-- MIGRATION 0160: barcode registry and history
--
-- The barcode rules the shop needs, and where each one is enforced:
--
--   1. One barcode belongs to exactly one product, always.
--   2. A barcode that is deleted or replaced is never forgotten.
--   3. A retired barcode can never be reused, on this or any other product.
--   4. History is kept apart from the live code, so deleting or replacing a barcode cannot
--      touch a past sale. (Sales reference `product_id`/`variant_id`, never the code, so the
--      code was never load-bearing for history — this makes that explicit and permanent.)
--
-- 0158 gave the shop `product_barcodes`, with `unique (shop_id, code)`. That stops two LIVE
-- products sharing a code, which is rule 1 only while nothing is ever deleted: remove the row
-- and the code is free again, so it can be handed to another product tomorrow, and a mistake
-- made last month silently becomes somebody else's barcode. The unique index cannot express
-- "and never again", because it only knows about rows that still exist.
--
-- So the claim is separated from the code. `barcode_registry` holds one row per code a shop
-- has EVER used, forever, with the product holding it now and the one that first claimed it.
-- Nothing is deleted from it: deleting a barcode sets the claim to 'retired', which is what
-- makes "never reused" enforceable rather than aspirational. `barcode_history` is the
-- readable trail for a product screen. Both are written only by triggers here, on every path
-- in — `create_product`, `update_product`, a scan, or raw SQL — so the rule cannot be
-- side-stepped by a client that forgets to call the right function.
--
-- `product_barcodes` keeps its own role: it is the ANSWER to "what does this code scan to
-- today?", which is the question a sale asks. The registry answers "did this code ever exist,
-- and whose was it?" — the question a delete or a rename asks.

-- The code as a scanner sees it: no whitespace, upper case. One normalisation function, used
-- by the claim path, by the generators and by the backfill, so a code cannot mean two things.
CREATE OR REPLACE FUNCTION public.barcode_normalize(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$function$;

CREATE TABLE IF NOT EXISTS public.barcode_registry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL,
  code             varchar NOT NULL,
  -- The product holding the code now; NULL once it has been retired.
  product_id       uuid,
  -- The product that first claimed it. Kept even after retirement, so an old code can always
  -- be traced back to what it was once on.
  first_product_id uuid,
  -- 'active'  — this code is on this product today
  -- 'retired' — deleted or replaced; spent forever, never claimable again
  status           varchar NOT NULL DEFAULT 'active',
  source           varchar NOT NULL DEFAULT 'generated',
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  claimed_by       uuid,
  retired_at       timestamptz,
  retired_reason   varchar,
  CONSTRAINT barcode_registry_status_check CHECK (status IN ('active', 'retired')),
  CONSTRAINT barcode_registry_code_unique UNIQUE (shop_id, code)
);

COMMENT ON TABLE public.barcode_registry IS
  'Every barcode this shop has ever used. Append-only: a retired code is never deleted and can never be claimed again ("never reused"). product_barcodes answers "what scans to what today"; this answers "whose was this code ever".';

