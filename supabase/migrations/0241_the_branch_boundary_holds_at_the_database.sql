-- ═══════════════════════════════════════════════════════════════════════════════
-- Branch isolation at the database boundary
--
-- The branch policies existed, but two things defeated them:
--
--   1. each `permission_*_gate` policy was PERMISSIVE, so it was OR-ed with the
--      row policy. A permission check that is true for every row lets every row
--      through regardless of the branch policy beside it;
--   2. several tables kept a second shop-wide SELECT policy, which was also OR-ed
--      with the branch policy.
--
-- The gates become RESTRICTIVE (the caller must have the permission) and the
-- shop-wide row policies are removed, leaving the branch policy as the only row
-- filter. Customers, companies and products get an explicit branch association,
-- because a shop-scoped row has no branch to filter on.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Permission gates become restrictive ───────────────────────────────────
-- PostgreSQL has no ALTER POLICY ... AS RESTRICTIVE, so each gate is recreated
-- with the same command, roles and expressions. Its old PERMISSIVE form was
-- OR-ed with the row policy; the RESTRICTIVE form is AND-ed with it.
DO $$
DECLARE
  r record;
  v_roles text;
  v_sql text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, qual, with_check, roles
      FROM pg_policies
     WHERE schemaname = 'public' AND policyname LIKE 'permission\_%\_gate'
  LOOP
    SELECT string_agg(CASE WHEN role_name = 'public' THEN 'public' ELSE quote_ident(role_name) END, ', ')
      INTO v_roles
      FROM unnest(r.roles) AS t(role_name);

    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);

    v_sql := format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO %s',
                    r.policyname, r.tablename, r.cmd, v_roles);
    IF r.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', r.qual);
    END IF;
    IF r.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', r.with_check);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- ── 2. Customer / supplier branch association ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_branches (
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, branch_id)
);
CREATE INDEX IF NOT EXISTS customer_branches_branch_idx
  ON public.customer_branches (branch_id, customer_id);
ALTER TABLE public.customer_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_branches FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.company_branches (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, branch_id)
);
CREATE INDEX IF NOT EXISTS company_branches_branch_idx
  ON public.company_branches (branch_id, company_id);
ALTER TABLE public.company_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_branches FROM PUBLIC, anon, authenticated;

-- The policies below need to ask these questions without recursing through the
-- customer/company RLS policies themselves, so the helpers are definer-scoped.
CREATE OR REPLACE FUNCTION public.customer_in_branch(
  p_customer uuid,
  p_branch uuid DEFAULT public.current_branch_id()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_branches cb
     WHERE cb.customer_id = p_customer AND cb.branch_id = p_branch
  );
$$;

CREATE OR REPLACE FUNCTION public.company_in_branch(
  p_company uuid,
  p_branch uuid DEFAULT public.current_branch_id()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_branches cb
     WHERE cb.company_id = p_company AND cb.branch_id = p_branch
  );
$$;

CREATE OR REPLACE FUNCTION public.product_in_branch(
  p_product uuid,
  p_branch uuid DEFAULT public.current_branch_id()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.product_branches pb
     WHERE pb.product_id = p_product AND pb.branch_id = p_branch
  );
$$;

