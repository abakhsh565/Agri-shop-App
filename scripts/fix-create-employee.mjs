import pg from 'pg';
import { qaPoolOptions } from './lib/qa-connection.mjs';
const { Pool } = pg;

// Credentials come from the environment, and the target must be the QA project. The password literal
// that used to sit here is in git history and must be rotated — see docs/PRODUCTION_DATA_POLICY.md.
const pool = new Pool(qaPoolOptions());

async function fix() {
  const client = await pool.connect();
  try {
    console.log('Fixing create_employee employee_number logic...');
    await client.query(`
      CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $$
      DECLARE
        v_id uuid; v_phone text; v_shop_id uuid; v_actor uuid; v_caller_role text;
        v_max_num_text text; v_next_num integer;
      BEGIN
        v_actor := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
        IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session'; END IF;
        SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
        IF v_caller_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create employees'; END IF;
        v_shop_id := current_shop_id();
        IF v_shop_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context'; END IF;
        v_phone := NULLIF(payload->>'phone', '');
        IF v_phone IS NULL OR trim(payload->>'name') = '' THEN RAISE EXCEPTION 'VALIDATION: Name and phone are required'; END IF;
        IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE: An employee with this phone number already exists'; END IF;
        -- Get next employee number safely
        SELECT MAX(employee_number) INTO v_max_num_text
        FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
        IF v_max_num_text IS NULL THEN
          v_next_num := 1;
        ELSE
          v_next_num := COALESCE((regexp_replace(v_max_num_text, '[^0-9]', '', 'g'))::integer, 0) + 1;
        END IF;
        INSERT INTO users (id, name, phone, role, is_original_owner, is_active, employee_number, job_title, photo_url, created_by, shop_id, created_at)
        VALUES (gen_random_uuid(), trim(payload->>'name'), v_phone,
          COALESCE(NULLIF(payload->>'role', ''), 'employee')::user_role,
          false, true, 'EMP-' || LPAD(v_next_num::text, 3, '0'),
          NULLIF(payload->>'jobTitle', ''), NULLIF(payload->>'photoUrl', ''), v_actor, v_shop_id, now())
        RETURNING id INTO v_id;
        INSERT INTO memberships (user_id, tenant_id, role, status) VALUES (v_id, v_shop_id, 'employee', 'active');
        RETURN jsonb_build_object('id', v_id);
      END;
      $$;
    `);
    console.log('create_employee fixed: OK');

    // Verify
    const { rows } = await client.query(`SELECT proname FROM pg_proc WHERE proname = 'create_employee'`);
    console.log('Verified:', rows.length > 0 ? 'exists' : 'MISSING');
  } finally {
    client.release();
    await pool.end();
  }
}

fix().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
