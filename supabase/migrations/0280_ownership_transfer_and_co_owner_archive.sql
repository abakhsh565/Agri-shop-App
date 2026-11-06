-- 0280 — Ownership transfer, co-owner archive/restore and owner notifications
--
-- The 0266–0274 slice already gives a delegated Co-Owner its own experience, scopes,
-- permissions, approvals and owner-side activity. It deliberately did not transfer legal
-- ownership. This migration adds that separate workflow and the missing archive/restore
-- lifecycle, without turning a Co-Owner into an employee or creating a second ownership model.

-- ── 1. Owner-only authority catalogue ────────────────────────────────────────
INSERT INTO public.co_owner_authority_catalog
  (code, module, label_en, label_ur, permission_code, sort_order) VALUES
  ('ownership.transfer', 'ownership', 'Transfer business ownership', 'کاروبار کی ملکیت منتقل کریں', 'settings.edit', 5),
  ('co_owners.manage',   'ownership', 'Manage other Co-Owners',     'دیگر شریک مالکان کا انتظام', 'settings.edit', 6),
  ('business.delete',    'ownership', 'Delete the business or critical history', 'کاروبار یا اہم تاریخ حذف کریں', 'settings.edit', 7),
  ('owner.security',     'ownership', 'Change the Owner security or recovery', 'مالک کی سیکیورٹی یا ریکوری تبدیل کریں', 'settings.edit', 8)
ON CONFLICT (code) DO NOTHING;

-- ── 2. One active Owner per shop ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_active_owner_per_shop
  ON public.memberships(tenant_id)
  WHERE role = 'owner' AND access_kind = 'standard' AND status = 'active';

-- ── 3. Transfer state machine ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ownership_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  initiated_by        uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_grant_id  uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'pending_recipient'
                      CHECK (status IN (
                        'draft', 'pending_verification', 'pending_recipient',
                        'pending_final', 'completed', 'rejected', 'cancelled',
                        'expired', 'failed'
                      )),
  idempotency_key     uuid,
  snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiated_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz,
  confirmed_at        timestamptz,
  completed_at        timestamptz,
  rejected_at         timestamptz,
  cancelled_at        timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '7 days',
  reason              text,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_one_pending
  ON public.ownership_transfers(shop_id)
  WHERE status IN ('pending_verification', 'pending_recipient', 'pending_final');

CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_idempotency
  ON public.ownership_transfers(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ownership_transfers_recipient
  ON public.ownership_transfers(recipient_user_id, status, created_at DESC);

ALTER TABLE public.ownership_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ownership_transfers FROM anon, authenticated;

COMMENT ON TABLE public.ownership_transfers IS
  'Legal ownership transfer requests. Owner and recipient read through the RPCs only; business records are never moved or deleted.';

-- ── 4. Fresh-auth guard ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_recent_owner_auth(p_minutes int DEFAULT 15)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_iat bigint;
  v_claims jsonb;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_iat := COALESCE(NULLIF(v_claims->>'iat', '')::bigint, 0);
  IF v_iat = 0 OR to_timestamp(v_iat) < now() - make_interval(mins => greatest(1, p_minutes)) THEN
    RAISE EXCEPTION 'REAUTH_REQUIRED: sign in again before transferring ownership';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_recent_owner_auth(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_recent_owner_auth(int) TO authenticated;

-- ── 5. Start the transfer ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.initiate_ownership_transfer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_owner_user public.users;
  v_recipient public.users;
  v_grant public.co_owner_grants;
  v_transfer public.ownership_transfers;
  v_phone text := NULLIF(trim(COALESCE(payload->>'phone', '')), '');
  v_request_id uuid := NULLIF(payload->>'requestId', '')::uuid;
  v_recipient_id uuid := NULLIF(payload->>'recipientUserId', '')::uuid;
  v_shop_name text;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  PERFORM public.assert_recent_owner_auth(15);
  SELECT * INTO v_owner_user FROM public.users WHERE id = v_owner.user_id;
  SELECT name INTO v_shop_name FROM public.shops WHERE id = v_owner.tenant_id;

  IF v_request_id IS NOT NULL THEN
    SELECT * INTO v_transfer FROM public.ownership_transfers
      WHERE idempotency_key = v_request_id AND shop_id = v_owner.tenant_id;
    IF FOUND THEN
      RETURN jsonb_build_object('transferId', v_transfer.id, 'status', v_transfer.status, 'idempotent', true);
    END IF;
  END IF;

  UPDATE public.ownership_transfers
     SET status = 'expired', updated_at = now()
   WHERE shop_id = v_owner.tenant_id
     AND status IN ('pending_verification', 'pending_recipient', 'pending_final')
     AND expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM public.ownership_transfers
     WHERE shop_id = v_owner.tenant_id
       AND status IN ('pending_verification', 'pending_recipient', 'pending_final')
  ) THEN
    RAISE EXCEPTION 'TRANSFER_ALREADY_PENDING: finish or cancel the current transfer first';
  END IF;

  IF v_recipient_id IS NOT NULL THEN
    SELECT * INTO v_recipient FROM public.users
      WHERE id = v_recipient_id AND is_active;
  ELSIF v_phone IS NOT NULL THEN
    SELECT * INTO v_recipient FROM public.users
      WHERE is_active
        AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10)
      ORDER BY shop_id = v_owner.tenant_id DESC
      LIMIT 1;
  END IF;

  IF v_recipient.id IS NULL THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_FOUND';
  END IF;
  IF v_recipient.id = v_owner.user_id THEN
    RAISE EXCEPTION 'RECIPIENT_IS_OWNER';
  END IF;
  IF v_recipient.shop_id IS DISTINCT FROM v_owner.tenant_id THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_IN_THIS_BUSINESS';
  END IF;
  IF v_phone IS NOT NULL AND right(regexp_replace(COALESCE(v_recipient.phone, ''), '[^0-9]', '', 'g'), 10) <> right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10) THEN
    RAISE EXCEPTION 'RECIPIENT_PHONE_MISMATCH';
  END IF;

  SELECT g.* INTO v_grant
    FROM public.co_owner_grants g
    JOIN public.memberships m ON m.id = g.membership_id
   WHERE g.tenant_id = v_owner.tenant_id
     AND g.user_id = v_recipient.id
     AND g.status = 'active'
     AND (g.expires_at IS NULL OR g.expires_at > now())
   FOR UPDATE;
  IF v_grant.id IS NULL THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_ACTIVE_CO_OWNER';
  END IF;

  INSERT INTO public.ownership_transfers
    (shop_id, initiated_by, recipient_user_id, recipient_grant_id, status,
     idempotency_key, snapshot, expires_at)
  VALUES
    (v_owner.tenant_id, v_owner.user_id, v_recipient.id, v_grant.id, 'pending_recipient',
     v_request_id,
     jsonb_build_object(
       'businessName', v_shop_name,
       'currentOwner', jsonb_build_object('id', v_owner_user.id, 'name', v_owner_user.name, 'phone', v_owner_user.phone),
       'recipient', jsonb_build_object('id', v_recipient.id, 'name', v_recipient.name, 'phone', v_recipient.phone),
       'coOwnerGrantId', v_grant.id,
       'preserveHistory', true,
       'previousOwnerAccess', 'suspended_owner_no_access'
     ),
     now() + interval '7 days')
  RETURNING * INTO v_transfer;

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'ownership_transfer_initiated', 'ownership_transfer', v_transfer.id,
     v_owner.tenant_id, v_grant.id,
     jsonb_build_object('recipient_user_id', v_recipient.id, 'recipient_name', v_recipient.name,
       'recipient_phone', v_recipient.phone, 'history_preserved', true));

  RETURN jsonb_build_object(
    'transferId', v_transfer.id, 'status', v_transfer.status,
    'recipientName', v_recipient.name, 'recipientPhone', v_recipient.phone,
    'expiresAt', v_transfer.expires_at, 'businessName', v_shop_name
  );
