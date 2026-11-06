-- 0273 — Co-Owner acceptance is an explicit decision.
--
-- Until now complete_member_onboarding() auto-accepted a pending Co-Owner grant
-- at the first verified sign-in. That is correct for an employee invitation and
-- wrong for an owner-level delegation. This migration:
--   • makes onboarding skip a pending Co-Owner grant;
--   • makes acceptance require an unexpired `invited` grant;
--   • adds an invitee-only decline that leaves the person inactive;
--   • returns the full delegated summary to the invitee's acceptance screen.
-- The ordinary employee onboarding path is unchanged.

CREATE OR REPLACE FUNCTION public.get_my_pending_co_owner_invitation()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'grantId', g.id,
    'status', g.status,
    'businessName', s.name,
    'invitedAt', g.invited_at,
    'expiresAt', g.expires_at,
    'invitedBy', u.name,
    'tenantId', g.tenant_id,
    'canInviteEmployees', g.can_invite_employees,
    'canDeactivateEmployees', g.can_deactivate_employees,
    'canManageBranches', g.can_manage_branches,
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.is_default DESC, b.name)
        FROM public.branches b
       WHERE b.tenant_id = g.tenant_id AND b.is_active
         AND (
           (SELECT s2.branches_mode FROM public.co_owner_scope_settings s2 WHERE s2.grant_id = g.id) = 'all'
           OR b.id IN (SELECT bs.branch_id FROM public.co_owner_branch_scopes bs WHERE bs.grant_id = g.id)
         )
    ), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', p.code, 'module', p.module,
        'labelEn', p.label_en, 'labelUr', p.label_ur) ORDER BY p.module, p.code)
        FROM public.co_owner_permissions cp
        JOIN public.permissions p ON p.id = cp.permission_id
       WHERE cp.grant_id = g.id
    ), '[]'::jsonb),
    'dashboards', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', w.key, 'labelEn', w.label_en, 'labelUr', w.label_ur) ORDER BY w.sort_order)
        FROM public.co_owner_dashboards cd
        JOIN public.dashboard_widgets w ON w.key = cd.widget_key
       WHERE cd.grant_id = g.id AND cd.visible
    ), '[]'::jsonb),
    'authorities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', c.code, 'module', c.module,
        'labelEn', c.label_en, 'labelUr', c.label_ur,
        'mode', COALESCE(a.mode, 'restricted')) ORDER BY c.sort_order)
        FROM public.co_owner_authority_catalog c
        LEFT JOIN public.co_owner_authorities a
          ON a.grant_id = g.id AND a.authority_code = c.code
    ), '[]'::jsonb)
  )
  FROM public.co_owner_grants g
  JOIN public.shops s ON s.id = g.tenant_id
  LEFT JOIN public.users u ON u.id = g.granted_by
  WHERE g.user_id = public.app_current_user_id()
    AND g.status = 'invited'
    AND (g.expires_at IS NULL OR g.expires_at > now())
  ORDER BY g.created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_pending_co_owner_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_co_owner_invitation() TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_co_owner_invitation(p_grant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_grant public.co_owner_grants;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = p_grant_id FOR UPDATE;
  IF v_grant.id IS NULL OR v_grant.user_id <> v_user THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;
  IF v_grant.status = 'revoked' THEN RAISE EXCEPTION 'INVITATION_REVOKED'; END IF;
  IF v_grant.status <> 'invited' THEN RAISE EXCEPTION 'INVITATION_NOT_PENDING'; END IF;
  IF v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;
  UPDATE public.co_owner_grants
     SET status = 'active', activated_at = COALESCE(activated_at, now()),
         access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  PERFORM public.co_owner_sync_membership(v_grant.id);
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_user, 'co_owner_invitation_accepted', 'co_owner_grant', v_grant.id,
          v_grant.tenant_id, v_grant.id, '{}'::jsonb);
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'active');
END;
$$;
REVOKE ALL ON FUNCTION public.accept_co_owner_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_co_owner_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_co_owner_invitation(p_grant_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_grant public.co_owner_grants;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = p_grant_id FOR UPDATE;
  IF v_grant.id IS NULL OR v_grant.user_id <> v_user THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;
  IF v_grant.status = 'revoked' THEN RAISE EXCEPTION 'INVITATION_REVOKED'; END IF;
  IF v_grant.status <> 'invited' THEN RAISE EXCEPTION 'INVITATION_NOT_PENDING'; END IF;

  -- The grant is the authority. Revoking it makes every access path fail closed;
  -- the membership stays pending (never active and never restored to employee),
  -- so no business data is reachable and the owner can invite the person again.
  UPDATE public.co_owner_grants
     SET status = 'revoked', revoked_at = now(), revoked_by = v_user,
         revocation_reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Declined by invitee'),
         access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;

  UPDATE public.co_owner_approval_requests
     SET status = 'cancelled', decided_at = now(), decision_note = 'Invitation declined'
   WHERE grant_id = v_grant.id AND status = 'pending';

  -- A pending invitee has no active membership, so the audit ledger cannot stamp
  -- an actor context for them. The grant itself records who declined, when and
  -- why; the membership remains suspended and is never restored to employee.
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'revoked', 'declined', true);
END;
$$;
REVOKE ALL ON FUNCTION public.decline_co_owner_invitation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_co_owner_invitation(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_member_onboarding()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
  v_n int := 0;
  v_grant public.co_owner_grants;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.is_active) THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE';
  END IF;

  -- A Co-Owner invitation is not an employee onboarding. It stays pending until
  -- the invitee explicitly accepts it on the acceptance screen.
  SELECT g.* INTO v_grant
    FROM public.co_owner_grants g
    JOIN public.memberships m ON m.id = g.membership_id
   WHERE g.user_id = v_uid AND g.status = 'invited'
     AND m.status = 'pending'
   ORDER BY g.created_at DESC LIMIT 1;
  IF v_grant.id IS NOT NULL THEN
    RETURN jsonb_build_object('activated', 0, 'coOwnerInvitation', v_grant.id);
  END IF;

  UPDATE public.memberships
     SET status = 'active'::membership_status, updated_at = now()
   WHERE user_id = v_uid
     AND access_kind = 'standard'
     AND status = 'pending'::membership_status;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, details)
    VALUES (v_uid, 'member_onboarding_completed', 'membership', v_uid, jsonb_build_object('activated', v_n));
  END IF;

  RETURN jsonb_build_object('activated', v_n);
END;
$$;

NOTIFY pgrst, 'reload schema';
