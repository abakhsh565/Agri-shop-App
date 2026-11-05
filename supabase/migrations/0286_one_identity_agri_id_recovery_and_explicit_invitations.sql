-- ═══════════════════════════════════════════════════════════════════════════════
-- 0286: one person, one identity; Agri ID, recovery, and explicit invitations
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS ADDS
--   • users.agri_id — a permanent, user-facing identifier. Backfilled for every
--     existing row; new rows get one through the column default. The internal id,
--     memberships, shops and historical references are unchanged.
--   • a recovery key per person. It is a separate server-verified credential, stored
--     as a bcrypt hash plus a SHA-256 lookup so it can be used when both the phone
--     and the Agri ID are unavailable. Nobody can recover from the Agri ID alone.
--   • explicit invitation state on memberships. First sign-in no longer activates
--     every pending membership; the person accepts exactly one invitation.
--   • create_employee now attaches an existing person to a second shop instead of
--     refusing the phone or minting a duplicate user.
--
-- COMPATIBILITY
--   Existing user ids, memberships, roles, branch scopes, PIN hashes, auth rows and
--   historical rows are preserved. Pending memberships are backfilled as invitations;
--   active memberships are not touched. Phone uniqueness remains in force.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Agri ID ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_agri_id()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_value text;
  v_try int := 0;
BEGIN
  LOOP
    v_value := '';
    FOR i IN 1..8 LOOP
      v_value := v_value || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    v_value := 'AG-' || substr(v_value, 1, 4) || '-' || substr(v_value, 5, 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users u WHERE u.agri_id = v_value);
    v_try := v_try + 1;
    IF v_try > 40 THEN RAISE EXCEPTION 'AGRI_ID_GENERATION_FAILED'; END IF;
  END LOOP;
  RETURN v_value;
END;
$$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS agri_id text;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE agri_id IS NULL LOOP
    UPDATE public.users SET agri_id = public.generate_agri_id() WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.users ALTER COLUMN agri_id SET DEFAULT public.generate_agri_id();
ALTER TABLE public.users ALTER COLUMN agri_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_agri_id_key ON public.users (agri_id);

COMMENT ON COLUMN public.users.agri_id IS
  'Permanent user-facing identifier. It identifies a person but is never an authentication secret by itself.';

-- ── 2. Recovery key ───────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_key_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_key_lookup text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_key_created_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_locked_until timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_recovery_key_lookup_key
  ON public.users (recovery_key_lookup)
  WHERE recovery_key_lookup IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_recovery_key()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_value text := '';
BEGIN
  FOR i IN 1..16 LOOP
    v_value := v_value || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  END LOOP;
  RETURN 'RK-' || substr(v_value, 1, 4) || '-' || substr(v_value, 5, 4) || '-' ||
         substr(v_value, 9, 4) || '-' || substr(v_value, 13, 4);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_identity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
  v_row public.users;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_row FROM public.users WHERE id = v_uid;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'agri_id', v_row.agri_id,
    'phone', v_row.phone,
    'has_recovery_key', v_row.recovery_key_hash IS NOT NULL,
    'recovery_key_created_at', v_row.recovery_key_created_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_identity() TO authenticated;

-- Rotate the caller's own recovery key. The key is shown once by the client and never
-- stored there. The same key is written as the password of the account's existing auth
-- identity, which is what makes recovery possible when the old SIM is gone.
CREATE OR REPLACE FUNCTION public.rotate_my_recovery_key()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
  v_user public.users;
  v_key text;
  v_e164 text;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_user FROM public.users WHERE id = v_uid AND is_active;
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;

  v_key := public.generate_recovery_key();
  v_e164 := public.canonical_phone(v_user.phone);
  v_email := 'user-' || v_e164 || '@agrishop.auth.local';

  UPDATE public.users
     SET recovery_key_hash = extensions.crypt(v_key, extensions.gen_salt('bf')),
         recovery_key_lookup = encode(extensions.digest(upper(v_key), 'sha256'), 'hex'),
         recovery_key_created_at = now(),
         recovery_failed_count = 0,
         recovery_locked_until = NULL,
         updated_at = now()
   WHERE id = v_uid;

  -- Deliberately do NOT rewrite the auth password. The existing bridge, PIN restore and
  -- session resume derive that credential from the phone; replacing it would make a normal
  -- returning sign-in fail after a key was generated. The key is verified by this server-side
  -- hash, and only then is the normal session reopened for the identity that already exists.
  IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = v_uid) THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_MISSING';
  END IF;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (v_uid, 'recovery_key_rotated', 'user', v_uid, jsonb_build_object('hasKey', true));

  RETURN jsonb_build_object('agri_id', v_user.agri_id, 'recovery_key', upper(v_key));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rotate_my_recovery_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_my_recovery_key() TO authenticated;

