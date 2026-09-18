-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0094: Tenant / Membership / Branch Foundation
-- ═══════════════════════════════════════════════════════════════════════════════
-- SAFETY: Additive only. No columns dropped. No data destroyed.
-- Backward-compatible: existing shop_id columns remain functional.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. ENUMS
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE membership_status AS ENUM ('active', 'suspended', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. TENANTS (view over existing shops for backward compatibility)
-- ──────────────────────────────────────────────────────────────────────────────
-- We keep the `shops` table as-is and create `tenants` as an alias view.
-- This avoids breaking any existing FK or query that references `shops`.

CREATE OR REPLACE VIEW tenants AS
  SELECT id, name, phone, address, owner_id, created_at
  FROM shops;

-- 3. BRANCHES
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        varchar NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  address     text,
  phone       varchar,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);

-- 4. MEMBERSHIPS
-- ──────────────────────────────────────────────────────────────────────────────
-- The core authorization table: user ↔ tenant relationship.

CREATE TABLE IF NOT EXISTS memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role          membership_role NOT NULL DEFAULT 'employee',
  status        membership_status NOT NULL DEFAULT 'active',
  branch_scope  uuid[] DEFAULT NULL,  -- NULL = all branches; array = specific branches
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);

-- 5. BACKFILL: Create memberships from existing users.shop_id
-- ──────────────────────────────────────────────────────────────────────────────

-- For each user that has a shop_id, create a membership.
-- Owner gets 'owner' role, admin gets 'admin', employee gets 'employee'.

INSERT INTO memberships (user_id, tenant_id, role, status)
SELECT
  u.id,
  u.shop_id,
  CASE
    WHEN u.is_original_owner THEN 'owner'::membership_role
    WHEN u.role = 'admin' THEN 'admin'::membership_role
    ELSE 'employee'::membership_role
  END,
  CASE WHEN u.is_active THEN 'active'::membership_status ELSE 'suspended'::membership_status END
FROM users u
WHERE u.shop_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.tenant_id = u.shop_id
  );

-- 6. BACKFILL: Create default branch for each tenant
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO branches (tenant_id, name, is_default)
SELECT s.id, s.name || ' - Main', true
FROM shops s
WHERE NOT EXISTS (
  SELECT 1 FROM branches b WHERE b.tenant_id = s.id AND b.is_default = true
);

-- 7. HELPER FUNCTIONS
-- ──────────────────────────────────────────────────────────────────────────────

-- Resolve current user's tenant from their JWT → user → membership.
-- This is the SINGLE SOURCE OF TRUTH for tenant context in all RPCs.

CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  -- Step 1: Get user ID from JWT
  v_user_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Step 2: Get active membership for this user
  SELECT m.tenant_id INTO v_tenant_id
  FROM memberships m
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC  -- First membership if multiple
  LIMIT 1;

  RETURN v_tenant_id;
END;
$$;

-- Get current user's membership (includes role, branch_scope, status).

CREATE OR REPLACE FUNCTION get_current_membership()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_membership jsonb;
BEGIN
  v_user_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'user_id', m.user_id,
    'tenant_id', m.tenant_id,
    'role', m.role,
    'status', m.status,
    'branch_scope', m.branch_scope
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;

  RETURN v_membership;
END;
$$;

-- Authorization check: is the current user authorized for this tenant?

CREATE OR REPLACE FUNCTION is_authorized_for_tenant(
  p_tenant_id uuid,
  p_required_role membership_role DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_membership memberships%ROWTYPE;
BEGIN
  v_user_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;

  IF v_user_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_membership
  FROM memberships m
  WHERE m.user_id = v_user_id
    AND m.tenant_id = p_tenant_id
    AND m.status = 'active';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- If a specific role is required, check hierarchy: owner > admin > employee
  IF p_required_role IS NOT NULL THEN
    RETURN CASE
      WHEN v_membership.role = 'owner' THEN true
      WHEN v_membership.role = 'admin' AND p_required_role IN ('admin', 'employee') THEN true
      WHEN v_membership.role = 'employee' AND p_required_role = 'employee' THEN true
      ELSE false
    END;
  END IF;

  RETURN true;
END;
$$;

-- 8. GRANTS
-- ──────────────────────────────────────────────────────────────────────────────

GRANT SELECT ON branches TO authenticated;
GRANT SELECT ON memberships TO authenticated;
GRANT SELECT ON tenants TO authenticated;

GRANT EXECUTE ON FUNCTION get_current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION is_authorized_for_tenant(uuid, membership_role) TO authenticated;

-- Also grant to anon for registration flow (get_my_shop_request needs tenant lookup)
GRANT EXECUTE ON FUNCTION get_current_tenant_id() TO anon;

-- 9. RLS POLICIES (tenant isolation at DB level)
-- ──────────────────────────────────────────────────────────────────────────────

-- Memberships: users can see their own memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_select_own ON memberships;
CREATE POLICY memberships_select_own ON memberships
  FOR SELECT USING (
    user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  );

-- Branches: authenticated users can see branches of their tenant
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_select_tenant ON branches;
CREATE POLICY branches_select_tenant ON branches
  FOR SELECT USING (
    tenant_id = get_current_tenant_id()
  );

-- 10. UPDATE TRIGGER for memberships.updated_at
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_memberships_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memberships_updated_at ON memberships;
CREATE TRIGGER memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_memberships_updated_at();
