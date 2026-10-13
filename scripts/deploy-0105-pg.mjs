import pg from 'pg';
import { qaPoolOptions } from './lib/qa-connection.mjs';

const { Pool } = pg;

// Credentials come from the environment, and the target must be the QA project.
// The literal that used to sit here (a service-role key for an older project) is in git history and
// must be rotated — see docs/PRODUCTION_DATA_POLICY.md.
const pool = new Pool(qaPoolOptions({ statementTimeout: 30000 }));

async function run() {
  const client = await pool.connect();
  try {
    // Test connection
    const test = await client.query('SELECT current_database(), current_user');
    console.log('Connected as:', test.rows[0]);

    // Deploy deactivate_employee_v1
    console.log('Deploying deactivate_employee_v1...');
    await client.query(`
      CREATE OR REPLACE FUNCTION deactivate_employee_v1(payload jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        v_actor_id uuid;
        v_emp_id uuid;
        v_emp record;
        v_caller_role text;
        v_shop_id uuid;
      BEGIN
        v_actor_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
        IF v_actor_id IS NULL THEN
          RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session';
        END IF;
        SELECT role INTO v_caller_role FROM users WHERE id = v_actor_id;
        IF v_caller_role IS DISTINCT FROM 'admin' THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can deactivate employees';
        END IF;
        v_shop_id := current_shop_id();
        IF v_shop_id IS NULL THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context';
        END IF;
        v_emp_id := COALESCE(
          NULLIF((payload->>'employeeId')::text, '')::uuid,
          NULLIF((payload->>'employee_id')::text, '')::uuid
        );
        IF v_emp_id IS NULL THEN
          RAISE EXCEPTION 'VALIDATION: Employee ID is required';
        END IF;
        SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
        END IF;
        IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization';
        END IF;
        IF v_emp.is_original_owner THEN
          RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER: Cannot deactivate the shop owner';
        END IF;
        IF v_emp.is_active = false THEN
          RAISE EXCEPTION 'ALREADY_DEACTIVATED: Employee is already deactivated';
        END IF;
        UPDATE users SET is_active = false, deactivated_at = now(), deactivated_by = v_actor_id WHERE id = v_emp_id;
        UPDATE memberships SET status = 'suspended', updated_at = now() WHERE user_id = v_emp_id AND tenant_id = v_shop_id;
        INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
        VALUES (v_actor_id, 'employee_deactivated', 'user', v_emp_id, jsonb_build_object('name', v_emp.name, 'shop_id', v_shop_id));
        RETURN jsonb_build_object('id', v_emp_id, 'isActive', false, 'membershipStatus', 'suspended');
      END;
      $$;
    `);
    console.log('deactivate_employee_v1: OK');

    // Deploy activate_employee_v1
    console.log('Deploying activate_employee_v1...');
    await client.query(`
      CREATE OR REPLACE FUNCTION activate_employee_v1(payload jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        v_actor_id uuid;
        v_emp_id uuid;
        v_emp record;
        v_caller_role text;
        v_shop_id uuid;
      BEGIN
        v_actor_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
        IF v_actor_id IS NULL THEN
          RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session';
        END IF;
        SELECT role INTO v_caller_role FROM users WHERE id = v_actor_id;
        IF v_caller_role IS DISTINCT FROM 'admin' THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can activate employees';
        END IF;
        v_shop_id := current_shop_id();
        IF v_shop_id IS NULL THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context';
        END IF;
        v_emp_id := COALESCE(
          NULLIF((payload->>'employeeId')::text, '')::uuid,
          NULLIF((payload->>'employee_id')::text, '')::uuid
        );
        IF v_emp_id IS NULL THEN
          RAISE EXCEPTION 'VALIDATION: Employee ID is required';
        END IF;
        SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
        END IF;
        IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization';
        END IF;
        IF v_emp.is_active = true THEN
          RAISE EXCEPTION 'ALREADY_ACTIVE: Employee is already active';
        END IF;
        UPDATE users SET is_active = true, deactivated_at = NULL, deactivated_by = NULL WHERE id = v_emp_id;
        UPDATE memberships SET status = 'active', updated_at = now() WHERE user_id = v_emp_id AND tenant_id = v_shop_id;
        IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = v_emp_id AND tenant_id = v_shop_id) THEN
          INSERT INTO memberships (user_id, tenant_id, role, status) VALUES (v_emp_id, v_shop_id, 'employee', 'active');
        END IF;
        INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
        VALUES (v_actor_id, 'employee_activated', 'user', v_emp_id, jsonb_build_object('name', v_emp.name, 'shop_id', v_shop_id));
        RETURN jsonb_build_object('id', v_emp_id, 'isActive', true, 'membershipStatus', 'active');
      END;
      $$;
    `);
    console.log('activate_employee_v1: OK');

    // Deploy updated create_employee
    console.log('Deploying create_employee...');
    await client.query(`
      CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public'
      AS $$
      DECLARE
        v_id uuid;
        v_phone text;
        v_shop_id uuid;
        v_actor uuid;
        v_caller_role text;
        v_next_num integer;
      BEGIN
        v_actor := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session';
        END IF;
        SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
        IF v_caller_role IS DISTINCT FROM 'admin' THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create employees';
        END IF;
        v_shop_id := current_shop_id();
        IF v_shop_id IS NULL THEN
          RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context';
        END IF;
        v_phone := NULLIF(payload->>'phone', '');
        IF v_phone IS NULL OR trim(payload->>'name') = '' THEN
          RAISE EXCEPTION 'VALIDATION: Name and phone are required';
        END IF;
        IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone) THEN
          RAISE EXCEPTION 'DUPLICATE_PHONE: An employee with this phone number already exists';
        END IF;
        SELECT COALESCE(MAX(employee_number::text), 'EMP-000') INTO v_next_num
        FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
        v_next_num := (regexp_replace(COALESCE(v_next_num::text, 'EMP-000'), '[^0-9]', '', 'g'))::integer + 1;
        INSERT INTO users (
          id, name, phone, role, is_original_owner, is_active,
          employee_number, job_title, photo_url, created_by, shop_id, created_at
        ) VALUES (
          gen_random_uuid(), trim(payload->>'name'), v_phone,
          COALESCE(NULLIF(payload->>'role', ''), 'employee')::user_role,
          false, true, 'EMP-' || LPAD(v_next_num::text, 3, '0'),
          NULLIF(payload->>'jobTitle', ''), NULLIF(payload->>'photoUrl', ''),
          v_actor, v_shop_id, now()
        ) RETURNING id INTO v_id;
        INSERT INTO memberships (user_id, tenant_id, role, status)
        VALUES (v_id, v_shop_id, 'employee', 'active');
        RETURN jsonb_build_object('id', v_id);
      END;
      $$;
    `);
    console.log('create_employee: OK');

    // Grant execute
    console.log('Granting execute permissions...');
    await client.query(`GRANT EXECUTE ON FUNCTION deactivate_employee_v1(jsonb) TO authenticated;`);
    await client.query(`GRANT EXECUTE ON FUNCTION activate_employee_v1(jsonb) TO authenticated;`);
    await client.query(`GRANT EXECUTE ON FUNCTION create_employee(jsonb) TO authenticated;`);
    console.log('Grants: OK');

    // Verify
    const { rows } = await client.query(`
      SELECT proname, pronargs 
      FROM pg_proc 
      WHERE proname IN ('deactivate_employee_v1', 'activate_employee_v1', 'create_employee')
      ORDER BY proname
    `);
    console.log('Verified functions:', rows.map(r => `${r.proname}(${r.pronargs} args)`).join(', '));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
