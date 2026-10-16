-- Extend the existing audit history, never a duplicate log.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS actor_role_id uuid,
  ADD COLUMN IF NOT EXISTS branch_scope uuid[];
-- Deliberately no cascading references: deletion must not erase attribution.
-- Historical role/branch context is unknown, not retroactively invented.

CREATE OR REPLACE FUNCTION public.audit_context_stamp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_role_name text;
  v_entity_branch uuid;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  NEW.user_id := v_actor;
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: audit context unavailable'; END IF;
  NEW.tenant_id := v_member.tenant_id;
  NEW.actor_role_id := v_member.role_id;
  SELECT name INTO v_role_name FROM public.roles WHERE id = v_member.role_id;
  NEW.actor_role := COALESCE(v_role_name, v_member.role::text);
  NEW.branch_scope := v_member.branch_scope;

  -- Prefer the consequential record's actual branch, not a caller's actor or
  -- branch-manager identity. Non-record actions use the selected branch.
  IF NEW.entity_type = 'sale' THEN
    SELECT branch_id INTO v_entity_branch FROM public.sales WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'purchase' THEN
    SELECT branch_id INTO v_entity_branch FROM public.purchases WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'return' THEN
    SELECT branch_id INTO v_entity_branch FROM public.returns WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'branch' THEN
    SELECT id INTO v_entity_branch FROM public.branches WHERE id = NEW.entity_id;
  END IF;
  NEW.branch_id := COALESCE(v_entity_branch, NEW.branch_id, public.current_branch_id());
  IF NEW.branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id
     AND b.tenant_id = v_member.tenant_id
     AND (v_member.role = 'owner' OR
       b.id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: audit branch access denied'; END IF;
  NEW.details := COALESCE(NEW.details, '{}'::jsonb) || jsonb_build_object('result','succeeded');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_context_stamp_trg ON public.audit_events;
CREATE TRIGGER audit_context_stamp_trg BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_context_stamp();

-- Ordinary sale creation was not audited. A row trigger covers the current
-- sale writer and any future/direct writer; idempotent retries insert no row.
CREATE OR REPLACE FUNCTION public.audit_sale_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, branch_id, details)
  VALUES (public.app_current_user_id(), 'sale_created', 'sale', NEW.id, NEW.branch_id,
    jsonb_build_object('after', jsonb_build_object('saleNumber',NEW.sale_number,
      'totalAmount',NEW.total_amount,'amountPaid',NEW.amount_paid,
      'amountDue',NEW.amount_due,'customerId',NEW.customer_id)));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_sale_created_trg ON public.sales;
CREATE TRIGGER audit_sale_created_trg AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.audit_sale_created();

-- The permission must have a real read result, scoped by the action's tenant
-- and branch, not by the actor's mutable home-shop field.
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_select ON public.audit_events;
CREATE POLICY audit_events_select ON public.audit_events FOR SELECT TO authenticated
  USING (public.has_effective_permission('activity.view') AND
    tenant_id = public.current_shop_id() AND
    (public.allowed_branch_scope() IS NULL OR branch_id = ANY(public.allowed_branch_scope())));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_events FROM authenticated, anon;

-- A locked row makes concurrent Add/Move requests serial. Only branch_scope
-- changes: phone, person, role, permissions and every historical row stay put.
CREATE OR REPLACE FUNCTION public.assign_employee_branch(
  p_employee_id uuid, p_branch_id uuid, p_action text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member public.memberships;
  v_scope uuid[];
BEGIN
  v_tenant := public.authorize_business_action('employees.manage', NULL, p_branch_id);
  IF p_branch_id IS DISTINCT FROM public.current_branch_id() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: select this branch before assigning an employee';
  END IF;
  IF p_action NOT IN ('add','move') OR p_action IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: choose add or move';
  END IF;
  SELECT m.* INTO v_member FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
   WHERE m.user_id = p_employee_id AND m.tenant_id = v_tenant
     AND m.role = 'employee' AND NOT u.is_original_owner AND u.is_active
   FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF p_action = 'move' THEN v_scope := ARRAY[p_branch_id];
  ELSE
    -- Missing historical scope is no authority. Add cannot preserve a grant
    -- that never existed, and cannot implicitly convert it to every branch.
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_scope
      FROM unnest(COALESCE(v_member.branch_scope, '{}'::uuid[]) || ARRAY[p_branch_id]) x;
  END IF;
  IF v_scope IS NOT DISTINCT FROM v_member.branch_scope THEN
    RETURN jsonb_build_object('id',p_employee_id,'branchScope',v_scope,'changed',false,'idempotent',true);
  END IF;
  UPDATE public.memberships SET branch_scope = v_scope, updated_at = now()
    WHERE id = v_member.id;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'employee_branch_' || p_action,'user',p_employee_id,p_branch_id,
    jsonb_build_object('before',v_member.branch_scope,'after',v_scope));
  RETURN jsonb_build_object('id',p_employee_id,'branchScope',v_scope,'changed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_employee_branch(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_employee_branch(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