END;
$$;
REVOKE ALL ON FUNCTION public.initiate_ownership_transfer(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_ownership_transfer(jsonb) TO authenticated;

-- ── 6. Read the transfer ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_owner_ownership_transfer()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_row jsonb;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  UPDATE public.ownership_transfers
     SET status = 'expired', updated_at = now()
   WHERE shop_id = v_owner.tenant_id
     AND status IN ('pending_verification', 'pending_recipient', 'pending_final')
     AND expires_at <= now();
  SELECT jsonb_build_object(
    'id', t.id, 'status', t.status, 'initiatedAt', t.initiated_at,
    'acceptedAt', t.accepted_at, 'confirmedAt', t.confirmed_at,
    'completedAt', t.completed_at, 'expiresAt', t.expires_at,
    'recipientName', u.name, 'recipientPhone', u.phone,
    'businessName', s.name,
    'snapshot', t.snapshot
  ) INTO v_row
  FROM public.ownership_transfers t
  JOIN public.users u ON u.id = t.recipient_user_id
  JOIN public.shops s ON s.id = t.shop_id
  WHERE t.shop_id = v_owner.tenant_id
  ORDER BY t.updated_at DESC, t.created_at DESC, t.id DESC
  LIMIT 1;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.get_owner_ownership_transfer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_ownership_transfer() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_ownership_transfer()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_row jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', t.id, 'status', t.status, 'expiresAt', t.expires_at,
    'currentOwnerName', owner_user.name, 'currentOwnerPhone', owner_user.phone,
    'recipientName', recipient.name, 'recipientPhone', recipient.phone,
    'businessName', s.name, 'snapshot', t.snapshot
  ) INTO v_row
  FROM public.ownership_transfers t
  JOIN public.users owner_user ON owner_user.id = t.initiated_by
  JOIN public.users recipient ON recipient.id = t.recipient_user_id
  JOIN public.shops s ON s.id = t.shop_id
  WHERE t.recipient_user_id = v_user
    AND t.status IN ('pending_recipient', 'pending_final')
    AND t.expires_at > now()
  ORDER BY t.created_at DESC
  LIMIT 1;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_ownership_transfer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ownership_transfer() TO authenticated;

-- ── 7. Recipient accepts or rejects ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_ownership_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_transfer public.ownership_transfers;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_transfer FROM public.ownership_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_transfer.id IS NULL OR v_transfer.recipient_user_id <> v_user THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND';
  END IF;
  IF v_transfer.status = 'expired' OR (v_transfer.status IN ('pending_recipient', 'pending_final') AND v_transfer.expires_at <= now()) THEN
    RAISE EXCEPTION 'TRANSFER_EXPIRED';
  END IF;
  IF v_transfer.status <> 'pending_recipient' THEN
    RAISE EXCEPTION 'TRANSFER_NOT_PENDING';
  END IF;
  UPDATE public.ownership_transfers
     SET status = 'pending_final', accepted_at = now(), updated_at = now()
   WHERE id = v_transfer.id;
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_user, 'ownership_transfer_accepted', 'ownership_transfer', v_transfer.id,
    v_transfer.shop_id, v_transfer.recipient_grant_id, jsonb_build_object('history_preserved', true));
  RETURN jsonb_build_object('transferId', v_transfer.id, 'status', 'pending_final');
END;
$$;
REVOKE ALL ON FUNCTION public.accept_ownership_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_ownership_transfer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_ownership_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_transfer public.ownership_transfers;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_transfer FROM public.ownership_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_transfer.id IS NULL OR v_transfer.recipient_user_id <> v_user THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND';
  END IF;
  IF v_transfer.status NOT IN ('pending_recipient', 'pending_final') THEN
    RAISE EXCEPTION 'TRANSFER_NOT_PENDING';
  END IF;
  UPDATE public.ownership_transfers
     SET status = 'rejected', rejected_at = now(), reason = NULLIF(trim(COALESCE(p_reason, '')), ''), updated_at = now()
   WHERE id = v_transfer.id;
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_user, 'ownership_transfer_rejected', 'ownership_transfer', v_transfer.id,
    v_transfer.shop_id, v_transfer.recipient_grant_id, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('transferId', v_transfer.id, 'status', 'rejected');
