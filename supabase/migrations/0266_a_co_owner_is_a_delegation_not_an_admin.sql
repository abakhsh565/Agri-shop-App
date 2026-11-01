-- ═══════════════════════════════════════════════════════════════════════════════
-- 0266 — A Co-Owner is a DELEGATION, not an admin
--
-- WHY THIS FILE EXISTS
--   The business has exactly two supported account experiences today: the original
--   owner (users.role = 'admin', membership.role = 'owner') and an employee. A
--   manager is only an employee with a wider permission bundle. There is no
--   owner-level delegation, no co-owner grant and no separate owner-style access
--   path for a non-owner.
--
-- THE MODEL
--   access_kind = 'co_owner' on the membership is the identity of the delegated
--   experience. memberships.role stays 'employee' on purpose: the legacy
--   users.role = 'admin' flag also opens old RLS role-write policies, and reusing
--   it for a Co-Owner would silently grant more than the owner delegated.
--
--   co_owner_grants is the authority. No active grant means no Co-Owner access.
--   The grant carries:
--     • branch / supplier / department / assigned-record scopes (explicit ALL,
--       SELECTED or NONE — NULL is never "everything"),
--     • the permission codes the owner delegated,
--     • major-authority modes (allowed / approval required / restricted),
--     • dashboard visibility,
--     • the employee roles this Co-Owner may assign and the branches they may
--       administer.
--
--   Original ownership never changes. users.is_original_owner is not touched by
--   any function in this file, and only the original owner can create, modify,
--   suspend or revoke a grant.
--
-- WHAT IS NOT HERE
--   Legal ownership transfer. That is a separate, independently approved workflow
--   and must not be implemented by turning a delegation into an owner.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Membership access category ─────────────────────────────────────────────
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS access_kind text NOT NULL DEFAULT 'standard';

DO $$ BEGIN
  ALTER TABLE public.memberships
    ADD CONSTRAINT memberships_access_kind_check
    CHECK (access_kind IN ('standard', 'co_owner'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_memberships_access_kind
  ON public.memberships(tenant_id, access_kind)
  WHERE access_kind = 'co_owner';

COMMENT ON COLUMN public.memberships.access_kind IS
  'standard = owner/employee membership; co_owner = delegated owner experience. Never use users.role=admin for a Co-Owner.';

-- ── 2. The grant and its lifecycle ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.co_owner_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  membership_id      uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  granted_by         uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  access_version     int NOT NULL DEFAULT 1,
  invited_at         timestamptz NOT NULL DEFAULT now(),
  activated_at       timestamptz,
  suspended_at       timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revocation_reason  text,
  expires_at         timestamptz,
  can_invite_employees    boolean NOT NULL DEFAULT false,
  can_deactivate_employees boolean NOT NULL DEFAULT false,
  can_manage_branches     boolean NOT NULL DEFAULT false,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id)
);

-- One live delegation per person per business. Revoked history is kept.
CREATE UNIQUE INDEX IF NOT EXISTS co_owner_grants_one_live
  ON public.co_owner_grants(tenant_id, user_id)
  WHERE status IN ('invited', 'active', 'suspended');

