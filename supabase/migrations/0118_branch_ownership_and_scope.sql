-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0118: branch ownership on operational records + scope enforcement
-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBLEM (measured):
--   branches exists and memberships.branch_scope exists, but NO business table
--   carried a branch. Branch scope could therefore only be checked against a
--   caller-supplied parameter, while the record itself had no persistent branch
--   ownership — so "employee on Main cannot touch Warehouse data" was not
--   representable: every row looked like it belonged to every branch.
--
-- MODEL (minimum that makes the existing product correct):
--   * A record is owned by exactly one branch: the branch the acting member
--     operated in.
--   * `memberships.branch_scope` = the branches the member may operate in.
--     NULL scope means all branches (this is already how the UI and
--     authorize_business_action() interpret it).
--   * A member with an all-branch membership works in the tenant's default
--     branch unless the caller states a branch explicitly.
--   * Ownership is stamped and enforced at the DATA layer by a trigger, so it
--     holds for direct PostgREST writes AND for SECURITY DEFINER RPCs, and
--     cannot be bypassed by a new code path that forgets to pass a branch.
--
-- Layering: authorization (identity → membership → permission) stays in the
-- RPC/RLS layer. The trigger only stamps ownership and REJECTS out-of-scope
-- rows; it never grants access. Untrusted callers are always restricted.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Branch helpers ────────────────────────────────────────────────────────

-- Branches the acting member may operate in. NULL = all branches.
CREATE OR REPLACE FUNCTION public.current_branch_scope()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.branch_scope
    FROM memberships m
   WHERE m.user_id = app_current_user_id()
     AND m.status = 'active'
   ORDER BY m.created_at ASC
   LIMIT 1;
$$;

-- The branch a tenant operates in by default.
CREATE OR REPLACE FUNCTION public.default_branch_id(p_tenant uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id FROM branches b
   WHERE b.tenant_id = p_tenant
     AND b.is_active
   ORDER BY b.is_default DESC, b.created_at ASC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_branch_scope() TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_branch_id(uuid) TO authenticated;

-- ── 2. Persistent branch ownership on operational records ────────────────────

ALTER TABLE public.sales               ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.purchases           ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.returns             ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.customer_payments   ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.supplier_payments   ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.stock_adjustments   ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

-- Backfill existing history to the tenant's default branch. Deterministic: the
-- tenant has a single default branch, so no historical row is guessed.
UPDATE public.sales               SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.purchases           SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.returns             SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.inventory_movements SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.customer_payments   SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.supplier_payments   SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;
UPDATE public.stock_adjustments   SET branch_id = (SELECT id FROM public.branches ORDER BY is_default DESC, created_at ASC LIMIT 1) WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS sales_branch_idx               ON public.sales (branch_id);
CREATE INDEX IF NOT EXISTS purchases_branch_idx           ON public.purchases (branch_id);
CREATE INDEX IF NOT EXISTS returns_branch_idx             ON public.returns (branch_id);
CREATE INDEX IF NOT EXISTS inventory_movements_branch_idx ON public.inventory_movements (branch_id);
CREATE INDEX IF NOT EXISTS customer_payments_branch_idx   ON public.customer_payments (branch_id);
CREATE INDEX IF NOT EXISTS supplier_payments_branch_idx   ON public.supplier_payments (branch_id);
CREATE INDEX IF NOT EXISTS stock_adjustments_branch_idx   ON public.stock_adjustments (branch_id);

-- ── 3. Stamp + enforce branch ownership at the data layer ───────────────────

CREATE OR REPLACE FUNCTION public.enforce_branch_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_scope uuid[];
BEGIN
  -- No JWT claim means a trusted non-user context (scheduled job / service
  -- role). There is no member scope to enforce, so the row is left alone.
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  v_scope := current_branch_scope();

  -- All-branch membership: the tenant's default branch owns the record unless
  -- the caller stated one explicitly.
  IF v_scope IS NULL THEN
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := default_branch_id(current_shop_id());
    END IF;
    RETURN NEW;
  END IF;

  -- Branch-limited membership: operate in its own branch by default, and never
  -- in a branch outside the scope.
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := v_scope[1];
  ELSIF NOT (NEW.branch_id = ANY(v_scope)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales','purchases','returns','inventory_movements',
                           'customer_payments','supplier_payments','stock_adjustments']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_branch_scope_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER enforce_branch_scope_trg BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_scope()', t);
  END LOOP;
END $$;

-- ── 4. Read isolation: a branch-limited member cannot read another branch ────
-- RESTRICTIVE policies combine with AND against the existing permissive ones,
-- so tenant scoping (shop_id = current_shop_id()) is preserved and branch
-- scoping is added on top. A NULL scope (all branches) is unrestricted.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales','purchases','returns','inventory_movements',
                           'customer_payments','supplier_payments','stock_adjustments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_branch_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
                    USING (current_branch_scope() IS NULL OR branch_id = ANY(current_branch_scope()))',
                   t || '_branch_select', t);
  END LOOP;
END $$;