GRANT EXECUTE ON FUNCTION public.customer_in_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_in_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_in_branch(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.customer_in_branch(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_in_branch(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_in_branch(uuid, uuid) FROM PUBLIC, anon;

-- A customer/supplier created in a branch belongs to it. When there is no
-- branch context (seed data, service call), the shop's default branch is used.
CREATE OR REPLACE FUNCTION public.stamp_customer_branch_on_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid;
BEGIN
  SELECT b.id INTO v_branch FROM public.branches b
   WHERE b.id = public.current_branch_id() AND b.tenant_id = NEW.shop_id AND b.is_active;
  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch FROM public.branches b
     WHERE b.tenant_id = NEW.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1;
  END IF;
  IF v_branch IS NOT NULL THEN
    INSERT INTO public.customer_branches (customer_id, branch_id)
    VALUES (NEW.id, v_branch) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.stamp_company_branch_on_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid;
BEGIN
  SELECT b.id INTO v_branch FROM public.branches b
   WHERE b.id = public.current_branch_id() AND b.tenant_id = NEW.shop_id AND b.is_active;
  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch FROM public.branches b
     WHERE b.tenant_id = NEW.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1;
  END IF;
  IF v_branch IS NOT NULL THEN
    INSERT INTO public.company_branches (company_id, branch_id)
    VALUES (NEW.id, v_branch) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_customer_branch_on_create_trg ON public.customers;
CREATE TRIGGER stamp_customer_branch_on_create_trg
  AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.stamp_customer_branch_on_create();

DROP TRIGGER IF EXISTS stamp_company_branch_on_create_trg ON public.companies;
CREATE TRIGGER stamp_company_branch_on_create_trg
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_branch_on_create();

-- Activity is what makes a person visible in a branch. The sale/payment/return
-- already carries the branch, so the relationship is recorded from the row that
-- actually happened, once.
CREATE OR REPLACE FUNCTION public.stamp_customer_branch_from_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.branch_id IS NOT NULL THEN
    INSERT INTO public.customer_branches (customer_id, branch_id)
    VALUES (NEW.customer_id, NEW.branch_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.stamp_company_branch_from_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.branch_id IS NOT NULL THEN
    INSERT INTO public.company_branches (company_id, branch_id)
    VALUES (NEW.company_id, NEW.branch_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_customer_branch_from_sale_trg ON public.sales;
CREATE TRIGGER stamp_customer_branch_from_sale_trg
  AFTER INSERT ON public.sales FOR EACH ROW
  EXECUTE FUNCTION public.stamp_customer_branch_from_activity();

DROP TRIGGER IF EXISTS stamp_customer_branch_from_payment_trg ON public.customer_payments;
CREATE TRIGGER stamp_customer_branch_from_payment_trg
  AFTER INSERT ON public.customer_payments FOR EACH ROW
  EXECUTE FUNCTION public.stamp_customer_branch_from_activity();

DROP TRIGGER IF EXISTS stamp_customer_branch_from_return_trg ON public.returns;
CREATE TRIGGER stamp_customer_branch_from_return_trg
  AFTER INSERT ON public.returns FOR EACH ROW
  EXECUTE FUNCTION public.stamp_customer_branch_from_activity();

DROP TRIGGER IF EXISTS stamp_company_branch_from_purchase_trg ON public.purchases;
CREATE TRIGGER stamp_company_branch_from_purchase_trg
  AFTER INSERT ON public.purchases FOR EACH ROW
  EXECUTE FUNCTION public.stamp_company_branch_from_activity();

DROP TRIGGER IF EXISTS stamp_company_branch_from_payment_trg ON public.supplier_payments;
CREATE TRIGGER stamp_company_branch_from_payment_trg
  AFTER INSERT ON public.supplier_payments FOR EACH ROW
  EXECUTE FUNCTION public.stamp_company_branch_from_activity();

-- ── 3. Backfill from what already happened ───────────────────────────────────
INSERT INTO public.customer_branches (customer_id, branch_id)
SELECT DISTINCT s.customer_id, s.branch_id
  FROM public.sales s
 WHERE s.customer_id IS NOT NULL AND s.branch_id IS NOT NULL
UNION
SELECT DISTINCT p.customer_id, p.branch_id
  FROM public.customer_payments p
 WHERE p.customer_id IS NOT NULL AND p.branch_id IS NOT NULL
UNION
SELECT DISTINCT r.customer_id, r.branch_id
  FROM public.returns r
 WHERE r.customer_id IS NOT NULL AND r.branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.company_branches (company_id, branch_id)
SELECT DISTINCT p.company_id, p.branch_id
  FROM public.purchases p
 WHERE p.company_id IS NOT NULL AND p.branch_id IS NOT NULL
UNION
SELECT DISTINCT p.company_id, p.branch_id
  FROM public.supplier_payments p
 WHERE p.company_id IS NOT NULL AND p.branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- A customer or supplier with no activity still exists in the shop. It is shown
-- on the default active branch, never on every branch and never nowhere.
INSERT INTO public.customer_branches (customer_id, branch_id)
SELECT c.id, b.id
  FROM public.customers c
  JOIN LATERAL (
    SELECT b.id FROM public.branches b
     WHERE b.tenant_id = c.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1
  ) b ON true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.customer_branches cb
     JOIN public.branches br ON br.id = cb.branch_id
    WHERE cb.customer_id = c.id AND br.is_active
 )
ON CONFLICT DO NOTHING;

INSERT INTO public.company_branches (company_id, branch_id)
SELECT c.id, b.id
  FROM public.companies c
  JOIN LATERAL (
    SELECT b.id FROM public.branches b
     WHERE b.tenant_id = c.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1
  ) b ON true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.company_branches cb
     JOIN public.branches br ON br.id = cb.branch_id
    WHERE cb.company_id = c.id AND br.is_active
 )
ON CONFLICT DO NOTHING;

-- ── 4. Row policies: only the branch's rows ──────────────────────────────────
-- The branch policies on the transactional tables were written RESTRICTIVE. RLS
-- denies by default when a command has no PERMISSIVE policy at all, so each table
-- gets one explicit open policy; the restrictive permission gate and branch policy
-- then decide which rows survive. Without this the tables returned zero rows.
DROP POLICY IF EXISTS sales_read ON public.sales;
CREATE POLICY sales_read ON public.sales FOR SELECT USING (true);
DROP POLICY IF EXISTS purchases_read ON public.purchases;
CREATE POLICY purchases_read ON public.purchases FOR SELECT USING (true);
DROP POLICY IF EXISTS returns_read ON public.returns;
CREATE POLICY returns_read ON public.returns FOR SELECT USING (true);
DROP POLICY IF EXISTS stock_adjustments_read ON public.stock_adjustments;
CREATE POLICY stock_adjustments_read ON public.stock_adjustments FOR SELECT USING (true);
DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements FOR SELECT USING (true);
DROP POLICY IF EXISTS customer_payments_read ON public.customer_payments;
CREATE POLICY customer_payments_read ON public.customer_payments FOR SELECT USING (true);
DROP POLICY IF EXISTS supplier_payments_read ON public.supplier_payments;
CREATE POLICY supplier_payments_read ON public.supplier_payments FOR SELECT USING (true);

DROP POLICY IF EXISTS sales_select ON public.sales;
DROP POLICY IF EXISTS purchases_select ON public.purchases;
DROP POLICY IF EXISTS returns_select ON public.returns;
DROP POLICY IF EXISTS stock_adjustments_select ON public.stock_adjustments;
DROP POLICY IF EXISTS inventory_movements_select ON public.inventory_movements;
DROP POLICY IF EXISTS customer_payments_select ON public.customer_payments;
DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;

DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_branch_select ON public.products FOR SELECT USING (
  shop_id = public.current_shop_id() AND public.product_in_branch(id)
);

DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_branch_select ON public.product_variants FOR SELECT USING (
  public.product_in_branch(product_id)
);

DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_branch_select ON public.customers FOR SELECT USING (
  shop_id = public.current_shop_id() AND public.customer_in_branch(id)
);
DROP POLICY IF EXISTS customers_update ON public.customers;
CREATE POLICY customers_branch_update ON public.customers FOR UPDATE USING (
  shop_id = public.current_shop_id() AND public.customer_in_branch(id)
) WITH CHECK (shop_id = public.current_shop_id());

DROP POLICY IF EXISTS companies_select ON public.companies;
CREATE POLICY companies_branch_select ON public.companies FOR SELECT USING (
  shop_id = public.current_shop_id() AND public.company_in_branch(id)
);
DROP POLICY IF EXISTS companies_update ON public.companies;
CREATE POLICY companies_branch_update ON public.companies FOR UPDATE USING (
  shop_id = public.current_shop_id() AND public.company_in_branch(id)
) WITH CHECK (shop_id = public.current_shop_id());

-- Credit-limit requests follow the customer they belong to.
DROP POLICY IF EXISTS credit_limit_requests_tenant ON public.credit_limit_requests;
CREATE POLICY credit_limit_requests_branch ON public.credit_limit_requests FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.customers c
     WHERE c.id = credit_limit_requests.customer_id
       AND c.shop_id = public.current_shop_id()
       AND public.customer_in_branch(c.id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.customers c
     WHERE c.id = credit_limit_requests.customer_id
       AND c.shop_id = public.current_shop_id()
       AND public.customer_in_branch(c.id)
  )
);
