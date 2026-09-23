import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const lines = readFileSync('.env.qa', 'utf8').split('\n');
const env = {};
for (const l of lines) {
  if (l.includes('=')) {
    const k = l.split('=')[0].trim();
    const v = l.split('=').slice(1).join('=').trim();
    env[k] = v;
  }
}

const c = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE);

const sql = `
CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_phone text;
  v_shop_id uuid;
  v_actor uuid;
  v_caller_role text;
  v_next_num integer;
  v_num_text text;
BEGIN
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create employees';
  END IF;

  v_shop_id := current_shop_id();

  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NULL OR trim(payload->>'name') = '' THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PHONE: An employee with this phone number already exists';
  END IF;

  SELECT COALESCE(MAX(employee_number), 'EMP-000') INTO v_num_text
  FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
  v_next_num := (regexp_replace(v_num_text, '[^0-9]', '', 'g'))::integer + 1;

  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, job_title, photo_url, created_by, shop_id, created_at
  ) VALUES (
    gen_random_uuid(),
    trim(payload->>'name'),
    v_phone,
    COALESCE(NULLIF(payload->>'role', ''), 'employee')::user_role,
    false,
    true,
    'EMP-' || LPAD(v_next_num::text, 3, '0'),
    NULLIF(payload->>'jobTitle', ''),
    NULLIF(payload->>'photoUrl', ''),
    v_actor,
    v_shop_id,
    now()
  )
  RETURNING id INTO v_id;

  INSERT INTO memberships (user_id, tenant_id, role, status, created_at)
  VALUES (v_id, v_shop_id, 'employee', 'active', now());

  RETURN jsonb_build_object('id', v_id);
END;
$function$;
`;

const { error } = await c.rpc('run_sql', { sql_query: sql });
if (error) {
  console.log('ERROR:', error.message);
} else {
  console.log('Function created successfully');
}

// Verify
const { data: check } = await c.rpc('run_sql', {
  sql_query: "SELECT proname FROM pg_proc WHERE proname = 'create_employee'"
});
console.log('Verification:', JSON.stringify(check));
