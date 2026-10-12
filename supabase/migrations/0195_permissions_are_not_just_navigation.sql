-- Owner is the only implicit permission set. Ordinary admin/employee memberships
-- use their existing reusable role + explicit grants/denials, without changing identity.
CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id,public.app_current_user_id());
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_permissions text[];
BEGIN
  IF v_actor IS NULL OR v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_actor IS DISTINCT FROM v_user AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
  END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_member.role='owner' THEN
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM public.permissions;
  ELSE
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM (
      SELECT p.code FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
        JOIN public.roles r ON r.id=rp.role_id AND r.tenant_id=v_member.tenant_id
        WHERE rp.role_id=v_member.role_id
      UNION SELECT p.code FROM public.user_permissions up JOIN public.permissions p ON p.id=up.permission_id
        WHERE up.user_id=v_user AND up.is_override AND up.is_granted
      EXCEPT SELECT p.code FROM public.user_permissions up JOIN public.permissions p ON p.id=up.permission_id
        WHERE up.user_id=v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;
  RETURN to_jsonb(COALESCE(v_permissions,'{}'::text[]));
END;
$$;

-- Restrictive policies supplement (never OR around) the existing tenant and
-- branch boundaries. Direct PostgREST calls must not bypass hidden navigation.
DO $$
DECLARE v_table text; v_permission text; v_pair text[];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ['sales','sales.view'],['purchases','purchases.view'],['returns','returns.view'],
    ['customer_payments','customers.view'],['supplier_payments','payments.view'],
    ['inventory_movements','inventory.view'],['stock_adjustments','inventory.view'],
    ['products','products.view'],['customers','customers.view'],['companies','companies.view']
  ] LOOP
    v_table:=v_pair[1]; v_permission:=v_pair[2];
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('DROP POLICY IF EXISTS permission_read_gate ON public.%I',v_table);
    EXECUTE format('CREATE POLICY permission_read_gate ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
      USING (public.current_branch_id() IS NOT NULL AND public.has_effective_permission(%L::varchar))',v_table,v_permission);
  END LOOP;
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ['sales','sales.create'],['purchases','purchases.create'],['returns','returns.create'],
    ['customer_payments','customers.payments'],['supplier_payments','payments.supplier'],
    ['inventory_movements','inventory.adjust'],['stock_adjustments','inventory.adjust'],
    ['products','products.create'],['customers','customers.create'],['companies','companies.create']
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS permission_insert_gate ON public.%I',v_pair[1]);
    EXECUTE format('CREATE POLICY permission_insert_gate ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.current_branch_id() IS NOT NULL AND public.has_effective_permission(%L::varchar))',v_pair[1],v_pair[2]);
  END LOOP;
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ['sales','sales.create'],['products','products.edit'],['customers','customers.edit'],['companies','companies.edit']
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS permission_update_gate ON public.%I',v_pair[1]);
    EXECUTE format('CREATE POLICY permission_update_gate ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.current_branch_id() IS NOT NULL AND public.has_effective_permission(%L::varchar))
      WITH CHECK (public.current_branch_id() IS NOT NULL AND public.has_effective_permission(%L::varchar))',v_pair[1],v_pair[2],v_pair[2]);
  END LOOP;
END $$;

-- Operations carrying money must use the existing atomic RPCs. A direct ledger
-- insert/update/delete could otherwise bypass balance, stock and history invariants.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.sales,public.sale_items,public.purchases,public.purchase_items,
  public.returns,public.return_items,public.customer_payments,public.supplier_payments,public.voids,
  public.inventory_movements,public.stock_adjustments FROM authenticated,anon;
-- Sales notes have an existing direct update path; column permission is not a
-- licence to alter totals, actors, status or branch ownership.
GRANT UPDATE(notes) ON public.sales TO authenticated;
NOTIFY pgrst,'reload schema';