CREATE INDEX IF NOT EXISTS idx_co_owner_grants_tenant
  ON public.co_owner_grants(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_co_owner_grants_user
  ON public.co_owner_grants(user_id, status);

-- ── 3. Scope configuration ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.co_owner_scope_settings (
  grant_id         uuid PRIMARY KEY REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  branches_mode    text NOT NULL DEFAULT 'none'
                   CHECK (branches_mode IN ('all', 'selected', 'none')),
  suppliers_mode   text NOT NULL DEFAULT 'none'
                   CHECK (suppliers_mode IN ('all', 'selected', 'none')),
  departments_mode text NOT NULL DEFAULT 'none'
                   CHECK (departments_mode IN ('all', 'selected', 'none')),
  records_mode     text NOT NULL DEFAULT 'none'
                   CHECK (records_mode IN ('all', 'selected', 'none')),
  -- The catalogue has no brand field today. The mode exists for forward
  -- compatibility, but the UI does not offer it and it is forced to none.
  brands_mode      text NOT NULL DEFAULT 'none'
                   CHECK (brands_mode = 'none'),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.co_owner_branch_scopes (
  grant_id  uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.co_owner_supplier_scopes (
  grant_id   uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.co_owner_department_scopes (
  grant_id      uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, department_id)
);

-- Reserved for a future brand field. No production code writes this yet.
CREATE TABLE IF NOT EXISTS public.co_owner_brand_scopes (
  grant_id uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  brand    text NOT NULL,
  PRIMARY KEY (grant_id, brand)
);

CREATE TABLE IF NOT EXISTS public.co_owner_record_scopes (
  grant_id    uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'supplier')),
  entity_id   uuid NOT NULL,
  PRIMARY KEY (grant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS public.co_owner_permissions (
  grant_id      uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.co_owner_dashboards (
  grant_id   uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  widget_key text NOT NULL REFERENCES public.dashboard_widgets(key) ON DELETE CASCADE,
  visible    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (grant_id, widget_key)
);

CREATE TABLE IF NOT EXISTS public.co_owner_assignable_roles (
  grant_id uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  role_id  uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.co_owner_authority_catalog (
  code            text PRIMARY KEY,
  module          text NOT NULL,
  label_en        text NOT NULL,
  label_ur        text NOT NULL,
  permission_code text NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  sort_order      int NOT NULL DEFAULT 100
);

INSERT INTO public.co_owner_authority_catalog
  (code, module, label_en, label_ur, permission_code, sort_order) VALUES
  ('business.settings',      'settings',  'Business configuration', 'کاروباری ترتیبات',       'settings.edit',        10),
  ('business.branches',      'settings',  'Manage branches',        'برانچز کا انتظام',       'settings.edit',        20),
  ('employees.manage',       'employees', 'Manage employees',       'ملازمین کا انتظام',      'employees.manage',     30),
  ('employees.roles',        'employees', 'Manage roles and access','کردار اور رسائی',        'settings.edit',        40),
  ('sales.void',             'sales',     'Void a sale',            'فروخت منسوخ کریں',       'sales.void',           50),
  ('sales.returns',          'sales',     'Process returns',        'واپسی کا عمل',           'returns.create',       60),
  ('customers.delete',       'customers', 'Archive a customer',     'گاہک محفوظ شدہ',         'customers.delete',     70),
  ('customers.credit_limit', 'customers', 'Set credit limits',      'ادھار کی حد',            'customers.credit_limit', 80),
  ('customers.payments',     'customers', 'Record customer payments','گاہک کی ادائیگی',       'customers.payments',   90),
  ('inventory.adjust',       'inventory', 'Adjust stock',           'اسٹاک ایڈجسٹ کریں',      'inventory.adjust',    100),
  ('payments.supplier',      'purchases', 'Pay a supplier',         'سپلائر کو ادائیگی',      'payments.supplier',   110),
  ('products.delete',        'products',  'Delete a product',       'پروڈکٹ حذف کریں',        'products.delete',     120),
  ('purchases.create',       'purchases', 'Record a purchase',      'خریداری درج کریں',       'purchases.create',    130),
  ('data.export',            'reports',   'Export business records','ریکارڈ ایکسپورٹ',        'reports.view',        140)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.co_owner_authorities (
  grant_id       uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  authority_code text NOT NULL REFERENCES public.co_owner_authority_catalog(code) ON DELETE CASCADE,
  mode           text NOT NULL DEFAULT 'restricted'
                 CHECK (mode IN ('allowed', 'approval_required', 'restricted')),
  PRIMARY KEY (grant_id, authority_code)
);

-- ── 4. Approval requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.co_owner_approval_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  grant_id        uuid NOT NULL REFERENCES public.co_owner_grants(id) ON DELETE CASCADE,
  requested_by    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  authority_code  text NOT NULL REFERENCES public.co_owner_authority_catalog(code) ON DELETE RESTRICT,
  action_code     text NOT NULL,
  entity_type     text,
  entity_id       uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'executed', 'failed')),
  decided_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  executed_at     timestamptz,
  execution_result jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_co_owner_approvals_grant
  ON public.co_owner_approval_requests(grant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_co_owner_approvals_tenant
  ON public.co_owner_approval_requests(tenant_id, status, created_at DESC);

-- ── 5. Audit linkage ──────────────────────────────────────────────────────────
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS co_owner_grant_id uuid,
  ADD COLUMN IF NOT EXISTS on_behalf_of_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_audit_events_co_owner_grant
  ON public.audit_events(co_owner_grant_id, created_at DESC)
  WHERE co_owner_grant_id IS NOT NULL;

-- ── 6. Identity helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.co_owner_grant_for(
  p_user_id uuid DEFAULT NULL, p_tenant_id uuid DEFAULT NULL
)
RETURNS public.co_owner_grants
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT g.*
    FROM public.co_owner_grants g
    JOIN public.memberships m ON m.id = g.membership_id
   WHERE g.user_id = COALESCE(p_user_id, public.app_current_user_id())
     AND g.tenant_id = COALESCE(p_tenant_id, public.current_shop_id())
     AND g.status = 'active'
     AND (g.expires_at IS NULL OR g.expires_at > now())
     AND m.status = 'active'
     AND m.access_kind = 'co_owner'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.co_owner_grant_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_grant_for(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_co_owner(p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (public.co_owner_grant_for(p_user_id, public.current_shop_id())).id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.is_co_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_co_owner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_current_grant()
RETURNS public.co_owner_grants
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.co_owner_grant_for(public.app_current_user_id(), public.current_shop_id());
$$;
REVOKE ALL ON FUNCTION public.co_owner_current_grant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_current_grant() TO authenticated;

-- ── 7. Scope checks ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.co_owner_branch_allowed(
  p_grant_id uuid, p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_branch_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
        FROM public.co_owner_scope_settings s
       WHERE s.grant_id = p_grant_id
         AND (
           s.branches_mode = 'all'
           OR (s.branches_mode = 'selected' AND EXISTS (
             SELECT 1 FROM public.co_owner_branch_scopes b
              WHERE b.grant_id = p_grant_id AND b.branch_id = p_branch_id
           ))
         )
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_branch_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_branch_allowed(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_supplier_allowed(
  p_grant_id uuid, p_company_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_company_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
        FROM public.co_owner_scope_settings s
       WHERE s.grant_id = p_grant_id
         AND (
           s.suppliers_mode = 'all'
           OR (s.suppliers_mode = 'selected' AND EXISTS (
             SELECT 1 FROM public.co_owner_supplier_scopes x
              WHERE x.grant_id = p_grant_id AND x.company_id = p_company_id
           ))
         )
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_supplier_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_supplier_allowed(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_department_allowed(
  p_grant_id uuid, p_department_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_department_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
        FROM public.co_owner_scope_settings s
       WHERE s.grant_id = p_grant_id
         AND (
           s.departments_mode = 'all'
           OR (s.departments_mode = 'selected' AND EXISTS (
             SELECT 1 FROM public.co_owner_department_scopes x
              WHERE x.grant_id = p_grant_id AND x.department_id = p_department_id
           ))
         )
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_department_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_department_allowed(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_record_allowed(
  p_grant_id uuid, p_entity_type text, p_entity_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.co_owner_scope_settings s
     WHERE s.grant_id = p_grant_id
       AND (
         s.records_mode = 'all'
         OR (s.records_mode = 'selected' AND p_entity_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.co_owner_record_scopes r
            WHERE r.grant_id = p_grant_id
              AND r.entity_type = p_entity_type
              AND r.entity_id = p_entity_id
         ))
       )
  );
$$;
REVOKE ALL ON FUNCTION public.co_owner_record_allowed(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_record_allowed(uuid, text, uuid) TO authenticated;

-- RLS predicates. They return true for every non-Co-Owner, so the existing
-- owner/employee boundaries are unchanged.
CREATE OR REPLACE FUNCTION public.co_owner_supplier_visible(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT public.is_co_owner()
      OR public.co_owner_supplier_allowed((public.co_owner_current_grant()).id, p_company_id);
$$;
REVOKE ALL ON FUNCTION public.co_owner_supplier_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_supplier_visible(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_department_visible(p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT public.is_co_owner()
      OR public.co_owner_department_allowed((public.co_owner_current_grant()).id, p_department_id);
$$;
REVOKE ALL ON FUNCTION public.co_owner_department_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_department_visible(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_customer_visible(p_customer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT public.is_co_owner()
      OR public.co_owner_record_allowed((public.co_owner_current_grant()).id, 'customer', p_customer_id);
$$;
REVOKE ALL ON FUNCTION public.co_owner_customer_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_customer_visible(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_authority_mode(
  p_grant_id uuid, p_authority_code text
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT a.mode FROM public.co_owner_authorities a
     WHERE a.grant_id = p_grant_id AND a.authority_code = p_authority_code
  ), 'restricted');
$$;
REVOKE ALL ON FUNCTION public.co_owner_authority_mode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_authority_mode(uuid, text) TO authenticated;

-- ── 8. Effective permissions ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, public.app_current_user_id());
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_grant public.co_owner_grants;
  v_permissions text[];
BEGIN
  IF v_actor IS NULL OR v_user IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Owner and legacy admin may inspect anybody. A Co-Owner may inspect an
  -- employee only when they hold employees.view; this is the one read the
  -- employee detail screen needs.
  IF v_actor IS DISTINCT FROM v_user AND NOT public.app_is_admin() THEN
    IF NOT (public.is_co_owner(v_actor)
            AND EXISTS (
              SELECT 1
                FROM public.co_owner_permissions cp
                JOIN public.permissions p ON p.id = cp.permission_id
               WHERE cp.grant_id = (public.co_owner_current_grant()).id
                 AND p.code = 'employees.view'
            )) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM public.permissions;
  ELSIF v_member.access_kind = 'co_owner' THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_member.id
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now());
    IF v_grant.id IS NULL THEN RETURN '[]'::jsonb; END IF;
    SELECT array_agg(p.code ORDER BY p.code) INTO v_permissions
      FROM public.co_owner_permissions cp
      JOIN public.permissions p ON p.id = cp.permission_id
     WHERE cp.grant_id = v_grant.id;
  ELSE
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM (
      SELECT p.code FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        JOIN public.roles r ON r.id = rp.role_id AND r.tenant_id = v_member.tenant_id
       WHERE rp.role_id = v_member.role_id
      UNION
      SELECT p.code FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = v_user AND up.is_override AND up.is_granted
      EXCEPT
      SELECT p.code FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;

  RETURN to_jsonb(COALESCE(v_permissions, '{}'::text[]));
END;
$$;
REVOKE ALL ON FUNCTION public.get_effective_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_permissions(uuid) TO authenticated;

-- ── 9. Backend authorization ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.authorize_business_action(
  p_permission varchar, p_tenant_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_grant public.co_owner_grants;
  v_branch uuid := COALESCE(p_branch_id, public.current_branch_id());
  v_authority text;
  v_mode text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL OR
     (p_tenant_id IS NOT NULL AND v_member.tenant_id IS DISTINCT FROM p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;

  IF NOT public.has_effective_permission(p_permission, v_actor) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission %', p_permission;
  END IF;

  IF v_member.access_kind = 'co_owner' THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_member.id
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now());
    IF v_grant.id IS NULL THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: no active Co-Owner grant';
    END IF;
    IF v_branch IS NULL OR NOT public.co_owner_branch_allowed(v_grant.id, v_branch) OR NOT EXISTS (
      SELECT 1 FROM public.branches b
       WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
    END IF;

    v_authority := CASE p_permission
      WHEN 'sales.void' THEN 'sales.void'
      WHEN 'returns.create' THEN 'sales.returns'
      WHEN 'customers.delete' THEN 'customers.delete'
      WHEN 'customers.credit_limit' THEN 'customers.credit_limit'
      WHEN 'customers.payments' THEN 'customers.payments'
      WHEN 'inventory.adjust' THEN 'inventory.adjust'
      WHEN 'payments.supplier' THEN 'payments.supplier'
      WHEN 'employees.manage' THEN 'employees.manage'
      WHEN 'products.delete' THEN 'products.delete'
      WHEN 'purchases.create' THEN 'purchases.create'
      WHEN 'settings.edit' THEN 'business.settings'
      ELSE NULL
    END;

    IF v_authority IS NOT NULL THEN
      v_mode := public.co_owner_authority_mode(v_grant.id, v_authority);
      IF v_mode = 'restricted' THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: authority % is restricted', v_authority;
      ELSIF v_mode = 'approval_required' THEN
        RAISE EXCEPTION 'APPROVAL_REQUIRED:%', v_authority;
      END IF;
    END IF;
  ELSE
    IF v_branch IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b
       WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
         AND (v_member.role = 'owner' OR b.id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
    END IF;
  END IF;

  RETURN v_member.tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_business_action(varchar, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_business_action(varchar, uuid, uuid) TO authenticated;

-- ── 10. Dashboard visibility ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_dashboards()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user    uuid := public.app_current_user_id();
  v_member  public.memberships;
  v_grant   public.co_owner_grants;
  v_role    uuid;
  v_branch  uuid;
  v_keys    text[];
BEGIN
  IF v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    SELECT array_agg(key ORDER BY sort_order, key) INTO v_keys FROM public.dashboard_widgets;
    RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
  END IF;

  IF v_member.access_kind = 'co_owner' THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_member.id
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now());
    IF v_grant.id IS NULL THEN RETURN '[]'::jsonb; END IF;
    SELECT COALESCE(array_agg(d.widget_key ORDER BY w.sort_order, w.key), '{}'::text[])
      INTO v_keys
      FROM public.co_owner_dashboards d
      JOIN public.dashboard_widgets w ON w.key = d.widget_key
     WHERE d.grant_id = v_grant.id AND d.visible;
    RETURN to_jsonb(v_keys);
  END IF;

  v_role := v_member.role_id;
  v_branch := public.current_branch_id();
  IF v_branch IS NOT NULL THEN
    SELECT COALESCE(mbr.role_id, v_role) INTO v_role
      FROM public.membership_branch_roles mbr
     WHERE mbr.membership_id = v_member.id AND mbr.branch_id = v_branch;
    v_role := COALESCE(v_role, v_member.role_id);
  END IF;

  SELECT array_agg(rd.widget_key ORDER BY w.sort_order, w.key)
    INTO v_keys
    FROM public.role_dashboards rd
    JOIN public.dashboard_widgets w ON w.key = rd.widget_key
   WHERE rd.role_id = v_role;

  RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_dashboards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_dashboards() TO authenticated;

-- ── 11. Active access context used by the client shell ───────────────────────
CREATE OR REPLACE FUNCTION public.get_my_access_context()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_member public.memberships;
  v_grant public.co_owner_grants;
  v_shop text;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('experience', 'none'); END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN jsonb_build_object('experience', 'none'); END IF;
  SELECT s.name INTO v_shop FROM public.shops s WHERE s.id = v_member.tenant_id;

  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    RETURN jsonb_build_object(
      'experience', 'owner', 'membershipRole', 'owner',
      'membershipId', v_member.id, 'tenantId', v_member.tenant_id,
      'businessName', v_shop, 'grantId', NULL);
  END IF;

  SELECT g.* INTO v_grant
    FROM public.co_owner_grants g
   WHERE g.membership_id = v_member.id
     AND g.status = 'active'
     AND (g.expires_at IS NULL OR g.expires_at > now());
  IF v_grant.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'experience', 'co_owner', 'membershipRole', 'co_owner',
      'membershipId', v_member.id, 'tenantId', v_member.tenant_id,
      'businessName', v_shop, 'grantId', v_grant.id,
      'accessVersion', v_grant.access_version);
  END IF;

  RETURN jsonb_build_object(
    'experience', 'employee', 'membershipRole', v_member.role,
    'membershipId', v_member.id, 'tenantId', v_member.tenant_id,
    'businessName', v_shop, 'grantId', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_access_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;

-- ── 12. Grant scope synchronisation ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.co_owner_sync_membership(p_grant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant public.co_owner_grants;
  v_mode text;
  v_scope uuid[];
BEGIN
  SELECT * INTO v_grant FROM public.co_owner_grants WHERE id = p_grant_id FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  SELECT branches_mode INTO v_mode FROM public.co_owner_scope_settings WHERE grant_id = p_grant_id;
  v_mode := COALESCE(v_mode, 'none');

  IF v_mode = 'all' THEN
    SELECT COALESCE(array_agg(b.id ORDER BY b.created_at, b.id), '{}'::uuid[])
      INTO v_scope
      FROM public.branches b
     WHERE b.tenant_id = v_grant.tenant_id AND b.is_active;
  ELSIF v_mode = 'selected' THEN
    SELECT COALESCE(array_agg(x.branch_id ORDER BY x.branch_id), '{}'::uuid[])
      INTO v_scope
      FROM public.co_owner_branch_scopes x
      JOIN public.branches b ON b.id = x.branch_id
     WHERE x.grant_id = p_grant_id AND b.tenant_id = v_grant.tenant_id AND b.is_active;
  ELSE
    v_scope := '{}'::uuid[];
  END IF;

  UPDATE public.memberships
     SET access_kind = 'co_owner',
         role = 'employee',
         role_id = NULL,
         branch_scope = v_scope,
         status = CASE
           WHEN v_grant.status = 'invited' THEN 'pending'::membership_status
           WHEN v_grant.status = 'active' THEN 'active'::membership_status
           ELSE 'suspended'::membership_status
         END,
         updated_at = now()
   WHERE id = v_grant.membership_id;
END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_sync_membership(uuid) FROM PUBLIC, anon;

-- The membership helper is the inner half of acceptance, not a client RPC. Name it in
-- the retirement set the ACL guard unions across migrations, and prove it is closed.
DO $$
DECLARE
  v_server_only constant text[] := array['co_owner_sync_membership'];
  v_left text[];
BEGIN
  SELECT array_agg(p.proname) INTO v_left
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (v_server_only)
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '0266: a server-only Co-Owner function is still reachable: %', array_to_string(v_left, ', ');
  END IF;
END $$;

-- Keep an "all branches" grant current when a branch is added.
CREATE OR REPLACE FUNCTION public.co_owner_append_new_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.memberships m
     SET branch_scope = (
           SELECT COALESCE(array_agg(b.id ORDER BY b.created_at, b.id), '{}'::uuid[])
             FROM public.branches b
            WHERE b.tenant_id = NEW.tenant_id AND b.is_active
         ),
         updated_at = now()
   WHERE m.id IN (
     SELECT g.membership_id
       FROM public.co_owner_grants g
       JOIN public.co_owner_scope_settings s ON s.grant_id = g.id
      WHERE g.tenant_id = NEW.tenant_id
        AND g.status IN ('invited', 'active')
        AND s.branches_mode = 'all'
   );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS co_owner_append_new_branch_trg ON public.branches;
CREATE TRIGGER co_owner_append_new_branch_trg
  AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.co_owner_append_new_branch();

-- ── 13. Employee-management guard ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_co_owner_membership_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_actor_member public.memberships;
  v_grant public.co_owner_grants;
  v_target public.memberships;
  v_role_ok boolean;
  v_invited boolean;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_actor_member FROM public.membership_in_active_shop(v_actor);

  -- A new Co-Owner can only be created by the original owner. An invited
  -- person may activate their own membership; nobody else may.
  IF NEW.access_kind = 'co_owner' AND NEW.role = 'employee' THEN
    IF v_actor_member.id IS NULL THEN
      -- The invited person is still pending and has no active membership. The
      -- only permitted write is activating their own invitation.
      SELECT EXISTS (
        SELECT 1 FROM public.co_owner_grants g
         WHERE g.membership_id = NEW.id AND g.user_id = NEW.user_id
           AND g.status = 'invited'
      ) INTO v_invited;
      IF NOT v_invited THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: no invitation to activate';
      END IF;
    ELSIF v_actor_member.role <> 'owner' AND v_actor_member.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: only the original owner can appoint a Co-Owner';
    ELSIF v_actor_member.user_id = NEW.user_id AND v_actor_member.role <> 'owner' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.co_owner_grants g
         WHERE g.membership_id = NEW.id AND g.user_id = NEW.user_id
           AND g.status = 'invited'
      ) INTO v_invited;
      IF NOT v_invited THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: no invitation to activate';
      END IF;
    END IF;
  END IF;

  -- The original owner's own membership is never a Co-Owner target.
  IF NEW.role = 'owner' AND v_actor_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot change the original owner membership';
  END IF;

  -- A Co-Owner editing an employee membership must stay inside their grant.
  IF v_actor_member.access_kind = 'co_owner' AND v_actor_member.id IS NOT NULL THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_actor_member.id AND g.status = 'active';
    IF v_grant.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active grant'; END IF;
    IF NEW.user_id = v_actor THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: a Co-Owner cannot edit their own membership';
    END IF;
    SELECT * INTO v_target FROM public.memberships
      WHERE id = NEW.id FOR UPDATE;
    IF FOUND AND v_target.access_kind = 'co_owner' THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: cannot edit another Co-Owner';
    END IF;
    IF NEW.access_kind <> 'standard' OR NEW.role <> 'employee' THEN
      RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE';
    END IF;
    IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
      SELECT 1 FROM unnest(NEW.branch_scope) x
       WHERE NOT public.co_owner_branch_allowed(v_grant.id, x)
    ) THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: outside the Co-Owner grant';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.co_owner_assignable_roles ar
       WHERE ar.grant_id = v_grant.id AND ar.role_id = NEW.role_id
    ) INTO v_role_ok;
    IF NEW.role_id IS NULL OR NOT v_role_ok THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: role is not in the Co-Owner assignment ceiling';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_co_owner_membership_write_trg ON public.memberships;
CREATE TRIGGER guard_co_owner_membership_write_trg
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.guard_co_owner_membership_write();

-- ── 14. Owner-side grant management ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.co_owner_is_original_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.membership_in_active_shop(NULL) m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.role = 'owner' AND m.access_kind = 'standard' AND u.is_original_owner
  );
$$;
REVOKE ALL ON FUNCTION public.co_owner_is_original_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_is_original_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.co_owner_assert_original_owner()
RETURNS public.memberships
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
BEGIN
  SELECT m.* INTO v_member
    FROM public.membership_in_active_shop(NULL) m
    JOIN public.users u ON u.id = m.user_id
   WHERE m.role = 'owner' AND m.access_kind = 'standard' AND u.is_original_owner;
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the original owner can manage Co-Owners';
  END IF;
  RETURN v_member;
END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_assert_original_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_assert_original_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_co_owner_invitation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_user_id uuid;
  v_member_id uuid;
  v_grant_id uuid;
  v_phone text;
  v_name text;
  v_existing public.users;
  v_existing_member public.memberships;
  v_mode text;
  v_ids uuid[];
  v_code text;
  v_perm uuid;
  v_role uuid;
  v_widget text;
  v_authority text;
  v_auth_mode text;
  v_scope jsonb := COALESCE(payload->'scopes', '{}'::jsonb);
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  v_phone := NULLIF(trim(COALESCE(payload->>'phone', '')), '');
  v_name := NULLIF(trim(COALESCE(payload->>'name', '')), '');
  IF v_phone IS NULL THEN RAISE EXCEPTION 'VALIDATION: phone is required'; END IF;

  SELECT * INTO v_existing FROM public.users WHERE phone = v_phone LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.shop_id <> v_owner.tenant_id THEN
      RAISE EXCEPTION 'PERSON_BELONGS_TO_ANOTHER_BUSINESS';
    END IF;
    SELECT * INTO v_existing_member FROM public.memberships
      WHERE user_id = v_existing.id AND tenant_id = v_owner.tenant_id FOR UPDATE;
    IF v_existing_member.id IS NULL THEN
      RAISE EXCEPTION 'PERSON_NOT_IN_THIS_BUSINESS';
    END IF;
    IF v_existing_member.role = 'owner' OR v_existing_member.access_kind = 'co_owner' THEN
      RAISE EXCEPTION 'PERSON_ALREADY_HAS_OWNER_ACCESS';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.co_owner_grants g
       WHERE g.tenant_id = v_owner.tenant_id AND g.user_id = v_existing.id
         AND g.status IN ('invited', 'active', 'suspended')
    ) THEN
      RAISE EXCEPTION 'PERSON_ALREADY_INVITED';
    END IF;
    v_user_id := v_existing.id;
    -- Controlled transition: the employee membership becomes the Co-Owner
    -- membership. The previous employee role is recorded in history and is
    -- never silently restored on revocation.
    UPDATE public.memberships
       SET access_kind = 'co_owner', role = 'employee', role_id = NULL,
           status = 'pending', updated_at = now()
     WHERE id = v_existing_member.id;
    v_member_id := v_existing_member.id;
  ELSE
    INSERT INTO public.users
      (id, name, phone, role, is_original_owner, is_active, shop_id, created_by, created_at)
    VALUES
      (gen_random_uuid(), COALESCE(v_name, 'Co-Owner'), v_phone, 'employee', false, true,
       v_owner.tenant_id, v_owner.user_id, now())
    RETURNING id INTO v_user_id;

    -- The users trigger creates the ordinary membership. This invitation turns
    -- that same row into the Co-Owner membership instead of adding a second one.
    SELECT id INTO v_member_id
      FROM public.memberships
     WHERE user_id = v_user_id AND tenant_id = v_owner.tenant_id
     FOR UPDATE;
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'MEMBERSHIP_NOT_CREATED';
    END IF;
    UPDATE public.memberships
       SET access_kind = 'co_owner', role = 'employee', role_id = NULL,
           status = 'pending', updated_at = now()
     WHERE id = v_member_id;
  END IF;

  INSERT INTO public.co_owner_grants
    (tenant_id, user_id, membership_id, granted_by, status,
     can_invite_employees, can_deactivate_employees, can_manage_branches,
     notes, expires_at)
  VALUES
    (v_owner.tenant_id, v_user_id, v_member_id, v_owner.user_id, 'invited',
     COALESCE((payload->>'canInviteEmployees')::boolean, false),
     COALESCE((payload->>'canDeactivateEmployees')::boolean, false),
     COALESCE((payload->>'canManageBranches')::boolean, false),
     NULLIF(payload->>'notes', ''),
     NULLIF(payload->>'expiresAt', '')::timestamptz)
  RETURNING id INTO v_grant_id;

  INSERT INTO public.co_owner_scope_settings
    (grant_id, branches_mode, suppliers_mode, departments_mode, records_mode, brands_mode)
  VALUES
    (v_grant_id,
     CASE WHEN v_scope->>'branchesMode' IN ('all','selected','none') THEN v_scope->>'branchesMode' ELSE 'none' END,
     CASE WHEN v_scope->>'suppliersMode' IN ('all','selected','none') THEN v_scope->>'suppliersMode' ELSE 'none' END,
     CASE WHEN v_scope->>'departmentsMode' IN ('all','selected','none') THEN v_scope->>'departmentsMode' ELSE 'none' END,
     CASE WHEN v_scope->>'recordsMode' IN ('all','selected','none') THEN v_scope->>'recordsMode' ELSE 'none' END,
     'none');

  -- Validate + insert branch IDs.
  IF jsonb_typeof(COALESCE(v_scope->'branchIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_branch_scopes(grant_id, branch_id)
    SELECT v_grant_id, x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'branchIds')) s
     WHERE EXISTS (SELECT 1 FROM public.branches b WHERE b.id = s.x AND b.tenant_id = v_owner.tenant_id AND b.is_active);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'supplierIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_supplier_scopes(grant_id, company_id)
    SELECT v_grant_id, x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'supplierIds')) s
     WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id AND c.is_active);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'departmentIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_department_scopes(grant_id, department_id)
    SELECT v_grant_id, x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'departmentIds')) s
     WHERE EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.x AND d.tenant_id = v_owner.tenant_id);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'customerIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
    SELECT v_grant_id, 'customer', x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'customerIds')) s
     WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'recordSupplierIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
    SELECT v_grant_id, 'supplier', x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'recordSupplierIds')) s
     WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
  END IF;

  -- Permissions must exist in the catalogue and be real codes.
  FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
    SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
    IF v_perm IS NOT NULL THEN
      INSERT INTO public.co_owner_permissions(grant_id, permission_id)
      VALUES (v_grant_id, v_perm) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Dashboard visibility. Absence/unticked is hidden, never "show everything".
  FOR v_widget IN SELECT jsonb_array_elements_text(COALESCE(payload->'dashboards', '[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM public.dashboard_widgets w WHERE w.key = v_widget) THEN
      INSERT INTO public.co_owner_dashboards(grant_id, widget_key, visible)
      VALUES (v_grant_id, v_widget, true)
      ON CONFLICT (grant_id, widget_key) DO UPDATE SET visible = true;
    END IF;
  END LOOP;

  -- Major authority modes. Missing = restricted.
  FOR v_authority, v_auth_mode IN
    SELECT key, value FROM jsonb_each_text(COALESCE(payload->'authorities', '{}'::jsonb))
  LOOP
    IF EXISTS (SELECT 1 FROM public.co_owner_authority_catalog c WHERE c.code = v_authority)
       AND v_auth_mode IN ('allowed', 'approval_required', 'restricted') THEN
      INSERT INTO public.co_owner_authorities(grant_id, authority_code, mode)
      VALUES (v_grant_id, v_authority, v_auth_mode)
      ON CONFLICT (grant_id, authority_code) DO UPDATE SET mode = EXCLUDED.mode;
    END IF;
  END LOOP;

  -- Employee roles the Co-Owner may assign.
  IF jsonb_typeof(COALESCE(payload->'assignableRoleIds', '[]'::jsonb)) = 'array' THEN
    FOR v_role IN SELECT value::uuid FROM jsonb_array_elements_text(payload->'assignableRoleIds') LOOP
      IF EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.tenant_id = v_owner.tenant_id) THEN
        INSERT INTO public.co_owner_assignable_roles(grant_id, role_id)
        VALUES (v_grant_id, v_role) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.co_owner_sync_membership(v_grant_id);

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'co_owner_invited', 'co_owner_grant', v_grant_id, v_owner.tenant_id, v_grant_id,
     jsonb_build_object('user_id', v_user_id, 'phone', v_phone,
       'scopes', v_scope, 'permissions', COALESCE(payload->'permissions', '[]'::jsonb),
       'authorities', COALESCE(payload->'authorities', '{}'::jsonb),
       'dashboards', COALESCE(payload->'dashboards', '[]'::jsonb)));

  RETURN jsonb_build_object('grantId', v_grant_id, 'userId', v_user_id,
    'membershipId', v_member_id, 'status', 'invited');
END;
$$;
REVOKE ALL ON FUNCTION public.create_co_owner_invitation(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_co_owner_invitation(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_co_owner_grant(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_grant public.co_owner_grants;
  v_scope jsonb := COALESCE(payload->'scopes', '{}'::jsonb);
  v_mode text;
  v_code text;
  v_perm uuid;
  v_role uuid;
  v_widget text;
  v_authority text;
  v_auth_mode text;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = (payload->>'grantId')::uuid AND tenant_id = v_owner.tenant_id
    FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF v_grant.status = 'revoked' THEN RAISE EXCEPTION 'GRANT_REVOKED'; END IF;

  IF payload ? 'canInviteEmployees' THEN
    UPDATE public.co_owner_grants SET can_invite_employees = (payload->>'canInviteEmployees')::boolean WHERE id = v_grant.id;
  END IF;
  IF payload ? 'canDeactivateEmployees' THEN
    UPDATE public.co_owner_grants SET can_deactivate_employees = (payload->>'canDeactivateEmployees')::boolean WHERE id = v_grant.id;
  END IF;
  IF payload ? 'canManageBranches' THEN
    UPDATE public.co_owner_grants SET can_manage_branches = (payload->>'canManageBranches')::boolean WHERE id = v_grant.id;
  END IF;

  IF v_scope ? 'branchesMode' THEN
    UPDATE public.co_owner_scope_settings SET branches_mode = v_scope->>'branchesMode' WHERE grant_id = v_grant.id;
  END IF;
  IF v_scope ? 'suppliersMode' THEN
    UPDATE public.co_owner_scope_settings SET suppliers_mode = v_scope->>'suppliersMode' WHERE grant_id = v_grant.id;
  END IF;
  IF v_scope ? 'departmentsMode' THEN
    UPDATE public.co_owner_scope_settings SET departments_mode = v_scope->>'departmentsMode' WHERE grant_id = v_grant.id;
  END IF;
  IF v_scope ? 'recordsMode' THEN
    UPDATE public.co_owner_scope_settings SET records_mode = v_scope->>'recordsMode' WHERE grant_id = v_grant.id;
  END IF;

  IF v_scope ? 'branchIds' THEN
    DELETE FROM public.co_owner_branch_scopes WHERE grant_id = v_grant.id;
    INSERT INTO public.co_owner_branch_scopes(grant_id, branch_id)
    SELECT v_grant.id, x FROM (
      SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'branchIds')
    ) s WHERE EXISTS (SELECT 1 FROM public.branches b WHERE b.id = s.x AND b.tenant_id = v_owner.tenant_id AND b.is_active);
  END IF;
  IF v_scope ? 'supplierIds' THEN
    DELETE FROM public.co_owner_supplier_scopes WHERE grant_id = v_grant.id;
    INSERT INTO public.co_owner_supplier_scopes(grant_id, company_id)
    SELECT v_grant.id, x FROM (
      SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'supplierIds')
    ) s WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id AND c.is_active);
  END IF;
  IF v_scope ? 'departmentIds' THEN
    DELETE FROM public.co_owner_department_scopes WHERE grant_id = v_grant.id;
    INSERT INTO public.co_owner_department_scopes(grant_id, department_id)
    SELECT v_grant.id, x FROM (
      SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'departmentIds')
    ) s WHERE EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.x AND d.tenant_id = v_owner.tenant_id);
  END IF;
  IF v_scope ? 'customerIds' OR v_scope ? 'recordSupplierIds' THEN
    IF v_scope ? 'customerIds' THEN
      DELETE FROM public.co_owner_record_scopes WHERE grant_id = v_grant.id AND entity_type = 'customer';
      INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
      SELECT v_grant.id, 'customer', x FROM (
        SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'customerIds')
      ) s WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
    END IF;
    IF v_scope ? 'recordSupplierIds' THEN
      DELETE FROM public.co_owner_record_scopes WHERE grant_id = v_grant.id AND entity_type = 'supplier';
      INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
      SELECT v_grant.id, 'supplier', x FROM (
        SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'recordSupplierIds')
      ) s WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
    END IF;
  END IF;

  IF payload ? 'permissions' THEN
    DELETE FROM public.co_owner_permissions WHERE grant_id = v_grant.id;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
      IF v_perm IS NOT NULL THEN
        INSERT INTO public.co_owner_permissions(grant_id, permission_id) VALUES (v_grant.id, v_perm);
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'dashboards' THEN
    DELETE FROM public.co_owner_dashboards WHERE grant_id = v_grant.id;
    FOR v_widget IN SELECT jsonb_array_elements_text(COALESCE(payload->'dashboards', '[]'::jsonb)) LOOP
      IF EXISTS (SELECT 1 FROM public.dashboard_widgets w WHERE w.key = v_widget) THEN
        INSERT INTO public.co_owner_dashboards(grant_id, widget_key, visible)
        VALUES (v_grant.id, v_widget, true);
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'authorities' THEN
    FOR v_authority, v_auth_mode IN SELECT key, value FROM jsonb_each_text(payload->'authorities') LOOP
      IF EXISTS (SELECT 1 FROM public.co_owner_authority_catalog c WHERE c.code = v_authority)
         AND v_auth_mode IN ('allowed', 'approval_required', 'restricted') THEN
        INSERT INTO public.co_owner_authorities(grant_id, authority_code, mode)
        VALUES (v_grant.id, v_authority, v_auth_mode)
        ON CONFLICT (grant_id, authority_code) DO UPDATE SET mode = EXCLUDED.mode;
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'assignableRoleIds' THEN
    DELETE FROM public.co_owner_assignable_roles WHERE grant_id = v_grant.id;
    FOR v_role IN SELECT value::uuid FROM jsonb_array_elements_text(payload->'assignableRoleIds') LOOP
      IF EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.tenant_id = v_owner.tenant_id) THEN
        INSERT INTO public.co_owner_assignable_roles(grant_id, role_id) VALUES (v_grant.id, v_role);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.co_owner_grants
     SET access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  PERFORM public.co_owner_sync_membership(v_grant.id);

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'co_owner_grant_updated', 'co_owner_grant', v_grant.id, v_owner.tenant_id, v_grant.id,
     jsonb_build_object('access_version', v_grant.access_version + 1, 'payload', payload));

  RETURN jsonb_build_object('grantId', v_grant.id, 'updated', true,
    'accessVersion', v_grant.access_version + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.update_co_owner_grant(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_co_owner_grant(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.suspend_co_owner(p_grant_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner public.memberships; v_grant public.co_owner_grants;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = p_grant_id AND tenant_id = v_owner.tenant_id FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF v_grant.status = 'revoked' THEN RAISE EXCEPTION 'GRANT_REVOKED'; END IF;
  UPDATE public.co_owner_grants
     SET status = 'suspended', suspended_at = now(), access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  PERFORM public.co_owner_sync_membership(v_grant.id);
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_owner.user_id, 'co_owner_suspended', 'co_owner_grant', v_grant.id, v_owner.tenant_id, v_grant.id,
    jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), '')));
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'suspended');
END;
$$;
REVOKE ALL ON FUNCTION public.suspend_co_owner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_co_owner(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reactivate_co_owner(p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner public.memberships; v_grant public.co_owner_grants;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = p_grant_id AND tenant_id = v_owner.tenant_id FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF v_grant.status = 'revoked' THEN RAISE EXCEPTION 'GRANT_REVOKED: invite again instead'; END IF;
  UPDATE public.co_owner_grants
     SET status = 'active', activated_at = COALESCE(activated_at, now()),
         access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  PERFORM public.co_owner_sync_membership(v_grant.id);
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_owner.user_id, 'co_owner_reactivated', 'co_owner_grant', v_grant.id, v_owner.tenant_id, v_grant.id, '{}'::jsonb);
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'active');
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_co_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_co_owner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_co_owner(p_grant_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner public.memberships; v_grant public.co_owner_grants;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: a revocation reason is required';
  END IF;
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = p_grant_id AND tenant_id = v_owner.tenant_id FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF v_grant.status = 'revoked' THEN
    RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'revoked', 'idempotent', true);
  END IF;
  UPDATE public.co_owner_grants
     SET status = 'revoked', revoked_at = now(), revoked_by = v_owner.user_id,
         revocation_reason = trim(p_reason), access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  -- No automatic employee restoration: the former Co-Owner becomes an inactive
  -- membership with no role until the owner explicitly assigns one.
  UPDATE public.memberships
     SET access_kind = 'standard', role = 'employee', role_id = NULL,
         status = 'suspended', updated_at = now()
   WHERE id = v_grant.membership_id;
  UPDATE public.co_owner_approval_requests
     SET status = 'cancelled', decided_at = now(), decision_note = 'Grant revoked'
   WHERE grant_id = v_grant.id AND status = 'pending';
  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_owner.user_id, 'co_owner_revoked', 'co_owner_grant', v_grant.id, v_owner.tenant_id, v_grant.id,
    jsonb_build_object('reason', trim(p_reason), 'employee_restored', false, 'history_preserved', true));
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'revoked',
    'employeeRestored', false, 'historyPreserved', true);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_co_owner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_co_owner_invitation(p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  VALUES (v_user, 'co_owner_invitation_accepted', 'co_owner_grant', v_grant.id, v_grant.tenant_id, v_grant.id, '{}'::jsonb);
  RETURN jsonb_build_object('grantId', v_grant.id, 'status', 'active');
END;
$$;
REVOKE ALL ON FUNCTION public.accept_co_owner_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_co_owner_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_co_owner_grants()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', g.id, 'status', g.status, 'userId', g.user_id,
    'name', u.name, 'phone', u.phone, 'photoUrl', u.photo_url,
    'jobTitle', u.job_title, 'lastLoginAt', u.last_login_at,
    'invitedAt', g.invited_at, 'activatedAt', g.activated_at,
    'suspendedAt', g.suspended_at, 'revokedAt', g.revoked_at,
    'revocationReason', g.revocation_reason,
    'permissions', COALESCE((SELECT jsonb_agg(p.code ORDER BY p.code)
      FROM public.co_owner_permissions cp JOIN public.permissions p ON p.id = cp.permission_id
      WHERE cp.grant_id = g.id), '[]'::jsonb),
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
      FROM public.co_owner_branch_scopes bs JOIN public.branches b ON b.id = bs.branch_id
      WHERE bs.grant_id = g.id), '[]'::jsonb),
    'scope', (SELECT to_jsonb(s) FROM public.co_owner_scope_settings s WHERE s.grant_id = g.id)
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  FROM public.co_owner_grants g
  JOIN public.users u ON u.id = g.user_id
  WHERE g.tenant_id = public.current_shop_id()
    AND public.co_owner_is_original_owner();
