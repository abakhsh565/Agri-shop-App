-- 0300 — Policies and guards for the tables and RPCs 0280-0289 introduced.
--
-- WHY THIS EXISTS. The Phase 2 import (PR #13) landed two tables and four RPCs
-- that the repo's own invariants catch:
--   * Invariant A (every RLS-enabled table carries at least one policy):
--     employee_compensations (0278) and ownership_transfers (0280) have RLS
--     enabled and zero policies.
--   * Invariant E (every business write RPC carries an authorization guard):
--     create_product_with_classification and update_product_with_classification
--     (0289), reject_ownership_transfer and restore_co_owner (0280) carry none
--     of the recognized guard strings.
--
-- WHAT THIS DOES. Following the 0292 / 0293 precedents exactly:
--   * ONE SELECT policy per table, tenant-scoped. employee_compensations is
--     salary data, so its read also requires employees.manage (the same
--     permission 0292 used for employee_access_requests and
--     membership_branch_roles). ownership_transfers follows the 0292 registry
--     shape (shop-scoped only): the app reads transfers through owner-gated
--     RPCs, so the policy only decides what a direct PostgREST read by a
--     same-shop member may see. Writes stay RPC/trigger-only: no
--     INSERT/UPDATE/DELETE policy is added.
--   * The four RPCs are restated byte-for-byte from their defining migrations
--     with ONE added statement each, first in the body:
--     PERFORM public.authorize_tenant_membership(). That call returns the
--     caller's first active membership and raises NOT_AUTHORIZED only when
--     there is none, so the caller set of each function is exactly what it
--     was: the recipient still rejects their own transfer, the original owner
--     still restores a grant, and the product wrappers still run through
--     create_product / update_product. In particular NO function is re-gated
--     onto a permission: reject_ownership_transfer's recipient check and
--     restore_co_owner's co_owner_assert_original_owner() stay the real gates.
--
-- WHY IT IS SAFE TO APPLY. SELECT-only policies cannot grant a write. CREATE OR
-- REPLACE FUNCTION keeps the existing grants (authenticated-only, PUBLIC/anon
-- revoked). The added call derives from the same active-membership chain the
-- functions already rely on, so in every session where a function previously
-- succeeded it still succeeds.

DROP POLICY IF EXISTS employee_compensations_select ON public.employee_compensations;
CREATE POLICY employee_compensations_select ON public.employee_compensations
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('employees.manage')
  );

DROP POLICY IF EXISTS ownership_transfers_select ON public.ownership_transfers;
CREATE POLICY ownership_transfers_select ON public.ownership_transfers
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
  );

CREATE OR REPLACE FUNCTION public.reject_ownership_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_transfer public.ownership_transfers;
BEGIN
  PERFORM public.authorize_tenant_membership();
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

CREATE OR REPLACE FUNCTION public.restore_co_owner(p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_grant public.co_owner_grants;
BEGIN
  PERFORM public.authorize_tenant_membership();
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

CREATE OR REPLACE FUNCTION public.create_product_with_classification(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result    jsonb;
  v_id        uuid;
  v_shop_id   uuid;
  v_category  uuid;
  v_base      text;
  v_form      text;
  v_class     jsonb;
  v_forms     jsonb;
  v_groups    text[];
BEGIN
  PERFORM public.authorize_tenant_membership();
  -- The long-standing RPC still owns the product, variants, opening stock and barcode. This
  -- wrapper reads the resulting row, validates the classification, and writes the one new column.
  v_result := public.create_product(payload);
  v_id := (v_result->>'id')::uuid;

  SELECT shop_id, category_id, lower(COALESCE(base_unit, ''))
    INTO v_shop_id, v_category, v_base
    FROM public.products
   WHERE id = v_id;

  v_form := NULLIF(btrim(COALESCE(payload->>'physicalForm', '')), '');

  IF v_category IS NOT NULL THEN
    v_class := public.resolve_product_classification(v_category, v_shop_id);
    IF v_class IS NOT NULL THEN
      v_forms := v_class->'physicalForms';

      IF v_form IS NULL AND jsonb_array_length(v_forms) = 1 THEN
        v_form := v_forms->0->>'code';
      END IF;

      IF v_form IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_forms) f WHERE f->>'code' = v_form
        ) THEN
          RAISE EXCEPTION 'CLASSIFICATION_FORM_INVALID: that physical form is not allowed by this category';
        END IF;

        SELECT array_agg(g) INTO v_groups
          FROM jsonb_array_elements(v_forms) f
          CROSS JOIN LATERAL jsonb_array_elements_text(f->'unitGroups') g
         WHERE f->>'code' = v_form;

        IF public.unit_group_for_base(v_base) IS NULL
           OR NOT (public.unit_group_for_base(v_base) = ANY(COALESCE(v_groups, '{}'))) THEN
          RAISE EXCEPTION 'CLASSIFICATION_UNIT: choose a unit that matches the physical form';
        END IF;
      ELSIF jsonb_array_length(v_forms) > 0 THEN
        RAISE EXCEPTION 'CLASSIFICATION_FORM_REQUIRED: choose a physical form';
      END IF;
    END IF;
  END IF;

  IF v_form IS NOT NULL THEN
    UPDATE public.products
       SET physical_form = v_form,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  RETURN v_result || jsonb_build_object('physical_form', v_form);
