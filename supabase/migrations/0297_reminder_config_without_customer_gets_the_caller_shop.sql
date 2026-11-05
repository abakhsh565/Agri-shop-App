-- 0297 — A reminder config without a customer still belongs to the caller's shop.
--
-- WHY THIS EXISTS. tenantIsolationOps inserts a reminder_config directly as the
-- owner with NO shop_id and NO customer_id, and expects the insert to succeed with
-- shop_id stamped to the caller's tenant. It fails with a row-level-security error.
-- Two things are wrong, both on the schema side (the test's expectation is the
-- product's own rule: a direct insert names its tenant or is stamped with it):
--   * `enforce_reminder_config_tenant()` (0122) stamps shop_id from the config's
--     customer — but returns the row unchanged when customer_id IS NULL, so a
--     shop-wide config (no customer) keeps shop_id NULL and every INSERT policy
--     refuses it.
--   * the 0242 `reminder_configs_branch` policy demands
--     `customer_in_branch(customer_id)` for every row — which is false for a NULL
--     customer_id (EXISTS over `customer_id = NULL` matches nothing), so a
--     customer-less config could never pass that policy even after stamping.
-- A config with no customer is a shop-wide config, not a tenant-less one.
--
-- WHAT THIS DOES.
--   * Restates `enforce_reminder_config_tenant()` (0122 body verbatim) with one
--     addition: when customer_id IS NULL and shop_id IS NULL, the trigger stamps
--     shop_id from `current_shop_id()` — the caller's own shop. The customer path
--     is unchanged: a config naming a customer still inherits that customer's shop,
--     and a shop_id that disagrees with the customer's shop is still refused.
--     An explicitly cross-tenant shop_id with no customer is left alone, so the
--     RLS check still refuses it (the second test case).
--   * Relaxes the 0242 `reminder_configs_branch` policy so the branch half reads
--     `(customer_id IS NULL OR customer_in_branch(customer_id))` in both USING and
--     WITH CHECK. The shop half is unchanged.
--
-- WHY IT IS SAFE TO APPLY. The trigger is BEFORE INSERT OR UPDATE and SECURITY
-- DEFINER, like the 0241 stamp triggers; it only ever fills a NULL shop_id, never
-- overwrites one. A stamped shop_id still has to pass the RLS WITH CHECK
-- (shop_id = current_shop_id()), so a caller with no active shop still cannot
-- write. The policy relaxation only admits rows with no customer — rows that name a
-- customer still have to be in the caller's branch exactly as before.

CREATE OR REPLACE FUNCTION public.enforce_reminder_config_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_customer_shop uuid;
BEGIN
  IF NEW.customer_id IS NULL THEN
    -- A shop-wide config names no customer, so there is no customer shop to
    -- inherit. Stamp the caller's own shop; the RLS check still refuses the row
    -- when the caller has no active shop, and an explicitly cross-tenant shop_id
    -- is left alone for the RLS check to refuse.
    IF NEW.shop_id IS NULL THEN
      NEW.shop_id := public.current_shop_id();
    END IF;
    RETURN NEW;
  END IF;

  SELECT c.shop_id INTO v_customer_shop FROM customers c WHERE c.id = NEW.customer_id;
  IF v_customer_shop IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  IF NEW.shop_id IS NOT NULL AND NEW.shop_id IS DISTINCT FROM v_customer_shop THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: reminder customer belongs to another tenant';
  END IF;
  IF NEW.shop_id IS NULL THEN
    NEW.shop_id := v_customer_shop;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS reminder_configs_branch ON public.reminder_configs;
CREATE POLICY reminder_configs_branch ON public.reminder_configs
  FOR ALL TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND (customer_id IS NULL OR public.customer_in_branch(customer_id))
  )
  WITH CHECK (
    shop_id = public.current_shop_id()
    AND (customer_id IS NULL OR public.customer_in_branch(customer_id))
  );

NOTIFY pgrst, 'reload schema';

-- Assertion: the trigger stamps a customer-less config, and the policy admits one.
DO $$
DECLARE
  v_def text;
  v_qual text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_reminder_config_tenant';
  IF v_def IS NULL OR v_def NOT LIKE '%NEW.shop_id := public.current_shop_id()%' THEN
    RAISE EXCEPTION '0297: the trigger does not stamp the caller shop for a customer-less config';
  END IF;
  IF v_def NOT LIKE '%NOT_AUTHORIZED: reminder customer belongs to another tenant%' THEN
    RAISE EXCEPTION '0297: the cross-tenant customer refusal was lost in the restatement';
  END IF;
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'reminder_configs'
     AND policyname = 'reminder_configs_branch' AND cmd = 'ALL';
  IF v_qual IS NULL
     OR v_qual NOT LIKE '%customer_id IS NULL%'
     OR v_qual NOT LIKE '%customer_in_branch%' THEN
    RAISE EXCEPTION '0297: reminder_configs_branch still demands a customer for every row';
  END IF;
END $$;