$$;
REVOKE ALL ON FUNCTION public.get_co_owner_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_co_owner_grants() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_co_owner_grant(p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_row jsonb;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT jsonb_build_object(
    'id', g.id, 'status', g.status, 'userId', g.user_id, 'membershipId', g.membership_id,
    'name', u.name, 'phone', u.phone, 'jobTitle', u.job_title, 'lastLoginAt', u.last_login_at,
    'invitedAt', g.invited_at, 'activatedAt', g.activated_at,
    'suspendedAt', g.suspended_at, 'revokedAt', g.revoked_at,
    'revocationReason', g.revocation_reason,
    'canInviteEmployees', g.can_invite_employees,
    'canDeactivateEmployees', g.can_deactivate_employees,
    'canManageBranches', g.can_manage_branches,
    'notes', g.notes,
    'scope', (SELECT to_jsonb(s) FROM public.co_owner_scope_settings s WHERE s.grant_id = g.id),
    'branches', COALESCE((SELECT jsonb_agg(b.id ORDER BY b.name) FROM public.co_owner_branch_scopes bs JOIN public.branches b ON b.id = bs.branch_id WHERE bs.grant_id = g.id), '[]'::jsonb),
    'supplierIds', COALESCE((SELECT jsonb_agg(company_id) FROM public.co_owner_supplier_scopes WHERE grant_id = g.id), '[]'::jsonb),
    'departmentIds', COALESCE((SELECT jsonb_agg(department_id) FROM public.co_owner_department_scopes WHERE grant_id = g.id), '[]'::jsonb),
    'customerIds', COALESCE((SELECT jsonb_agg(entity_id) FROM public.co_owner_record_scopes WHERE grant_id = g.id AND entity_type = 'customer'), '[]'::jsonb),
    'recordSupplierIds', COALESCE((SELECT jsonb_agg(entity_id) FROM public.co_owner_record_scopes WHERE grant_id = g.id AND entity_type = 'supplier'), '[]'::jsonb),
    'permissions', COALESCE((SELECT jsonb_agg(p.code ORDER BY p.code) FROM public.co_owner_permissions cp JOIN public.permissions p ON p.id = cp.permission_id WHERE cp.grant_id = g.id), '[]'::jsonb),
    'dashboards', COALESCE((SELECT jsonb_agg(widget_key ORDER BY widget_key) FROM public.co_owner_dashboards WHERE grant_id = g.id AND visible), '[]'::jsonb),
    'authorities', COALESCE((SELECT jsonb_object_agg(authority_code, mode) FROM public.co_owner_authorities WHERE grant_id = g.id), '{}'::jsonb),
    'assignableRoleIds', COALESCE((SELECT jsonb_agg(role_id) FROM public.co_owner_assignable_roles WHERE grant_id = g.id), '[]'::jsonb),
    'activity', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'details', a.details) ORDER BY a.created_at DESC)
      FROM (SELECT action, created_at, details FROM public.audit_events
             WHERE co_owner_grant_id = g.id ORDER BY created_at DESC LIMIT 30) a), '[]'::jsonb)
  ) INTO v_row
  FROM public.co_owner_grants g
  JOIN public.users u ON u.id = g.user_id
  WHERE g.id = p_grant_id AND g.tenant_id = v_owner.tenant_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.get_co_owner_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_co_owner_grant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_co_owner_access()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant public.co_owner_grants;
  v_result jsonb;