END;
$$;
REVOKE ALL ON FUNCTION public.reject_ownership_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_ownership_transfer(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_ownership_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_transfer public.ownership_transfers;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_transfer FROM public.ownership_transfers
    WHERE id = p_transfer_id AND shop_id = v_owner.tenant_id FOR UPDATE;
  IF v_transfer.id IS NULL THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF v_transfer.status NOT IN ('pending_recipient', 'pending_final') THEN
    RAISE EXCEPTION 'TRANSFER_NOT_PENDING';
  END IF;
  UPDATE public.ownership_transfers
     SET status = 'cancelled', cancelled_at = now(), reason = NULLIF(trim(COALESCE(p_reason, '')), ''), updated_at = now()
   WHERE id = v_transfer.id;
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_owner.user_id, 'ownership_transfer_cancelled', 'ownership_transfer', v_transfer.id,
    v_owner.tenant_id, v_transfer.recipient_grant_id, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('transferId', v_transfer.id, 'status', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_ownership_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_ownership_transfer(uuid, text) TO authenticated;

-- ── 8. Atomic final transfer ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_ownership_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_owner_user public.users;
  v_recipient public.users;
  v_grant public.co_owner_grants;
  v_transfer public.ownership_transfers;
  v_recipient_member public.memberships;
  v_branches uuid[];
  v_shop_name text;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  PERFORM public.assert_recent_owner_auth(15);
  SELECT * INTO v_transfer FROM public.ownership_transfers
    WHERE id = p_transfer_id AND shop_id = v_owner.tenant_id FOR UPDATE;
  IF v_transfer.id IS NULL THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF v_transfer.status = 'expired' OR (v_transfer.status = 'pending_final' AND v_transfer.expires_at <= now()) THEN
    RAISE EXCEPTION 'TRANSFER_EXPIRED';
  END IF;
  IF v_transfer.status <> 'pending_final' THEN
    RAISE EXCEPTION 'TRANSFER_NOT_ACCEPTED';
  END IF;

  SELECT * INTO v_owner_user FROM public.users WHERE id = v_owner.user_id FOR UPDATE;
  SELECT * INTO v_recipient FROM public.users WHERE id = v_transfer.recipient_user_id FOR UPDATE;
  SELECT * INTO v_grant FROM public.co_owner_grants WHERE id = v_transfer.recipient_grant_id FOR UPDATE;
  SELECT * INTO v_recipient_member FROM public.memberships WHERE id = v_grant.membership_id FOR UPDATE;
  IF v_grant.id IS NULL OR v_grant.status <> 'active' OR v_recipient_member.status <> 'active' THEN
    RAISE EXCEPTION 'RECIPIENT_GRANT_ENDED';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY created_at, id), '{}'::uuid[]) INTO v_branches
    FROM public.branches WHERE tenant_id = v_owner.tenant_id AND is_active;
  SELECT name INTO v_shop_name FROM public.shops WHERE id = v_owner.tenant_id;

  -- Suspend the previous owner first so the one-active-owner index can accept the new Owner.
  UPDATE public.users
     SET is_original_owner = false, role = 'admin', updated_at = now()
   WHERE id = v_owner.user_id;
  UPDATE public.memberships
     SET role = 'owner', access_kind = 'standard', role_id = NULL,
         branch_scope = v_branches, status = 'suspended', updated_at = now()
   WHERE id = v_owner.id;

  UPDATE public.users
     SET is_original_owner = true, role = 'admin', updated_at = now()
   WHERE id = v_recipient.id;
  UPDATE public.memberships
     SET role = 'owner', access_kind = 'standard', role_id = NULL,
         branch_scope = v_branches, status = 'active', updated_at = now()
   WHERE id = v_recipient_member.id;

  UPDATE public.co_owner_grants
     SET status = 'revoked', revoked_at = now(), revoked_by = v_owner.user_id,
         revocation_reason = 'ownership_transferred', access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  UPDATE public.shops SET owner_id = v_recipient.id WHERE id = v_owner.tenant_id;
  UPDATE public.ownership_transfers
     SET status = 'completed', confirmed_at = now(), completed_at = now(), updated_at = now()
   WHERE id = v_transfer.id;

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'ownership_transfer_completed', 'ownership_transfer', v_transfer.id,
     v_owner.tenant_id, v_grant.id,
     jsonb_build_object('previous_owner_user_id', v_owner.user_id,
       'new_owner_user_id', v_recipient.id, 'new_owner_name', v_recipient.name,
       'business_name', v_shop_name, 'history_preserved', true,
       'previous_owner_access', 'suspended_owner_no_access',
       'records_moved', false));

  RETURN jsonb_build_object(
    'transferId', v_transfer.id, 'status', 'completed',
    'newOwnerName', v_recipient.name, 'newOwnerPhone', v_recipient.phone,
    'businessName', v_shop_name, 'previousOwnerAccess', 'suspended_owner_no_access'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_ownership_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_ownership_transfer(uuid) TO authenticated;

-- ── 9. Archive, restore and re-invite ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_co_owner(p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_grant public.co_owner_grants;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = p_grant_id AND tenant_id = v_owner.tenant_id FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF v_grant.status <> 'revoked' THEN RAISE EXCEPTION 'GRANT_NOT_ARCHIVED'; END IF;
  -- A Co-Owner grant promoted into the Owner seat by a completed transfer is archived
  -- history, not a restorable delegation. Restoring it would demote the active Owner.
  IF EXISTS (
    SELECT 1 FROM public.memberships
     WHERE tenant_id = v_owner.tenant_id AND user_id = v_grant.user_id
       AND role = 'owner' AND access_kind = 'standard'
  ) THEN
    RAISE EXCEPTION 'GRANT_BELONGS_TO_OWNER: the active Owner cannot be restored as a Co-Owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.co_owner_grants
     WHERE tenant_id = v_owner.tenant_id AND user_id = v_grant.user_id
       AND id <> v_grant.id AND status IN ('invited', 'active', 'suspended')
  ) THEN
    RAISE EXCEPTION 'PERSON_ALREADY_INVITED';
  END IF;
  UPDATE public.co_owner_grants
     SET status = 'invited', invited_at = now(), activated_at = NULL,
         suspended_at = NULL, revoked_at = NULL, revoked_by = NULL,
         revocation_reason = NULL, expires_at = now() + interval '7 days',
         access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  UPDATE public.memberships
     SET access_kind = 'co_owner', role = 'employee', role_id = NULL,
         status = 'pending', updated_at = now()
   WHERE id = v_grant.membership_id;
  PERFORM public.co_owner_sync_membership(v_grant.id);
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_owner.user_id, 'co_owner_restored', 'co_owner_grant', v_grant.id,
    v_owner.tenant_id, v_grant.id,
    jsonb_build_object('requires_acceptance', true, 'configuration_preserved', true));
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'invited',
    'requiresAcceptance', true);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_co_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_co_owner(uuid) TO authenticated;

