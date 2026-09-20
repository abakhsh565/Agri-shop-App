-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0134: one confirm, one sale — even if the button is tapped twice
-- ═══════════════════════════════════════════════════════════════════════════════
-- REPORTED BY THE PRODUCT OWNER: "once I create a sale and double-click confirm,
-- it's created twice in the system but it is only one sale".
--
-- ROOT CAUSE
--   create_sale() had no idempotency at all: every call inserted a new sale and
--   deducted stock again. The confirm button sets its own `loading` state, but a
--   double tap fires two click handlers before React re-renders, so both reached
--   the RPC. The returns path already had an idempotency_key (0052, restored in
--   0130) — sales never did.
--
-- FIX (two layers, database is the authority)
--   1. A ledger keyed by (shop_id, idempotency_key). The first caller CLAIMS the
--      key with an INSERT ... ON CONFLICT DO NOTHING, which is atomic under
--      concurrency — two simultaneous taps cannot both win. The loser gets the
--      sale the winner created instead of creating a second one.
--   2. create_sale becomes a thin wrapper. The real implementation is renamed and
--      its EXECUTE is revoked from clients, so the unchecked path is not reachable
--      from a browser at all. No money/inventory logic was rewritten, which keeps
--      the verified stock, COGS and outstanding behaviour untouched.
--
-- A retry AFTER a genuine failure still works: if the inner function raises (say
-- INSUFFICIENT_STOCK) the whole transaction rolls back, ledger row included, so the
-- same key can be used again. Only a *successful* first attempt blocks a second.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The ledger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_submissions (
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  sale_id         uuid REFERENCES public.sales(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, idempotency_key)
);

COMMENT ON TABLE public.sale_submissions IS
  'One row per confirmed sale submission. Exists so a double-tap (or a retry after a lost response) cannot create a second sale.';

ALTER TABLE public.sale_submissions ENABLE ROW LEVEL SECURITY;
-- An EXPLICIT "nobody" policy rather than simply no policies: this table is
-- touched only by the SECURITY DEFINER wrapper below, and the Engineering OS
-- invariant (tests/integration/rbacInvariants.test.ts) treats an RLS-enabled
-- table with zero policies as a bug — rightly, because that is what hid tenant
-- data before. Stating the intent keeps the guard meaningful instead of adding an
-- exception to it. The function owner is not subject to RLS, so the wrapper still
-- works.
DROP POLICY IF EXISTS sale_submissions_no_client_access ON public.sale_submissions;
CREATE POLICY sale_submissions_no_client_access ON public.sale_submissions
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Keep the real implementation, out of reach
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Re-runnable: only rename while the wrapper does not exist yet.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_sale'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_sale_unchecked'
  ) THEN
    ALTER FUNCTION public.create_sale(jsonb) RENAME TO create_sale_unchecked;
  END IF;
END $$;

-- The unchecked path must never be callable by a client: without that, a browser
-- could bypass the guard simply by naming the other function.
REVOKE EXECUTE ON FUNCTION public.create_sale_unchecked(jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The wrapper the client calls
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key      text;
  v_shop_id  uuid;
  v_actor    uuid;
  v_existing record;
  v_out      jsonb;
BEGIN
  -- The key is optional: a caller that does not send one gets the old behaviour
  -- exactly (used by scripts/tests, never by the confirm button).
  v_key := NULLIF(COALESCE(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  IF v_key IS NULL THEN
    RETURN public.create_sale_unchecked(payload);
  END IF;

  -- Same tenant/actor resolution the inner function performs, so the ledger is
  -- scoped to the caller's own shop and cannot be used to probe another tenant.
  SELECT (r->>'shop_id')::uuid, (r->>'actor_id')::uuid
    INTO v_shop_id, v_actor
    FROM (SELECT public.resolve_shop_and_actor(
            NULLIF(payload->>'shopId', '')::uuid,
            NULLIF(payload->>'userId', '')::uuid,
            NULLIF(payload->>'createdBy', '')::uuid) AS r) s;

  -- Authorize HERE as well as inside the inner function: this is the function
  -- clients can actually call, so the check that guards the write must be visible
  -- on the path a client takes (the Engineering OS invariant asserts exactly that).
  PERFORM public.authorize_business_action('sales.create', v_shop_id, NULLIF(payload->>'branchId', '')::uuid);

  -- Claim the key. Only one caller can win this insert.
  INSERT INTO public.sale_submissions (shop_id, idempotency_key)
  VALUES (v_shop_id, v_key)
  ON CONFLICT (shop_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    -- Already submitted. Return THAT sale — a second confirm must be a no-op, not
    -- a second sale, and not an error the shop owner has to interpret.
    SELECT s.id, s.sale_number, s.total_amount, s.amount_paid, s.amount_due
      INTO v_existing
      FROM public.sale_submissions ss
      JOIN public.sales s ON s.id = ss.sale_id
     WHERE ss.shop_id = v_shop_id AND ss.idempotency_key = v_key;

    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'saleNumber', v_existing.sale_number,
        'totalAmount', v_existing.total_amount,
        'amountPaid', v_existing.amount_paid,
        'outstandingBalance', v_existing.amount_due,
        'duplicate', true
      );
    END IF;

    -- Claimed but unfinished: another tap is still in flight. Refusing is correct —
    -- creating the sale here is exactly the duplication we are preventing.
    RAISE EXCEPTION 'DUPLICATE_SUBMISSION';
  END IF;

  v_out := public.create_sale_unchecked(payload);

  UPDATE public.sale_submissions
     SET sale_id = (v_out->>'id')::uuid
   WHERE shop_id = v_shop_id AND idempotency_key = v_key;

  RETURN v_out;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_sale(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_sale(jsonb) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Prove it against the live database
-- ─────────────────────────────────────────────────────────────────────────────
-- (Verified in tests/integration/saleIdempotency.test.ts: two calls with one key
--  create one sale and deduct stock once; a retry after a failed attempt creates
--  the sale; and an un-keyed call still behaves exactly as before.)
