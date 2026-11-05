-- 0298 — An access request names its requester's current membership, not the oldest.
--
-- WHY THIS EXISTS. tenantResolverReplay guards the rule that nobody re-derives the
-- active shop — or anything that stands in for it — from row age. The two 0243
-- functions (list_employee_access_requests, get_employee_access_request) already derive
-- the SHOP from the chain (authorize_business_action('employees.manage')), but the
-- LATERAL that resolves the REQUESTER's membership picked the OLDEST membership for
-- that phone (`ORDER BY m.created_at ASC LIMIT 1`). When a person left and rejoined,
-- or holds more than one membership row in the shop, the request shows the stale
-- membership and its status instead of the current one. The test flags the shape
-- because its text scan cannot tell a caller-scoped shop derivation from a
-- requester-membership lookup — and it is right that the oldest row should not
-- decide.
--
-- WHAT THIS DOES. Restates both functions byte-for-byte from 0243 with ONE change
-- each: the requester-membership pick becomes
-- `ORDER BY (m.status = 'active') DESC, m.created_at DESC LIMIT 1` — the active
-- membership first, then the newest. The shop derivation, the authorize call, the
-- filters and the returned shape are unchanged.
--
-- WHY IT IS SAFE TO APPLY. With a single membership for the phone the ordering is
-- irrelevant, so the common case is byte-identical in behaviour. With several, the
-- active/newest row is the membership that describes the person NOW, which is what
-- the request screen shows (employeeId, membershipStatus). CREATE OR REPLACE
-- FUNCTION keeps the existing grants.


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
         ORDER BY (m.status = 'active') DESC, m.created_at DESC
         LIMIT 1
      ) e ON true
     WHERE r.shop_id = v_tenant
       AND (v_status IS NULL OR r.status = v_status)
  ), '[]'::jsonb);
END;
$$;


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
   ORDER BY (m.status = 'active') DESC, m.created_at DESC
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


NOTIFY pgrst, 'reload schema';

-- Assertion: neither function still derives from the oldest membership.
DO $$
DECLARE
  v_old text[];
BEGIN
  SELECT array_agg(f.fn ORDER BY f.fn) INTO v_old
    FROM (
      VALUES ('list_employee_access_requests'), ('get_employee_access_request')
    ) AS f(fn)
   WHERE EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = f.fn
        AND pg_get_functiondef(p.oid) ILIKE '%ORDER BY m.created_at ASC%'
   );
  IF v_old IS NOT NULL THEN
    RAISE EXCEPTION '0298: functions still pick the oldest membership: %', array_to_string(v_old, ', ');
  END IF;
END $$;
