-- 0272 — an approval request is not a way around the delegation's data scope.
--
-- Before this, request_co_owner_approval() only checked that the payload had a
-- saleId/customerId. A Co-Owner could name an unassigned branch's record and let
-- the owner execute it. The target is now checked when the request is created and
-- again when the owner approves it, against the stored grant rather than a
-- client-supplied scope.
CREATE OR REPLACE FUNCTION public.co_owner_approval_target_allowed(
  p_grant_id uuid, p_action_code text, p_payload jsonb
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant public.co_owner_grants;
  v_sale public.sales;
  v_customer public.customers;
  v_id uuid;
BEGIN
  SELECT * INTO v_grant FROM public.co_owner_grants WHERE id = p_grant_id AND status = 'active';
  IF v_grant.id IS NULL THEN RETURN false; END IF;

  IF p_action_code = 'sale.void' THEN
    BEGIN v_id := NULLIF(p_payload->>'saleId', '')::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
    IF v_id IS NULL THEN RETURN false; END IF;
    SELECT * INTO v_sale FROM public.sales
      WHERE id = v_id AND shop_id = v_grant.tenant_id;
    IF v_sale.id IS NULL THEN RETURN false; END IF;
    IF NOT public.co_owner_branch_allowed(v_grant.id, v_sale.branch_id) THEN RETURN false; END IF;
    IF v_sale.customer_id IS NOT NULL
       AND NOT public.co_owner_record_allowed(v_grant.id, 'customer', v_sale.customer_id) THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  IF p_action_code IN ('customer.credit_limit', 'customer.archive') THEN
    BEGIN v_id := NULLIF(p_payload->>'customerId', '')::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
    IF v_id IS NULL THEN RETURN false; END IF;
    SELECT * INTO v_customer FROM public.customers
      WHERE id = v_id AND shop_id = v_grant.tenant_id;
    IF v_customer.id IS NULL THEN RETURN false; END IF;
    RETURN public.co_owner_record_allowed(v_grant.id, 'customer', v_customer.id);
  END IF;

  -- Inventory adjustments and supplier payments do not yet carry enough target
  -- data here to prove both the branch and supplier boundary. They stay closed
  -- until their approval payloads can be validated end to end.
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_approval_target_allowed(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_approval_target_allowed(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_co_owner_approval_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant public.co_owner_grants;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_by <> public.app_current_user_id() THEN RETURN NEW; END IF;
    IF NOT public.co_owner_approval_target_allowed(NEW.grant_id, NEW.action_code, NEW.payload) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: target is outside the Co-Owner grant';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    SELECT * INTO v_grant FROM public.co_owner_grants
      WHERE id = NEW.grant_id AND status = 'active';
    IF v_grant.id IS NULL THEN
      RAISE EXCEPTION 'GRANT_NOT_ACTIVE';
    END IF;
    IF NOT public.co_owner_approval_target_allowed(NEW.grant_id, NEW.action_code, NEW.payload) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: target is outside the Co-Owner grant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_co_owner_approval_target_trg ON public.co_owner_approval_requests;
CREATE TRIGGER guard_co_owner_approval_target_trg
  BEFORE INSERT OR UPDATE ON public.co_owner_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_co_owner_approval_target();

NOTIFY pgrst, 'reload schema';