BEGIN
  SELECT * INTO v_grant FROM public.co_owner_current_grant();
  IF v_grant.id IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'grantId', v_grant.id, 'status', v_grant.status, 'accessVersion', v_grant.access_version,
    'businessName', (SELECT name FROM public.shops WHERE id = v_grant.tenant_id),
    'tenantId', v_grant.tenant_id,
    'canInviteEmployees', v_grant.can_invite_employees,
    'canDeactivateEmployees', v_grant.can_deactivate_employees,
    'canManageBranches', v_grant.can_manage_branches,
    'scope', (SELECT to_jsonb(s) FROM public.co_owner_scope_settings s WHERE s.grant_id = v_grant.id),
    'permissions', COALESCE((SELECT jsonb_agg(p.code ORDER BY p.code) FROM public.co_owner_permissions cp JOIN public.permissions p ON p.id = cp.permission_id WHERE cp.grant_id = v_grant.id), '[]'::jsonb),
    'dashboards', COALESCE((SELECT jsonb_agg(widget_key ORDER BY widget_key) FROM public.co_owner_dashboards WHERE grant_id = v_grant.id AND visible), '[]'::jsonb),
    'authorities', COALESCE((SELECT jsonb_object_agg(authority_code, mode) FROM public.co_owner_authorities WHERE grant_id = v_grant.id), '{}'::jsonb),
    'assignableRoleIds', COALESCE((SELECT jsonb_agg(role_id) FROM public.co_owner_assignable_roles WHERE grant_id = v_grant.id), '[]'::jsonb),
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'isMain', b.is_default) ORDER BY b.is_default DESC, b.name)
      FROM public.memberships m
      JOIN public.branches b ON b.tenant_id = m.tenant_id AND b.is_active
      WHERE m.id = v_grant.membership_id
        AND b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_co_owner_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_co_owner_access() TO authenticated;

