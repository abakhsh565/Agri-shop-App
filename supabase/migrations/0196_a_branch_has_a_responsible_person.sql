-- A branch's responsible person is operational control, never business ownership.
--
-- The Owner owns the business. A branch is operational scope. The person made responsible for a
-- branch manages it inside the permissions they already hold and inside the branches they are
-- scoped to; nothing here promotes anyone to owner, and nothing here can reach another branch.
--
-- History is kept rather than deleted: revoking marks the row revoked, because "who was
-- responsible for Warehouse in March, and who ended it" is a question this must still answer
-- after the fact. The permissions wall is untouched — this designates a person, it does not
-- grant a permission.
CREATE TABLE IF NOT EXISTS public.branch_responsibility (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  granted_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  role_id       uuid,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoke_reason text
);

-- One responsible person per branch at a time. Partial, so revoked history rows are exempt:
-- a full unique index would forbid ever recording a second holder.
CREATE UNIQUE INDEX IF NOT EXISTS branch_responsibility_one_active
  ON public.branch_responsibility(branch_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS branch_responsibility_user_idx
  ON public.branch_responsibility(user_id);
CREATE INDEX IF NOT EXISTS branch_responsibility_tenant_idx
  ON public.branch_responsibility(tenant_id);

ALTER TABLE public.branch_responsibility ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_responsibility_select ON public.branch_responsibility;
CREATE POLICY branch_responsibility_select ON public.branch_responsibility FOR SELECT TO authenticated
  USING (tenant_id = public.current_shop_id() AND
    (public.allowed_branch_scope() IS NULL OR branch_id = ANY(public.allowed_branch_scope())));
REVOKE ALL ON public.branch_responsibility FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.branch_responsibility TO authenticated;

-- Who is responsible, for a branch the caller may already see. NULL when nobody is.
CREATE OR REPLACE FUNCTION public.branch_responsible_person(p_branch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object('user_id', r.user_id, 'name', u.name, 'since', r.granted_at)
  FROM public.branch_responsibility r
  LEFT JOIN public.users u ON u.id = r.user_id
  WHERE r.branch_id = p_branch_id
    AND r.revoked_at IS NULL
    AND r.tenant_id = public.current_shop_id()
    AND (public.allowed_branch_scope() IS NULL OR r.branch_id = ANY(public.allowed_branch_scope()));
$$;
REVOKE ALL ON FUNCTION public.branch_responsible_person(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_responsible_person(uuid) TO authenticated;

-- Hand a branch to a responsible person.
--
-- Owner-only, deliberately: this is the act the Owner performs, and no branch-level authority
-- may perform it on itself. The target must already be an active member of this business, so a
-- number that cannot sign in can never be made responsible for anything.
CREATE OR REPLACE FUNCTION public.grant_branch_responsibility(
  p_branch_id uuid, p_user_id uuid, p_role_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_branch public.branches;
  v_target public.memberships;
  v_active public.branch_responsibility;
  v_scope uuid[];
BEGIN
  SELECT * INTO v_owner FROM public.membership_in_active_shop(NULL);
  IF v_owner.id IS NULL OR v_owner.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can assign branch responsibility';
  END IF;
  PERFORM public.authorize_business_action('employees.manage');
  -- One writer per business: a duplicate tap cannot produce two responsible people.
  PERFORM 1 FROM public.shops WHERE id = v_owner.tenant_id FOR UPDATE;
  SELECT * INTO v_branch FROM public.branches
    WHERE id = p_branch_id AND tenant_id = v_owner.tenant_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  IF p_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_role_id AND tenant_id = v_owner.tenant_id
  ) THEN RAISE EXCEPTION 'VALIDATION: that role does not belong to this business'; END IF;
  SELECT m.* INTO v_target FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
   WHERE m.user_id = p_user_id AND m.tenant_id = v_owner.tenant_id
     AND m.role <> 'owner' AND m.status = 'active' AND u.is_active
   FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_active FROM public.branch_responsibility
    WHERE branch_id = p_branch_id AND revoked_at IS NULL FOR UPDATE;
  IF FOUND AND v_active.user_id = p_user_id THEN
    RETURN jsonb_build_object('success',true,'branch_id',p_branch_id,'user_id',p_user_id,'idempotent',true);
  END IF;
  IF FOUND THEN
    RAISE EXCEPTION 'BRANCH_ALREADY_ASSIGNED: transfer responsibility instead';
  END IF;
  -- Being responsible means being able to work the branch. Existing access is kept: this adds
  -- the branch and never silently removes one the owner granted deliberately.
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_scope
    FROM unnest(COALESCE(v_target.branch_scope, '{}'::uuid[]) || ARRAY[p_branch_id]) x;
  UPDATE public.memberships
    SET branch_scope = v_scope,
        role_id = COALESCE(p_role_id, role_id),
        updated_at = now()
    WHERE id = v_target.id;
  INSERT INTO public.branch_responsibility(branch_id, tenant_id, user_id, granted_by, role_id)
  VALUES (p_branch_id, v_owner.tenant_id, p_user_id, public.app_current_user_id(),
    COALESCE(p_role_id, v_target.role_id));
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, branch_id, details)
  VALUES (public.app_current_user_id(), 'branch_responsibility_granted', 'branch', p_branch_id, p_branch_id,
    jsonb_build_object(
      'before', jsonb_build_object('responsible_user_id', NULL, 'branch_scope', v_target.branch_scope),
      'after', jsonb_build_object('responsible_user_id', p_user_id, 'branch_scope', v_scope,
        'role_id', COALESCE(p_role_id, v_target.role_id)),
      'businessOwnershipUnchanged', true));
  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'user_id', p_user_id,
    'branch_scope', v_scope);
END;
$$;
REVOKE ALL ON FUNCTION public.grant_branch_responsibility(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_branch_responsibility(uuid, uuid, uuid) TO authenticated;

-- Take responsibility back. Access is deliberately NOT removed here: revoking a designation is
-- not the same act as withdrawing someone's ability to work, and conflating the two is how a
-- revocation silently locks a person out of the shop they are standing in.
CREATE OR REPLACE FUNCTION public.revoke_branch_responsibility(p_branch_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_active public.branch_responsibility;
BEGIN
  SELECT * INTO v_owner FROM public.membership_in_active_shop(NULL);
  IF v_owner.id IS NULL OR v_owner.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can revoke branch responsibility';
  END IF;
  PERFORM public.authorize_business_action('employees.manage');
  PERFORM 1 FROM public.shops WHERE id = v_owner.tenant_id FOR UPDATE;
  SELECT * INTO v_active FROM public.branch_responsibility
    WHERE branch_id = p_branch_id AND tenant_id = v_owner.tenant_id AND revoked_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', true, 'idempotent', true); END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: a reason is required';
  END IF;
  UPDATE public.branch_responsibility
    SET revoked_at = now(), revoked_by = public.app_current_user_id(), revoke_reason = trim(p_reason)
    WHERE id = v_active.id;
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, branch_id, details)
  VALUES (public.app_current_user_id(), 'branch_responsibility_revoked', 'branch', p_branch_id, p_branch_id,
    jsonb_build_object(
      'reason', trim(p_reason),
      'before', jsonb_build_object('responsible_user_id', v_active.user_id),
      'after', jsonb_build_object('responsible_user_id', NULL),
      'accessKept', true, 'historyPreserved', true));
  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'access_kept', true);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_branch_responsibility(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_branch_responsibility(uuid, text) TO authenticated;

-- Move responsibility from one person to another in ONE transaction.
--
-- Split into revoke-then-grant by the caller, two devices could leave a branch with nobody
-- responsible between the two calls. Here the old holder is ended and the new one validated
-- under the same lock, so the branch is never briefly ownerless.
CREATE OR REPLACE FUNCTION public.transfer_branch_responsibility(
  p_branch_id uuid, p_to_user_id uuid, p_role_id uuid DEFAULT NULL, p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_active public.branch_responsibility;
  v_from uuid;
BEGIN
  SELECT * INTO v_owner FROM public.membership_in_active_shop(NULL);
  IF v_owner.id IS NULL OR v_owner.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can transfer branch responsibility';
  END IF;
  PERFORM public.authorize_business_action('employees.manage');
  PERFORM 1 FROM public.shops WHERE id = v_owner.tenant_id FOR UPDATE;
  SELECT * INTO v_active FROM public.branch_responsibility
    WHERE branch_id = p_branch_id AND tenant_id = v_owner.tenant_id AND revoked_at IS NULL
    FOR UPDATE;
  IF v_active.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: nobody is currently responsible for this branch';
  END IF;
  IF v_active.user_id = p_to_user_id THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'user_id', p_to_user_id);
  END IF;
  v_from := v_active.user_id;
  UPDATE public.branch_responsibility
    SET revoked_at = now(), revoked_by = public.app_current_user_id(),
        revoke_reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'transferred')
    WHERE id = v_active.id;
  -- The replacement passes exactly the same checks as a fresh grant: active member of this
  -- business, real branch of this business, role belonging to this business.
  PERFORM public.grant_branch_responsibility(p_branch_id, p_to_user_id, p_role_id);
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, branch_id, details)
  VALUES (public.app_current_user_id(), 'branch_responsibility_transferred', 'branch', p_branch_id, p_branch_id,
    jsonb_build_object(
      'before', jsonb_build_object('responsible_user_id', v_from),
      'after', jsonb_build_object('responsible_user_id', p_to_user_id),
      'reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
      'businessOwnershipUnchanged', true));
  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'from_user_id', v_from,
    'to_user_id', p_to_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_branch_responsibility(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_branch_responsibility(uuid, uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