-- ── 10. Credit requests enter the audit trail ────────────────────────────────
-- `create_credit_limit_request` is the one write path used by the employee and Co-Owner
-- screens. It previously created the request row without an audit event, so the owner had
-- no notification that staff were waiting for a lending decision. The audit row is written
-- from the table, not the caller, so every future write path is covered too.
CREATE OR REPLACE FUNCTION public.audit_credit_limit_request_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_shop uuid;
  v_actor_name text;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  SELECT shop_id INTO v_shop FROM public.customers WHERE id = NEW.customer_id;
  IF v_shop IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO v_actor_name FROM public.users WHERE id = v_actor;
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, actor_name, details)
  VALUES
    (v_actor, 'credit_limit_request_created', 'credit_limit_request', NEW.id, v_shop, v_actor_name,
     jsonb_build_object('customer_id', NEW.customer_id, 'customer_name', NEW.customer_name,
       'requested_by', NEW.requested_by, 'current_limit', NEW.current_limit,
       'requested_limit', NEW.requested_limit));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_credit_limit_request_created() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS audit_credit_limit_request_created_trg ON public.credit_limit_requests;
CREATE TRIGGER audit_credit_limit_request_created_trg
  AFTER INSERT ON public.credit_limit_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_credit_limit_request_created();

-- ── 11. Owner notifications from audit events ────────────────────────────────
-- The audit row is the source of truth. A notification is a read surface over it, so this
-- trigger cannot create a business event and cannot be used to edit history.
CREATE OR REPLACE FUNCTION public.owner_notification_from_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_major boolean;
  v_title text;
  v_actor_role text;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
  v_major := NEW.action IN (
    'sale_voided', 'return_processed', 'purchase_recorded',
    'supplier_payment_recorded', 'customer_payment_recorded',
    'customer_payments_insert', 'supplier_payments_insert',
    'stock_adjusted', 'employee_created', 'employee_access_updated',
    'membership_access_changed', 'member_login_provisioned', 'member_onboarding_completed',
    'employee_branch_add', 'employee_branch_move', 'branch_responsibility_granted',
    'branch_responsibility_revoked', 'marketplace_settings_changed', 'role_created',
    'role_updated', 'role_deleted', 'branch_created', 'branch_renamed', 'branch_archived',
    'product_deleted', 'company_archived', 'customer_credit_limit_set',
    'credit_request_created', 'credit_request_approved', 'credit_request_rejected',
    'credit_limit_request_created', 'credit_limit_request_approved',
    'credit_limit_request_rejected'
  ) OR NEW.action LIKE 'co_owner_%' OR NEW.action LIKE 'ownership_transfer_%';
  IF NOT v_major THEN RETURN NEW; END IF;

  SELECT role INTO v_actor_role FROM public.memberships
    WHERE user_id = NEW.user_id AND tenant_id = NEW.tenant_id AND status = 'active'
    LIMIT 1;
  IF v_actor_role = 'owner' AND NEW.action NOT LIKE 'ownership_transfer_%' THEN
    RETURN NEW;
  END IF;

  v_title := CASE NEW.action
    WHEN 'sale_voided' THEN 'Sale voided'
    WHEN 'return_processed' THEN 'Return processed'
    WHEN 'purchase_recorded' THEN 'Purchase recorded'
    WHEN 'supplier_payment_recorded' THEN 'Supplier payment recorded'
    WHEN 'customer_payment_recorded' THEN 'Customer payment recorded'
    WHEN 'customer_credit_limit_set' THEN 'Customer credit limit changed'
    WHEN 'credit_limit_request_created' THEN 'Credit limit request'
    WHEN 'product_deleted' THEN 'Product deleted'
    WHEN 'company_archived' THEN 'Supplier archived'
    WHEN 'stock_adjusted' THEN 'Stock adjusted'
    WHEN 'employee_created' THEN 'Employee added'
    WHEN 'employee_access_updated' THEN 'Employee access changed'
    WHEN 'membership_access_changed' THEN 'Employee access changed'
    WHEN 'member_login_provisioned' THEN 'Employee login created'
    WHEN 'member_onboarding_completed' THEN 'Employee onboarding completed'
    WHEN 'branch_responsibility_granted' THEN 'Branch responsibility granted'
    WHEN 'branch_responsibility_revoked' THEN 'Branch responsibility revoked'
    WHEN 'marketplace_settings_changed' THEN 'Marketplace settings changed'
    WHEN 'ownership_transfer_initiated' THEN 'Ownership transfer requested'
    WHEN 'ownership_transfer_accepted' THEN 'Ownership transfer accepted'
    WHEN 'ownership_transfer_rejected' THEN 'Ownership transfer rejected'
    WHEN 'ownership_transfer_completed' THEN 'Ownership transferred'
    WHEN 'ownership_transfer_cancelled' THEN 'Ownership transfer cancelled'
    WHEN 'co_owner_revoked' THEN 'Co-Owner archived'
    WHEN 'co_owner_restored' THEN 'Co-Owner restored'
    ELSE 'Business action: ' || replace(NEW.action, '_', ' ')
  END;

  INSERT INTO public.notifications
    (kind, title, message, body, shop_id, branch_id, entity_type, entity_id, actor_id, actor_name)
  VALUES
    ('owner_audit', v_title, COALESCE(NEW.actor_name, 'System') || ' · ' || replace(NEW.action, '_', ' '),
     COALESCE(NEW.actor_name, 'System') || ' · ' || replace(NEW.action, '_', ' '),
     NEW.tenant_id, NEW.branch_id, NEW.entity_type, NEW.entity_id, NEW.user_id, NEW.actor_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_notification_from_audit_trg ON public.audit_events;
CREATE TRIGGER owner_notification_from_audit_trg
  AFTER INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.owner_notification_from_audit();

-- ── 11. Read access for the owner-side transfer screen ────────────────────────
CREATE OR REPLACE FUNCTION public.get_ownership_transfer_history(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'status', t.status, 'createdAt', t.created_at,
    'completedAt', t.completed_at, 'recipientName', u.name,
    'recipientPhone', u.phone, 'actorName', a.name
  ) ORDER BY t.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM public.ownership_transfers
     WHERE shop_id = public.current_shop_id()
       AND public.co_owner_is_original_owner()
     ORDER BY created_at DESC, id DESC
     LIMIT greatest(1, least(100, p_limit))
  ) t
  JOIN public.users u ON u.id = t.recipient_user_id
  JOIN public.users a ON a.id = t.initiated_by;
$$;
REVOKE ALL ON FUNCTION public.get_ownership_transfer_history(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ownership_transfer_history(int) TO authenticated;

-- 0280: name the retired function(s) in the server-only set the ACL guard
-- unions across migrations, and prove the closure rather than assume it.
DO $server_only$
DECLARE
  v_server_only constant text[] := array['audit_credit_limit_request_created'];
  v_name text;
  v_sig text;
  v_open int;
BEGIN
  FOREACH v_name IN ARRAY v_server_only LOOP
    FOR v_sig IN
      SELECT p.oid::regprocedure::text
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    END LOOP;
  END LOOP;
  SELECT count(*) INTO v_open
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (v_server_only)
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_open > 0 THEN
    RAISE EXCEPTION '0280: % server-only function(s) are still executable by an API role', v_open;
  END IF;
  RAISE NOTICE '0280: the server-only functions are closed';
END
$server_only$;
