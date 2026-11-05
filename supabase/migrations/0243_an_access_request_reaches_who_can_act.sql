-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0243: an access request reaches the people who can act on it
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR
--   An employee who does not have the shop code has no way to name the shop at
--   sign-in, so they cannot ask the server to check an invitation. The owner can
--   read the code out, but only if the employee can reach them. This is the
--   reverse of the invitation: the employee enters the owner's phone number and
--   asks to join.
--
-- WHAT IT IS NOT
--   A request does not create a membership, a user, or a session. It is a note
--   to the owner/admin. Only the existing path can grant access: the owner adds
--   the person (create_employee -> pending membership -> employee OTP). The
--   request page's "already invited" case is read-only and still requires the
--   owner to share the code.
--
-- WHY NOT `notifications`
--   Notifications are readable by every active member of the shop at the RLS
--   layer (0197). An employee's name and phone number do not belong in a row a
--   colleague can select directly. The notification written here is deliberately
--   generic and points at a request row; only a caller with `employees.manage`
--   can read that row through the RPCs below.
--
-- WHO MAY SEE A REQUEST
--   The table is server-owned: RLS is on, there are no policies, and every grant
--   is revoked. Reads and writes travel through SECURITY DEFINER functions that
--   begin with `authorize_business_action('employees.manage')`. A custom role
--   such as Store Manager therefore works too, without turning `membership_role`
--   into a second permission system.
--
-- ONE OWNER NUMBER, ONE BUSINESS
--   `users.phone` is unique. An owner who runs several shops can hold several
--   memberships, so the resolver prefers the owner's home shop (`users.shop_id`)
--   and then the oldest managed membership. The request is business-level
--   because the employee does not know a branch yet; the owner chooses the
--   branch when adding them.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employee_access_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  requester_name  text,
  requester_phone text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'dismissed')),
  employee_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- One open request per number per business. A second tap is the same request,
-- not a second notification; the RPC reports the existing id.
CREATE UNIQUE INDEX IF NOT EXISTS employee_access_requests_one_pending
  ON public.employee_access_requests (shop_id, requester_phone)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS employee_access_requests_shop_created
  ON public.employee_access_requests (shop_id, created_at DESC);

ALTER TABLE public.employee_access_requests ENABLE ROW LEVEL SECURITY;

-- No client role reads or writes this table directly. The functions below are
-- the only door, so a future policy cannot accidentally widen the request
-- details to a colleague.
REVOKE ALL ON TABLE public.employee_access_requests FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.employee_access_requests IS
  'An employee asking an owner/admin to add them. Server-owned; readable only through list/get RPCs that require employees.manage. A request never grants access by itself.';

