-- Migration 0070: Test infrastructure functions for CI
-- Allows tests to execute SQL/RPCs via HTTP API instead of direct PostgreSQL connections.

DROP FUNCTION IF EXISTS run_sql(text) CASCADE;
DROP FUNCTION IF EXISTS exec_rpc_as_user(uuid, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS run_sql_as_user(text, text) CASCADE;

-- Function 1: Execute SQL as postgres (bypasses RLS and triggers)
CREATE OR REPLACE FUNCTION run_sql(sql_query text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $BODY$
DECLARE result jsonb;
BEGIN
  BEGIN
    EXECUTE 'SELECT coalesce(json_agg(row_to_json(t)), ''[]''::json) FROM (' || sql_query || ') t' INTO result;
    RETURN result::text;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE sql_query;
      RETURN 'ok';
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('error', SQLERRM)::text;
    END;
  END;
END;
$BODY$;

-- Function 2: Execute SQL as a specific user (with JWT claims)
CREATE OR REPLACE FUNCTION run_sql_as_user(
  p_user_id text,
  p_sql text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $BODY$
DECLARE
  v_phone text;
  v_claims text;
  v_result jsonb;
BEGIN
  SELECT phone INTO v_phone FROM users WHERE id = p_user_id::uuid;

  IF v_phone IS NOT NULL THEN
    v_claims := json_build_object('sub', p_user_id, 'phone', v_phone)::text;
  ELSE
    v_claims := json_build_object('sub', p_user_id)::text;
  END IF;

  -- Use session-level (is_local=false) so the claims persist for the EXECUTE
  PERFORM set_config('request.jwt.claims', v_claims, false);

  BEGIN
    EXECUTE 'SELECT coalesce(json_agg(row_to_json(t)), ''[]''::json) FROM (' || p_sql || ') t' INTO v_result;
    RETURN v_result::text;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE p_sql;
      RETURN 'ok';
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('error', SQLERRM)::text;
    END;
  END;
END;
$BODY$;

-- Function 3: Execute an RPC as a specific user (with JWT claims)
-- Returns text to avoid type mismatch issues with different RPC return types.
CREATE OR REPLACE FUNCTION exec_rpc_as_user(
  p_user_id uuid,
  p_rpc_name text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $BODY$
DECLARE
  v_phone text;
  v_claims text;
  v_result text;
  v_sql text;
  v_param_str text := '';
  k text;
  v jsonb;
BEGIN
  SELECT phone INTO v_phone FROM users WHERE id = p_user_id;

  IF v_phone IS NOT NULL THEN
    v_claims := json_build_object('sub', p_user_id, 'phone', v_phone)::text;
  ELSE
    v_claims := json_build_object('sub', p_user_id)::text;
  END IF;

  -- Use session-level so claims persist for the EXECUTE
  PERFORM set_config('request.jwt.claims', v_claims, false);

  -- Build parameter string
  FOR k, v IN SELECT * FROM jsonb_each(p_params)
  LOOP
    IF v_param_str != '' THEN v_param_str := v_param_str || ', '; END IF;
    IF jsonb_typeof(v) = 'string' THEN
      v_param_str := v_param_str || k || ' := ' || quote_literal(v #>> '{}');
    ELSIF v IS NULL THEN
      v_param_str := v_param_str || k || ' := NULL';
    ELSIF jsonb_typeof(v) = 'number' THEN
      v_param_str := v_param_str || k || ' := ' || (v #>> '{}');
    ELSIF jsonb_typeof(v) = 'boolean' THEN
      v_param_str := v_param_str || k || ' := ' || (v #>> '{}');
    ELSE
      v_param_str := v_param_str || k || ' := ' || quote_literal(v::text) || '::jsonb';
    END IF;
  END LOOP;

  IF v_param_str != '' THEN
    v_sql := format('SELECT * FROM %I(%s)', p_rpc_name, v_param_str);
  ELSE
    v_sql := format('SELECT * FROM %I()', p_rpc_name);
  END IF;

  -- Use text result to avoid type mismatch
  EXECUTE 'SELECT coalesce(json_agg(row_to_json(t)), ''[]''::json) FROM (' || v_sql || ') t' INTO v_result;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM)::text;
END;
$BODY$;

GRANT EXECUTE ON FUNCTION run_sql(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION run_sql_as_user(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION exec_rpc_as_user(uuid, text, jsonb) TO authenticated, service_role;
