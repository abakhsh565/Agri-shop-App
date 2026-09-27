-- 0154_set_customer_credit_limit.sql
--
-- Giving a customer a credit limit from the till.
--
-- Why this exists: a credit sale is blocked until the customer has a limit, and the blocker was
-- a dead end — the only way to set one was the request → approve round trip (credit_limit_requests,
-- 0062 → 0112), which needs a second person and a detour out of the sale. The owner standing at
-- the counter with the customer in front of them could not finish the sale at all.
--
-- This is the direct, authorised path: the same `customers.edit` permission the rest of the
-- customer surface uses (`update_customer_image`, `update_customer_due_date` in 0112), enforced
-- against the customer's own shop, so an employee without it is refused by the database rather
-- than only by the screen that hides the control.
--
-- The request/approve flow stays as it is — it is the right shape for an employee asking for more
-- room than they may grant themselves. This function is for an actor who already holds the
-- permission, and it is the only thing the app writes `customers.credit_limit` through.

CREATE OR REPLACE FUNCTION public.set_customer_credit_limit(
  p_customer_id uuid,
  p_credit_limit numeric
)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_shop uuid;
  v_before numeric;
BEGIN
  IF p_credit_limit IS NULL OR p_credit_limit < 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_LIMIT';
  END IF;

  SELECT shop_id, credit_limit INTO v_shop, v_before FROM customers WHERE id = p_customer_id;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  PERFORM authorize_business_action('customers.edit', v_shop);

  UPDATE customers
     SET credit_limit = p_credit_limit,
         updated_at = now()
   WHERE id = p_customer_id;

  -- Same shape as the rest of the trail (0011/0012): who did it, to which record, and both
  -- values, so a limit that moves later can be explained.
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (
    app_current_user_id(),
    'customer_credit_limit_set',
    'customer',
    p_customer_id,
    jsonb_build_object('from', v_before, 'to', p_credit_limit)
  );

  RETURN p_credit_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_customer_credit_limit(uuid, numeric) TO authenticated;
