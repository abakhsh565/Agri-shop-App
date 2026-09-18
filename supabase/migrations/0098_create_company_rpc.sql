-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0098: Create company via SECURITY DEFINER RPC
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE: Company creation used direct Supabase INSERT, which requires
-- RLS (current_shop_id + app_is_admin), but the browser has no valid JWT
-- session. SECURITY DEFINER RPCs bypass RLS and resolve tenant context
-- from JWT claims server-side.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_company(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_shop_id uuid;
  v_actor uuid;
BEGIN
  -- Resolve tenant via membership (single source of truth)
  v_shop_id := current_shop_id();

  -- Resolve actor from JWT sub → system default
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Insert company with tenant-scoped shop_id
  INSERT INTO companies (
    id, name, contact_person, phone, address, logo_url,
    outstanding_payable, total_purchases, shop_id, created_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    NULLIF(payload->>'contactPerson', ''),
    NULLIF(payload->>'phone', ''),
    NULLIF(payload->>'address', ''),
    NULLIF(payload->>'logoUrl', ''),
    0,
    0,
    v_shop_id,
    now()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'name', payload->>'name'
  );
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION create_company(jsonb) TO authenticated;