-- The trail a product screen shows: what was added, replaced or deleted, by whom, and when.
CREATE TABLE IF NOT EXISTS public.barcode_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL,
  product_id    uuid NOT NULL,
  code          varchar NOT NULL,
  -- For a replacement, the code that this one took over from.
  previous_code varchar,
  action        varchar NOT NULL,
  source        varchar,
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  reason        varchar,
  CONSTRAINT barcode_history_action_check CHECK (action IN ('added', 'replaced', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_barcode_history_product
  ON public.barcode_history (product_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_barcode_registry_product
  ON public.barcode_registry (product_id);

COMMENT ON TABLE public.barcode_history IS
  'Append-only trail of every barcode added to, replaced on, or deleted from a product. Deleting or replacing a code records here and touches nothing else: sales reference product_id/variant_id, so no past sale depends on a barcode.';

-- ── The claim ────────────────────────────────────────────────────────────────
--
-- Raises when the code is spoken for. One function, so `create_product`,
-- `update_product`, the barcode RPCs and raw SQL all get the identical answer.
CREATE OR REPLACE FUNCTION public.claim_barcode(
  p_shop       uuid,
  p_product_id uuid,
  p_code       text,
  p_source     text,
  p_actor      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code text := public.barcode_normalize(p_code);
  v_row  public.barcode_registry;
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'BARCODE_EMPTY: a barcode cannot be blank';
  END IF;

  SELECT * INTO v_row FROM public.barcode_registry
   WHERE shop_id = p_shop AND code = v_code;

  IF FOUND THEN
    -- Retired means spent. This is rule 3, and it is the reason the registry exists at all:
    -- the live table cannot remember a code it no longer contains.
    IF v_row.status = 'retired' THEN
      RAISE EXCEPTION 'BARCODE_RETIRED: "%" was used before and retired; a retired barcode can never be reused', v_code;
    END IF;
    -- Rule 1: one code, one product, forever.
    IF v_row.product_id IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'BARCODE_TAKEN: "%" already belongs to another product', v_code;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.barcode_registry
    (shop_id, code, product_id, first_product_id, status, source, claimed_by)
  VALUES
    (p_shop, v_code, p_product_id, p_product_id, 'active', COALESCE(p_source, 'generated'), p_actor);
END;
$function$;

-- ── Retiring a code ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.retire_barcode(
  p_shop      uuid,
  p_code      text,
  p_reason    text,
  p_retired_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code text := public.barcode_normalize(p_code);
BEGIN
  IF v_code = '' THEN RETURN; END IF;

  UPDATE public.barcode_registry
     SET status         = 'retired',
         product_id     = NULL,
         retired_at     = now(),
         retired_reason = p_reason
   WHERE shop_id = p_shop
     AND code = v_code
     AND status = 'active';

  -- If the code was never registered (a row written before this migration, or by a path that
  -- bypassed the claim), register it as retired now rather than letting it be reused later.
  IF NOT FOUND THEN
    INSERT INTO public.barcode_registry
      (shop_id, code, product_id, first_product_id, status, source, retired_at, retired_reason, claimed_by)
    VALUES
      (p_shop, v_code, NULL, NULL, 'retired', 'unknown', now(), p_reason, p_retired_by)
    ON CONFLICT (shop_id, code) DO NOTHING;
  END IF;
END;
$function$;

-- ── Enforcement, on every write path ─────────────────────────────────────────
--
-- BEFORE INSERT OR UPDATE OF code: claim the incoming code, and when it is taking over from
-- a different one, retire the old code and record the replacement. Doing it BEFORE means the
-- row cannot land unclaimed, so there is no window in which a code is live and unowned.
CREATE OR REPLACE FUNCTION public.barcode_claim_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_reason text := NULLIF(current_setting('app.barcode_reason', true), '');
  -- Who did it now, not who created the row originally: on an update `created_by` is the
  -- person who added the code months ago, and the trail is about the change.
  v_actor  uuid := COALESCE(public.app_current_user_id(), NEW.created_by);
BEGIN
  NEW.code := public.barcode_normalize(NEW.code);

  PERFORM public.claim_barcode(NEW.shop_id, NEW.product_id, NEW.code, NEW.source, v_actor);

  IF TG_OP = 'UPDATE' AND public.barcode_normalize(OLD.code) IS DISTINCT FROM NEW.code THEN
    PERFORM public.retire_barcode(NEW.shop_id, OLD.code, coalesce(v_reason, 'replaced'), v_actor);

    INSERT INTO public.barcode_history
      (shop_id, product_id, code, previous_code, action, source, changed_by, reason)
    VALUES
      (NEW.shop_id, NEW.product_id, NEW.code, public.barcode_normalize(OLD.code), 'replaced',
       NEW.source, v_actor, v_reason);
  END IF;

  RETURN NEW;
END;
$function$;

-- AFTER INSERT: the trail entry for a code going on a product. A database-minted code and a
-- typed one are the same event to the shop, so both record as 'added' with the source kept.
CREATE OR REPLACE FUNCTION public.barcode_added_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.barcode_history
    (shop_id, product_id, code, action, source, changed_by)
  VALUES
    (NEW.shop_id, NEW.product_id, NEW.code, 'added', NEW.source,
     COALESCE(public.app_current_user_id(), NEW.created_by));
  RETURN NEW;
END;
$function$;

-- AFTER DELETE: the code is retired, not forgotten. The registry row stays forever, which is
-- what makes it impossible to hand this code to another product later.
CREATE OR REPLACE FUNCTION public.barcode_deleted_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_reason text := NULLIF(current_setting('app.barcode_reason', true), '');
BEGIN
  PERFORM public.retire_barcode(OLD.shop_id, OLD.code, coalesce(v_reason, 'deleted'),
                                COALESCE(public.app_current_user_id(), OLD.created_by));

  INSERT INTO public.barcode_history
    (shop_id, product_id, code, action, source, changed_by, reason)
  VALUES
    (OLD.shop_id, OLD.product_id, public.barcode_normalize(OLD.code), 'deleted',
     OLD.source, COALESCE(public.app_current_user_id(), OLD.created_by), v_reason);
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS barcode_claim_trigger ON public.product_barcodes;
CREATE TRIGGER barcode_claim_trigger
  BEFORE INSERT OR UPDATE OF code ON public.product_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.barcode_claim_trigger();

DROP TRIGGER IF EXISTS barcode_added_trigger ON public.product_barcodes;
CREATE TRIGGER barcode_added_trigger
  AFTER INSERT ON public.product_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.barcode_added_trigger();

DROP TRIGGER IF EXISTS barcode_deleted_trigger ON public.product_barcodes;
CREATE TRIGGER barcode_deleted_trigger
  AFTER DELETE ON public.product_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.barcode_deleted_trigger();

-- ── Backfill: every code already in use is claimed ───────────────────────────
-- A code live today was live before this migration, so it must already be spoken for;
-- otherwise the first product to be given a retired code would be allowed to take it.
INSERT INTO public.barcode_registry
  (shop_id, code, product_id, first_product_id, status, source, claimed_at, claimed_by)
SELECT b.shop_id, public.barcode_normalize(b.code), b.product_id, b.product_id, 'active',
       COALESCE(b.source, 'generated'), b.created_at, b.created_by
  FROM public.product_barcodes b
 WHERE public.barcode_normalize(b.code) <> ''
ON CONFLICT (shop_id, code) DO NOTHING;

-- Codes that predate product_barcodes live only on `products.barcode`. Claim them too, so a
-- legacy code cannot be taken by a new product while the old one still shows it.
INSERT INTO public.barcode_registry
  (shop_id, code, product_id, first_product_id, status, source, claimed_at)
SELECT p.shop_id, public.barcode_normalize(p.barcode), p.id, p.id, 'active', 'legacy', p.created_at
  FROM public.products p
 WHERE public.barcode_normalize(p.barcode) <> ''
ON CONFLICT (shop_id, code) DO NOTHING;

INSERT INTO public.barcode_history (shop_id, product_id, code, action, source, changed_by, changed_at)
SELECT b.shop_id, b.product_id, public.barcode_normalize(b.code), 'added',
       COALESCE(b.source, 'generated'), b.created_by, b.created_at
  FROM public.product_barcodes b
 WHERE public.barcode_normalize(b.code) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM public.barcode_history h
      WHERE h.product_id = b.product_id AND h.code = public.barcode_normalize(b.code)
   );

-- ── Append-only, enforced by grants rather than by good intentions ───────────
-- The triggers write these tables as their owner (SECURITY DEFINER). The app may read its own
-- shop's rows and nothing more: no INSERT, no UPDATE, no DELETE, so history cannot be rewritten
-- from a client even by accident.
ALTER TABLE public.barcode_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barcode_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barcode_registry_select_shop ON public.barcode_registry;
CREATE POLICY barcode_registry_select_shop ON public.barcode_registry
  FOR SELECT USING (shop_id = current_shop_id());

DROP POLICY IF EXISTS barcode_history_select_shop ON public.barcode_history;
CREATE POLICY barcode_history_select_shop ON public.barcode_history
  FOR SELECT USING (shop_id = current_shop_id());

REVOKE ALL ON public.barcode_registry FROM authenticated, anon;
REVOKE ALL ON public.barcode_history  FROM authenticated, anon;
GRANT SELECT ON public.barcode_registry TO authenticated;
GRANT SELECT ON public.barcode_history  TO authenticated;

-- ── Generating a code that is free FOREVER, not merely free today ────────────
-- mint_barcode (0158) skipped codes live in `product_barcodes`. With retirement that is no
-- longer enough: a retired code is not in that table, so it could be handed out again.
-- Redefinition only — same signature, so no caller changes.
CREATE OR REPLACE FUNCTION public.mint_barcode(p_name text, p_shop uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
DECLARE
  v_stem text;
  v_code text;
  v_try  int := 0;
BEGIN
  -- A readable stem from the product's name; anything unnameable still gets a valid code.
  v_stem := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  v_stem := rpad(coalesce(nullif(substr(v_stem, 1, 4), ''), 'PRD'), 4, 'X');

  LOOP
    v_try := v_try + 1;
    -- Two digits is the familiar shape; if a shop has genuinely filled all 99 slots for
    -- one stem, the code grows rather than failing to be handed out.
    v_code := 'AGS-' || v_stem || '-' || CASE
      WHEN v_try <= 200 THEN lpad((1 + floor(random() * 99))::int::text, 2, '0')
      ELSE lpad((100 + floor(random() * 899))::int::text, 3, '0')
    END;

    -- Free means free in the registry — which every code this shop has ever used is in, live
    -- or retired. Checking `product_barcodes` alone would offer back a retired code.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.barcode_registry WHERE shop_id = p_shop AND code = v_code
    );
    IF v_try > 400 THEN
      RAISE EXCEPTION 'BARCODE_MINT_FAILED: could not find a free code for this shop';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$function$;

-- ── What the app calls ───────────────────────────────────────────────────────

/**
 * Suggest a code for this shop without claiming it, so "Generate" can show the owner the code
 * before anything is written — and can never propose one that is retired or spoken for.
 */
CREATE OR REPLACE FUNCTION public.preview_product_barcode(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.mint_barcode(p_name, public.current_shop_id());
$function$;

/**
 * Put a code on a product: typed in, scanned off a label, or generated by the button above.
 * Replaces the product's current code when it has one, which retires the old code and records
 * the replacement. Authorized as an edit, because that is what it is.
 */
CREATE OR REPLACE FUNCTION public.set_product_barcode(
  p_product_id uuid,
  p_code       text,
  p_source     text DEFAULT 'supplied',
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_shop  uuid;
  v_code  text := public.barcode_normalize(p_code);
  v_row   uuid;
BEGIN
  SELECT shop_id INTO v_shop FROM public.products WHERE id = p_product_id;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

  PERFORM public.authorize_business_action('products.edit', v_shop);
  IF v_code = '' THEN RAISE EXCEPTION 'BARCODE_EMPTY: a barcode cannot be blank'; END IF;

  -- The delete/replace reason travels to the triggers through the transaction, so the trail
  -- can say why a code was retired without every trigger needing a parameter.
  PERFORM set_config('app.barcode_reason', coalesce(p_reason, ''), true);

  SELECT id INTO v_row FROM public.product_barcodes
   WHERE product_id = p_product_id AND is_primary LIMIT 1;

  IF v_row IS NOT NULL THEN
    UPDATE public.product_barcodes SET code = v_code, source = COALESCE(p_source, 'supplied')
     WHERE id = v_row;
  ELSE
    INSERT INTO public.product_barcodes (shop_id, product_id, code, is_primary, source, created_by)
    VALUES (v_shop, p_product_id, v_code, true, COALESCE(p_source, 'supplied'), v_actor);
  END IF;

  PERFORM set_config('app.barcode_reason', '', true);
  RETURN jsonb_build_object('productId', p_product_id, 'code', v_code);
END;
$function$;

/**
 * Take the barcode off a product. The code is retired into the registry, never deleted, so it
 * can never be put on anything again — and no past sale is affected, because sales reference
 * the product and the variant, not the code.
 */
CREATE OR REPLACE FUNCTION public.delete_product_barcode(
  p_product_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop  uuid;
  v_count int;
BEGIN
  SELECT shop_id INTO v_shop FROM public.products WHERE id = p_product_id;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

  PERFORM public.authorize_business_action('products.edit', v_shop);

  -- Raise a typed error when there is nothing to remove, rather than returning success for a
  -- delete that did nothing.
  IF NOT EXISTS (SELECT 1 FROM public.product_barcodes WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'BARCODE_NONE: this product has no barcode to delete';
  END IF;

  PERFORM set_config('app.barcode_reason', coalesce(p_reason, ''), true);
  DELETE FROM public.product_barcodes WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.barcode_reason', '', true);

  RETURN jsonb_build_object('productId', p_product_id, 'deleted', v_count);
END;
$function$;

/**
 * Everything the product screen needs about codes: what it has now, and what it used to have.
 * One call, so the screen cannot show a current code and a stale history side by side.
 */
CREATE OR REPLACE FUNCTION public.product_barcodes_for(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shop uuid;
  v_now  jsonb;
  v_past jsonb;
BEGIN
  SELECT shop_id INTO v_shop FROM public.products WHERE id = p_product_id;
  IF v_shop IS NULL OR v_shop IS DISTINCT FROM public.current_shop_id() THEN
    RETURN jsonb_build_object('current', '[]'::jsonb, 'history', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', b.code, 'isPrimary', b.is_primary, 'source', b.source, 'createdAt', b.created_at
         ) ORDER BY b.is_primary DESC, b.created_at), '[]'::jsonb)
    INTO v_now
    FROM public.product_barcodes b
   WHERE b.product_id = p_product_id;

  -- Only codes that are no longer on the product: the live one is the field above it, and
  -- listing it twice would read as two barcodes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', h.code, 'previousCode', h.previous_code, 'action', h.action,
           'source', h.source, 'changedAt', h.changed_at, 'reason', h.reason,
           'retired', COALESCE(r.status = 'retired', false)
         ) ORDER BY h.changed_at DESC), '[]'::jsonb)
    INTO v_past
    FROM public.barcode_history h
    LEFT JOIN public.barcode_registry r ON r.shop_id = h.shop_id AND r.code = h.code
   WHERE h.product_id = p_product_id
     AND NOT EXISTS (
       SELECT 1 FROM public.product_barcodes b
        WHERE b.product_id = h.product_id AND b.code = h.code
     );

  RETURN jsonb_build_object('current', v_now, 'history', v_past);
END;
$function$;
