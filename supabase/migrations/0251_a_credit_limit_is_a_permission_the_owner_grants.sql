-- ═══════════════════════════════════════════════════════════════════════════════
-- 0251 — A credit limit is a permission the owner grants, and the owner's number wins
--
-- Two gaps, both reported from the employee side.
--
-- 1. SETTING A CREDIT LIMIT WAS FOLDED INTO `customers.edit`
--    The direct path (0154) asked only for the ability to edit a customer, so "may correct a
--    phone number" and "may let this customer owe 500,000" were the same switch. The owner
--    asked for them to be separate: a person can be trusted with the customer record and not
--    with the shop's lending. This file adds `customers.credit_limit` and points the direct
--    RPC at it. Nothing changes for the roles that could already do it — every role that held
--    `customers.edit` keeps the ability (see the grant below); the switch exists so the owner
--    can turn it OFF for a person, and so a grant can be given WITHOUT handing over the rest
--    of the customer surface. An employee without it is not blocked: the request path
--    (`create_credit_limit_request`, unchanged) asks the owner, and approving is already
--    gated on `alerts.manage`.
--
-- 2. THE OWNER COULD NOT CHANGE THE NUMBER BEFORE APPROVING
--    `approve_credit_limit_request_v2` applied `requested_limit` verbatim, so an employee who
--    asked for 100,000 got 100,000 if the owner approved at all — the owner's only other option
--    was to reject and ask again. v3 takes the owner's own figure: the request carries what was
--    asked for, the approval carries what was granted, and `credit_limit_requests.approved_limit`
--    records the granted one so the history says both. Passing the same number is the ordinary
--    case and needs no ceremony.
--
--    v2 stays in place, unchanged in behaviour except that it now also records `approved_limit`
--    (the amount it granted). Nothing calls it from the app any more, but other callers holding
--    the old signature keep working instead of failing at the point of approval.
--
-- Forward-only, idempotent: safe to re-apply, and no file above this one is rewritten.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The permission ────────────────────────────────────────────────────────────
-- Module stays `customers` so the owner reads it with the rest of the customer choices in
-- Employees → Access ("Customers · Set Credit Limit"). `action` is a new verb on purpose:
-- the checklist composes its label from module + action, and reusing `edit` would draw a
-- second row that says exactly what the first one says.
INSERT INTO permissions (code, module, action, label_en, label_ur)
VALUES (
  'customers.credit_limit',
  'customers',
  'credit_limit',
  'Set Credit Limit',
  'ادھار کی حد مقرر کریں'
)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Role defaults: whoever could do this keeps doing it ───────────────────────
-- Sales Manager and Store Manager hold `customers.edit` today (0107/0220), which was the old
-- requirement — so they are granted the new permission by exactly that rule, and a role that
-- never had `customers.edit` (Sales Employee, Inventory Clerk) does not silently gain lending
-- authority. New shops copy their system roles' grants from these rows (0150), so the default
-- travels with the template.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.code = 'customers.edit'
CROSS JOIN permissions p_new
WHERE p_new.code = 'customers.credit_limit'
ON CONFLICT DO NOTHING;

-- ── 3. The direct path now asks for the lending permission ───────────────────────
-- Body unchanged from 0154 apart from the authorization line, so every earlier property
-- (non-negative limit, customer must exist, audited from → to) still holds.
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

  -- Was `customers.edit` (0154). Editing a customer and lending to them are separate
  -- decisions, and this is the line the owner's switch actually moves.
  PERFORM authorize_business_action('customers.credit_limit', v_shop);

  UPDATE customers
     SET credit_limit = p_credit_limit,
         updated_at = now()
   WHERE id = p_customer_id;

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

-- ── 4. What was granted, not only what was asked ─────────────────────────────────
-- The granted figure gets its own column: the request row is the record of the conversation
-- ("asked 100,000, owner granted 50,000"), and the owner's screens read it without replaying
-- audit events.
ALTER TABLE credit_limit_requests ADD COLUMN IF NOT EXISTS approved_limit numeric;