-- ── 15. Approval requests ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_co_owner_approval(
  p_action_code text, p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_grant public.co_owner_grants;
  v_authority text;
  v_mode text;
  v_id uuid;
  v_supported boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_grant FROM public.co_owner_current_grant();
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active Co-Owner grant'; END IF;

  v_authority := CASE p_action_code
    WHEN 'sale.void' THEN 'sales.void'
    WHEN 'inventory.adjust' THEN 'inventory.adjust'
    WHEN 'customer.credit_limit' THEN 'customers.credit_limit'
    WHEN 'customer.archive' THEN 'customers.delete'
    WHEN 'supplier.payment' THEN 'payments.supplier'
    ELSE NULL END;
  IF v_authority IS NULL THEN RAISE EXCEPTION 'UNSUPPORTED_APPROVAL_ACTION'; END IF;
  v_mode := public.co_owner_authority_mode(v_grant.id, v_authority);
  IF v_mode <> 'approval_required' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_REQUIRED';
  END IF;

  v_supported := (p_action_code = 'sale.void' AND p_payload ? 'saleId')
    OR (p_action_code = 'inventory.adjust' AND p_payload ? 'payload')
    OR (p_action_code = 'customer.credit_limit' AND p_payload ? 'customerId' AND p_payload ? 'creditLimit')
    OR (p_action_code = 'customer.archive' AND p_payload ? 'customerId')
    OR (p_action_code = 'supplier.payment' AND p_payload ? 'payload');
  IF NOT v_supported THEN RAISE EXCEPTION 'INVALID_APPROVAL_PAYLOAD'; END IF;

  INSERT INTO public.co_owner_approval_requests
    (tenant_id, grant_id, requested_by, authority_code, action_code,
     entity_type, entity_id, payload, status)
  VALUES
    (v_grant.tenant_id, v_grant.id, v_user, v_authority, p_action_code,
     p_entity_type, p_entity_id, p_payload, 'pending')
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES (v_user, 'co_owner_approval_requested', 'co_owner_approval', v_id, v_grant.tenant_id, v_grant.id,
    jsonb_build_object('action', p_action_code, 'authority', v_authority, 'payload', p_payload));

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$$;
REVOKE ALL ON FUNCTION public.request_co_owner_approval(text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_co_owner_approval(text, text, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_co_owner_approvals(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'status', r.status, 'actionCode', r.action_code,
    'entityType', r.entity_type, 'entityId', r.entity_id, 'payload', r.payload,
    'createdAt', r.created_at, 'decidedAt', r.decided_at,
    'decisionNote', r.decision_note, 'executedAt', r.executed_at,
    'executionResult', r.execution_result,
    'requesterName', u.name, 'requesterId', r.requested_by,
    'authorityMode', public.co_owner_authority_mode(r.grant_id, r.authority_code)
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.co_owner_approval_requests r
  JOIN public.users u ON u.id = r.requested_by
  WHERE r.tenant_id = public.current_shop_id()
    AND (p_status IS NULL OR r.status = p_status)
    AND (public.co_owner_is_original_owner() OR r.grant_id = (public.co_owner_current_grant()).id);
$$;
REVOKE ALL ON FUNCTION public.get_co_owner_approvals(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_co_owner_approvals(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_co_owner_approval(
  p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_req public.co_owner_approval_requests;
  v_grant public.co_owner_grants;
  v_result jsonb;
  v_mode text;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_req FROM public.co_owner_approval_requests
    WHERE id = p_request_id AND tenant_id = v_owner.tenant_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_ALREADY_DECIDED'; END IF;
  SELECT * INTO v_grant FROM public.co_owner_grants WHERE id = v_req.grant_id FOR UPDATE;
  IF v_grant.status <> 'active' THEN RAISE EXCEPTION 'GRANT_NOT_ACTIVE'; END IF;

  IF NOT p_approve THEN
    UPDATE public.co_owner_approval_requests
       SET status = 'rejected', decided_by = v_owner.user_id, decided_at = now(),
           decision_note = NULLIF(trim(COALESCE(p_note, '')), '')
     WHERE id = v_req.id;
    INSERT INTO public.audit_events
      (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
    VALUES (v_owner.user_id, 'co_owner_approval_rejected', 'co_owner_approval', v_req.id,
      v_owner.tenant_id, v_grant.id, jsonb_build_object('action', v_req.action_code, 'note', p_note));
    RETURN jsonb_build_object('id', v_req.id, 'status', 'rejected');
  END IF;

  SELECT mode INTO v_mode FROM public.co_owner_authorities
    WHERE grant_id = v_grant.id AND authority_code = v_req.authority_code;
  IF v_mode IS DISTINCT FROM 'approval_required' THEN
    RAISE EXCEPTION 'AUTHORITY_NOT_IN_APPROVAL_MODE';
  END IF;

  UPDATE public.co_owner_approval_requests
     SET status = 'approved', decided_by = v_owner.user_id, decided_at = now(),
         decision_note = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = v_req.id;

  -- The existing business RPC still enforces its permission and branch. The
  -- authority is temporarily switched to allowed for the duration of this
  -- transaction; the restoration runs in the same transaction, including on
  -- failure. The owner's approval is therefore the only bypass.
  UPDATE public.co_owner_authorities SET mode = 'allowed'
   WHERE grant_id = v_grant.id AND authority_code = v_req.authority_code;

  BEGIN
    IF v_req.action_code = 'sale.void' THEN
      v_result := public.void_sale(
        (v_req.payload->>'saleId')::uuid,
        COALESCE(v_req.payload->>'reason', ''),
        v_owner.user_id);
    ELSIF v_req.action_code = 'inventory.adjust' THEN
      v_result := public.adjust_stock(v_req.payload->'payload');
    ELSIF v_req.action_code = 'customer.credit_limit' THEN
      v_result := jsonb_build_object('limit', public.set_customer_credit_limit(
        (v_req.payload->>'customerId')::uuid,
        (v_req.payload->>'creditLimit')::numeric));
    ELSIF v_req.action_code = 'customer.archive' THEN
      PERFORM public.archive_customer((v_req.payload->>'customerId')::uuid, v_owner.user_id);
      v_result := jsonb_build_object('archived', true);
    ELSIF v_req.action_code = 'supplier.payment' THEN
      v_result := public.record_supplier_payment(v_req.payload->'payload');
    ELSE
      RAISE EXCEPTION 'UNSUPPORTED_APPROVAL_ACTION';
    END IF;

    UPDATE public.co_owner_authorities SET mode = 'approval_required'
     WHERE grant_id = v_grant.id AND authority_code = v_req.authority_code;

    UPDATE public.co_owner_approval_requests
       SET status = 'executed', executed_at = now(), execution_result = COALESCE(v_result, '{}'::jsonb)
     WHERE id = v_req.id;

    INSERT INTO public.audit_events
      (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
    VALUES (v_owner.user_id, 'co_owner_approval_executed', 'co_owner_approval', v_req.id,
      v_owner.tenant_id, v_grant.id,
      jsonb_build_object('action', v_req.action_code, 'result', v_result,
        'approved_for_user', v_req.requested_by));
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.co_owner_authorities SET mode = 'approval_required'
     WHERE grant_id = v_grant.id AND authority_code = v_req.authority_code;
    UPDATE public.co_owner_approval_requests
       SET status = 'failed', executed_at = now(),
           execution_result = jsonb_build_object('error', SQLERRM)
     WHERE id = v_req.id;
    RAISE;
  END;

  RETURN jsonb_build_object('id', v_req.id, 'status', 'executed', 'result', COALESCE(v_result, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.decide_co_owner_approval(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_co_owner_approval(uuid, boolean, text) TO authenticated;

-- ── 16. Co-Owner dashboard (one scoped read) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_co_owner_dashboard(
  p_branch_id uuid DEFAULT NULL, p_range text DEFAULT 'month'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_current_user_id();
  v_grant public.co_owner_grants;
  v_member public.memberships;
  v_widgets text[];
  v_branches uuid[];
  v_from timestamptz;
  v_sales numeric := 0;
  v_paid numeric := 0;
  v_due numeric := 0;
  v_profit numeric := 0;
  v_count int := 0;
  v_outstanding numeric := 0;
  v_low int := 0;
  v_products int := 0;
  v_team int := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_series jsonb := '[]'::jsonb;
  v_branch_rows jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_result jsonb;
  v_scope record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_grant FROM public.co_owner_current_grant();
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active Co-Owner grant'; END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  v_branches := COALESCE(v_member.branch_scope, '{}'::uuid[]);
  IF p_branch_id IS NOT NULL THEN
    IF NOT (p_branch_id = ANY(v_branches)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
    END IF;
    v_branches := ARRAY[p_branch_id];
  END IF;
  IF cardinality(v_branches) = 0 THEN
    RETURN jsonb_build_object('business', (SELECT name FROM public.shops WHERE id = v_grant.tenant_id),
      'branches', '[]'::jsonb, 'widgets', '[]'::jsonb, 'empty', 'no_branches');
  END IF;

  v_from := CASE lower(COALESCE(p_range, 'month'))
    WHEN 'today' THEN date_trunc('day', now())
    WHEN 'week' THEN now() - interval '7 days'
    WHEN 'month' THEN date_trunc('month', now())
    ELSE now() - interval '30 days' END;

  SELECT COALESCE(array_agg(widget_key ORDER BY widget_key), '{}'::text[])
    INTO v_widgets
    FROM public.co_owner_dashboards WHERE grant_id = v_grant.id AND visible;

  SELECT
    COALESCE(sum(s.total_amount), 0),
    COALESCE(sum(s.amount_paid), 0),
    COALESCE(sum(s.amount_due), 0),
    COALESCE(sum(COALESCE((SELECT sum(si.cogs_amount) FROM public.sale_items si WHERE si.sale_id = s.id), 0)), 0),
    count(*)::int
  INTO v_sales, v_paid, v_due, v_profit, v_count
  FROM public.sales s
  WHERE s.shop_id = v_grant.tenant_id
    AND s.branch_id = ANY(v_branches)
    AND s.is_voided = false
    AND s.created_at >= v_from;

  SELECT COALESCE(sum(c.outstanding_balance), 0)
    INTO v_outstanding
    FROM public.customers c
   WHERE c.shop_id = v_grant.tenant_id
     AND c.is_archived = false
     AND public.co_owner_customer_visible(c.id)
     AND EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_id = c.id AND s.branch_id = ANY(v_branches));

  SELECT count(*)::int, count(*) FILTER (WHERE p.stock_qty <= 5)::int
    INTO v_products, v_low
    FROM public.products p
   WHERE p.shop_id = v_grant.tenant_id
     AND p.is_active
     AND public.co_owner_supplier_visible(p.company_id)
     AND EXISTS (SELECT 1 FROM public.inventory_movements im
                  WHERE im.product_id = p.id AND im.branch_id = ANY(v_branches));

  SELECT count(DISTINCT m.user_id)::int
    INTO v_team
    FROM public.memberships m
    LEFT JOIN public.roles r ON r.id = m.role_id
   WHERE m.tenant_id = v_grant.tenant_id
     AND m.status = 'active'
     AND m.access_kind = 'standard'
     AND m.role <> 'owner'
     AND (
       (SELECT departments_mode FROM public.co_owner_scope_settings WHERE grant_id = v_grant.id) <> 'selected'
       OR public.co_owner_department_visible(r.department_id)
     );

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'sales', x.total, 'count', x.cnt)
    ORDER BY x.total DESC), '[]'::jsonb)
  INTO v_branch_rows
  FROM public.branches b
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(s.total_amount), 0) AS total, count(*)::int AS cnt
      FROM public.sales s
     WHERE s.branch_id = b.id AND s.shop_id = v_grant.tenant_id
       AND s.is_voided = false AND s.created_at >= v_from
  ) x ON true
  WHERE b.id = ANY(v_branches);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day, 'total', COALESCE(x.total, 0)) ORDER BY d.day), '[]'::jsonb)
  INTO v_series
  FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d(day)
  LEFT JOIN LATERAL (
    SELECT sum(s.total_amount) AS total FROM public.sales s
     WHERE s.shop_id = v_grant.tenant_id AND s.branch_id = ANY(v_branches)
       AND s.is_voided = false AND s.created_at >= d.day AND s.created_at < d.day + interval '1 day'
  ) x ON true;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT s.id, s.sale_number, s.customer_name_snapshot AS customer,
           s.total_amount AS total, s.status, s.created_at
      FROM public.sales s
     WHERE s.shop_id = v_grant.tenant_id AND s.branch_id = ANY(v_branches)
       AND s.is_voided = false
     ORDER BY s.created_at DESC LIMIT 8
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(a)), '[]'::jsonb)
  INTO v_alerts
  FROM (
    SELECT 'credit'::text AS kind, c.name, c.outstanding_balance AS amount
      FROM public.customers c
     WHERE c.shop_id = v_grant.tenant_id AND c.is_archived = false
       AND c.outstanding_balance > 0
       AND public.co_owner_customer_visible(c.id)
     ORDER BY c.outstanding_balance DESC LIMIT 5
  ) a;

  v_result := jsonb_build_object(
    'business', (SELECT name FROM public.shops WHERE id = v_grant.tenant_id),
    'tenantId', v_grant.tenant_id,
    'grantId', v_grant.id,
    'range', lower(COALESCE(p_range, 'month')),
    'branches', v_branch_rows,
    'widgets', to_jsonb(v_widgets),
    'allBranches', p_branch_id IS NULL
  );

  IF 'sales_overview' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('kpis', jsonb_build_object(
      'sales', v_sales, 'paid', v_paid, 'due', v_due,
      'profit', v_sales - v_profit, 'count', v_count));
  END IF;
  IF 'revenue_analysis' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('series', v_series);
  END IF;
  IF 'customer_outstanding' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('outstanding', v_outstanding);
  END IF;
  IF 'inventory_position' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('inventory', jsonb_build_object(
      'products', v_products, 'lowStock', v_low));
  END IF;
  IF 'team_performance' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('team', v_team);
  END IF;
  IF 'quick_alerts' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('alerts', v_alerts);
  END IF;
  IF 'sales_overview' = ANY(v_widgets) THEN
    v_result := v_result || jsonb_build_object('recentSales', v_recent);
  END IF;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_co_owner_dashboard(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_co_owner_dashboard(uuid, text) TO authenticated;

-- ── 17. RLS for the new tables ────────────────────────────────────────────────
ALTER TABLE public.co_owner_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_scope_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_branch_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_supplier_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_department_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_brand_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_record_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_assignable_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_authority_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_owner_approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS co_owner_grants_select ON public.co_owner_grants;
CREATE POLICY co_owner_grants_select ON public.co_owner_grants FOR SELECT TO authenticated
  USING (tenant_id = public.current_shop_id()
    AND (user_id = public.app_current_user_id()
      OR public.co_owner_is_original_owner()));

DROP POLICY IF EXISTS co_owner_scope_select ON public.co_owner_scope_settings;
CREATE POLICY co_owner_scope_select ON public.co_owner_scope_settings FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants
    WHERE tenant_id = public.current_shop_id()
      AND (user_id = public.app_current_user_id()
        OR public.co_owner_is_original_owner())));

DROP POLICY IF EXISTS co_owner_branch_scopes_select ON public.co_owner_branch_scopes;
CREATE POLICY co_owner_branch_scopes_select ON public.co_owner_branch_scopes FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_supplier_scopes_select ON public.co_owner_supplier_scopes;
CREATE POLICY co_owner_supplier_scopes_select ON public.co_owner_supplier_scopes FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_department_scopes_select ON public.co_owner_department_scopes;
CREATE POLICY co_owner_department_scopes_select ON public.co_owner_department_scopes FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_brand_scopes_select ON public.co_owner_brand_scopes;
CREATE POLICY co_owner_brand_scopes_select ON public.co_owner_brand_scopes FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_record_scopes_select ON public.co_owner_record_scopes;
CREATE POLICY co_owner_record_scopes_select ON public.co_owner_record_scopes FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_permissions_select ON public.co_owner_permissions;
CREATE POLICY co_owner_permissions_select ON public.co_owner_permissions FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_dashboards_select ON public.co_owner_dashboards;
CREATE POLICY co_owner_dashboards_select ON public.co_owner_dashboards FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_assignable_roles_select ON public.co_owner_assignable_roles;
CREATE POLICY co_owner_assignable_roles_select ON public.co_owner_assignable_roles FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_authority_catalog_select ON public.co_owner_authority_catalog;
CREATE POLICY co_owner_authority_catalog_select ON public.co_owner_authority_catalog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS co_owner_authorities_select ON public.co_owner_authorities;
CREATE POLICY co_owner_authorities_select ON public.co_owner_authorities FOR SELECT TO authenticated
  USING (grant_id IN (SELECT id FROM public.co_owner_grants WHERE tenant_id = public.current_shop_id()));
DROP POLICY IF EXISTS co_owner_approvals_select ON public.co_owner_approval_requests;
CREATE POLICY co_owner_approvals_select ON public.co_owner_approval_requests FOR SELECT TO authenticated
  USING (tenant_id = public.current_shop_id()
    AND (requested_by = public.app_current_user_id()
      OR public.co_owner_is_original_owner()));

REVOKE INSERT, UPDATE, DELETE ON
  public.co_owner_grants,
  public.co_owner_scope_settings,
  public.co_owner_branch_scopes,
  public.co_owner_supplier_scopes,
  public.co_owner_department_scopes,
  public.co_owner_brand_scopes,
  public.co_owner_record_scopes,
  public.co_owner_permissions,
  public.co_owner_dashboards,
  public.co_owner_assignable_roles,
  public.co_owner_authorities,
  public.co_owner_approval_requests
FROM anon, authenticated;

GRANT SELECT ON
  public.co_owner_grants,
  public.co_owner_scope_settings,
  public.co_owner_branch_scopes,
  public.co_owner_supplier_scopes,
  public.co_owner_department_scopes,
  public.co_owner_brand_scopes,
  public.co_owner_record_scopes,
  public.co_owner_permissions,
  public.co_owner_dashboards,
  public.co_owner_assignable_roles,
  public.co_owner_authority_catalog,
  public.co_owner_authorities,
  public.co_owner_approval_requests
TO authenticated;

-- ── 18. Existing table gates ─────────────────────────────────────────────────
-- Supplier scope applies to the supplier record and everything that names it.
DROP POLICY IF EXISTS co_owner_supplier_gate_companies ON public.companies;
CREATE POLICY co_owner_supplier_gate_companies ON public.companies AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.co_owner_supplier_visible(id));

DROP POLICY IF EXISTS co_owner_supplier_gate_products ON public.products;
CREATE POLICY co_owner_supplier_gate_products ON public.products AS RESTRICTIVE
  FOR SELECT TO authenticated USING (company_id IS NULL OR public.co_owner_supplier_visible(company_id));
DROP POLICY IF EXISTS co_owner_supplier_write_products ON public.products;
CREATE POLICY co_owner_supplier_write_products ON public.products AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (company_id IS NULL OR public.co_owner_supplier_visible(company_id));
DROP POLICY IF EXISTS co_owner_supplier_update_products ON public.products;
CREATE POLICY co_owner_supplier_update_products ON public.products AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (company_id IS NULL OR public.co_owner_supplier_visible(company_id))
  WITH CHECK (company_id IS NULL OR public.co_owner_supplier_visible(company_id));

DROP POLICY IF EXISTS co_owner_supplier_gate_purchases ON public.purchases;
CREATE POLICY co_owner_supplier_gate_purchases ON public.purchases AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.co_owner_supplier_visible(company_id));

