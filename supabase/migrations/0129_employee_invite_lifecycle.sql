-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0129: Employee invite lifecycle (invited → active)
-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBLEM
--   create_employee (0113) wrote memberships.status = 'active' directly, so an
--   "added" employee had full tenant access before they had ever signed in. The
--   owner could not tell an invite from a working employee, and the employee
--   screens showed a full performance panel for someone who had never worked.
--
-- LOCKED PRODUCT INTENT
--   Role is the employee's job/access profile (there is no separate job title).
--   Adding an employee ISSUES AN INVITE. Completing onboarding ACTIVATES it.
--
-- WHY ONBOARDING == OTP VERIFICATION
--   The device PIN is deliberately device-only: lib/pinLock.ts hashes it into
--   localStorage and it is never sent to the server (so users.pin_hash is unused
--   and there is no server-visible "PIN set" event). The only server-observable
--   proof that the invitee accepted the invite is a successful phone OTP, which
--   also establishes the JWT that app_current_user_id() reads. So that is the
--   activation point, and it is derived server-side — never from a payload.
--
-- SAFETY
--   complete_member_onboarding() only ever touches the CALLER'S OWN rows, only
--   from 'pending', and only while their user row is active. It therefore cannot
--   grant access to another user, cannot revive a suspended membership, and
--   cannot create tenant access that did not already exist.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. create_employee issues a PENDING invitation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_phone text;
  v_role membership_role := COALESCE(NULLIF(payload->>'membershipRole','')::membership_role,'employee');
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid; v_scope uuid[]; v_num int;
BEGIN
  v_tenant := authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name',''))='' OR NULLIF(payload->>'phone','') IS NULL THEN RAISE EXCEPTION 'VALIDATION: Name and phone are required'; END IF;
  v_phone := payload->>'phone';
  IF EXISTS(SELECT 1 FROM users WHERE phone=v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE'; END IF;
  IF v_role='owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM roles WHERE id=v_role_id AND tenant_id=v_tenant) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload->'branchScope' IS NOT NULL AND jsonb_typeof(payload->'branchScope')='array' THEN
    SELECT array_agg(x::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope') x;
    IF EXISTS(SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
  END IF;
  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number,'[^0-9]','','g'),'')::int),0)+1 INTO v_num FROM users WHERE shop_id=v_tenant;
  INSERT INTO users(id,name,phone,role,is_original_owner,is_active,employee_number,job_title,photo_url,created_by,shop_id,created_at)
  VALUES(gen_random_uuid(),trim(payload->>'name'),v_phone,CASE WHEN v_role='admin' THEN 'admin'::user_role ELSE 'employee'::user_role END,false,true,
    'EMP-'||lpad(v_num::text,3,'0'),NULLIF(payload->>'jobTitle',''),NULLIF(payload->>'photoUrl',''),v_actor,v_tenant,now()) RETURNING id INTO v_id;
  -- INVITE, not access. 'pending' is denied by every authorization path (they all
  -- require m.status = 'active'), so an un-onboarded invitee can hold a session
  -- but cannot read or mutate any tenant-owned row.
  INSERT INTO memberships(user_id,tenant_id,role,status,branch_scope,role_id)
  VALUES(v_id,v_tenant,v_role,'pending',v_scope,v_role_id)
  ON CONFLICT (user_id,tenant_id) DO UPDATE
    SET role=EXCLUDED.role, status='pending', branch_scope=EXCLUDED.branch_scope,
        role_id=EXCLUDED.role_id, updated_at=now();
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,'branch_scope',v_scope,'invited',true));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole',v_role,'membershipStatus','pending');
END; $$;
GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Status sync must never PROMOTE an invitation
-- ─────────────────────────────────────────────────────────────────────────────
-- sync_membership_status (0113) derived status purely from users.is_active, so
-- toggling is_active on an invited employee silently turned the invite into live
-- access. Two paths had to be closed:
--   * reactivating a still-pending invite;
--   * cancelling an invite (deactivate → 'suspended') and then re-enabling it,
--     which loses the 'pending' marker and would otherwise restore access to
--     somebody who has never signed in.
-- The information needed is already on the row: an employee who has never signed
-- in (first_login_at/last_login_at both NULL) has not completed onboarding, so
-- reactivation returns them to 'pending'. Owners are exempt — they are never
-- invitations — and an employee who has actually signed in reactivates normally.

CREATE OR REPLACE FUNCTION public.sync_membership_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.shop_id IS NOT NULL THEN
    UPDATE memberships
    SET status = CASE
          WHEN NEW.is_active THEN
            CASE WHEN status = 'pending'::membership_status
                      OR (NOT NEW.is_original_owner
                          AND NEW.first_login_at IS NULL
                          AND NEW.last_login_at IS NULL)
                 THEN 'pending'::membership_status
                 ELSE 'active'::membership_status END
          ELSE 'suspended'::membership_status END,
        updated_at = now()
    WHERE user_id = NEW.id AND tenant_id = NEW.shop_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Onboarding completion — the invitee's first verified sign-in
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_member_onboarding()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := app_current_user_id();
  v_n int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- A deactivated account cannot onboard itself.
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_uid AND u.is_active) THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE';
  END IF;

  -- Only the caller's own invitations, and only from 'pending'. A suspended
  -- membership is deliberately NOT revived here — the owner must reactivate it.
  UPDATE memberships
  SET status = 'active'::membership_status, updated_at = now()
  WHERE user_id = v_uid AND status = 'pending'::membership_status;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
    VALUES(v_uid,'member_onboarding_completed','membership',v_uid,jsonb_build_object('activated',v_n));
  END IF;

  RETURN jsonb_build_object('activated', v_n);
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_member_onboarding() TO authenticated;
-- House rule (see 0115/0116/0121): a SECURITY DEFINER function must not be
-- callable anonymously. anon could never do anything here (app_current_user_id()
-- is NULL without a JWT, so it raises NOT_AUTHENTICATED), but the grant is removed
-- so the surface does not depend on that argument.
REVOKE EXECUTE ON FUNCTION public.complete_member_onboarding() FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill — do not retroactively re-open anyone who already works here
-- ─────────────────────────────────────────────────────────────────────────────
-- Existing employees were created under the old rule and have almost certainly
-- already used the app. Only rows that have never recorded a login stay pending.

UPDATE memberships m
SET status = 'pending'::membership_status, updated_at = now()
WHERE m.status = 'active'::membership_status
  AND m.role <> 'owner'::membership_role
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = m.user_id
      AND u.is_active = true
      AND u.is_original_owner = false
      AND u.first_login_at IS NULL
      AND u.last_login_at IS NULL
  );