-- Verify a recovery key before any session exists. Knowing the Agri ID alone does
-- nothing; the key is the secret. Supplying only the key is allowed too, which is the
-- case where both the number and the Agri ID were forgotten.
CREATE OR REPLACE FUNCTION public.verify_recovery_identity(
  p_agri_id text,
  p_recovery_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users;
  v_key text := upper(trim(COALESCE(p_recovery_key, '')));
  v_lookup text;
  v_failed int;
BEGIN
  IF v_key = '' THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  v_lookup := encode(extensions.digest(v_key, 'sha256'), 'hex');

  IF NULLIF(trim(COALESCE(p_agri_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_user FROM public.users
     WHERE upper(agri_id) = upper(trim(p_agri_id)) LIMIT 1;
  ELSE
    SELECT * INTO v_user FROM public.users
     WHERE recovery_key_lookup = v_lookup LIMIT 1;
  END IF;

  IF v_user.id IS NULL OR v_user.recovery_key_hash IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF NOT v_user.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;
  IF v_user.recovery_locked_until IS NOT NULL AND v_user.recovery_locked_until > now() THEN
    RETURN jsonb_build_object('status', 'locked');
  END IF;

  IF v_user.recovery_key_hash = extensions.crypt(v_key, v_user.recovery_key_hash) THEN
    UPDATE public.users
       SET recovery_failed_count = 0, recovery_locked_until = NULL
     WHERE id = v_user.id;
    IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = v_user.id) THEN
      RETURN jsonb_build_object('status', 'login_not_ready');
    END IF;
    RETURN jsonb_build_object(
      'status', 'ok',
      'agri_id', v_user.agri_id,
      'name', v_user.name,
      'phone', v_user.phone
    );
  END IF;

  v_failed := COALESCE(v_user.recovery_failed_count, 0) + 1;
  UPDATE public.users
     SET recovery_failed_count = v_failed,
         recovery_locked_until = CASE WHEN v_failed >= 5 THEN now() + interval '15 minutes' ELSE NULL END
   WHERE id = v_user.id;
  RETURN jsonb_build_object('status', 'invalid');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_recovery_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_recovery_identity(text, text) TO anon, authenticated;

-- ── 3. Login by phone OR Agri ID ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text := trim(COALESCE(p_identifier, ''));
  v_user public.users;
BEGIN
  IF v_raw = '' THEN RETURN jsonb_build_object('found', false); END IF;
  IF upper(v_raw) LIKE 'AG-%' THEN
    SELECT * INTO v_user FROM public.users WHERE upper(agri_id) = upper(v_raw) LIMIT 1;
  ELSE
    SELECT * INTO v_user FROM public.users
     WHERE public.canonical_phone(phone) = public.canonical_phone(v_raw)
     LIMIT 1;
  END IF;
  IF v_user.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object(
    'found', true,
    'phone', v_user.phone,
    'active', v_user.is_active,
    'role', v_user.role,
    'agri_id', v_user.agri_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_login_identifier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(text) TO anon, authenticated;

-- ── 4. Invitations are explicit ───────────────────────────────────────────────
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS declined_at timestamptz;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.users(id);

ALTER TABLE public.memberships ALTER COLUMN invited_at SET DEFAULT now();
ALTER TABLE public.memberships ALTER COLUMN invite_expires_at SET DEFAULT (now() + interval '14 days');

UPDATE public.memberships m
   SET invited_at = COALESCE(m.invited_at, m.created_at, now()),
       invite_expires_at = COALESCE(m.invite_expires_at, COALESCE(m.created_at, now()) + interval '90 days'),
       accepted_at = CASE WHEN m.status = 'active' THEN COALESCE(m.accepted_at, m.created_at) ELSE m.accepted_at END
 WHERE m.status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS memberships_pending_invites_idx
  ON public.memberships (user_id, status, invite_expires_at)
  WHERE status = 'pending';

-- The first sign-in no longer activates anything. Keeping this function callable preserves
-- the existing client contract while changing the rule: a person accepts one invitation.
CREATE OR REPLACE FUNCTION public.complete_member_onboarding()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
  v_pending int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT count(*)::int INTO v_pending
    FROM public.memberships
   WHERE user_id = v_uid AND status = 'pending' AND access_kind = 'standard';
  RETURN jsonb_build_object('activated', 0, 'pendingInvitations', v_pending);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_member_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_member_onboarding() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_invitations()
RETURNS TABLE (
  membership_id uuid,
  shop_id uuid,
  shop_name text,
  membership_role membership_role,
  role_name text,
  branch_names text[],
  inviter_name text,
  invited_at timestamptz,
  expires_at timestamptz,
  expired boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.tenant_id, s.name::text, m.role,
         r.name::text,
         COALESCE((
           SELECT array_agg(b.name ORDER BY b.is_default DESC, b.name)
             FROM branches b
            WHERE b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
         ), '{}'::text[]),
         u.name::text,
         COALESCE(m.invited_at, m.created_at),
         COALESCE(m.invite_expires_at, m.created_at + interval '90 days'),
         COALESCE(m.invite_expires_at, m.created_at + interval '90 days') < now()
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
    LEFT JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
    LEFT JOIN users u ON u.id = m.invited_by
   WHERE m.user_id = public.app_current_user_id()
     AND m.status = 'pending'
     AND m.access_kind = 'standard'
   ORDER BY COALESCE(m.invited_at, m.created_at) DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_invitations() TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_my_invitation(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
  v_invite public.memberships;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_invite FROM public.memberships
   WHERE id = p_membership_id AND user_id = v_uid
     AND status = 'pending' AND access_kind = 'standard'
   FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND'; END IF;
  IF COALESCE(v_invite.invite_expires_at, v_invite.created_at + interval '90 days') < now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;

  UPDATE public.memberships
     SET status = 'active'::membership_status, accepted_at = now(), updated_at = now()
   WHERE id = v_invite.id;

  -- The accepted shop becomes the working context of this one action. Other
  -- invitations remain pending and untouched.
  INSERT INTO public.user_active_shops (user_id, shop_id, updated_at)
  VALUES (v_uid, v_invite.tenant_id, now())
  ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, updated_at = now();

  -- An invitation can be accepted before a branch is chosen. The generic access-audit trigger
  -- cannot stamp a branch in that state, so this explicit event is written only when the
  -- accepted membership actually carries branch scope. The membership row is authoritative.
  IF v_invite.branch_scope IS NOT NULL AND cardinality(v_invite.branch_scope) > 0 THEN
    INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
    VALUES (v_uid, 'membership_invitation_accepted', 'membership', v_invite.id,
            jsonb_build_object('shop_id', v_invite.tenant_id, 'role', v_invite.role));
  END IF;

  RETURN jsonb_build_object('ok', true, 'shop_id', v_invite.tenant_id, 'membership_id', v_invite.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_my_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_my_invitation(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
  v_invite public.memberships;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_invite FROM public.memberships
   WHERE id = p_membership_id AND user_id = v_uid
     AND status = 'pending' AND access_kind = 'standard'
   FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND'; END IF;

  UPDATE public.memberships
     SET status = 'suspended'::membership_status, declined_at = now(), updated_at = now()
   WHERE id = v_invite.id;

  -- Deliberately no audit_events insert. A person whose only relationship is this pending
  -- invitation has no active-shop context, and the access journal's context guard correctly
  -- refuses a write from that state. The membership row itself — status, declined_at and
  -- updated_at — is the durable, queryable record of this decision.

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decline_my_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_my_invitation(uuid) TO authenticated;

-- A declined invitation removes no active access: it is still pending on its way out. The
-- audit trigger must not require an active-shop context for that transition, and the explicit
-- `membership_invitation_declined` row (when a context exists) records the decision.
CREATE OR REPLACE FUNCTION public.audit_membership_access_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('active', 'suspended') THEN RETURN NEW; END IF;
  IF public.app_current_user_id() IS NULL OR NOT EXISTS(SELECT 1 FROM public.membership_in_active_shop(NULL)) OR
    (NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope AND
      NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(public.app_current_user_id(),'membership_access_changed','user',NEW.user_id,
    jsonb_build_object('before',jsonb_build_object('roleId',OLD.role_id,'branchScope',OLD.branch_scope,'status',OLD.status),
      'after',jsonb_build_object('roleId',NEW.role_id,'branchScope',NEW.branch_scope,'status',NEW.status)));
  RETURN NEW;
END;
$$;

-- ── 5. Inviting a person who already exists ───────────────────────────────────
-- Wrap the existing creator. A phone with an account gets a membership invitation,
-- not a second users row and not a duplicate auth identity. The existing user id,
-- name, phone, PIN and other memberships stay exactly as they are.
CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_tenant uuid;
  v_created jsonb;
  v_id uuid;
  v_existing public.users;
  v_phone text;
  v_role membership_role := COALESCE(NULLIF(payload->>'membershipRole','')::membership_role, 'employee');
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid;
  v_scope uuid[];
  v_membership uuid;
  v_branch_id uuid;
  v_branch_role uuid;
BEGIN
  v_tenant := public.authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name','')) = '' OR NULLIF(payload->>'phone','') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;
  IF v_role = 'owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = v_role_id AND tenant_id = v_tenant
  ) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  v_phone := public.canonical_phone(payload->>'phone');
  IF v_phone IS NULL THEN RAISE EXCEPTION 'VALIDATION: a valid phone is required'; END IF;

  IF NOT (payload ? 'branchScope') THEN
    v_scope := ARRAY[public.current_branch_id()];
  ELSIF jsonb_typeof(payload->'branchScope') = 'array' THEN
    SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO v_scope
      FROM jsonb_array_elements_text(payload->'branchScope') x;
  ELSE RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
  IF v_scope IS NULL OR cardinality(v_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(v_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = v_tenant AND b.is_active
    ) OR (public.allowed_branch_scope() IS NOT NULL AND NOT (x = ANY(public.allowed_branch_scope())))
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;

  SELECT * INTO v_existing FROM public.users
   WHERE public.canonical_phone(phone) = v_phone LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF NOT v_existing.is_active THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = v_existing.id AND m.tenant_id = v_tenant AND m.status = 'active'
    ) THEN RAISE EXCEPTION 'ALREADY_A_MEMBER'; END IF;

    INSERT INTO public.memberships (
      user_id, tenant_id, role, status, branch_scope, role_id, access_kind,
      invited_at, invite_expires_at, invited_by
    ) VALUES (
      v_existing.id, v_tenant, v_role, 'pending', v_scope, v_role_id, 'standard',
      now(), now() + interval '14 days', v_actor
    )
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'pending', branch_scope = EXCLUDED.branch_scope,
          role_id = EXCLUDED.role_id, invited_at = now(),
          invite_expires_at = now() + interval '14 days', invited_by = v_actor,
          declined_at = NULL, updated_at = now()
    RETURNING id INTO v_membership;

    IF payload->'branchRoles' IS NOT NULL AND jsonb_typeof(payload->'branchRoles') = 'object' THEN
      FOR v_branch_id, v_branch_role IN
        SELECT key::uuid, value::uuid FROM jsonb_each_text(payload->'branchRoles')
      LOOP
        IF v_branch_id = ANY(v_scope) AND EXISTS (
          SELECT 1 FROM public.roles r WHERE r.id = v_branch_role AND r.tenant_id = v_tenant
        ) THEN
          INSERT INTO public.membership_branch_roles (membership_id, branch_id, role_id)
          VALUES (v_membership, v_branch_id, v_branch_role)
          ON CONFLICT (membership_id, branch_id)
          DO UPDATE SET role_id = EXCLUDED.role_id, updated_at = now();
        END IF;
      END LOOP;
    END IF;

    INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
    VALUES (v_actor, 'employee_invited_existing_person', 'user', v_existing.id,
            jsonb_build_object('shop_id', v_tenant, 'membership_id', v_membership,
                               'scope', v_scope, 'role_id', v_role_id));

    RETURN jsonb_build_object(
      'id', v_existing.id, 'roleId', v_role_id, 'membershipRole', v_role,
      'membershipStatus', 'pending', 'branchScope', v_scope, 'existingUser', true
    );
  END IF;

  v_created := public.create_employee_core(payload);
  v_id := (v_created->>'id')::uuid;
  UPDATE public.memberships
     SET invited_at = now(), invite_expires_at = now() + interval '14 days', invited_by = v_actor
   WHERE user_id = v_id AND tenant_id = v_tenant AND status = 'pending';

  BEGIN
    PERFORM public.provision_member_login(v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
    VALUES (v_actor, 'member_login_provision_failed', 'user', v_id,
            jsonb_build_object('reason', SQLERRM));
  END;

  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_employee(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;

-- ── 6. The directory must show a member whose home shop is elsewhere ─────────
CREATE OR REPLACE FUNCTION public.get_shop_members()
RETURNS TABLE (
  id uuid, name text, phone text, role user_role, is_original_owner boolean,
  is_active boolean, employee_number text, job_title text, photo_url text,
  first_login_at timestamptz, last_login_at timestamptz, deactivated_at timestamptz,
  deactivated_by uuid, created_at timestamptz, created_by uuid, shop_id uuid,
  membership_id uuid, membership_role membership_role, membership_status membership_status,
  branch_scope uuid[], role_id uuid, access_kind text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  v_tenant := public.authorize_business_action('employees.view');
  RETURN QUERY
    SELECT u.id, u.name::text, u.phone::text, u.role, u.is_original_owner,
           u.is_active, u.employee_number::text, u.job_title::text, u.photo_url,
           u.first_login_at, u.last_login_at, u.deactivated_at, u.deactivated_by,
           u.created_at, u.created_by, u.shop_id,
           m.id, m.role, m.status, m.branch_scope, m.role_id, m.access_kind
      FROM public.memberships m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.tenant_id = v_tenant
     ORDER BY u.name, u.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_shop_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shop_members() TO authenticated;

COMMENT ON FUNCTION public.get_shop_members() IS
  'The current shop memberships, including a person whose home shop is another shop; authorization is employees.view.';