DROP POLICY IF EXISTS co_owner_supplier_gate_supplier_payments ON public.supplier_payments;
CREATE POLICY co_owner_supplier_gate_supplier_payments ON public.supplier_payments AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.co_owner_supplier_visible(company_id));

-- Assigned-record scope applies to the customer, their sales and their receipts.
DROP POLICY IF EXISTS co_owner_record_gate_customers ON public.customers;
CREATE POLICY co_owner_record_gate_customers ON public.customers AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.co_owner_customer_visible(id));
DROP POLICY IF EXISTS co_owner_record_write_customers ON public.customers;
CREATE POLICY co_owner_record_write_customers ON public.customers AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (public.co_owner_customer_visible(id));

DROP POLICY IF EXISTS co_owner_record_gate_sales ON public.sales;
CREATE POLICY co_owner_record_gate_sales ON public.sales AS RESTRICTIVE
  FOR SELECT TO authenticated USING (customer_id IS NULL OR public.co_owner_customer_visible(customer_id));

DROP POLICY IF EXISTS co_owner_record_gate_customer_payments ON public.customer_payments;
CREATE POLICY co_owner_record_gate_customer_payments ON public.customer_payments AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.co_owner_customer_visible(customer_id));

-- Co-Owners with the ordinary permission may write products/companies even
-- though the legacy policies name app_is_admin(). The restrictive gates above
-- still apply, and authorize_business_action is the RPC gate.
DROP POLICY IF EXISTS co_owner_products_insert ON public.products;
CREATE POLICY co_owner_products_insert ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_co_owner() AND public.has_effective_permission('products.create'));
DROP POLICY IF EXISTS co_owner_products_update ON public.products;
CREATE POLICY co_owner_products_update ON public.products FOR UPDATE TO authenticated
  USING (public.is_co_owner() AND public.has_effective_permission('products.edit'))
  WITH CHECK (public.is_co_owner() AND public.has_effective_permission('products.edit'));