END;
$$;

COMMENT ON FUNCTION public.create_product_with_classification(jsonb) IS
  'Creates a product through create_product, then validates and stores its physical form. Older clients keep using create_product unchanged.';

REVOKE ALL ON FUNCTION public.create_product_with_classification(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_classification(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_product_with_classification(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result           jsonb;
  v_id               uuid;
  v_shop_id          uuid;
  v_category         uuid;
  v_existing_category uuid;
  v_base             text;
  v_existing_form    text;
  v_form             text;
  v_form_given       boolean;
  v_form_changed     boolean;
  v_category_given   boolean;
  v_category_changed boolean;
  v_class            jsonb;
  v_forms            jsonb;
  v_groups           text[];
BEGIN
  PERFORM public.authorize_tenant_membership();
  v_id := (payload->>'id')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  SELECT shop_id, category_id, lower(COALESCE(base_unit, '')), physical_form
    INTO v_shop_id, v_existing_category, v_base, v_existing_form
    FROM public.products
   WHERE id = v_id;

  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  v_result := public.update_product(payload);

  SELECT category_id, lower(COALESCE(base_unit, '')), physical_form
    INTO v_category, v_base, v_form
    FROM public.products
   WHERE id = v_id;

  v_form_given := payload ? 'physicalForm';
  v_form_changed := v_form_given
    AND NULLIF(btrim(COALESCE(payload->>'physicalForm', '')), '') IS DISTINCT FROM v_existing_form;
  v_category_given := payload ? 'categoryId';
  v_category_changed := v_category_given
    AND NULLIF(payload->>'categoryId', '')::uuid IS DISTINCT FROM v_existing_category;

  IF v_form_given THEN
    v_form := NULLIF(btrim(COALESCE(payload->>'physicalForm', '')), '');
  END IF;

  IF v_category IS NOT NULL THEN
    v_class := public.resolve_product_classification(v_category, v_shop_id);
    IF v_class IS NOT NULL THEN
      v_forms := v_class->'physicalForms';

      IF v_form IS NULL
         AND (v_form_given OR v_category_changed)
         AND jsonb_array_length(v_forms) = 1 THEN
        v_form := v_forms->0->>'code';
      END IF;

      -- Validate only when the caller actually changed the form or moved the shelf. An old
      -- product whose profile changed underneath it keeps its stored form on an unrelated
      -- edit, exactly as it keeps its stored unit.
      IF (v_form_changed OR v_category_changed) AND v_form IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_forms) f WHERE f->>'code' = v_form
        ) THEN
          RAISE EXCEPTION 'CLASSIFICATION_FORM_INVALID: that physical form is not allowed by this category';
        END IF;

        SELECT array_agg(g) INTO v_groups
          FROM jsonb_array_elements(v_forms) f
          CROSS JOIN LATERAL jsonb_array_elements_text(f->'unitGroups') g
         WHERE f->>'code' = v_form;

        IF public.unit_group_for_base(v_base) IS NULL
           OR NOT (public.unit_group_for_base(v_base) = ANY(COALESCE(v_groups, '{}'))) THEN
          RAISE EXCEPTION 'CLASSIFICATION_UNIT: choose a unit that matches the physical form';
        END IF;
      END IF;
    ELSIF v_category_changed THEN
      v_form := NULL;
    END IF;
  ELSIF v_category_changed THEN
    v_form := NULL;
  END IF;

  IF v_form_changed OR v_category_changed OR v_form IS DISTINCT FROM v_existing_form THEN
    UPDATE public.products
       SET physical_form = v_form,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  RETURN v_result || jsonb_build_object('physical_form', v_form);
END;
$$;

COMMENT ON FUNCTION public.update_product_with_classification(jsonb) IS
  'Updates a product through update_product, then validates and stores a changed physical form. An unchanged form is preserved without reclassifying an old product.';

REVOKE ALL ON FUNCTION public.update_product_with_classification(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_with_classification(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Assertion: both tables now carry at least one policy.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(t.tablename ORDER BY t.tablename) INTO v_missing
    FROM pg_tables t
   WHERE t.schemaname = 'public'
     AND t.tablename IN ('employee_compensations', 'ownership_transfers')
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.tablename
     );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0300: tables still without any policy: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- Assertion: each of the four functions now carries the recognized guard string.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(f.fn ORDER BY f.fn) INTO v_missing
    FROM (
      VALUES ('create_product_with_classification'), ('update_product_with_classification'),
             ('reject_ownership_transfer'), ('restore_co_owner')
    ) AS f(fn)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = f.fn
        AND pg_get_functiondef(p.oid) LIKE '%authorize_tenant_membership%'
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0300: functions still without the recognized guard: %', array_to_string(v_missing, ', ');
  END IF;
END $$;