-- ── 1. The employee's request, callable before a session exists ────────────────
-- Returns `{sent:false, reason}` for a wrong number rather than raising an
-- opaque database error the login screen would have to translate. The three
-- reasons are stable API: owner_not_found, rate_limited, same_phone.
CREATE OR REPLACE FUNCTION public.request_employee_access(
  p_owner_phone     text,
  p_requester_name  text,
  p_requester_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_phone     text := public.canonical_phone(p_owner_phone);
  v_requester_phone text := public.canonical_phone(p_requester_phone);
  v_name            text := NULLIF(btrim(COALESCE(p_requester_name, '')), '');
  v_shop_id         uuid;
  v_request_id      uuid;
  v_existing_id     uuid;
  v_recent          int;
BEGIN
  IF v_owner_phone IS NULL OR v_requester_phone IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: phone numbers are required';
  END IF;
  IF v_owner_phone = v_requester_phone THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'same_phone');
  END IF;
  IF length(v_name) > 80 THEN
    v_name := left(v_name, 80);
  END IF;

  -- The number must belong to someone who can actually add an employee in at
  -- least one shop. Checking the role name alone would miss a custom manager
  -- whose access comes from a role or a per-branch role.
  SELECT m.tenant_id
    INTO v_shop_id
    FROM public.users u
    JOIN public.memberships m
      ON m.user_id = u.id AND m.status = 'active'
   WHERE u.is_active
     AND public.canonical_phone(u.phone) = v_owner_phone
     AND (
       m.role IN ('owner', 'admin')
       OR EXISTS (
         SELECT 1
           FROM public.role_permissions rp
           JOIN public.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = m.role_id AND p.code = 'employees.manage'
       )
       OR EXISTS (
         SELECT 1
           FROM public.membership_branch_roles mbr
           JOIN public.role_permissions rp ON rp.role_id = mbr.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
          WHERE mbr.membership_id = m.id AND p.code = 'employees.manage'
       )
     )
   ORDER BY (m.tenant_id = u.shop_id) DESC, m.created_at ASC
   LIMIT 1;

  IF v_shop_id IS NULL THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'owner_not_found');
  END IF;

  -- Idempotent before the rate limit: a person who taps twice is not spam.
  SELECT r.id INTO v_existing_id
    FROM public.employee_access_requests r
   WHERE r.shop_id = v_shop_id
     AND r.requester_phone = v_requester_phone
     AND r.status = 'pending'
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('sent', true, 'requestId', v_existing_id, 'duplicate', true);
  END IF;

  -- A request is cheap for the sender and visible to another person. Five a day
  -- is enough for a real correction, and stops a single number filling an
  -- owner's inbox.
  SELECT count(*) INTO v_recent
    FROM public.employee_access_requests r
   WHERE r.requester_phone = v_requester_phone
     AND r.created_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.employee_access_requests (shop_id, requester_name, requester_phone)
  VALUES (v_shop_id, v_name, v_requester_phone)
  ON CONFLICT (shop_id, requester_phone) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    SELECT r.id INTO v_existing_id
      FROM public.employee_access_requests r
     WHERE r.shop_id = v_shop_id
       AND r.requester_phone = v_requester_phone
       AND r.status = 'pending'
     LIMIT 1;
    RETURN jsonb_build_object('sent', true, 'requestId', v_existing_id, 'duplicate', true);
  END IF;

  -- Generic on purpose: the request details live in the protected table. This
  -- row is the owner's nudge, not the request.
  INSERT INTO public.notifications (kind, title, body, entity_id, shop_id, actor_name)
  VALUES (
    'employee_access_request',
    'New access request',
    'A new employee wants to join your shop',
    v_request_id,
    v_shop_id,
    v_name
  );

  RETURN jsonb_build_object('sent', true, 'requestId', v_request_id, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.request_employee_access(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_employee_access(text, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.request_employee_access(text, text, text) IS
  'Records an employee request for the owner/admin of the shop whose number was entered. Never creates access, never returns shop details, and is idempotent for a pending request.';

-- ── 2. The owner/manager inbox ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_employee_access_requests(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
BEGIN
  IF v_status IS NOT NULL AND v_status NOT IN ('pending', 'approved', 'dismissed') THEN
    RAISE EXCEPTION 'VALIDATION: unknown request status';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id,
             'name', COALESCE(r.requester_name, ''),
             'phone', r.requester_phone,
             'status', r.status,
             'createdAt', r.created_at,
             'resolvedAt', r.resolved_at,
             'employeeId', e.id,
             'membershipStatus', e.status
           ) ORDER BY (r.status = 'pending') DESC, r.created_at DESC)
      FROM public.employee_access_requests r
      LEFT JOIN LATERAL (
        SELECT u.id, m.status::text AS status
          FROM public.users u
          JOIN public.memberships m ON m.user_id = u.id
         WHERE m.tenant_id = r.shop_id
           AND public.canonical_phone(u.phone) = r.requester_phone
         ORDER BY m.created_at ASC
         LIMIT 1
      ) e ON true
     WHERE r.shop_id = v_tenant
       AND (v_status IS NULL OR r.status = v_status)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_employee_access_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_employee_access_requests(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_employee_access_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
  v_row public.employee_access_requests;
  v_employee_id uuid;
  v_membership_status text;
BEGIN
  SELECT * INTO v_row
    FROM public.employee_access_requests r
   WHERE r.id = p_request_id AND r.shop_id = v_tenant;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;

  SELECT u.id, m.status::text
    INTO v_employee_id, v_membership_status
    FROM public.users u
    JOIN public.memberships m ON m.user_id = u.id
   WHERE m.tenant_id = v_tenant
     AND public.canonical_phone(u.phone) = v_row.requester_phone
   ORDER BY m.created_at ASC
   LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', COALESCE(v_row.requester_name, ''),
    'phone', v_row.requester_phone,
    'status', v_row.status,
    'createdAt', v_row.created_at,
    'resolvedAt', v_row.resolved_at,
    'employeeId', v_employee_id,
    'membershipStatus', v_membership_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_access_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_access_request(uuid) TO authenticated;

-- ── 3. Resolving a request ─────────────────────────────────────────────────────
-- Linking is deliberate, not a side effect of opening the add screen. The
-- employee must belong to the same shop and carry the number the request named,
-- so a request cannot be closed by attaching somebody else's account.
CREATE OR REPLACE FUNCTION public.mark_employee_access_request_added(
  p_request_id  uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
  v_row public.employee_access_requests;
BEGIN
  SELECT * INTO v_row
    FROM public.employee_access_requests r
   WHERE r.id = p_request_id AND r.shop_id = v_tenant;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.users u
      JOIN public.memberships m ON m.user_id = u.id
     WHERE u.id = p_employee_id
       AND m.tenant_id = v_tenant
       AND public.canonical_phone(u.phone) = v_row.requester_phone
  ) THEN
    RAISE EXCEPTION 'EMPLOYEE_DOES_NOT_MATCH_REQUEST';
  END IF;

  UPDATE public.employee_access_requests
     SET status = 'approved',
         employee_id = p_employee_id,
         resolved_at = COALESCE(resolved_at, now()),
         resolved_by = public.app_current_user_id()
   WHERE id = p_request_id AND shop_id = v_tenant;

  RETURN jsonb_build_object('updated', true, 'requestId', p_request_id, 'employeeId', p_employee_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_employee_access_request_added(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_employee_access_request_added(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_employee_access_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
BEGIN
  UPDATE public.employee_access_requests
     SET status = 'dismissed',
         resolved_at = now(),
         resolved_by = public.app_current_user_id()
   WHERE id = p_request_id
     AND shop_id = v_tenant
     AND status = 'pending';

  RETURN jsonb_build_object('updated', FOUND, 'requestId', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_employee_access_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_employee_access_request(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_employee_access_requests(text) IS
  'The access-request inbox for an owner/admin/manager. Scoped to the active business and requires employees.manage.';
COMMENT ON FUNCTION public.get_employee_access_request(uuid) IS
  'One access request, its requester, and whether that number already has a membership in this business.';
COMMENT ON FUNCTION public.mark_employee_access_request_added(uuid, uuid) IS
  'Closes a request after the owner added the matching number to the business. Refuses an employee from another shop or a different phone.';
COMMENT ON FUNCTION public.dismiss_employee_access_request(uuid) IS
  'Dismisses a pending request. It does not remove the requester or grant anything.';

NOTIFY pgrst, 'reload schema';