DROP POLICY IF EXISTS co_owner_companies_insert ON public.companies;
CREATE POLICY co_owner_companies_insert ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.is_co_owner() AND public.has_effective_permission('companies.create'));
DROP POLICY IF EXISTS co_owner_companies_update ON public.companies;
CREATE POLICY co_owner_companies_update ON public.companies FOR UPDATE TO authenticated
  USING (public.is_co_owner() AND public.has_effective_permission('companies.edit'))
  WITH CHECK (public.is_co_owner() AND public.has_effective_permission('companies.edit'));

-- ── 19. Onboarding: an invitation becomes access only on acceptance ───────────
CREATE OR REPLACE FUNCTION public.complete_member_onboarding()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := app_current_user_id();
  v_n int := 0;
  v_grant public.co_owner_grants;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_uid AND u.is_active) THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE';
  END IF;

  SELECT g.* INTO v_grant
    FROM public.co_owner_grants g
    JOIN public.memberships m ON m.id = g.membership_id
   WHERE g.user_id = v_uid AND g.status = 'invited'
     AND m.status = 'pending'
   ORDER BY g.created_at DESC LIMIT 1;
  IF v_grant.id IS NOT NULL THEN
    PERFORM public.accept_co_owner_invitation(v_grant.id);
    RETURN jsonb_build_object('activated', 1, 'coOwnerGrantId', v_grant.id);
  END IF;

  UPDATE memberships
     SET status = 'active'::membership_status, updated_at = now()
   WHERE user_id = v_uid AND status = 'pending'::membership_status;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
    VALUES (v_uid, 'member_onboarding_completed', 'membership', v_uid, jsonb_build_object('activated', v_n));
  END IF;

  RETURN jsonb_build_object('activated', v_n);
END;
$$;

NOTIFY pgrst, 'reload schema';