CREATE OR REPLACE FUNCTION public.approve_credit_limit_request_v3(
  p_request_id uuid,
  p_reviewed_by text,
  p_approved_limit numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req RECORD;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
  v_effective numeric;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  IF p_approved_limit IS NOT NULL AND p_approved_limit < 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_LIMIT';
  END IF;

  -- Locked while it is read: two taps on Approve used to race to apply two different numbers,
  -- and the second overwrote the first with no trace of the disagreement.
  SELECT * INTO req FROM credit_limit_requests
   WHERE id = p_request_id AND status = 'pending'
   FOR UPDATE;
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  -- The owner's figure when one was given; otherwise the amount that was asked for.
  v_effective := COALESCE(p_approved_limit, req.requested_limit);

  UPDATE credit_limit_requests
     SET status = 'approved',
         approved_limit = v_effective,
         reviewed_by = COALESCE(p_reviewed_by, v_actor::text),
         reviewed_at = now()
   WHERE id = p_request_id;

  UPDATE customers
     SET credit_limit = v_effective,
         updated_at = now()
   WHERE id = req.customer_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_approved', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'requested', req.requested_limit, 'approved', v_effective));

  RETURN jsonb_build_object('status', 'approved', 'requestedLimit', req.requested_limit, 'approvedLimit', v_effective);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.approve_credit_limit_request_v3(uuid, text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_credit_limit_request_v3(uuid, text, numeric) FROM PUBLIC, anon;

-- The old signature keeps working for callers that still send it, and now records the figure
-- it grants. Behaviour is otherwise identical to 0112's definition.
CREATE OR REPLACE FUNCTION public.approve_credit_limit_request_v2(p_request_id uuid, p_reviewed_by text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req RECORD;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests
   WHERE id = p_request_id AND status = 'pending'
   FOR UPDATE;
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests
     SET status = 'approved',
         approved_limit = req.requested_limit,
         reviewed_by = COALESCE(p_reviewed_by, v_actor::text),
         reviewed_at = now()
   WHERE id = p_request_id;

  UPDATE customers SET credit_limit = req.requested_limit, updated_at = now() WHERE id = req.customer_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_approved', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'requested', req.requested_limit, 'approved', req.requested_limit));

  RETURN jsonb_build_object('status', 'approved', 'requestedLimit', req.requested_limit, 'approvedLimit', req.requested_limit);
END;
$function$;

-- ── Assertions — the migration fails loudly rather than half-applying ────────────
DO $assert$
DECLARE
  v_permission int;
  v_missing int;
  v_signature text;
BEGIN
  SELECT count(*) INTO v_permission FROM permissions WHERE code = 'customers.credit_limit';
  IF v_permission <> 1 THEN
    RAISE EXCEPTION '0251: customers.credit_limit permission was not created (found %)', v_permission;
  END IF;

  SELECT count(*) INTO v_missing
  FROM role_permissions rp
  JOIN permissions pe ON pe.id = rp.permission_id AND pe.code = 'customers.edit'
  WHERE NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    JOIN permissions pn ON pn.id = rp2.permission_id
    WHERE rp2.role_id = rp.role_id AND pn.code = 'customers.credit_limit'
  );
  IF v_missing > 0 THEN
    RAISE EXCEPTION '0251: % role(s) can edit customers but cannot set a credit limit', v_missing;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_signature
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_customer_credit_limit';
  IF v_signature IS NULL OR v_signature NOT LIKE '%customers.credit_limit%' THEN
    RAISE EXCEPTION '0251: set_customer_credit_limit still does not ask for the credit-limit permission';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'approve_credit_limit_request_v3'
  ) THEN
    RAISE EXCEPTION '0251: approve_credit_limit_request_v3 is missing';
  END IF;
END
$assert$;
