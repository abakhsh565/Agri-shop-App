-- Local-CI baseline: sanitized production schema at ledger 0304 + the
-- RBAC supplement (supabase/baseline/local-ci-supplement.sql).
-- Built by scripts/dev/build-local-ci-baseline.mjs from the production
-- pg_dump; no personal data, no password hashes, no business rows.
-- Reference rows only: permissions, roles, role_permissions,
-- app_settings, shops, branches, storage.buckets.

SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET transaction_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA pgbouncer;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA storage;


--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA supabase_migrations;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--


CREATE SCHEMA vault;


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--


CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--


CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--


CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--


CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone',
    'recovery_code'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--


CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: adjustment_kind; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.adjustment_kind AS ENUM (
    'add',
    'remove',
    'set'
);


--
-- Name: membership_role; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.membership_role AS ENUM (
    'owner',
    'admin',
    'employee'
);


--
-- Name: membership_status; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.membership_status AS ENUM (
    'active',
    'suspended',
    'pending'
);


--
-- Name: movement_type; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.movement_type AS ENUM (
    'sale',
    'return',
    'purchase',
    'adjustment',
    'void',
    'opening'
);


--
-- Name: notification_kind; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.notification_kind AS ENUM (
    'sale',
    'payment',
    'return',
    'stock_adjust',
    'low_stock',
    'employee',
    'purchase',
    'system'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'bank_transfer'
);


--
-- Name: payment_type; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.payment_type AS ENUM (
    'full',
    'partial',
    'credit'
);


--
-- Name: product_category; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.product_category AS ENUM (
    'spray',
    'seed',
    'fertilizer',
    'other'
);


--
-- Name: shop_request_status; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.shop_request_status AS ENUM (
    'pending',
    'approved',
    'hold',
    'rejected'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--


CREATE TYPE public.user_role AS ENUM (
    'admin',
    'co_admin',
    'employee'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--


CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--


CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'like',
    'ilike',
    'is',
    'match',
    'imatch',
    'isdistinct'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--


CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text,
	negate boolean
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--


CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--


CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--


CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--


CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--


CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--


CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--


CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--


CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
    revoke trigger on cron.job_run_details from postgres;
  END IF;
END;
$$;


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--


CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
begin
    if not exists (
        select 1
        from pg_catalog.pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--


CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8.0', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--


CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--


CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--


CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
            set search_path to ''
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--


CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--


CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: adjust_stock(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.adjust_stock(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_qty numeric(12,2);
  v_actor uuid;
  v_adjustment_type text;
  v_shop uuid;
  v_key text;
  v_existing record;
BEGIN
  PERFORM public.guard_operational_request('adjust_stock',payload);
  v_actor := app_current_user_id();
  v_product_id := NULLIF(payload->>'productId', '')::uuid;
  v_variant_id := NULLIF(payload->>'variantId', '')::uuid;
  v_qty := (payload->>'qty')::numeric;
  v_adjustment_type := payload->>'adjustmentType';

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('inventory.adjust', COALESCE(v_shop, current_shop_id()));

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product does not belong to your organization';
  END IF;

  v_key := NULLIF(COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey'), '');
  IF v_key IS NOT NULL THEN
    SELECT sa.id, sa.qty_before, sa.qty_change, sa.qty_after
      INTO v_existing
      FROM stock_adjustments sa
     WHERE sa.idempotency_key = v_key
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
        'id', v_existing.id,
        'qtyBefore', v_existing.qty_before,
        'qtyChange', v_existing.qty_change,
        'qtyAfter', v_existing.qty_after,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;

  IF v_adjustment_type = 'add' THEN
    v_after := v_before + v_qty;
  ELSIF v_adjustment_type = 'remove' THEN
    v_after := GREATEST(0, v_before - v_qty);
  ELSIF v_adjustment_type = 'set' THEN
    v_after := v_qty;
  ELSE
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_TYPE: Unknown adjustment type: %', v_adjustment_type;
  END IF;

  IF v_after = v_before THEN
    RAISE EXCEPTION 'NO_CHANGE: Adjustment does not change stock level';
  END IF;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: Adjustment would make stock negative';
  END IF;

  v_id := gen_random_uuid();

  BEGIN
    INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
      adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, idempotency_key, created_at)
    VALUES (v_id, v_product_id,
      COALESCE(payload->>'productName', (SELECT name FROM public.products WHERE id = v_product_id)),
      v_variant_id, COALESCE(payload->>'variantName', ''),
      v_adjustment_type::adjustment_kind, v_before, v_after - v_before, v_after,
      payload->>'reason', v_actor, v_key, now());

  EXCEPTION WHEN unique_violation THEN
    SELECT sa.id, sa.qty_before, sa.qty_change, sa.qty_after
      INTO v_existing
      FROM stock_adjustments sa
     WHERE sa.idempotency_key = v_key
     LIMIT 1;

    PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
      'id', v_existing.id,
      'qtyBefore', v_existing.qty_before,
      'qtyChange', v_existing.qty_change,
      'qtyAfter', v_existing.qty_after,
      'idempotent', true
    );
  END;

  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  IF v_variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_variant_id;
  END IF;

  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    v_variant_id,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now()
  );

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_adjusted', 'product', v_product_id,
    jsonb_build_object('type', v_adjustment_type, 'before', v_before, 'after', v_after));

  PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_after - v_before,
    'qtyAfter', v_after
  );
END;
$$;


--
-- Name: allowed_branch_scope(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.allowed_branch_scope() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE WHEN m.role = 'owner' THEN NULL::uuid[]
              ELSE COALESCE(m.branch_scope, '{}'::uuid[]) END
    FROM public.membership_in_active_shop(NULL) m
  UNION ALL
  SELECT '{}'::uuid[] WHERE NOT EXISTS (
    SELECT 1 FROM public.membership_in_active_shop(NULL)
  );
$$;


--
-- Name: app_current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;
$$;


--
-- Name: app_is_admin(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.app_is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT m.role IN ('owner', 'admin') FROM public.membership_in_active_shop(NULL) m),
    (SELECT EXISTS (
       SELECT 1 FROM users u
        WHERE u.id = app_current_user_id() AND u.role = 'admin' AND u.is_active))
  );
$$;


--
-- Name: apply_stock_threshold_to_all(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.apply_stock_threshold_to_all(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_resolved jsonb;
  v_shop uuid;
  v_actor uuid;
  v_threshold int;
  v_updated int;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId','')::uuid,
    NULLIF(payload->>'userId','')::uuid,
    NULLIF(payload->>'actorId','')::uuid
  );
  v_shop := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_SHOP_CONTEXT';
  END IF;

  PERFORM authorize_business_action('products.edit', v_shop, NULL);

  v_threshold := GREATEST(COALESCE((payload->>'threshold')::int, 10), 0);

  UPDATE product_variants v
     SET low_stock_threshold = v_threshold,
         updated_at = now()
   FROM products p
  WHERE v.product_id = p.id
    AND p.shop_id = v_shop
    AND COALESCE(v.is_active, true)
    AND v.low_stock_threshold IS DISTINCT FROM v_threshold;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_threshold_applied_to_all', 'shop', v_shop,
          jsonb_build_object('threshold', v_threshold, 'variants', v_updated));

  RETURN jsonb_build_object('threshold', v_threshold, 'updated', v_updated);
END;
$$;


--
-- Name: approve_credit_limit_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.approve_credit_limit_request(p_request_id uuid, p_reviewed_by text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';

  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'approved', reviewed_by = p_reviewed_by, reviewed_at = now()
  WHERE id = p_request_id;

  -- Update customer credit limit
  UPDATE customers
  SET credit_limit = req.requested_limit, updated_at = now()
  WHERE id = req.customer_id;

  RETURN jsonb_build_object('status', 'approved', 'customer_id', req.customer_id);
END;
$$;


--
-- Name: approve_credit_limit_request_v2(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.approve_credit_limit_request_v2(p_request_id uuid, p_reviewed_by text, p_actor_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  req RECORD;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests SET status = 'approved', reviewed_by = COALESCE(p_reviewed_by, v_actor::text), reviewed_at = now() WHERE id = p_request_id;
  UPDATE customers SET credit_limit = req.requested_limit WHERE id = req.customer_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_approved', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'newLimit', req.requested_limit));

  RETURN jsonb_build_object('status', 'approved');
END;
$$;


--
-- Name: archive_company(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.archive_company(p_company_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid;
  v_company record;
BEGIN
  v_actor := app_current_user_id();

  SELECT id, name, shop_id, outstanding_payable INTO v_company
    FROM companies WHERE id = p_company_id;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  PERFORM authorize_business_action('companies.edit', v_company.shop_id);

  -- Never hide a supplier that is still owed money: the payable would vanish from
  -- Payments while the debt stayed on the books.
  IF COALESCE(v_company.outstanding_payable, 0) > 0 THEN
    RAISE EXCEPTION 'COMPANY_HAS_PAYABLE: settle the outstanding payable before archiving this supplier';
  END IF;

  UPDATE companies
     SET is_active = false, updated_at = now()
   WHERE id = p_company_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'company_archived', 'company', p_company_id,
    jsonb_build_object('name', v_company.name));
END;
$$;


--
-- Name: archive_customer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_customer record;
BEGIN
  SELECT id, name INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  UPDATE customers
  SET is_archived = true, archived_at = now(), archived_by = p_archived_by
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('id', p_customer_id, 'archived', true);
END;
$$;


--
-- Name: archive_operating_branch(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.archive_operating_branch(p_branch_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_member public.memberships;
  v_branch public.branches;
  v_fallback uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL OR v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can archive a branch';
  END IF;
  PERFORM 1 FROM public.shops WHERE id = v_member.tenant_id FOR UPDATE;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND tenant_id = v_member.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  IF v_branch.is_default THEN RAISE EXCEPTION 'MAIN_BRANCH'; END IF;
  IF NOT v_branch.is_active THEN RETURN jsonb_build_object('success',true,'idempotent',true); END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'VALIDATION: a reason is required'; END IF;
  SELECT id INTO v_fallback FROM public.branches WHERE tenant_id = v_member.tenant_id
    AND is_active AND id <> p_branch_id ORDER BY is_default DESC,created_at,id LIMIT 1;
  IF v_fallback IS NULL THEN RAISE EXCEPTION 'LAST_BRANCH'; END IF;
  -- No silent lost login or scope rewrite. Reassign people explicitly first,
  -- including pending invitations and suspended accounts that may be restored.
  IF EXISTS (SELECT 1 FROM public.memberships WHERE tenant_id = v_member.tenant_id AND role <> 'owner'
    AND p_branch_id = ANY(COALESCE(branch_scope,'{}'::uuid[]))) THEN RAISE EXCEPTION 'BRANCH_HAS_STAFF'; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_archived','branch',p_branch_id,p_branch_id,
    jsonb_build_object('reason',trim(p_reason),'before',jsonb_build_object('active',true),
      'after',jsonb_build_object('active',false),'historyPreserved',true));
  UPDATE public.branches SET is_active = false WHERE id = p_branch_id;
  UPDATE public.user_active_shops SET branch_id = v_fallback,updated_at = now()
    WHERE shop_id = v_member.tenant_id AND branch_id = p_branch_id;
  RETURN jsonb_build_object('success',true,'branch_id',p_branch_id,'fallback_branch_id',v_fallback,'history_preserved',true);
END;
$$;


--
-- Name: assign_employee_branch(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.assign_employee_branch(p_employee_id uuid, p_branch_id uuid, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_member public.memberships;
  v_scope uuid[];
BEGIN
  v_tenant := public.authorize_business_action('employees.manage', NULL, p_branch_id);
  IF p_branch_id IS DISTINCT FROM public.current_branch_id() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: select this branch before assigning an employee';
  END IF;
  IF p_action NOT IN ('add','move') OR p_action IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: choose add or move';
  END IF;
  SELECT m.* INTO v_member FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
   WHERE m.user_id = p_employee_id AND m.tenant_id = v_tenant
     AND m.role = 'employee' AND NOT u.is_original_owner AND u.is_active
   FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
 IF public.allowed_branch_scope() IS NOT NULL AND (v_member.branch_scope IS NULL OR
 NOT (v_member.branch_scope <@ public.allowed_branch_scope())) THEN
 RAISE EXCEPTION 'NOT_AUTHORIZED: assignment exceeds editor scope'; END IF;
  IF p_action = 'move' THEN v_scope := ARRAY[p_branch_id];
  ELSE
    -- Missing historical scope is no authority. Add cannot preserve a grant
    -- that never existed, and cannot implicitly convert it to every branch.
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_scope
      FROM unnest(COALESCE(v_member.branch_scope, '{}'::uuid[]) || ARRAY[p_branch_id]) x;
  END IF;
  IF v_scope IS NOT DISTINCT FROM v_member.branch_scope THEN
    RETURN jsonb_build_object('id',p_employee_id,'branchScope',v_scope,'changed',false,'idempotent',true);
  END IF;
  UPDATE public.memberships SET branch_scope = v_scope, updated_at = now()
    WHERE id = v_member.id;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'employee_branch_' || p_action,'user',p_employee_id,p_branch_id,
    jsonb_build_object('before',v_member.branch_scope,'after',v_scope));
  RETURN jsonb_build_object('id',p_employee_id,'branchScope',v_scope,'changed',true);
END;
$$;


--
-- Name: audit_branch_selection(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_branch_selection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.app_current_user_id() IS NULL OR NEW.branch_id IS NULL OR
     NEW.user_id IS DISTINCT FROM public.app_current_user_id() THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id AND NEW.shop_id IS NOT DISTINCT FROM OLD.shop_id THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_selected','branch',NEW.branch_id,NEW.branch_id,
    jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN OLD.branch_id ELSE NULL END,'after',NEW.branch_id));
  RETURN NEW;
END;
$$;


--
-- Name: audit_context_stamp(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_context_stamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_role_name text;
  v_entity_branch uuid;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  NEW.user_id := v_actor;
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: audit context unavailable'; END IF;
  NEW.tenant_id := v_member.tenant_id;
  NEW.actor_role_id := v_member.role_id;
  SELECT name INTO v_role_name FROM public.roles WHERE id = v_member.role_id;
  NEW.actor_role := COALESCE(v_role_name, v_member.role::text);
  NEW.branch_scope := v_member.branch_scope;

  -- Prefer the consequential record's actual branch, not a caller's actor or
  -- branch-manager identity. Non-record actions use the selected branch.
  IF NEW.entity_type = 'sale' THEN
    SELECT branch_id INTO v_entity_branch FROM public.sales WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'purchase' THEN
    SELECT branch_id INTO v_entity_branch FROM public.purchases WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'return' THEN
    SELECT branch_id INTO v_entity_branch FROM public.returns WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'branch' THEN
    SELECT id INTO v_entity_branch FROM public.branches WHERE id = NEW.entity_id;
  END IF;
  NEW.branch_id := COALESCE(v_entity_branch, NEW.branch_id, public.current_branch_id());
  IF NEW.branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id
     AND b.tenant_id = v_member.tenant_id
     AND (v_member.role = 'owner' OR
       b.id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: audit branch access denied'; END IF;
  NEW.details := COALESCE(NEW.details, '{}'::jsonb) || jsonb_build_object('result','succeeded');
  RETURN NEW;
END;
$$;


--
-- Name: audit_final_sale_created(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_final_sale_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_sale public.sales;
BEGIN
  IF public.app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id=NEW.id;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'sale_created','sale',v_sale.id,v_sale.branch_id,
    jsonb_build_object('after',jsonb_build_object('saleNumber',v_sale.sale_number,'totalAmount',v_sale.total_amount,
      'amountPaid',v_sale.amount_paid,'amountDue',v_sale.amount_due,'customerId',v_sale.customer_id)));
  RETURN NEW;
END;
$$;


--
-- Name: audit_identity_labels(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_identity_labels() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  SELECT name INTO NEW.actor_name FROM public.users WHERE id=NEW.user_id;
  SELECT name INTO NEW.branch_name FROM public.branches WHERE id=NEW.branch_id;
  RETURN NEW;
END;
$$;


--
-- Name: audit_membership_access_change(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_membership_access_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.app_current_user_id() IS NULL OR NOT EXISTS(SELECT 1 FROM public.membership_in_active_shop(NULL)) OR
    (NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope AND
      NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(public.app_current_user_id(),'membership_access_changed','user',NEW.user_id,
    jsonb_build_object('before',jsonb_build_object('roleId',OLD.role_id,'branchScope',OLD.branch_scope,'status',OLD.status),
      'after',jsonb_build_object('roleId',NEW.role_id,'branchScope',NEW.branch_scope,'status',NEW.status)));
  RETURN NEW;
END;
$$;


--
-- Name: audit_operational_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_operational_snapshot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF public.app_current_user_id() IS NULL OR (v_old IS NOT NULL AND v_old=v_new) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='sales' AND EXISTS(SELECT 1 FROM public.audit_events WHERE entity_type='sale'
    AND entity_id=NEW.id AND action='sale_created') THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),CASE WHEN TG_TABLE_NAME='sales' THEN 'sale_created' ELSE TG_TABLE_NAME||'_'||lower(TG_OP) END,
    CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale' WHEN 'customer_payments' THEN 'customer_payment'
      WHEN 'supplier_payments' THEN 'supplier_payment' WHEN 'stock_adjustments' THEN 'stock_adjustment' ELSE TG_TABLE_NAME END,
    NEW.id,NEW.branch_id,jsonb_build_object('before',v_old,'after',v_new));
  RETURN NEW;
END;
$$;


--
-- Name: audit_sale_created(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.audit_sale_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, branch_id, details)
  VALUES (public.app_current_user_id(), 'sale_created', 'sale', NEW.id, NEW.branch_id,
    jsonb_build_object('after', jsonb_build_object('saleNumber',NEW.sale_number,
      'totalAmount',NEW.total_amount,'amountPaid',NEW.amount_paid,
      'amountDue',NEW.amount_due,'customerId',NEW.customer_id)));
  RETURN NEW;
END;
$$;


--
-- Name: authorize_business_action(character varying, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.authorize_business_action(p_permission character varying, p_tenant_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_branch uuid := COALESCE(p_branch_id, public.current_branch_id());
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
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = v_branch
     AND b.tenant_id = v_member.tenant_id AND b.is_active
     AND (v_member.role = 'owner' OR b.id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied'; END IF;
  RETURN v_member.tenant_id;
END;
$$;


--
-- Name: barcode_normalize(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.barcode_normalize(p_code text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;


--
-- Name: branch_responsible_person(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.branch_responsible_person(p_branch_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object('user_id', r.user_id, 'name', u.name, 'since', r.granted_at)
  FROM public.branch_responsibility r
  LEFT JOIN public.users u ON u.id = r.user_id
  WHERE r.branch_id = p_branch_id
    AND r.revoked_at IS NULL
    AND r.tenant_id = public.current_shop_id()
    AND (public.allowed_branch_scope() IS NULL OR r.branch_id = ANY(public.allowed_branch_scope()));
$$;


--
-- Name: canonical_phone(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.canonical_phone(p_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN regexp_replace(COALESCE(p_phone,''), '\D', '', 'g') = '' THEN NULL
    WHEN regexp_replace(p_phone, '\D', '', 'g') LIKE '0%'
      THEN '92' || substr(regexp_replace(p_phone, '\D', '', 'g'), 2)
    WHEN regexp_replace(p_phone, '\D', '', 'g') LIKE '92%'
      THEN regexp_replace(p_phone, '\D', '', 'g')
    ELSE '92' || regexp_replace(p_phone, '\D', '', 'g')
  END;
$$;


--
-- Name: check_rate_limit(text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.check_rate_limit(p_actor text, p_component text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_max_per_minute integer := 30;
  v_count integer;
BEGIN
  INSERT INTO public.incident_rate_limits (actor_id, component, window_start, count)
  VALUES (p_actor, p_component, v_window, 1)
  ON CONFLICT (actor_id, component, window_start)
  DO UPDATE SET count = public.incident_rate_limits.count + 1
  RETURNING count INTO v_count;

  IF v_count > v_max_per_minute THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;


--
-- Name: clear_active_shop_on_membership_delete(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.clear_active_shop_on_membership_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM user_active_shops
   WHERE user_id = OLD.user_id AND shop_id = OLD.tenant_id;
  RETURN OLD;
END;
$$;


--
-- Name: complete_member_onboarding(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.complete_member_onboarding() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := app_current_user_id();
  v_n int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- A deactivated account cannot onboard itself.
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_uid AND u.is_active) THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE';
  END IF;

  -- Only the caller's own invitations, and only from 'pending'. A suspended
  -- membership is deliberately NOT revived here — the owner must reactivate it.
  UPDATE memberships
  SET status = 'active'::membership_status, updated_at = now()
  WHERE user_id = v_uid AND status = 'pending'::membership_status;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
    VALUES(v_uid,'member_onboarding_completed','membership',v_uid,jsonb_build_object('activated',v_n));
  END IF;

  RETURN jsonb_build_object('activated', v_n);
END; $$;


--
-- Name: compute_incident_fingerprint(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.compute_incident_fingerprint(p_type text, p_component text, p_source text, p_message text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  normalized text;
BEGIN
  normalized := p_message;

  -- Replace UUIDs (POSIX compatible)
  normalized := regexp_replace(normalized, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '{UUID}', 'gi');

  -- Replace numeric values 4+ digits using POSIX word boundary (POSIX compatible)
  normalized := regexp_replace(normalized, '[[:<:]][0-9]{4,}[[:>:]]', '{NUM}', 'g');

  -- Replace long quoted strings
  normalized := regexp_replace(normalized, '''[^'']{10,}''', '{STRING}', 'g');

  RETURN md5(p_type || ':' || p_component || ':' || p_source || ':' || normalized);
END;
$$;


--
-- Name: create_company(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_company(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_id uuid; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('companies.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  INSERT INTO companies(id,name,contact_person,phone,address,logo_url,outstanding_payable,total_purchases,shop_id,created_at)
  VALUES(gen_random_uuid(),payload->>'name',NULLIF(payload->>'contactPerson',''),NULLIF(payload->>'phone',''),NULLIF(payload->>'address',''),NULLIF(payload->>'logoUrl',''),0,0,v_shop_id,now()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'name',payload->>'name');
END; $$;


--
-- Name: create_credit_limit_request(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_credit_limit_request(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO credit_limit_requests (
    customer_id, customer_name, requested_by, current_limit, requested_limit, status, reason
  ) VALUES (
    (payload->>'customer_id')::uuid,
    payload->>'customer_name',
    payload->>'requested_by',
    (payload->>'current_limit')::numeric,
    (payload->>'requested_limit')::numeric,
    'pending',
    COALESCE(payload->>'reason', '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$$;


--
-- Name: create_customer(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_customer(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customers WHERE phone = v_phone AND is_archived = false) THEN
      RAISE EXCEPTION 'A customer with this phone number already exists';
    END IF;
  END IF;

  INSERT INTO customers (
    id, name, phone, address, credit_limit, created_by, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    v_phone,
    NULLIF(payload->>'address', ''),
    COALESCE((payload->>'credit_limit')::numeric, 0),
    NULLIF(payload->>'created_by', '')::uuid,
    now(),
    now()
  ) RETURNING id INTO v_id;

  IF payload ? 'crops' THEN
    INSERT INTO customer_crops (customer_id, crop_name)
    SELECT v_id, crop.value
    FROM jsonb_array_elements_text(payload->'crops') AS crop;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$$;


--
-- Name: create_employee(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_employee(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_created jsonb;
  v_id uuid;
BEGIN
  -- Authorization at the entry point (employees.manage in the caller's tenant).
  v_tenant := authorize_business_action('employees.manage');

  v_created := public.create_employee_core(payload);
  v_id := (v_created->>'id')::uuid;

  -- Tenant context is resolved, not assumed: the row that was written must be in
  -- the tenant the guard just authorized.
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_id AND u.shop_id = v_tenant) THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH';
  END IF;

  -- Provisioning (0135) is tolerant by design: if it fails the employee is still
  -- invited and the owner can retry from the invitation card, rather than losing
  -- the record. The failure is recorded, never swallowed.
  BEGIN
    PERFORM public.provision_member_login(v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
    VALUES (app_current_user_id(), 'member_login_provision_failed', 'user', v_id,
            jsonb_build_object('reason', SQLERRM));
  END;

  RETURN v_created;
END; $$;


--
-- Name: create_employee_core(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_employee_core(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_tenant uuid;
  v_id uuid;
  v_phone text;
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid;
  v_scope uuid[];
  v_num int;
  v_code text;
  v_grant boolean;
  v_perm uuid;
  v_overrides int := 0;
BEGIN
  v_tenant := public.authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name','')) = '' OR NULLIF(payload->>'phone','') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;
  v_phone := payload->>'phone';
  IF EXISTS(SELECT 1 FROM public.users WHERE phone = v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE'; END IF;
  IF COALESCE(payload->>'membershipRole','') = 'owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = v_role_id AND tenant_id = v_tenant
  ) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  IF NOT (payload ? 'branchScope') THEN
    v_scope := ARRAY[public.current_branch_id()];
  ELSIF jsonb_typeof(payload->'branchScope') = 'array' THEN
    SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO v_scope
      FROM jsonb_array_elements_text(payload->'branchScope') x;
  ELSE RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  IF v_scope IS NULL OR cardinality(v_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(v_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = v_tenant AND b.is_active
    ) OR (public.allowed_branch_scope() IS NOT NULL AND NOT (x = ANY(public.allowed_branch_scope())))
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number,'[^0-9]','','g'),'')::int),0)+1
    INTO v_num FROM public.users WHERE shop_id = v_tenant;
  INSERT INTO public.users(id,name,phone,role,is_original_owner,is_active,employee_number,
    job_title,photo_url,created_by,shop_id,created_at)
  VALUES(gen_random_uuid(),trim(payload->>'name'),v_phone,'employee',false,true,
    'EMP-'||lpad(v_num::text,3,'0'),NULLIF(payload->>'jobTitle',''),NULLIF(payload->>'photoUrl',''),
    v_actor,v_tenant,now()) RETURNING id INTO v_id;
  INSERT INTO public.memberships(user_id,tenant_id,role,status,branch_scope,role_id)
  VALUES(v_id,v_tenant,'employee','pending',v_scope,v_role_id)
  ON CONFLICT(user_id,tenant_id) DO UPDATE SET role = EXCLUDED.role,
    status = 'pending', branch_scope = EXCLUDED.branch_scope, role_id = EXCLUDED.role_id, updated_at = now();
  IF payload->'overrides' IS NOT NULL AND jsonb_typeof(payload->'overrides') = 'object' THEN
    FOR v_code,v_grant IN SELECT key,(value)::boolean FROM jsonb_each_text(payload->'overrides') LOOP
      SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
      IF v_perm IS NOT NULL THEN
        INSERT INTO public.user_permissions(user_id,permission_id,granted_by,is_override,is_granted)
        VALUES(v_id,v_perm,v_actor,true,v_grant);
        v_overrides := v_overrides + 1;
      END IF;
    END LOOP;
  END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,
    'branch_scope',v_scope,'invited',true,'overrides',v_overrides));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole','employee',
    'membershipStatus','pending','branchScope',v_scope,'overrides',v_overrides);
END;
$$;


--
-- Name: create_operating_branch(uuid, text, double precision, double precision, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_operating_branch(p_branch_id uuid, p_name text, p_latitude double precision, p_longitude double precision, p_label text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_source text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_member public.memberships;
  v_branch public.branches;
  v_name text := trim(COALESCE(p_name, ''));
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL OR v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can create a branch';
  END IF;
  PERFORM public.authorize_business_action('settings.edit');
  IF p_branch_id IS NULL OR v_name = '' THEN RAISE EXCEPTION 'VALIDATION: a branch name is required'; END IF;
  IF length(v_name) > 120 THEN RAISE EXCEPTION 'VALIDATION: branch names are limited to 120 characters'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR
    NOT (p_latitude BETWEEN 23.0 AND 37.5 AND p_longitude BETWEEN 60.0 AND 78.0) THEN
    RAISE EXCEPTION 'VALIDATION: choose a branch location in Pakistan';
  END IF;
  -- One lifecycle writer per business. Duplicate taps and concurrent devices
  -- cannot create two active branches with the same normalized name.
  PERFORM 1 FROM public.shops WHERE id = v_member.tenant_id FOR UPDATE;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id;
  IF FOUND THEN
    IF v_branch.tenant_id IS DISTINCT FROM v_member.tenant_id OR
       v_branch.name IS DISTINCT FROM v_name OR NOT v_branch.is_active OR
       v_branch.latitude IS DISTINCT FROM p_latitude OR v_branch.longitude IS DISTINCT FROM p_longitude THEN
      RAISE EXCEPTION 'VALIDATION: branch request does not match';
    END IF;
    RETURN jsonb_build_object('success',true,'branch_id',v_branch.id,'tenant_id',v_branch.tenant_id,
      'branch_name',v_branch.name,'idempotent',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = v_member.tenant_id AND is_active
     AND lower(trim(name)) = lower(v_name)) THEN RAISE EXCEPTION 'BRANCH_NAME_TAKEN'; END IF;
  INSERT INTO public.branches(id,tenant_id,name,latitude,longitude,location_label,address,location_source)
  VALUES(p_branch_id,v_member.tenant_id,v_name,p_latitude,p_longitude,p_label,p_address,p_source)
  RETURNING * INTO v_branch;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_created','branch',v_branch.id,v_branch.id,
    jsonb_build_object('after',jsonb_build_object('name',v_name,'address',p_address,
      'latitude',p_latitude,'longitude',p_longitude)));
  RETURN jsonb_build_object('success',true,'branch_id',v_branch.id,'tenant_id',v_branch.tenant_id,
    'branch_name',v_branch.name);
END;
$$;


--
-- Name: create_product(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_product(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_product_id uuid;
  v_resolved   jsonb;
  v_shop_id    uuid;
  v_actor      uuid;
  v_branch_id  uuid;
  v_company_id uuid;
  v_item       jsonb;
  v_variant_id uuid;
  v_unit       text;
  v_code       text;
  v_stock      numeric;
  v_cost       numeric;
  v_listed     boolean;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  v_branch_id := NULLIF(payload->>'branchId','')::uuid;
  PERFORM authorize_business_action('products.create',v_shop_id,v_branch_id);

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN v_company_id := (payload->>'companyId')::uuid;
  ELSIF NULLIF(payload->>'company','') IS NOT NULL THEN SELECT id INTO v_company_id FROM companies WHERE name=payload->>'company' AND shop_id=v_shop_id LIMIT 1; END IF;
  IF v_company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM companies WHERE id=v_company_id AND shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: supplier belongs to another tenant'; END IF;

  -- The shop sells by weight or by volume. A new product cannot be anything else, and the
  -- unit is stored rather than defaulted, so the pack size below means what it says.
  v_unit := lower(COALESCE(NULLIF(payload->>'baseUnit',''), 'kg'));
  IF v_unit NOT IN ('kg','liter') THEN
    RAISE EXCEPTION 'INVALID_UNIT: a product is measured in kg or liter, not "%"', v_unit;
  END IF;

  -- One code per product, minted here when the caller did not supply one, so the code can
  -- never be lost by a client that forgets it.
  v_code := upper(regexp_replace(COALESCE(NULLIF(payload->>'barcode',''), mint_barcode(payload->>'name', v_shop_id)), '\s', '', 'g'));
  IF EXISTS (SELECT 1 FROM product_barcodes WHERE shop_id = v_shop_id AND code = v_code) THEN
    RAISE EXCEPTION 'BARCODE_TAKEN: "%" is already on another product in this shop', v_code;
  END IF;

  -- The owner's listing decision. Absent means NOT listed: a product being created is never
  -- publicly visible by accident, and a client that predates this feature cannot list one.
  v_listed := COALESCE((payload->>'marketplaceListed')::boolean, false);

  INSERT INTO products(id,name,category,company_id,image_url,base_unit,is_active,shop_id,created_at,
                       marketplace_listed,marketplace_listed_at)
  VALUES(
    gen_random_uuid(),
    payload->>'name',
    COALESCE((payload->>'category')::product_category,'other'),
    v_company_id,
    NULLIF(payload->>'imageUrl',''),
    v_unit,
    true,
    v_shop_id,
    now(),
    v_listed,
    CASE WHEN v_listed THEN now() ELSE NULL END
  ) RETURNING id INTO v_product_id;

  -- `products.barcode` is written by the mirror trigger, never here: one writer, no drift.
  INSERT INTO product_barcodes(shop_id, product_id, code, is_primary, source, created_by)
  VALUES(v_shop_id, v_product_id, v_code, true,
         CASE WHEN NULLIF(payload->>'barcode','') IS NULL THEN 'generated' ELSE 'supplied' END,
         v_actor);

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb)) LOOP
    v_stock := GREATEST(COALESCE((v_item->>'stockQty')::numeric, 0), 0);
    v_cost  := COALESCE((v_item->>'costPrice')::numeric, 0);

    -- Pack size and step keep any value above zero (500 Gram is 0.5); absent or zero means
    -- one. The old `GREATEST(…, 1)` turned a half-kilo pack into a kilo one in silence.
    -- Expiry is optional per pack, because it is a fact about a batch and not about a
    -- product: the same 10 KG bag is dated differently depending on when it was bought.
    INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold,unit_size,qty_step,is_active,expiry_date)
    VALUES(
      v_product_id,
      v_item->>'name',
      COALESCE((v_item->>'sellingPrice')::numeric,0),
      v_cost,
      v_stock,
      GREATEST(COALESCE((v_item->>'lowStockThreshold')::int,5),0),
      GREATEST(COALESCE(NULLIF((v_item->>'unitSize')::numeric, 0), 1), 0.001),
      GREATEST(COALESCE(NULLIF((v_item->>'qtyStep')::numeric, 0), 1), 0.001),
      true,
      NULLIF(v_item->>'expiryDate','')::date
    ) RETURNING id INTO v_variant_id;

    -- Opening stock is a movement, not a number dropped into a column: it carries the date,
    -- the person and what was actually paid, so Stock Movements has a beginning and the
    -- first sale's profit is measured against the real cost.
    IF v_stock > 0 THEN
      INSERT INTO inventory_movements(
        variant_id, product_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, notes, created_by, branch_id
      ) VALUES (
        v_variant_id, v_product_id, 'adjustment', 0, v_stock, v_stock,
        'product', v_variant_id, v_cost, 'Opening stock', v_actor, v_branch_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('id',v_product_id,'name',payload->>'name','barcode',v_code,'marketplace_listed',v_listed);
END;
$$;


--
-- Name: create_purchase(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_purchase(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4):=0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_shop_id uuid;
  v_resolved jsonb;
  v_actor uuid;
  v_key text;
  v_existing record;
  v_qty numeric(14,4);
  v_unit numeric(14,4);
  v_line numeric(14,4);
  v_sell numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
BEGIN
  PERFORM public.guard_operational_request('create_purchase',payload);
  v_actor := app_current_user_id();
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid;
  PERFORM authorize_business_action('purchases.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);

  v_key := NULLIF(COALESCE(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  IF v_key IS NOT NULL THEN
    SELECT p.id, p.purchase_number, p.total_amount, p.amount_due
      INTO v_existing
      FROM purchases p
     WHERE p.idempotency_key = v_key AND p.shop_id = v_shop_id
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      PERFORM public.guard_operational_request('create_purchase',payload);
 RETURN jsonb_build_object(
        'id', v_existing.id,
        'purchaseNumber', v_existing.purchase_number,
        'totalAmount', v_existing.total_amount,
        'outstandingPayable', COALESCE(v_existing.amount_due, 0),
        'idempotent', true
      );
    END IF;
  END IF;

  v_number:='PUR-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');
  v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  SELECT name INTO v_company_name FROM companies WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;

  BEGIN
    INSERT INTO purchases(id,purchase_number,company_id,company_name,total_amount,amount_paid,amount_due,status,notes,shop_id,recorded_by,idempotency_key,created_at,updated_at)
    VALUES(gen_random_uuid(),v_number,NULLIF(payload->>'companyId','')::uuid,COALESCE(v_company_name,'Unknown'),0,v_paid,0,'completed',payload->>'note',v_shop_id,v_actor,v_key,now(),now()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT p.id, p.purchase_number, p.total_amount, p.amount_due
      INTO v_existing
      FROM purchases p
     WHERE p.idempotency_key = v_key AND p.shop_id = v_shop_id
     LIMIT 1;

    PERFORM public.guard_operational_request('create_purchase',payload);
 RETURN jsonb_build_object(
      'id', v_existing.id,
      'purchaseNumber', v_existing.purchase_number,
      'totalAmount', v_existing.total_amount,
      'outstandingPayable', COALESCE(v_existing.amount_due, 0),
      'idempotent', true
    );
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_qty := COALESCE((v_item->>'qty')::numeric, 0);
    v_unit := COALESCE((v_item->>'costPrice')::numeric, 0);
    v_line := COALESCE((v_item->>'lineTotal')::numeric, v_qty * v_unit);
    v_total := v_total + v_line;

    INSERT INTO purchase_items(id,purchase_id,product_id,product_name,variant_id,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_id,NULLIF(v_item->>'productId','')::uuid,v_item->>'productName',NULLIF(v_item->>'variantId','')::uuid,COALESCE(v_item->>'variantName',''),v_qty,v_unit,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),v_line);

    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      v_sell := COALESCE((v_item->>'sellingPrice')::numeric, 0);
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = (v_item->>'variantId')::uuid FOR UPDATE;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_qty;
      UPDATE product_variants
         SET stock_qty = v_after,
             cost_price    = CASE WHEN v_unit > 0 THEN v_unit ELSE cost_price END,
             selling_price = CASE WHEN v_sell > 0 THEN v_sell ELSE selling_price END
       WHERE id = (v_item->>'variantId')::uuid;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by, created_at)
      VALUES (NULLIF(v_item->>'productId','')::uuid, (v_item->>'variantId')::uuid, 'purchase', v_before, v_qty, v_after,
        'purchase', v_id, v_unit, v_actor, now());
    END IF;
  END LOOP;

  UPDATE purchases SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable=outstanding_payable+(v_total-v_paid),total_purchases=total_purchases+v_total,updated_at=now() WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'purchase_recorded', 'purchase', v_id,
          jsonb_build_object('purchaseNumber', v_number, 'totalAmount', v_total, 'shopId', v_shop_id));

  PERFORM public.guard_operational_request('create_purchase',payload);
 RETURN jsonb_build_object('id',v_id,'purchaseNumber',v_number,'totalAmount',v_total,'outstandingPayable',GREATEST(0,v_total-v_paid));
END; $$;


--
-- Name: create_role(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_role(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_code text; v_perm uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  INSERT INTO roles(tenant_id,name,description) VALUES(v_tenant,trim(payload->>'name'),NULLIF(payload->>'description','')) RETURNING id INTO v_id;
  FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
    SELECT id INTO v_perm FROM permissions WHERE code=v_code;
    IF v_perm IS NOT NULL THEN INSERT INTO role_permissions(role_id,permission_id) VALUES(v_id,v_perm) ON CONFLICT DO NOTHING; END IF;
  END LOOP;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'role_created','role',v_id,payload);
  RETURN jsonb_build_object('id',v_id);
END; $$;


--
-- Name: create_sale(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_sale(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_key      text;
  v_shop_id  uuid;
  v_actor    uuid;
  v_existing record;
  v_out      jsonb;
BEGIN
  PERFORM public.guard_operational_request('create_sale',payload);
  v_key := NULLIF(COALESCE(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  IF v_key IS NULL THEN
    RETURN public.create_sale_unchecked(payload);
  END IF;

  SELECT (r->>'shop_id')::uuid, (r->>'actor_id')::uuid
    INTO v_shop_id, v_actor
    FROM (SELECT public.resolve_shop_and_actor(
            NULLIF(payload->>'shopId', '')::uuid,
            NULLIF(payload->>'userId', '')::uuid,
            NULLIF(payload->>'createdBy', '')::uuid) AS r) s;

  PERFORM public.authorize_business_action('sales.create', v_shop_id, NULLIF(payload->>'branchId', '')::uuid);

  INSERT INTO public.sale_submissions (shop_id, idempotency_key)
  VALUES (v_shop_id, v_key)
  ON CONFLICT (shop_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT s.id, s.sale_number, s.total_amount, s.amount_paid, s.amount_due
      INTO v_existing
      FROM public.sale_submissions ss
      JOIN public.sales s ON s.id = ss.sale_id
     WHERE ss.shop_id = v_shop_id AND ss.idempotency_key = v_key;

    IF v_existing.id IS NOT NULL THEN
      PERFORM public.guard_operational_request('create_sale',payload);
 RETURN jsonb_build_object(
        'id', v_existing.id,
        'saleNumber', v_existing.sale_number,
        'totalAmount', v_existing.total_amount,
        'amountPaid', v_existing.amount_paid,
        'outstandingBalance', v_existing.amount_due,
        'duplicate', true
      );
    END IF;

    RAISE EXCEPTION 'DUPLICATE_SUBMISSION';
  END IF;

  v_out := public.create_sale_unchecked(payload);

  UPDATE public.sale_submissions
     SET sale_id = (v_out->>'id')::uuid
   WHERE shop_id = v_shop_id AND idempotency_key = v_key;

  RETURN v_out;
END; $$;


--
-- Name: create_sale_unchecked(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.create_sale_unchecked(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_sale_id uuid; v_sale_number text; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
  v_customer_id uuid; v_total numeric(14,4):=0; v_paid numeric(14,4):=0; v_item jsonb;
  v_credit numeric(14,4):=0; v_outstanding numeric(14,4):=0; v_limit numeric(14,4):=0;
  v_stock_after numeric(14,4); v_stock_change numeric(14,4);
BEGIN
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid; v_actor:=(v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('sales.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  v_customer_id:=NULLIF(payload->>'customerId','')::uuid;
  v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  v_sale_number:='SALE-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');

  INSERT INTO sales(id,sale_number,customer_id,customer_name_snapshot,employee_id,employee_name,total_amount,discount,payment_type,payment_method,amount_paid,amount_due,due_date,status,shop_id,created_at,updated_at)
  VALUES(gen_random_uuid(),v_sale_number,v_customer_id,COALESCE((SELECT name FROM customers WHERE id=v_customer_id AND shop_id=v_shop_id),COALESCE(payload->>'customerName','Walk-in')),v_actor,COALESCE(payload->>'employeeName',(SELECT name FROM users WHERE id=v_actor)),0,0,COALESCE(payload->>'paymentType','full')::payment_type,COALESCE(payload->>'paymentMethod','cash')::payment_method,v_paid,0,NULLIF(COALESCE(payload->>'dueDate',payload->>'due_date'),'')::date,'completed',v_shop_id,now(),now()) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total:=v_total+ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2);
    IF NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NULLIF(v_item->>'productId','')::uuid AND p.shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product belongs to another tenant'; END IF;
    INSERT INTO sale_items(id,sale_id,product_id,variant_id,product_name,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_sale_id,NULLIF(v_item->>'productId','')::uuid,NULLIF(v_item->>'variantId','')::uuid,v_item->>'productName',COALESCE(v_item->>'variantName',''),(v_item->>'qty')::numeric,(v_item->>'unitPrice')::numeric,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2));
    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      UPDATE product_variants SET stock_qty=stock_qty-(v_item->>'qty')::numeric WHERE id=(v_item->>'variantId')::uuid AND stock_qty >= (v_item->>'qty')::numeric;
      IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
      -- The row that was missing: this line moved stock, so the ledger records it, with the
      -- values read from the same locked row the UPDATE just wrote.
      SELECT stock_qty INTO v_stock_after FROM product_variants WHERE id=(v_item->>'variantId')::uuid;
      v_stock_change:=-(v_item->>'qty')::numeric;
      INSERT INTO inventory_movements(product_id,variant_id,movement_type,qty_before,qty_change,qty_after,
        reference_type,reference_id,created_by)
      VALUES(NULLIF(v_item->>'productId','')::uuid,(v_item->>'variantId')::uuid,'sale',
        v_stock_after-v_stock_change,v_stock_change,v_stock_after,'sale',v_sale_id,v_actor);
    END IF;
  END LOOP;

  -- The credit rule, measured on the part of this sale that is not being paid for now.
  v_credit:=GREATEST(0,v_total-v_paid);
  IF v_credit > 0 AND v_customer_id IS NOT NULL THEN
    SELECT COALESCE(outstanding_balance,0),COALESCE(credit_limit,0)
      INTO v_outstanding,v_limit
      FROM customers WHERE id=v_customer_id AND shop_id=v_shop_id;

    IF v_limit <= 0 THEN
      RAISE EXCEPTION 'CREDIT_LIMIT_REQUIRED: this customer has no credit limit, and a credit sale is measured against one';
    END IF;

    IF v_outstanding + v_credit > v_limit THEN
      IF app_is_admin() THEN
        INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
        VALUES(app_current_user_id(),'sale_credit_limit_override','sale',v_sale_id,
          jsonb_build_object('credit',v_credit,'outstandingBefore',v_outstanding,'creditLimit',v_limit,
                             'overBy',(v_outstanding+v_credit)-v_limit,'customerId',v_customer_id));
      ELSE
        RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Rs. % of credit would bring the balance to Rs. %, over the Rs. % limit',
          v_credit, v_outstanding + v_credit, v_limit;
      END IF;
    END IF;
  END IF;

  UPDATE sales SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_sale_id;

  IF v_customer_id IS NOT NULL THEN
    -- `total_paid` is the third member of the identity: bought = paid + owed. Without this
    -- line, cash taken at the counter was recorded on the sale and nowhere else.
    UPDATE customers
       SET outstanding_balance = outstanding_balance + (v_total - v_paid),
           total_purchases     = total_purchases + v_total,
           total_paid          = total_paid + v_paid,
           updated_at = now()
     WHERE id = v_customer_id AND shop_id = v_shop_id;
  END IF;

  RETURN jsonb_build_object('id',v_sale_id,'saleNumber',v_sale_number,'totalAmount',v_total,'amountPaid',v_paid,'outstandingBalance',GREATEST(0,v_total-v_paid));
END;
$$;


--
-- Name: current_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.current_branch_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT b.id
    FROM public.branches b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id
     AND m.user_id = public.app_current_user_id() AND m.status = 'active'
    LEFT JOIN public.user_active_shops a ON a.user_id = m.user_id
     AND a.shop_id = b.tenant_id
   WHERE b.tenant_id = public.current_shop_id() AND b.is_active
     AND (m.role = 'owner' OR b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
   ORDER BY (b.id = a.branch_id) DESC NULLS LAST, b.is_default DESC, b.created_at, b.id
   LIMIT 1;
$$;


--
-- Name: current_branch_scope(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.current_branch_scope() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE WHEN public.current_branch_id() IS NULL THEN '{}'::uuid[]
              ELSE ARRAY[public.current_branch_id()] END;
$$;


--
-- Name: current_shop_id(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.current_shop_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT public.resolve_active_shop(app_current_user_id()); $$;


--
-- Name: deactivate_employee_v1(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.deactivate_employee_v1(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor_id uuid := app_current_user_id(); v_emp_id uuid := (payload->>'employeeId')::uuid; v_emp record;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.is_original_owner THEN RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER'; END IF;
  UPDATE users SET is_active=false, deactivated_at=now(), deactivated_by=v_actor_id WHERE id=v_emp_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'employee_deactivated','user',v_emp_id,jsonb_build_object('name',v_emp.name));
  RETURN jsonb_build_object('id',v_emp_id,'isActive',false);
END; $$;


--
-- Name: delete_branch(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.delete_branch(p_shop_id uuid, p_reason text DEFAULT NULL::text, p_feedback text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor       uuid := public.app_current_user_id();
  v_role        membership_role;
  v_name        text;
  v_home        uuid;
  v_fallback    uuid;
  v_staff       uuid[];
  v_gone        uuid[];
  /** The logins that keep working, in another branch. */
  v_keep_ids    uuid[];
  v_kept        int := 0;
  v_removed     int := 0;
  v_counts      jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Authority is stated twice on purpose, and both statements are needed. The first is the
  -- app-wide "is this an owner or an admin" gate every business write carries; the second
  -- is the one that actually decides, because it names THIS branch. A gate that only asked
  -- "are you an owner somewhere" would let an owner of one branch delete another's.
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or an admin can manage a branch';
  END IF;

  SELECT m.role INTO v_role
    FROM memberships m
   WHERE m.user_id = v_actor AND m.tenant_id = p_shop_id AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this branch';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin can delete a branch';
  END IF;

  SELECT s.name INTO v_name FROM shops s WHERE s.id = p_shop_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  -- The branch this account registered with is the main one. It is renamed, never
  -- deleted: there would be nowhere left for the account to live.
  SELECT u.shop_id INTO v_home FROM users u WHERE u.id = v_actor;
  IF v_home IS NOT NULL AND v_home = p_shop_id THEN
    RAISE EXCEPTION 'MAIN_BRANCH: the main branch cannot be deleted';
  END IF;

  -- Where this account lands afterwards: the main branch, else the oldest branch
  -- they still belong to.
  SELECT m.tenant_id INTO v_fallback
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = v_actor
     AND m.status = 'active'
     AND m.tenant_id <> p_shop_id
   ORDER BY (m.tenant_id = COALESCE(v_home, p_shop_id)) DESC, s.created_at ASC
   LIMIT 1;

  IF v_fallback IS NULL THEN
    RAISE EXCEPTION 'LAST_BRANCH: this is the only branch on this account';
  END IF;

  -- What the caller was told, counted inside the same transaction that removes it.
  -- `employees` is everyone EXCEPT the caller: the person confirming the delete is
  -- not one of the people who "lose access", and counting them would overstate it.
  SELECT jsonb_build_object(
           'employees', (SELECT count(*) FROM memberships x
                          WHERE x.tenant_id = p_shop_id AND x.status = 'active' AND x.user_id <> v_actor),
           'products',  (SELECT count(*) FROM products  p WHERE p.shop_id = p_shop_id),
           'customers', (SELECT count(*) FROM customers c WHERE c.shop_id = p_shop_id),
           'sales',     (SELECT count(*) FROM sales     v WHERE v.shop_id = p_shop_id),
           'sales_total',(SELECT COALESCE(sum(v.total_amount), 0) FROM sales v WHERE v.shop_id = p_shop_id)
         ) INTO v_counts;

  -- ── The people who worked in this branch ────────────────────────────────────
  SELECT array_agg(u.id) INTO v_staff
    FROM users u
   WHERE u.shop_id = p_shop_id
     AND u.id <> v_actor;

  IF v_staff IS NOT NULL THEN
    -- Who still has another branch to go to. They keep their login and their
    -- history, and only this branch's membership (which cascades with the shop)
    -- goes away.
    SELECT array_agg(u.id) INTO v_keep_ids
      FROM users u
     WHERE u.id = ANY (v_staff)
       AND EXISTS (
         SELECT 1 FROM memberships m
          WHERE m.user_id = u.id
            AND m.status = 'active'
            AND m.tenant_id <> p_shop_id
       );

    UPDATE users u
       SET shop_id = (
             SELECT m.tenant_id FROM memberships m
              WHERE m.user_id = u.id AND m.status = 'active' AND m.tenant_id <> p_shop_id
              ORDER BY (m.tenant_id = COALESCE(v_home, p_shop_id)) DESC
              LIMIT 1
           )
     WHERE u.id = ANY (v_keep_ids);

    -- Everyone else belongs to this branch alone. Their branch's records are about
    -- to be erased, so the login is removed with it.
    --
    -- The exception is a login that still carries records in ANOTHER branch
    -- (`sales.employee_id`, `voids.voided_by` and
    -- `cash_reconciliations.reconciled_by` are NOT NULL, so those rows cannot be
    -- detached): the profile row must stay for that history to remain valid. It is
    -- deactivated and left without a membership, so it grants no access to
    -- anything, and the credential is deleted so it cannot be signed into.
    SELECT array_agg(u.id) INTO v_gone
      FROM users u
     WHERE u.id = ANY (v_staff)
       AND u.id <> ALL (COALESCE(v_keep_ids, '{}'::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.employee_id = u.id AND s.shop_id <> p_shop_id)
       AND NOT EXISTS (SELECT 1 FROM voids v WHERE v.voided_by = u.id)
       AND NOT EXISTS (SELECT 1 FROM cash_reconciliations r WHERE r.reconciled_by = u.id);

    IF v_gone IS NOT NULL THEN
      UPDATE returns                    SET processed_by  = NULL WHERE processed_by  = ANY (v_gone);
      UPDATE inventory_movements        SET created_by    = NULL WHERE created_by    = ANY (v_gone);
      -- `customers.created_by` is varchar, not uuid (measured): compared as text, or
      -- this statement is a type error and takes the whole delete with it.
      UPDATE customers                  SET created_by    = NULL
                                         WHERE created_by IN (SELECT x::text FROM unnest (v_gone) x);
      UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = ANY (v_gone);
      UPDATE user_permissions           SET granted_by    = NULL WHERE granted_by    = ANY (v_gone);
      DELETE FROM activity_log     WHERE user_id = ANY (v_gone);
      DELETE FROM audit_events     WHERE user_id = ANY (v_gone);
      DELETE FROM user_permissions WHERE user_id = ANY (v_gone);
      DELETE FROM users      WHERE id = ANY (v_gone);
      DELETE FROM auth.users WHERE id = ANY (v_gone);
    END IF;

    -- Logins kept for their history but with no branch left: no membership (this
    -- branch's cascades away), not active, no credential. Nothing they can sign
    -- into, and nothing of another branch's history broken.
    UPDATE users u
       SET is_active = false,
           shop_id   = v_fallback
     WHERE u.id = ANY (v_staff)
       AND u.id <> ALL (COALESCE(v_keep_ids, '{}'::uuid[]))
       AND u.id <> ALL (COALESCE(v_gone, '{}'::uuid[]));

    DELETE FROM auth.users a
     WHERE a.id IN (
       SELECT u.id FROM users u
        WHERE u.id = ANY (v_staff)
          AND u.id <> ALL (COALESCE(v_keep_ids, '{}'::uuid[]))
          AND u.id <> ALL (COALESCE(v_gone, '{}'::uuid[]))
     );

    -- What the caller is told afterwards: how many people kept working, and how
    -- many logins were resolved with the branch. Counted from the ids, not from a
    -- query after the deletes — the deleted rows are already gone by now.
    v_kept    := COALESCE(cardinality(v_keep_ids), 0);
    v_removed := COALESCE(cardinality(v_staff), 0) - v_kept;
  END IF;

  -- ── The branch itself ───────────────────────────────────────────────────────
  -- This account stops working in a branch that is about to disappear, stated
  -- here so no client can hold a pointer at it.
  INSERT INTO user_active_shops (user_id, shop_id, updated_at)
  VALUES (v_actor, v_fallback, now())
  ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, updated_at = now();

  PERFORM public.purge_branch_data(p_shop_id);

  -- Written after the erase, and against the fallback branch, because the audit
  -- row must outlive the branch it describes.
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'branch_deleted', 'shop', p_shop_id,
          jsonb_build_object(
            'name', v_name,
            'reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
            'feedback', NULLIF(trim(COALESCE(p_feedback, '')), ''),
            'erased', v_counts,
            'employees_kept', COALESCE(v_kept, 0),
            'employees_removed', COALESCE(v_removed, 0),
            'fallback_shop_id', v_fallback
          ));

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'name', v_name,
    'erased', v_counts,
    'employees_kept', COALESCE(v_kept, 0),
    'employees_removed', COALESCE(v_removed, 0),
    'fallback_shop_id', v_fallback,
    'active_shop_id', v_fallback
  );
END;
$$;


--
-- Name: delete_credit_limit_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.delete_credit_limit_request(p_request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$$;


--
-- Name: delete_my_account(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.delete_my_account() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_mine uuid[];
  v_staff uuid[];
  v_keeper uuid;
  v_phone text;
  v_requests int := 0;
  -- 0156: the loop variable holds a shop id. Declaring it `int` made every iteration
  -- cast a uuid to an integer before the body was ever reached.
  v_shops uuid;
  v_shop_count int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Read the number first: after the rows below are deleted there is nothing left to read it from.
  SELECT phone INTO v_phone FROM users WHERE id = v_actor;

  -- Shops this account answers for: rows it owns, plus any shop where it holds an
  -- owner/admin membership. Both, because `shops.owner_id` is not stamped on older rows.
  SELECT array_agg(DISTINCT sid) INTO v_mine FROM (
    SELECT id AS sid FROM shops WHERE owner_id = v_actor
    UNION
    SELECT tenant_id FROM memberships
     WHERE user_id = v_actor AND role IN ('owner', 'admin') AND status = 'active'
  ) mine;

  IF v_mine IS NOT NULL THEN
    SELECT array_agg(id) INTO v_staff FROM users WHERE shop_id = ANY(v_mine) AND id <> v_actor;
    -- History rows that point at those logins (nullable ones are detached, not destroyed).
    UPDATE returns                SET processed_by  = NULL WHERE processed_by  = ANY(v_staff);
    UPDATE inventory_movements    SET created_by    = NULL WHERE created_by    = ANY(v_staff);
    -- `customers.created_by` is `varchar(255)`: compare as text, not as uuid.
    UPDATE customers              SET created_by    = NULL WHERE created_by    = ANY(v_staff::text[]);
    UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = ANY(v_staff);
    UPDATE user_permissions       SET granted_by    = NULL WHERE granted_by    = ANY(v_staff);
    UPDATE users                  SET created_by    = NULL WHERE created_by    = ANY(v_staff);
    DELETE FROM activity_log WHERE user_id = ANY(v_staff);
    DELETE FROM audit_events WHERE user_id = ANY(v_staff);
    DELETE FROM user_permissions WHERE user_id = ANY(v_staff);

    -- `users.shop_id` is a NO ACTION reference to `shops`, and the sales being purged below are
    -- NO ACTION references to `users`: the logins have to let go of the shop before the shop can
    -- go, and only then can the logins themselves be removed.
    UPDATE users SET shop_id = NULL WHERE shop_id = ANY(v_mine);

    FOREACH v_shops IN ARRAY v_mine LOOP
      PERFORM purge_shop_data(v_shops);
      v_shop_count := v_shop_count + 1;
    END LOOP;

    DELETE FROM users WHERE id = ANY(v_staff);
    DELETE FROM auth.users WHERE id = ANY(v_staff);
  END IF;

  -- The caller's own footprints. Their shop is already gone when they own one; when they were an
  -- employee, this detaches them from the shop's history rather than deleting it.
  UPDATE returns                SET processed_by  = NULL WHERE processed_by  = v_actor;
  UPDATE inventory_movements    SET created_by    = NULL WHERE created_by    = v_actor;
  UPDATE customers              SET created_by    = NULL WHERE created_by    = v_actor::text;
  UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = v_actor;
  UPDATE shop_requests          SET reviewed_by   = NULL WHERE reviewed_by   = v_actor;
  UPDATE user_permissions       SET granted_by    = NULL WHERE granted_by    = v_actor;
  UPDATE users                  SET created_by    = NULL WHERE created_by    = v_actor;
  DELETE FROM activity_log WHERE user_id = v_actor;
  DELETE FROM audit_events WHERE user_id = v_actor;

  -- NEW IN 0170: the number's own registration request, so this number can register again.
  -- Matched on the last ten digits: `03001234567` and `923001234567` are the same number
  -- written two ways, and only one of them is stored here.
  IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) >= 10 THEN
    DELETE FROM shop_requests
     WHERE right(regexp_replace(owner_phone, '\D', '', 'g'), 10)
         = right(regexp_replace(v_phone,      '\D', '', 'g'), 10);
    GET DIAGNOSTICS v_requests = ROW_COUNT;
  END IF;

  -- Not-nullable attribution is handed to someone still in the shop, so it keeps a valid record
  -- of what happened instead of losing the sale entirely.
  SELECT m2.user_id INTO v_keeper
  FROM memberships m1
  JOIN memberships m2 ON m2.tenant_id = m1.tenant_id AND m2.status = 'active'
  WHERE m1.user_id = v_actor AND m2.user_id <> v_actor AND m2.role IN ('owner', 'admin')
  ORDER BY m2.created_at ASC LIMIT 1;
  IF v_keeper IS NOT NULL THEN
    UPDATE sales  SET employee_id = v_keeper WHERE employee_id = v_actor;
    UPDATE voids  SET voided_by   = v_keeper WHERE voided_by   = v_actor;
    UPDATE cash_reconciliations SET reconciled_by = v_keeper WHERE reconciled_by = v_actor;
  ELSE
    -- Nobody left to inherit them: they belong to this account, so they go with it.
    DELETE FROM voids  v USING sales s WHERE v.sale_id = s.id AND v.voided_by = v_actor;
    DELETE FROM sales WHERE employee_id = v_actor;
    DELETE FROM cash_reconciliations WHERE reconciled_by = v_actor;
  END IF;

  DELETE FROM memberships WHERE user_id = v_actor;
  DELETE FROM users WHERE id = v_actor;
  DELETE FROM auth.users WHERE id = v_actor;   -- last: the login cannot outlive the data

  RETURN jsonb_build_object('ok', true, 'shops', v_shop_count, 'requests', v_requests);
END;
$$;


--
-- Name: delete_product(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.delete_product(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
BEGIN
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete products';
  END IF;

  DELETE FROM product_variants WHERE product_id = (payload->>'id')::uuid;
  DELETE FROM products WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: delete_product_barcode(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.delete_product_barcode(p_product_id uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop  uuid;
  v_count int;
BEGIN
  SELECT shop_id INTO v_shop FROM public.products WHERE id = p_product_id;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

  PERFORM public.authorize_business_action('products.edit', v_shop);

  -- Raise a typed error when there is nothing to remove, rather than returning success for a
  -- delete that did nothing.
  IF NOT EXISTS (SELECT 1 FROM public.product_barcodes WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'BARCODE_NONE: this product has no barcode to delete';
  END IF;

  PERFORM set_config('app.barcode_reason', coalesce(p_reason, ''), true);
  DELETE FROM public.product_barcodes WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.barcode_reason', '', true);

  RETURN jsonb_build_object('productId', p_product_id, 'deleted', v_count);
END;
$$;


--
-- Name: delete_role(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.delete_role(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_id uuid := (payload->>'roleId')::uuid;
  v_system boolean;
  v_affected int := 0;
BEGIN
  v_tenant := authorize_business_action('settings.edit');

  SELECT is_system INTO v_system FROM roles WHERE id = v_id AND tenant_id = v_tenant;
  IF v_system IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  -- Revoke first, in the same transaction as the delete: a role cannot be gone while
  -- an employee still resolves permissions through it, and it cannot be revoked while
  -- the role still exists. Either both happen or neither does.
  --
  -- Scoped to this tenant, because a membership pointing at a role of another shop is
  -- not this owner's to change. If one ever existed, the DELETE below fails on the
  -- foreign key and the whole transaction rolls back rather than half-applying.
  UPDATE memberships
     SET role_id = NULL, updated_at = now()
   WHERE role_id = v_id AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  DELETE FROM roles WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (app_current_user_id(), 'role_deleted', 'role', v_id,
          jsonb_build_object('wasSystemRole', COALESCE(v_system, false),
                             'revokedFrom', v_affected));

  -- The screen reads this to say what happened. `deleted` is kept so any older caller
  -- still sees the shape it knows.
  RETURN jsonb_build_object('id', v_id, 'deleted', true, 'revokedFrom', v_affected);
END; $$;


--
-- Name: enforce_branch_scope(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.enforce_branch_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_branch public.branches;
BEGIN
  -- Trusted background work must still state valid ownership. It is never
  -- authenticated merely because a caller supplied an actor field.
  IF v_actor IS NULL THEN
    IF current_setting('role', true) = 'authenticated' THEN
      RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := public.default_branch_id((to_jsonb(NEW)->>'shop_id')::uuid);
    END IF;
    IF NEW.branch_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches WHERE id = NEW.branch_id
    ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
  -- A definer UPDATE must not be allowed to move an inaccessible OLD record
  -- into the actor's branch. Check OLD before considering NEW.
  IF TG_OP = 'UPDATE' AND (
    OLD.branch_id IS DISTINCT FROM public.current_branch_id() OR
    NEW.branch_id IS DISTINCT FROM OLD.branch_id
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied'; END IF;

  NEW.branch_id := COALESCE(NEW.branch_id, public.current_branch_id());
  SELECT * INTO v_branch FROM public.branches WHERE id = NEW.branch_id AND is_active;
  IF v_branch.id IS NULL OR v_branch.tenant_id IS DISTINCT FROM v_member.tenant_id OR
     NEW.branch_id IS DISTINCT FROM public.current_branch_id() OR
     ((to_jsonb(NEW)->>'shop_id') IS NOT NULL AND
      (to_jsonb(NEW)->>'shop_id')::uuid IS DISTINCT FROM v_member.tenant_id) OR
     (v_member.role <> 'owner' AND
      NOT (NEW.branch_id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: generate_barcode(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.generate_barcode() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_code text;
  v_exists boolean;
BEGIN
  LOOP
    v_code := 'AG' || lpad((floor(random() * 999999999))::text, 9, '0');
    SELECT EXISTS(SELECT 1 FROM products WHERE barcode = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;


--
-- Name: generate_barcode(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.generate_barcode(p_name text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_hash text;
  v_seq int;
  v_barcode text;
BEGIN
  -- Extract first 4 alphanumeric characters from product name
  v_hash := UPPER(LEFT(REGEXP_REPLACE(p_name, '[^a-zA-Z0-9]', '', 'g'), 4));
  IF LENGTH(v_hash) < 4 THEN v_hash := v_hash || RPAD('X', 4 - LENGTH(v_hash), 'X'); END IF;

  -- Get next sequence number for this hash
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(barcode FROM 10 FOR 2) AS int)
  ), 0) + 1
  INTO v_seq
  FROM products
  WHERE barcode LIKE 'AGS-' || v_hash || '-%';

  v_barcode := 'AGS-' || v_hash || '-' || LPAD(v_seq::text, 2, '0');

  -- Ensure uniqueness (collision check)
  WHILE EXISTS (SELECT 1 FROM products WHERE barcode = v_barcode) LOOP
    v_seq := v_seq + 1;
    v_barcode := 'AGS-' || v_hash || '-' || LPAD(v_seq::text, 2, '0');
  END LOOP;

  RETURN v_barcode;
END;
$$;


--
-- Name: get_authenticated_user_id(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_authenticated_user_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_phone text;
BEGIN
  -- Try auth.uid() first
  v_user_id := auth.uid();
  
  -- If NULL, try JWT claims
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := NULLIF(
        current_setting('request.jwt.claims', true)::json->>'sub',
        ''
      )::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;
  
  -- If we have an auth user ID, try to find matching app user by phone
  IF v_user_id IS NOT NULL THEN
    -- Get phone from JWT claims
    BEGIN
      v_phone := current_setting('request.jwt.claims', true)::json->>'phone';
    EXCEPTION WHEN OTHERS THEN
      v_phone := NULL;
    END;
    
    -- If phone exists, look up app user
    IF v_phone IS NOT NULL AND v_phone != '' THEN
      SELECT id INTO v_user_id FROM users WHERE phone = v_phone AND is_active = true;
    ELSE
      -- Try to get phone from auth.users
      SELECT phone INTO v_phone FROM auth.users WHERE id = v_user_id;
      IF v_phone IS NOT NULL THEN
        SELECT id INTO v_user_id FROM users WHERE phone = v_phone AND is_active = true;
      ELSE
        v_user_id := NULL;
      END IF;
    END IF;
  END IF;
  
  RETURN v_user_id;
END;
$$;


--
-- Name: get_branch_activity(timestamp with time zone, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_branch_activity(p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, action text, entity_type text, entity_id uuid, actor_id uuid, actor_name text, actor_role text, branch_id uuid, branch_name text, details jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_tenant uuid; v_branch uuid := public.current_branch_id();
BEGIN
  v_tenant := public.authorize_business_action('activity.view');
  RETURN QUERY SELECT a.id,a.action::text,a.entity_type::text,a.entity_id,a.user_id,a.actor_name,
    a.actor_role,a.branch_id,a.branch_name,a.details,a.created_at FROM public.audit_events a
  WHERE a.tenant_id=v_tenant AND a.branch_id=v_branch
    AND (p_before IS NULL OR (a.created_at,a.id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  ORDER BY a.created_at DESC,a.id DESC LIMIT greatest(1,least(COALESCE(p_limit,50),100));
END;
$$;


--
-- Name: get_effective_permissions(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_effective_permissions(p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id,public.app_current_user_id());
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_permissions text[];
BEGIN
  IF v_actor IS NULL OR v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_actor IS DISTINCT FROM v_user AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
  END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_member.role='owner' THEN
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM public.permissions;
  ELSE
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM (
      SELECT p.code FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
        JOIN public.roles r ON r.id=rp.role_id AND r.tenant_id=v_member.tenant_id
        WHERE rp.role_id=v_member.role_id
      UNION SELECT p.code FROM public.user_permissions up JOIN public.permissions p ON p.id=up.permission_id
        WHERE up.user_id=v_user AND up.is_override AND up.is_granted
      EXCEPT SELECT p.code FROM public.user_permissions up JOIN public.permissions p ON p.id=up.permission_id
        WHERE up.user_id=v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;
  RETURN to_jsonb(COALESCE(v_permissions,'{}'::text[]));
END;
$$;


--
-- Name: get_employee_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_employee_access(p_employee_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_tenant uuid; v_role_id uuid; v_role text; v_scope uuid[]; v_effective jsonb; v_defaults jsonb; v_overrides jsonb;
BEGIN
  v_tenant := authorize_business_action('employees.view');
  SELECT m.role_id, m.role::text, m.branch_scope INTO v_role_id, v_role, v_scope
  FROM memberships m JOIN users u ON u.id=m.user_id
  WHERE m.user_id=p_employee_id AND m.tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code),'[]'::jsonb) INTO v_defaults
  FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=v_role_id;
  SELECT COALESCE(jsonb_object_agg(p.code, up.is_granted),'{}'::jsonb) INTO v_overrides
  FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
  WHERE up.user_id=p_employee_id AND up.is_override=true;
  v_effective := get_effective_permissions(p_employee_id);
  RETURN jsonb_build_object('roleId',v_role_id,'membershipRole',v_role,'branchScope',v_scope,'defaults',v_defaults,'overrides',v_overrides,'effective',v_effective);
END; $$;


--
-- Name: get_my_branches(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_my_branches() RETURNS TABLE(branch_id uuid, tenant_id uuid, name text, membership_role public.membership_role, membership_status public.membership_status, is_current boolean, is_main boolean, created_at timestamp with time zone, employee_count integer, product_count integer, customer_count integer, sales_count integer, sales_total numeric, address text, latitude double precision, longitude double precision, location_label text, location_source text, marketplace_enabled boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT b.id, b.tenant_id, b.name::text, m.role, m.status,
    (b.id = public.current_branch_id()), b.is_default, b.created_at,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('employees.view')
      THEN (SELECT count(*)::int FROM public.memberships x
        WHERE x.tenant_id = b.tenant_id AND x.status = 'active' AND x.role <> 'owner'
         AND b.id = ANY(COALESCE(x.branch_scope, '{}'::uuid[]))) ELSE NULL::int END,
    -- Products/customers are tenant-owned today. Do not invent a branch count
    -- or expose tenant-wide counts to a branch-limited reader.
    NULL::int, NULL::int,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT count(*)::int FROM public.sales v
        WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id) ELSE NULL::int END,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT COALESCE(sum(v.total_amount), 0) FROM public.sales v
        WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id) ELSE NULL::numeric END,
    b.address::text, b.latitude, b.longitude, b.location_label, b.location_source,
    s.marketplace_enabled
  FROM public.memberships m
  JOIN public.branches b ON b.tenant_id = m.tenant_id AND b.is_active
  JOIN public.shops s ON s.id = b.tenant_id
  WHERE m.user_id = public.app_current_user_id() AND m.status = 'active'
    AND m.tenant_id = public.current_shop_id()
    AND (m.role = 'owner' OR b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
  ORDER BY b.is_default DESC, b.created_at, b.id;
$$;


--
-- Name: get_my_permissions(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_my_permissions() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT get_effective_permissions(NULL) $$;


--
-- Name: get_my_shop_request(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_my_shop_request(p_phone text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_request public.shop_requests;
BEGIN
  -- One request per number (`idx_shop_requests_phone` on `owner_phone`). `phone` is the second
  -- spelling of the same value and it agreed with `owner_phone` in every row measured, so this stays
  -- a single lookup that tries both.
  --
  -- `phone` is reached through `to_jsonb(sr)` instead of being named as a column, and that accessor
  -- is load-bearing rather than stylistic: `phone` is not part of every lineage. Measured column
  -- lists — the deployed/staging `shop_requests` has 23 columns including `phone`, `latitude` and
  -- `longitude`; production's has 18 and no `phone` at all (both baselines, SCHEMA_STRATEGY.md §1).
  -- This file narrows the function where it exists AND creates it on production, and a named column
  -- that is not there fails at the first call — which creation-time verification cannot see, because
  -- PL/pgSQL resolves column references at execution, not when the function is defined. The JSON
  -- accessor returns NULL for a key the row type does not have.
  SELECT * INTO v_request
    FROM public.shop_requests sr
   WHERE sr.owner_phone = p_phone
      OR to_jsonb(sr) ->> 'phone' = p_phone
   LIMIT 1;

  IF v_request.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'request', jsonb_build_object(
      -- The five fields the pre-login screens render, plus the two the client contract requires.
      -- Widening this list is a decision about what an unauthenticated caller may see: make it
      -- deliberately, and change `tests/unit/preAuthRequestPrivacy.test.ts` with it.
      'id',               v_request.id,
      'status',           v_request.status,
      'rejection_reason', v_request.rejection_reason,
      'owner_name',       v_request.owner_name,
      'owner_phone',      v_request.owner_phone,
      'shop_name',        v_request.shop_name,
      'shop_type',        v_request.shop_type,
      'created_at',       v_request.created_at,
      'updated_at',       v_request.updated_at
    )
  );
END;
$$;


--
-- Name: get_my_shops(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_my_shops() RETURNS TABLE(shop_id uuid, name text, membership_role public.membership_role, membership_status public.membership_status, is_current boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.tenant_id,
         s.name::text,
         m.role,
         m.status,
         (m.tenant_id = public.current_shop_id())
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = app_current_user_id()
   ORDER BY (m.tenant_id = public.current_shop_id()) DESC, s.name ASC;
$$;


--
-- Name: get_stock_alert_settings(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.get_stock_alert_settings(payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_resolved jsonb;
  v_shop uuid;
  v_threshold int;
  v_frequency text;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId','')::uuid,
    NULLIF(payload->>'userId','')::uuid,
    NULLIF(payload->>'actorId','')::uuid
  );
  v_shop := (v_resolved->>'shop_id')::uuid;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_SHOP_CONTEXT';
  END IF;

  -- Anyone who may look at the shop's products may see the policy they are alerted by.
  PERFORM authorize_business_action('products.view', v_shop, NULL);

  SELECT GREATEST(COALESCE(setting_value::int, 0), 0) INTO v_threshold
    FROM app_settings WHERE shop_id = v_shop AND setting_key = 'low_stock_threshold_default';

  SELECT setting_value INTO v_frequency
    FROM app_settings WHERE shop_id = v_shop AND setting_key = 'stock_alert_frequency';

  RETURN jsonb_build_object(
    'threshold', COALESCE(v_threshold, 10),
    'frequency', COALESCE(NULLIF(v_frequency, ''), 'on_cross')
  );
END;
$$;


--
-- Name: grant_branch_responsibility(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.grant_branch_responsibility(p_branch_id uuid, p_user_id uuid, p_role_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: guard_employee_access_edit(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.guard_employee_access_edit(payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
  v_target public.memberships;
  v_actor public.memberships;
  v_scope uuid[];
  v_role uuid;
  v_code text;
  v_grant boolean;
BEGIN
  SELECT * INTO v_actor FROM public.membership_in_active_shop(NULL);
  SELECT * INTO v_target FROM public.memberships WHERE user_id=(payload->>'employeeId')::uuid
    AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR v_target.role='owner' THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF v_actor.role<>'owner' AND (v_target.user_id=v_actor.user_id OR v_target.role<>'employee' OR
    v_target.branch_scope IS NULL OR NOT (v_target.branch_scope <@ COALESCE(v_actor.branch_scope,'{}'::uuid[]))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: employee access exceeds your branch scope';
  END IF;
  IF payload ? 'branchScope' THEN
    IF jsonb_typeof(payload->'branchScope') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required';
    END IF;
    SELECT array_agg(DISTINCT value::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope');
    IF v_scope IS NULL OR cardinality(v_scope)=0 OR EXISTS (
      SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM public.branches b
        WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)
    ) OR (v_actor.role<>'owner' AND NOT (v_scope <@ COALESCE(v_actor.branch_scope,'{}'::uuid[]))) THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE';
    END IF;
  END IF;
  v_role := COALESCE(NULLIF(payload->>'roleId','')::uuid,v_target.role_id);
  IF v_role IS NULL OR NOT EXISTS(SELECT 1 FROM public.roles WHERE id=v_role AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  IF v_actor.role<>'owner' THEN
    IF EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
      WHERE rp.role_id=v_role AND NOT public.has_effective_permission(p.code)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
    END IF;
    FOR v_code,v_grant IN SELECT key,value::boolean FROM jsonb_each_text(COALESCE(payload->'overrides','{}'::jsonb)) LOOP
      IF v_grant AND NOT public.has_effective_permission(v_code::varchar) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
      END IF;
    END LOOP;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      IF NOT public.has_effective_permission(v_code::varchar) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
      END IF;
    END LOOP;
  END IF;
END;
$$;


--
-- Name: guard_operational_request(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.guard_operational_request(p_rpc text, p_payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_permission text;
  v_tenant uuid;
  v_branch uuid := public.current_branch_id();
  v_key text := NULLIF(COALESCE(p_payload->>'idempotencyKey',p_payload->>'idempotency_key'),'');
  v_record_branch uuid;
  v_record_tenant uuid;
  v_record_parent uuid;
  v_requested uuid;
  v_item jsonb;
  v_found boolean := false;
  v_sale_customer uuid;
BEGIN
  v_permission := CASE p_rpc WHEN 'create_sale' THEN 'sales.create' WHEN 'create_purchase' THEN 'purchases.create'
    WHEN 'void_sale' THEN 'sales.void' WHEN 'void_sale_v1' THEN 'sales.void' WHEN 'process_return' THEN 'returns.create'
    WHEN 'record_customer_payment' THEN 'customers.payments' WHEN 'record_supplier_payment' THEN 'payments.supplier'
    WHEN 'adjust_stock' THEN 'inventory.adjust' END;
  IF v_permission IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
  v_tenant := public.authorize_business_action(v_permission::varchar);
  IF NULLIF(p_payload->>'branchId','') IS NOT NULL AND (p_payload->>'branchId')::uuid IS DISTINCT FROM v_branch THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: select the requested branch first';
  END IF;
  IF NULLIF(p_payload->>'shopId','') IS NOT NULL AND (p_payload->>'shopId')::uuid IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF p_rpc IN ('process_return','void_sale','void_sale_v1') THEN
    v_requested := COALESCE(NULLIF(p_payload->>'saleId',''),NULLIF(p_payload->>'sale_id',''))::uuid;
    SELECT shop_id,branch_id,customer_id INTO v_record_tenant,v_record_branch,v_sale_customer FROM public.sales WHERE id=v_requested;
    IF NOT FOUND OR v_record_tenant IS DISTINCT FROM v_tenant OR v_record_branch IS DISTINCT FROM v_branch THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: record branch access denied';
    END IF;
    IF p_rpc='process_return' AND NULLIF(p_payload->>'customerId','') IS NOT NULL AND
      (p_payload->>'customerId')::uuid IS DISTINCT FROM v_sale_customer THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: return customer does not match the sale';
    END IF;
  END IF;
  -- Existing ledgers have tenant/global keys. Never disclose or accept a
  -- successful request from another branch/parent merely because its key matches.
  v_record_branch := NULL; v_record_parent := NULL;
  IF v_key IS NOT NULL THEN
    IF p_rpc='create_sale' THEN
      SELECT s.branch_id INTO v_record_branch FROM public.sale_submissions x
        JOIN public.sales s ON s.id=x.sale_id WHERE x.shop_id=v_tenant AND x.idempotency_key=v_key;
    ELSIF p_rpc='create_purchase' THEN
      SELECT branch_id INTO v_record_branch FROM public.purchases WHERE idempotency_key=v_key;
    ELSIF p_rpc='process_return' THEN
      SELECT branch_id,sale_id INTO v_record_branch,v_record_parent FROM public.returns WHERE idempotency_key=v_key;
    ELSIF p_rpc='record_customer_payment' THEN
      v_requested := NULLIF(p_payload->>'customerId','')::uuid;
      SELECT branch_id,customer_id INTO v_record_branch,v_record_parent FROM public.customer_payments WHERE idempotency_key=v_key LIMIT 1;
    ELSIF p_rpc='record_supplier_payment' THEN
      v_requested := NULLIF(p_payload->>'companyId','')::uuid;
      SELECT branch_id,company_id INTO v_record_branch,v_record_parent FROM public.supplier_payments WHERE idempotency_key=v_key LIMIT 1;
    ELSIF p_rpc='adjust_stock' THEN
      v_requested := NULLIF(p_payload->>'productId','')::uuid;
      SELECT branch_id,product_id INTO v_record_branch,v_record_parent FROM public.stock_adjustments WHERE idempotency_key=v_key LIMIT 1;
    END IF;
    v_found := FOUND;
    IF v_found AND (v_record_branch IS DISTINCT FROM v_branch OR
      (v_record_parent IS NOT NULL AND v_record_parent IS DISTINCT FROM v_requested)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: repeated request belongs to another branch or record';
    END IF;
  END IF;
  -- Master records are business-owned in the existing model. Enforce that
  -- boundary too, and reject a variant paired with someone else's product.
  IF NULLIF(p_payload->>'customerId','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id=(p_payload->>'customerId')::uuid AND shop_id=v_tenant
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: customer access denied'; END IF;
  IF NULLIF(p_payload->>'companyId','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id=(p_payload->>'companyId')::uuid AND shop_id=v_tenant
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: supplier access denied'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(CASE WHEN p_rpc='adjust_stock' THEN jsonb_build_array(p_payload)
    ELSE COALESCE(p_payload->'items','[]'::jsonb) END) LOOP
    IF p_rpc='process_return' AND NOT EXISTS (
      SELECT 1 FROM public.sale_items si WHERE si.id=COALESCE(NULLIF(v_item->>'saleItemId',''),NULLIF(v_item->>'sale_item_id',''))::uuid
        AND si.sale_id=v_requested AND si.product_id IS NOT DISTINCT FROM NULLIF(v_item->>'productId','')::uuid
        AND si.variant_id IS NOT DISTINCT FROM NULLIF(v_item->>'variantId','')::uuid
    ) THEN RAISE EXCEPTION 'ITEM_NOT_OWNED: return product or variant does not match the sale item'; END IF;
    IF NULLIF(v_item->>'productId','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE id=(v_item->>'productId')::uuid AND shop_id=v_tenant
    ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product access denied'; END IF;
    IF NULLIF(v_item->>'variantId','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants v JOIN public.products p ON p.id=v.product_id
      WHERE v.id=(v_item->>'variantId')::uuid AND p.shop_id=v_tenant
        AND p.id=NULLIF(v_item->>'productId','')::uuid
    ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: variant access denied'; END IF;
  END LOOP;
END;
$$;


--
-- Name: has_effective_permission(character varying, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.has_effective_permission(p_code character varying, p_user_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN get_effective_permissions(p_user_id) ? p_code;
END;
$$;


--
-- Name: insert_shop_request(text, text, text, text, text, text, text, text, double precision, double precision, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.insert_shop_request(p_owner_name text, p_owner_phone text, p_phone text, p_shop_name text, p_shop_type text DEFAULT 'retail'::text, p_shop_city text DEFAULT NULL::text, p_shop_address text DEFAULT NULL::text, p_business_registration_number text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_location_label text DEFAULT NULL::text, p_location_source text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO shop_requests (owner_name, owner_phone, phone, shop_name, shop_type, shop_city,
                             shop_address, business_registration_number, status,
                             latitude, longitude, location_label, location_source)
  VALUES (p_owner_name, p_owner_phone, p_phone, p_shop_name, p_shop_type, p_shop_city,
          p_shop_address, p_business_registration_number, 'pending',
          p_latitude, p_longitude, p_location_label, p_location_source)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'id', new_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


--
-- Name: lookup_product_by_barcode(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.lookup_product_by_barcode(p_barcode text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_product jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'company', p.company,
    'category', p.category,
    'image_url', p.image_url,
    'barcode', p.barcode
  )
  INTO v_product
  FROM products p
  WHERE UPPER(p.barcode) = UPPER(p_barcode)
    AND p.is_active = true;

  IF v_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  RETURN v_product;
END;
$$;


--
-- Name: lookup_user_by_phone(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.lookup_user_by_phone(p_phone text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user jsonb;
  v_membership jsonb;
  v_user_id uuid;
BEGIN
  IF to_regprocedure('public.canonical_phone(text)') IS NOT NULL THEN
    -- The newer lineage stores a canonical form and knows how to produce it.
    SELECT jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'phone', u.phone,
      'role', u.role,
      'is_original_owner', u.is_original_owner,
      'is_active', u.is_active,
      'employee_number', u.employee_number,
      'job_title', u.job_title,
      'first_login_at', u.first_login_at,
      'last_login_at', u.last_login_at,
      'deactivated_at', u.deactivated_at,
      'deactivated_by', u.deactivated_by,
      'created_by', u.created_by,
      'created_at', u.created_at,
      'photo_url', u.photo_url,
      'shop_id', u.shop_id
    ) INTO v_user
    FROM public.users u
    WHERE public.canonical_phone(p_phone) IS NOT NULL
      AND public.canonical_phone(u.phone) = public.canonical_phone(p_phone)
    LIMIT 1;
  ELSE
    -- The older lineage has no canonical form; it matches the number as stored, which is what its
    -- own body did. This branch reproduces that comparison rather than inventing one.
    SELECT jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'phone', u.phone,
      'role', u.role,
      'is_original_owner', u.is_original_owner,
      'is_active', u.is_active,
      'employee_number', u.employee_number,
      'job_title', u.job_title,
      'first_login_at', u.first_login_at,
      'last_login_at', u.last_login_at,
      'deactivated_at', u.deactivated_at,
      'deactivated_by', u.deactivated_by,
      'created_by', u.created_by,
      'created_at', u.created_at,
      'photo_url', u.photo_url,
      'shop_id', u.shop_id
    ) INTO v_user
    FROM public.users u
    WHERE u.phone = p_phone OR u.phone = '+' || p_phone
    LIMIT 1;
  END IF;

  -- No account for this number. Still NULL, which is the client's "not registered" signal.
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  v_user_id := (v_user->>'id')::uuid;

  -- ── The scope ────────────────────────────────────────────────────────────────────────────────
  -- Everything below this line answers for the signed-in owner of the account. A caller who has
  -- not proved that identity — an anonymous one, or one authenticated as somebody else — leaves
  -- with the door answer: whether the account is open, and the role the sign-in door keys off.
  IF public.app_current_user_id() IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object(
      'is_active', (v_user->>'is_active')::boolean,
      'role', v_user->>'role'
    );
  END IF;

  IF to_regclass('public.memberships') IS NOT NULL
     AND to_regprocedure('public.resolve_active_shop(uuid)') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'tenant_id', m.tenant_id,
      'membership_id', m.id,
      'membership_role', m.role,
      'membership_status', m.status,
      'branch_scope', m.branch_scope
    ) INTO v_membership
    FROM public.memberships m
    WHERE m.user_id = v_user_id
    -- The active shop first, then an active membership, then the oldest row: an invited employee
    -- still sees 'pending' and can activate it (0133).
    ORDER BY (m.tenant_id = public.resolve_active_shop(v_user_id)) DESC,
             (m.status = 'active') DESC,
             m.created_at ASC
    LIMIT 1;

    IF v_membership IS NOT NULL THEN
      v_user := v_user || v_membership;
    END IF;
  END IF;

  RETURN v_user;
END;
$$;


--
-- Name: marketplace_distance_km(double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.marketplace_distance_km(p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision) RETURNS double precision
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  SELECT 6371.0088 * 2 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2))
           * power(sin(radians(p_lon2 - p_lon1) / 2), 2)
         ));
$$;



SET default_tablespace = '';


SET default_table_access_method = heap;

--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    role public.membership_role DEFAULT 'employee'::public.membership_role NOT NULL,
    status public.membership_status DEFAULT 'active'::public.membership_status NOT NULL,
    branch_scope uuid[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role_id uuid,
    CONSTRAINT memberships_branch_scope_not_empty CHECK (((branch_scope IS NULL) OR (cardinality(branch_scope) > 0)))
);


--
-- Name: membership_in_active_shop(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.membership_in_active_shop(p_user_id uuid DEFAULT NULL::uuid) RETURNS public.memberships
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.*
    FROM memberships m
   WHERE m.user_id = COALESCE(p_user_id, app_current_user_id())
     AND m.tenant_id = public.current_shop_id()
     AND m.status = 'active'
   LIMIT 1;
$$;


--
-- Name: mint_barcode(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.mint_barcode(p_name text, p_shop uuid) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_stem text;
  v_code text;
  v_try  int := 0;
BEGIN
  -- A readable stem from the product's name; anything unnameable still gets a valid code.
  v_stem := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  v_stem := rpad(coalesce(nullif(substr(v_stem, 1, 4), ''), 'PRD'), 4, 'X');

  LOOP
    v_try := v_try + 1;
    -- Two digits is the familiar shape; if a shop has genuinely filled all 99 slots for
    -- one stem, the code grows rather than failing to be handed out.
    v_code := 'AGS-' || v_stem || '-' || CASE
      WHEN v_try <= 200 THEN lpad((1 + floor(random() * 99))::int::text, 2, '0')
      ELSE lpad((100 + floor(random() * 899))::int::text, 3, '0')
    END;

    -- Free means free in the registry — which every code this shop has ever used is in, live
    -- or retired. Checking `product_barcodes` alone would offer back a retired code.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.barcode_registry WHERE shop_id = p_shop AND code = v_code
    );
    IF v_try > 400 THEN
      RAISE EXCEPTION 'BARCODE_MINT_FAILED: could not find a free code for this shop';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;


--
-- Name: my_shop_ids(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.my_shop_ids() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(array_agg(m.tenant_id), '{}'::uuid[])
    FROM memberships m
   WHERE m.user_id = public.app_current_user_id()
     AND m.status = 'active';
$$;


--
-- Name: my_shop_join_code(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.my_shop_join_code() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_shop  uuid := current_shop_id();
  v_code  text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_shop IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = v_actor AND m.tenant_id = v_shop AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this shop';
  END IF;

  SELECT s.join_code INTO v_code FROM shops s WHERE s.id = v_shop;
  RETURN v_code;
END; $$;


--
-- Name: notification_branch_visible(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.notification_branch_visible(p_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p_branch_id IS NULL
      OR public.allowed_branch_scope() IS NULL
      OR p_branch_id = ANY (public.allowed_branch_scope());
$$;


--
-- Name: notifications_stamp(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.notifications_stamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_entity_branch uuid;
  v_kind text := COALESCE(NEW.entity_type, NEW.kind);
BEGIN
  IF NEW.shop_id IS NULL THEN
    NEW.shop_id := public.current_shop_id();
  END IF;

  IF NEW.actor_id IS NULL THEN
    NEW.actor_id := public.app_current_user_id();
  END IF;
  IF NEW.actor_name IS NULL AND NEW.actor_id IS NOT NULL THEN
    SELECT u.name INTO NEW.actor_name FROM users u WHERE u.id = NEW.actor_id;
  END IF;

  -- ── INSERT only, and this is not a detail ──────────────────────────────────
  -- Stamping on UPDATE would be a data-corruption bug with an innocent trigger: marking an
  -- old row read is an UPDATE (`markManyRead`), and a row written before 0197 has no branch,
  -- so "fill it in" would hang the reader's current branch on someone else's history — the
  -- owner's own branch, quietly, on every old row they touched. Attribution is decided once,
  -- when the event is written, and never again.
  IF TG_OP = 'INSERT' THEN
    -- The record's own branch first, the actor's working branch second — the same order of
    -- preference the audit trigger uses (0189), and for the same reason: a consequential
    -- record knows where it happened, while "the branch that was selected when this was
    -- written" is a weaker answer used only when the record cannot say.
    --
    -- Only some kinds can say. A sale and a purchase carry their own `branch_id` in the row
    -- the notification names. A return notification names the SALE it came from (that is what
    -- `notifyReturnProcessed` passes), so it is asked the same question as a sale. Everything
    -- else — a payment against a customer, a low-stock crossing, a stock adjustment — names a
    -- party or a product, not a branch, and is attributed to the branch the actor worked in.
    IF NEW.branch_id IS NULL AND NEW.entity_id IS NOT NULL THEN
      IF v_kind IN ('sale', 'return') THEN
        SELECT s.branch_id INTO v_entity_branch FROM public.sales s
         WHERE s.id = NEW.entity_id AND s.shop_id = NEW.shop_id;
      ELSIF v_kind = 'purchase' THEN
        SELECT p.branch_id INTO v_entity_branch FROM public.purchases p
         WHERE p.id = NEW.entity_id AND p.shop_id = NEW.shop_id;
      END IF;
    END IF;

    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := COALESCE(v_entity_branch, public.current_branch_id());
    END IF;
  END IF;

  -- A branch belonging to another business is not an answer to "where did this happen": the
  -- row would name a branch it does not sit beside. Left unattributed rather than wrong, and
  -- the insert policy below refuses such a row outright for a non-owner.
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.shop_id
  ) THEN
    NEW.branch_id := NULL;
  END IF;

  -- Either spelling fills the other, in both directions.
  IF NEW.body IS NULL THEN NEW.body := NEW.message; END IF;
  IF NEW.message IS NULL THEN NEW.message := NEW.body; END IF;
  IF NEW.entity_type IS NULL THEN NEW.entity_type := NEW.kind; END IF;

  IF TG_OP = 'INSERT' THEN
    -- `read` is the app's column and carries the default; `is_read` follows it.
    NEW.is_read := COALESCE(NEW.read, NEW.is_read, false);
  ELSE
    -- On an update, whichever one the writer changed is the answer.
    IF NEW.read IS DISTINCT FROM OLD.read THEN NEW.is_read := NEW.read;
    ELSIF NEW.is_read IS DISTINCT FROM OLD.is_read THEN NEW.read := NEW.is_read;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_role_escalation(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.prevent_role_escalation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- SECURITY DEFINER functions (admin employee management) allowed
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  -- Look up caller's role
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  -- Only admin may change roles
  IF OLD.role IS DISTINCT FROM NEW.role AND v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'ROLE_PROTECTED: Only administrators can change user roles';
  END IF;
  -- Only admin may deactivate accounts
  IF OLD.is_active IS DISTINCT FROM NEW.is_active AND v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'ACCOUNT_PROTECTED: Only administrators can change account status';
  END IF;
  -- Employee may only modify their own record
  IF NEW.id != auth.uid() AND v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'USER_ISOLATION: Cannot modify another user''s account';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: preview_product_barcode(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.preview_product_barcode(p_name text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.mint_barcode(p_name, public.current_shop_id());
$$;


--
-- Name: process_return(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.process_return(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_return_number text;
  v_sale_id uuid;
  v_customer_id uuid;
  v_total numeric(14,4) := 0;
  v_item jsonb;
  v_shop_id uuid;
  v_sale_shop uuid;
  v_resolution text;
  v_reason text;
  v_processed_by uuid;
  v_idempotency_key text;
  v_sale_is_voided boolean;
  v_sale_created timestamptz;
  v_sale_item_id uuid;
  v_sale_item_sale_id uuid;
  v_original_qty numeric;
  v_sale_item_unit_price numeric;
  v_already_returned numeric;
  v_request_qty numeric;
  v_request_price numeric;
  v_stock_after numeric(14,4);
  v_stock_change numeric(14,4);
BEGIN
  PERFORM public.guard_operational_request('process_return',payload);
  v_sale_id := COALESCE(NULLIF(payload->>'saleId', '')::uuid, NULLIF(payload->>'sale_id', '')::uuid);
  v_customer_id := COALESCE(NULLIF(payload->>'customerId', '')::uuid, NULLIF(payload->>'customer_id', '')::uuid);
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := NULLIF(trim(COALESCE(payload->>'reason', '')), '');
  v_idempotency_key := NULLIF(COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey'), '');
  v_processed_by := COALESCE(
    app_current_user_id(),
    NULLIF(payload->>'processedBy', '')::uuid
  );

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = v_sale_id;
  PERFORM authorize_business_action('returns.create', COALESCE(v_sale_shop, current_shop_id()));

  IF v_sale_shop IS NULL THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: Sale does not exist in your organization';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.return_number, r.total_refund
      INTO v_id, v_return_number, v_total
    FROM returns r
    WHERE r.shop_id = v_sale_shop AND r.idempotency_key = v_idempotency_key
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      PERFORM public.guard_operational_request('process_return',payload);
 RETURN jsonb_build_object(
        'id', v_id, 'return_number', v_return_number,
        'total_refund', v_total, 'idempotent', true
      );
    END IF;
  END IF;

  v_total := 0; v_id := NULL; v_return_number := NULL;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT created_at, is_voided INTO v_sale_created, v_sale_is_voided FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: Sale does not exist in your organization';
  END IF;
  IF v_sale_is_voided THEN
    RAISE EXCEPTION 'SALE_VOIDED: Cannot return items from a voided sale';
  END IF;
  IF (now() - v_sale_created) > interval '30 days' THEN
    RAISE EXCEPTION 'RETURN_WINDOW_EXPIRED';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_sale_item_id := COALESCE(
      NULLIF(v_item->>'saleItemId', '')::uuid,
      NULLIF(v_item->>'sale_item_id', '')::uuid
    );
    v_request_qty := COALESCE(
      NULLIF(v_item->>'qty', '')::numeric,
      NULLIF(v_item->>'qty_to_return', '')::numeric
    );
    v_request_price := COALESCE(
      NULLIF(v_item->>'unitPrice', '')::numeric,
      NULLIF(v_item->>'unit_price', '')::numeric
    );

    SELECT si.sale_id, si.qty, si.unit_price
      INTO v_sale_item_sale_id, v_original_qty, v_sale_item_unit_price
    FROM sale_items si WHERE si.id = v_sale_item_id;

    IF v_sale_item_sale_id IS NULL THEN
      RAISE EXCEPTION 'SALE_ITEM_NOT_FOUND';
    END IF;
    IF v_sale_item_sale_id IS DISTINCT FROM v_sale_id THEN
      RAISE EXCEPTION 'ITEM_NOT_OWNED: That item belongs to a different sale';
    END IF;
    IF v_request_qty IS NULL OR v_request_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: Return quantity must be greater than zero';
    END IF;

    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_sale_item_id AND r.sale_id = v_sale_id;

    IF v_already_returned + v_request_qty > v_original_qty THEN
      RAISE EXCEPTION 'EXCESS_RETURN: Cannot return more than the sold quantity for this item';
    END IF;

    IF v_request_price IS NOT NULL AND v_request_price > v_sale_item_unit_price THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_SALE_PRICE: Refund cannot exceed the original sale price for this item';
    END IF;
  END LOOP;

  v_shop_id := v_sale_shop;
  v_return_number := 'RET-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  BEGIN
    INSERT INTO returns (
      id, return_number, sale_id, customer_id, customer_name,
      total_refund, resolution, reason, processed_by, processed_by_name,
      shop_id, idempotency_key, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_return_number, v_sale_id, v_customer_id,
      COALESCE(payload->>'customerName', 'Customer'),
      0, v_resolution, v_reason, v_processed_by,
      (SELECT name FROM users WHERE id = v_processed_by),
      v_shop_id, v_idempotency_key, now(), now()
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.return_number, r.total_refund
      INTO v_id, v_return_number, v_total
    FROM returns r
    WHERE r.shop_id = v_shop_id AND r.idempotency_key = v_idempotency_key
    LIMIT 1;
    PERFORM public.guard_operational_request('process_return',payload);
 RETURN jsonb_build_object(
      'id', v_id, 'return_number', v_return_number,
      'total_refund', v_total, 'idempotent', true
    );
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);

    INSERT INTO return_items (
      id, return_id, sale_item_id, product_id, product_name,
      variant_id, variant_name, qty_to_return, unit_price, refund_amount,
      created_at
    ) VALUES (
      gen_random_uuid(), v_id,
      NULLIF(v_item->>'saleItemId', '')::uuid,
      NULLIF(v_item->>'productId', '')::uuid,
      v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid,
      COALESCE(v_item->>'variantName', ''),
      (v_item->>'qty')::numeric,
      (v_item->>'unitPrice')::numeric,
      ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2),
      now()
    );

    IF COALESCE((v_item->>'restock')::boolean, false) THEN
      IF (v_item->>'variantId')::uuid IS NOT NULL THEN
        UPDATE product_variants SET stock_qty = stock_qty + (v_item->>'qty')::numeric
          WHERE id = (v_item->>'variantId')::uuid;
        -- Inside `IF restock` on purpose: a return that does NOT put the goods back must not
        -- claim stock came back. The ledger follows the stock, not the paperwork.
        SELECT stock_qty INTO v_stock_after FROM product_variants WHERE id = (v_item->>'variantId')::uuid;
        v_stock_change := (v_item->>'qty')::numeric;
        INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
          reference_type, reference_id, created_by)
        VALUES (NULLIF(v_item->>'productId','')::uuid, (v_item->>'variantId')::uuid, 'return',
          v_stock_after - v_stock_change, v_stock_change, v_stock_after, 'return', v_id, v_processed_by);
      END IF;
    END IF;
  END LOOP;

  UPDATE returns SET total_refund = v_total WHERE id = v_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET
      outstanding_balance = GREATEST(0, outstanding_balance - v_total),
      updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_processed_by, 'return_processed', 'return', v_id,
    jsonb_build_object('saleId', v_sale_id, 'totalRefund', v_total));

  PERFORM public.guard_operational_request('process_return',payload);
 RETURN jsonb_build_object(
    'id', v_id, 'return_number', v_return_number,
    'total_refund', v_total
  );
END;
$$;


--
-- Name: product_barcodes_for(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.product_barcodes_for(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop uuid;
  v_now  jsonb;
  v_past jsonb;
BEGIN
  SELECT shop_id INTO v_shop FROM public.products WHERE id = p_product_id;
  IF v_shop IS NULL OR v_shop IS DISTINCT FROM public.current_shop_id() THEN
    RETURN jsonb_build_object('current', '[]'::jsonb, 'history', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', b.code, 'isPrimary', b.is_primary, 'source', b.source, 'createdAt', b.created_at
         ) ORDER BY b.is_primary DESC, b.created_at), '[]'::jsonb)
    INTO v_now
    FROM public.product_barcodes b
   WHERE b.product_id = p_product_id;

  -- Only codes that are no longer on the product: the live one is the field above it, and
  -- listing it twice would read as two barcodes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', h.code, 'previousCode', h.previous_code, 'action', h.action,
           'source', h.source, 'changedAt', h.changed_at, 'reason', h.reason,
           'retired', COALESCE(r.status = 'retired', false)
         ) ORDER BY h.changed_at DESC), '[]'::jsonb)
    INTO v_past
    FROM public.barcode_history h
    LEFT JOIN public.barcode_registry r ON r.shop_id = h.shop_id AND r.code = h.code
   WHERE h.product_id = p_product_id
     AND NOT EXISTS (
       SELECT 1 FROM public.product_barcodes b
        WHERE b.product_id = h.product_id AND b.code = h.code
     );

  RETURN jsonb_build_object('current', v_now, 'history', v_past);
END;
$$;


--
-- Name: protect_customer_archive(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.protect_customer_archive() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- SECURITY DEFINER functions run as the owner and authorize the actor themselves.
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF OLD.is_archived IS DISTINCT FROM NEW.is_archived
     OR OLD.archived_at IS DISTINCT FROM NEW.archived_at
     OR OLD.archived_by IS DISTINCT FROM NEW.archived_by THEN
    IF NOT public.has_effective_permission('customers.delete') THEN
      RAISE EXCEPTION
        'DELETE_PERMISSION_REQUIRED: archiving or restoring a customer requires the customers.delete permission — use archive_customer / restore_customer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_customer_financials(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.protect_customer_financials() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- SECURITY DEFINER functions run as the owner (postgres) — allow them
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  -- Block direct updates to financial/derived fields
  IF OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance THEN
    RAISE EXCEPTION 'OUTSTANDING_PROTECTED: Customer outstanding balance can only be modified through sales, payments, or returns workflows';
  END IF;
  IF OLD.total_purchases IS DISTINCT FROM NEW.total_purchases THEN
    RAISE EXCEPTION 'PURCHASES_PROTECTED: Customer total purchases can only be modified through the sales workflow';
  END IF;
  IF OLD.total_paid IS DISTINCT FROM NEW.total_paid THEN
    RAISE EXCEPTION 'PAID_PROTECTED: Customer total paid can only be modified through the payment workflow';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_product_stock(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.protect_product_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF OLD.stock_qty IS DISTINCT FROM NEW.stock_qty THEN
    RAISE EXCEPTION 'STOCK_PROTECTED: Product stock can only be modified through sales, returns, or stock adjustment workflows';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_sale_financials(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.protect_sale_financials() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF OLD.total_amount IS DISTINCT FROM NEW.total_amount THEN
    RAISE EXCEPTION 'SALE_TOTAL_PROTECTED: Sale total can only be set during sale creation';
  END IF;
  IF OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance THEN
    RAISE EXCEPTION 'SALE_OUTSTANDING_PROTECTED: Sale outstanding can only be modified through the payment workflow';
  END IF;
  IF OLD.amount_paid IS DISTINCT FROM NEW.amount_paid THEN
    RAISE EXCEPTION 'SALE_PAID_PROTECTED: Sale amount paid can only be modified through the payment workflow';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: provision_member_login(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.provision_member_login(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_phone  text;
  v_e164   text;
  v_email  text;
  v_pass   text;
  v_name   text;
  v_stray  uuid;
BEGIN
  v_tenant := authorize_business_action('employees.manage');

  SELECT name, phone INTO v_name, v_phone
    FROM users
   WHERE id = p_user_id AND shop_id = v_tenant;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  v_e164 := public.canonical_phone(v_phone);
  IF v_e164 IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_PHONE_INVALID';
  END IF;
  v_email := 'user-' || v_e164 || '@agrishop.auth.local';
  v_pass  := 'AgriShop-' || v_e164 || '-2026!';

  -- An identity holding this address under another id is a stray: a login whose `sub`
  -- resolves to no app user, so it can satisfy no authorization anywhere, and whose
  -- presence is what made the INSERT below fail with `users_email_partial_key`. Every
  -- FK from the auth schema to auth.users cascades, so this one delete is complete.
  SELECT id INTO v_stray FROM auth.users WHERE email = v_email AND id <> p_user_id LIMIT 1;
  IF v_stray IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_stray;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    UPDATE auth.users
       SET email               = v_email,
           encrypted_password  = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           email_confirmed_at  = COALESCE(email_confirmed_at, now()),
           updated_at          = now()
     WHERE id = p_user_id;
    RETURN jsonb_build_object('provisioned', false, 'repaired', true,
                              'claimedFrom', v_stray, 'userId', p_user_id, 'name', v_name);
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', p_user_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_pass, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_user_id, p_user_id::text,
    jsonb_build_object('sub', p_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (app_current_user_id(), 'member_login_provisioned', 'user', p_user_id,
          jsonb_build_object('invited', true, 'claimedFrom', v_stray));

  RETURN jsonb_build_object('provisioned', true, 'repaired', false,
                            'claimedFrom', v_stray, 'userId', p_user_id, 'name', v_name);
END; $$;


--
-- Name: prune_client_error_events(integer); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.prune_client_error_events(p_keep_days integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_deleted integer;
  v_cutoff timestamptz;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'INVALID_RETENTION_WINDOW: keep at least 1 day';
  END IF;
  v_cutoff := now() - make_interval(days => p_keep_days);
  DELETE FROM public.client_error_events WHERE occurred_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


--
-- Name: purge_shop_data(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.purge_shop_data(p_shop_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM return_items ri USING returns r WHERE ri.return_id = r.id AND r.shop_id = p_shop_id;
  DELETE FROM voids v USING sales s WHERE v.sale_id = s.id AND s.shop_id = p_shop_id;
  DELETE FROM sale_items si USING sales s WHERE si.sale_id = s.id AND s.shop_id = p_shop_id;
  DELETE FROM returns WHERE shop_id = p_shop_id;
  DELETE FROM sales WHERE shop_id = p_shop_id;

  DELETE FROM purchase_items pi USING purchases p WHERE pi.purchase_id = p.id AND p.shop_id = p_shop_id;
  DELETE FROM supplier_payments WHERE company_id IN (SELECT id FROM companies WHERE shop_id = p_shop_id);
  DELETE FROM purchases WHERE shop_id = p_shop_id;

  DELETE FROM payments WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = p_shop_id);
  DELETE FROM customer_payments WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = p_shop_id);
  DELETE FROM credit_limit_requests WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = p_shop_id);

  DELETE FROM inventory_movements im USING products pr WHERE im.product_id = pr.id AND pr.shop_id = p_shop_id;
  DELETE FROM stock_adjustments WHERE shop_id = p_shop_id;
  DELETE FROM product_variants pv USING products pr WHERE pv.product_id = pr.id AND pr.shop_id = p_shop_id;

  DELETE FROM products  WHERE shop_id = p_shop_id;
  DELETE FROM notifications WHERE shop_id = p_shop_id;
  DELETE FROM customers WHERE shop_id = p_shop_id;
  DELETE FROM companies WHERE shop_id = p_shop_id;

  -- Cascades the shops row's own children and removes the tenant itself.
  DELETE FROM shops WHERE id = p_shop_id;
END;
$$;


--
-- Name: record_cash_reconciliation_v1(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.record_cash_reconciliation_v1(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_shop_id uuid := current_shop_id();
  v_date date := (payload->>'date')::date;
  v_expected numeric(14,2) := (payload->>'expectedCash')::numeric;
  v_counted numeric(14,2) := (payload->>'countedCash')::numeric;
  v_notes text := payload->>'notes';
  v_recon_id uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  INSERT INTO cash_reconciliations(shop_id,reconciliation_date,expected_cash,counted_cash,variance,notes,reconciled_by,reconciled_by_name)
  VALUES (v_shop_id,v_date,v_expected,v_counted,v_counted-v_expected,v_notes,v_actor_id,v_actor_name)
  ON CONFLICT(shop_id,reconciliation_date) DO UPDATE SET expected_cash=EXCLUDED.expected_cash,counted_cash=EXCLUDED.counted_cash,variance=EXCLUDED.variance,notes=EXCLUDED.notes,reconciled_by=EXCLUDED.reconciled_by,reconciled_by_name=EXCLUDED.reconciled_by_name
  RETURNING id INTO v_recon_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'cash_reconciled','cash_reconciliation',v_recon_id,jsonb_build_object('date',v_date,'variance',v_counted-v_expected));
  RETURN jsonb_build_object('id',v_recon_id,'variance',v_counted-v_expected);
END; $$;


--
-- Name: record_customer_payment(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.record_customer_payment(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_balance numeric(14,4);
  v_actor uuid;
  v_auth_user_id uuid;
BEGIN
  PERFORM public.guard_operational_request('record_customer_payment',payload);
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;
  v_actor := v_auth_user_id;

  v_id := gen_random_uuid();
  INSERT INTO customer_payments (id, customer_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'customerId')::uuid, (payload->>'amount')::numeric,
    COALESCE((payload->>'method'),'cash')::payment_method, payload->>'notes', now());
  UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - (payload->>'amount')::numeric),
    total_paid = total_paid + (payload->>'amount')::numeric, updated_at = now()
  WHERE id = (payload->>'customerId')::uuid RETURNING outstanding_balance INTO v_balance;
  PERFORM public.guard_operational_request('record_customer_payment',payload);
 RETURN jsonb_build_object('id', v_id, 'balanceAfter', COALESCE(v_balance,0));
END;
$$;


--
-- Name: record_incident(text, text, text, text, text, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.record_incident(p_type text, p_severity text, p_source text, p_component text, p_message text, p_context jsonb DEFAULT '{}'::jsonb, p_stack_trace text DEFAULT NULL::text, p_user_action text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_sanitized_message text;
  v_sanitized_context jsonb;
  v_sanitized_stack text;
  v_fingerprint text;
  v_message_template text;
  v_signature_id uuid;
  v_actor text;
  v_environment text;
  v_db_name text;
BEGIN
  -- 1. Validate inputs
  IF p_type NOT IN ('error', 'broken_workflow', 'sync_failure', 'auth_failure', 'performance', 'regression', 'agent_loop') THEN
    RAISE EXCEPTION 'Invalid incident type: %', p_type;
  END IF;
  IF p_severity NOT IN ('critical', 'high', 'medium', 'low') THEN
    RAISE EXCEPTION 'Invalid severity: %', p_severity;
  END IF;
  IF p_source NOT IN ('client', 'server', 'test', 'ci', 'agent') THEN
    RAISE EXCEPTION 'Invalid source: %', p_source;
  END IF;
  IF p_component NOT IN ('auth', 'sales', 'inventory', 'customers', 'payments', 'returns', 'signals', 'images', 'ui', 'infrastructure') THEN
    RAISE EXCEPTION 'Invalid component: %', p_component;
  END IF;

  -- 2. Server-side sanitization
  v_sanitized_message := sanitize_text(p_message);
  v_sanitized_context := sanitize_context(p_context);
  v_sanitized_stack := sanitize_stack_trace(p_stack_trace);

  -- 3. Rate limit check
  BEGIN
    v_actor := COALESCE(
      current_setting('request.jwt.claims', true)::json->>'sub',
      'anon'
    );
  EXCEPTION WHEN OTHERS THEN
    v_actor := 'anon';
  END;

  IF NOT check_rate_limit(v_actor, p_component) THEN
    RETURN NULL;
  END IF;

  -- 4. Determine environment from DATABASE NAME (not client input)
  v_db_name := current_database();
  
  IF v_db_name LIKE '%production%' OR v_db_name LIKE '%prod%' THEN
    v_environment := 'production';
  ELSIF v_db_name LIKE '%ci%' OR v_db_name LIKE '%test%' THEN
    v_environment := 'ci';
  ELSE
    v_environment := 'qa';
  END IF;

  -- 5. Compute fingerprint and message template (POSIX compatible)
  v_message_template := v_sanitized_message;
  v_message_template := regexp_replace(v_message_template, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '{UUID}', 'gi');
  v_message_template := regexp_replace(v_message_template, '[[:<:]][0-9]{4,}[[:>:]]', '{NUM}', 'g');

  v_fingerprint := compute_incident_fingerprint(p_type, p_component, p_source, v_message_template);

  -- 6. Get or create signature
  INSERT INTO public.incident_signatures (fingerprint, type, component, source, message_template, environment)
  VALUES (v_fingerprint, p_type, p_component, p_source, left(v_message_template, 500), v_environment)
  ON CONFLICT (fingerprint) DO UPDATE SET
    occurrence_count = public.incident_signatures.occurrence_count + 1,
    last_seen_at = now(),
    updated_at = now()
  RETURNING id INTO v_signature_id;

  -- 7. Insert incident
  INSERT INTO public.incidents (
    signature_id, status, severity, message, context, stack_trace,
    environment, user_action
  ) VALUES (
    v_signature_id, 'detected', p_severity, v_sanitized_message, v_sanitized_context, v_sanitized_stack,
    v_environment, left(COALESCE(p_user_action, ''), 500)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: record_supplier_payment(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.record_supplier_payment(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_payable numeric(12,2);
  v_actor uuid;
  v_caller_role text;
BEGIN
  PERFORM public.guard_operational_request('record_supplier_payment',payload);
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can make supplier payments';
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO supplier_payments (id, company_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'companyId')::uuid, (payload->>'amount')::numeric,
    COALESCE((payload->>'method'),'cash')::payment_method, payload->>'notes', now());
  UPDATE companies SET outstanding_payable = GREATEST(0, outstanding_payable - (payload->>'amount')::numeric),
    updated_at = now()
  WHERE id = (payload->>'companyId')::uuid RETURNING outstanding_payable INTO v_payable;
  PERFORM public.guard_operational_request('record_supplier_payment',payload);
 RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable,0));
END;
$$;


--
-- Name: reject_credit_limit_request(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.reject_credit_limit_request(p_request_id uuid, p_reviewed_by text, p_rejection_reason text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';

  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(), rejection_reason = p_rejection_reason
  WHERE id = p_request_id;

  RETURN jsonb_build_object('status', 'rejected');
END;
$$;


--
-- Name: reject_credit_limit_request_v2(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.reject_credit_limit_request_v2(p_request_id uuid, p_reviewed_by text, p_reason text, p_actor_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  req RECORD;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests SET status = 'rejected', reviewed_by = COALESCE(p_reviewed_by, v_actor::text), reviewed_at = now(), rejection_reason = p_reason WHERE id = p_request_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_rejected', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'reason', p_reason));

  RETURN jsonb_build_object('status', 'rejected');
END;
$$;


--
-- Name: rename_branch(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.rename_branch(p_shop_id uuid, p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_branch public.branches;
  v_name text := trim(COALESCE(p_name,''));
BEGIN
  SELECT * INTO v_branch FROM public.branches WHERE id = p_shop_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.shops WHERE id = v_branch.tenant_id FOR UPDATE;
  PERFORM public.authorize_business_action('settings.edit',v_branch.tenant_id,v_branch.id);
  IF v_name = '' THEN RAISE EXCEPTION 'VALIDATION: a branch name is required'; END IF;
  IF length(v_name) > 120 THEN RAISE EXCEPTION 'VALIDATION: branch names are limited to 120 characters'; END IF;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_shop_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = v_branch.tenant_id AND is_active
     AND id <> v_branch.id AND lower(trim(name)) = lower(v_name)) THEN RAISE EXCEPTION 'BRANCH_NAME_TAKEN'; END IF;
  IF v_branch.name = v_name THEN RETURN jsonb_build_object('success',true,'name',v_name,'idempotent',true); END IF;
  UPDATE public.branches SET name = v_name WHERE id = v_branch.id;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_renamed','branch',v_branch.id,v_branch.id,
    jsonb_build_object('before',jsonb_build_object('name',v_branch.name),'after',jsonb_build_object('name',v_name)));
  RETURN jsonb_build_object('success',true,'branch_id',v_branch.id,'name',v_name);
END;
$$;


--
-- Name: resolve_active_shop(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.resolve_active_shop(p_user_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    -- The user's own selection — honoured only if the membership is still active.
    (SELECT uas.shop_id
       FROM user_active_shops uas
       JOIN memberships m
         ON m.user_id = uas.user_id
        AND m.tenant_id = uas.shop_id
        AND m.status = 'active'
      WHERE uas.user_id = p_user_id),
    -- No usable selection: the behaviour every caller had before multi-shop existed.
    (SELECT m.tenant_id
       FROM memberships m
      WHERE m.user_id = p_user_id AND m.status = 'active'
      ORDER BY m.created_at ASC
      LIMIT 1),
    -- Legacy: accounts that predate memberships.
    (SELECT u.shop_id FROM users u WHERE u.id = p_user_id)
  );
$$;


--
-- Name: resolve_invite(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.resolve_invite(p_shop_id uuid, p_phone text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop_name text;
  v_e164      text := public.canonical_phone(p_phone);
  v_user      uuid;
  v_status    text;
BEGIN
  IF p_shop_id IS NULL OR v_e164 IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT name INTO v_shop_name FROM shops WHERE id = p_shop_id;
  IF v_shop_name IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT u.id, m.status::text INTO v_user, v_status
    FROM memberships m
    JOIN users u ON u.id = m.user_id
   WHERE m.tenant_id = p_shop_id
     AND public.canonical_phone(u.phone) = v_e164
   ORDER BY m.created_at ASC
   LIMIT 1;

  RETURN jsonb_build_object(
    'found', true,
    'shopId', p_shop_id,
    'shopName', v_shop_name,
    'invited', v_user IS NOT NULL,
    'status', v_status
  );
END; $$;


--
-- Name: resolve_product_barcode(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.resolve_product_barcode(p_code text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_shop uuid := current_shop_id();
  v_row  record;
BEGIN
  IF v_code = '' OR v_shop IS NULL THEN RETURN NULL; END IF;

  SELECT b.product_id, b.variant_id, b.code
    INTO v_row
    FROM product_barcodes b
    JOIN products p ON p.id = b.product_id AND p.is_active
   WHERE b.shop_id = v_shop AND b.code = v_code
   LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'productId', v_row.product_id,
    'variantId', v_row.variant_id,
    'code',      v_row.code
  );
END;
$$;


--
-- Name: resolve_shop_and_actor(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.resolve_shop_and_actor(p_shop_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_shop_id uuid;
  v_actor_id uuid;
BEGIN
  -- Try JWT first
  v_user_id := NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;

  -- If no JWT, use provided user_id
  IF v_user_id IS NULL THEN
    v_user_id := p_user_id;
  END IF;

  -- Resolve tenant
  v_shop_id := COALESCE(
    current_shop_id(),
    resolve_tenant_for_user(v_user_id),
    p_shop_id
  );

  -- Resolve actor
  v_actor_id := COALESCE(
    v_user_id,
    p_created_by,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  RETURN jsonb_build_object(
    'shop_id', v_shop_id,
    'actor_id', v_actor_id
  );
END;
$$;


--
-- Name: resolve_shop_code(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.resolve_shop_code(p_code text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_shop record;
BEGIN
  IF length(v_norm) <> 6 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT s.id, s.name INTO v_shop FROM shops s WHERE upper(s.join_code) = v_norm;
  IF v_shop.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true, 'shopId', v_shop.id, 'shopName', v_shop.name);
END; $$;


--
-- Name: resolve_tenant_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.resolve_tenant_for_user(p_user_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT public.resolve_active_shop(p_user_id); $$;


--
-- Name: restore_customer(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.restore_customer(p_customer_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE customers
  SET is_archived = false, archived_at = NULL, archived_by = NULL
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('id', p_customer_id, 'restored', true);
END;
$$;


--
-- Name: return_items_mirror_qty(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.return_items_mirror_qty() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    begin
      new.qty := coalesce(new.qty_to_return, new.qty, 0);
      return new;
    end
    $$;


--
-- Name: revoke_branch_responsibility(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.revoke_branch_responsibility(p_branch_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: sanitize_context(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.sanitize_context(input jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  key text;
  val jsonb;
  allowed_keys text[] := ARRAY[
    'entity_type', 'entity_id', 'operation', 'screen',
    'error_code', 'test_name', 'test_file', 'component',
    'action_type', 'duration_ms', 'status_code', 'retry_count', 'correlation_id'
  ];
BEGIN
  IF input IS NULL OR input = 'null'::jsonb THEN RETURN '{}'::jsonb; END IF;

  FOR key, val IN SELECT * FROM jsonb_each(input)
  LOOP
    IF key = ANY(allowed_keys) THEN
      IF jsonb_typeof(val) = 'string' THEN
        result := result || jsonb_build_object(key, sanitize_text(val #>> '{}'));
      ELSE
        result := result || jsonb_build_object(key, val);
      END IF;
    END IF;
  END LOOP;

  IF pg_column_size(result) > 10000 THEN
    result := '{"truncated": true}'::jsonb;
  END IF;

  RETURN result;
END;
$$;


--
-- Name: sanitize_stack_trace(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.sanitize_stack_trace(input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;

  input := sanitize_text(input);

  -- Remove Unix file system paths: /home/<username>/
  input := regexp_replace(input, '/home/[^\s/]+', '/home/[USER]', 'g');

  -- Remove Windows paths with double backslash (from JS serialization): C:\\Users\\<name>
  -- In $$ string: \\\\ = regex matches two literal backslashes
  input := regexp_replace(input, 'C:\\\\Users\\\\[^\s\\\\]+', 'C:\\\\Users\\\\[USER]', 'g');

  -- Remove Windows paths with single backslash (from raw SQL): C:\Users\<name>
  input := regexp_replace(input, 'C:\\Users\\[^\s\\]+', 'C:\\Users\\[USER]', 'g');

  IF length(input) > 2000 THEN
    input := left(input, 2000) || '...[truncated]';
  END IF;

  RETURN input;
END;
$_$;


--
-- Name: sanitize_text(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.sanitize_text(input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;

  -- Remove phone numbers (Pakistani format)
  input := regexp_replace(input, '(\+?92|0)3[0-9]{2}[-\s]?[0-9]{3}[-\s]?[0-9]{4}', '[REDACTED_PHONE]', 'g');

  -- Remove email addresses
  input := regexp_replace(input, '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', '[REDACTED_EMAIL]', 'g');

  -- Remove JWT-like tokens (eyJ...)
  input := regexp_replace(input, 'eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}', '[REDACTED_TOKEN]', 'g');

  -- Remove base64-looking secrets (long strings that might be keys)
  input := regexp_replace(input, '[A-Za-z0-9+/]{40,}={0,2}', '[REDACTED_SECRET]', 'g');

  -- Truncate to 2000 chars
  IF length(input) > 2000 THEN
    input := left(input, 2000) || '...[truncated]';
  END IF;

  RETURN input;
END;
$$;


--
-- Name: search_marketplace(double precision, double precision, numeric, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.search_marketplace(p_latitude double precision, p_longitude double precision, p_radius_km numeric DEFAULT 25, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(listing_id uuid, branch_id uuid, branch_name text, branch_address text, branch_latitude numeric, branch_longitude numeric, branch_location_label text, product_id uuid, product_name text, category text, image_url text, variant_id uuid, variant_label text, unit_size numeric, qty_step numeric, base_unit text, selling_price numeric, availability text, listed_at timestamp with time zone, updated_at timestamp with time zone, distance_km numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_radius   numeric;
  v_limit    int;
  v_offset   int;
  v_query    text;
  v_category text;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < 23.0 OR p_latitude > 37.5
     OR p_longitude < 60.0 OR p_longitude > 78.0 THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;

  v_radius := LEAST(GREATEST(COALESCE(p_radius_km, 25), 1), 200);
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_query  := NULLIF(trim(COALESCE(p_query, '')), '');

  v_category := NULLIF(trim(COALESCE(p_category, '')), '');
  IF v_category IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'product_category' AND e.enumlabel = v_category
  ) THEN
    RAISE EXCEPTION 'VALIDATION: unknown category "%"', v_category;
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      l.listing_id, l.branch_id, l.branch_name, l.branch_address, l.branch_latitude,
      l.branch_longitude, l.branch_location_label, l.product_id, l.product_name, l.category,
      l.image_url, l.variant_id, l.variant_label, l.unit_size, l.qty_step, l.base_unit,
      l.selling_price, l.availability, l.listed_at, l.updated_at,
      public.marketplace_distance_km(
        p_latitude, p_longitude,
        l.branch_latitude::double precision, l.branch_longitude::double precision
      ) AS d
    FROM public.marketplace_listings l
    WHERE
      -- The distance the farmer asked for, and nothing else. There is no owner-set coverage to
      -- combine with it any more: a listed branch with a location is reachable from anywhere
      -- inside the searcher's own radius.
      public.marketplace_distance_km(
        p_latitude, p_longitude,
        l.branch_latitude::double precision, l.branch_longitude::double precision
      ) <= v_radius
      AND (v_query IS NULL OR l.product_name ILIKE '%' || v_query || '%')
      AND (v_category IS NULL OR l.category = v_category)
  )
  SELECT
    e.listing_id, e.branch_id, e.branch_name, e.branch_address, e.branch_latitude,
    e.branch_longitude, e.branch_location_label, e.product_id, e.product_name, e.category,
    e.image_url, e.variant_id, e.variant_label, e.unit_size, e.qty_step, e.base_unit,
    e.selling_price, e.availability, e.listed_at, e.updated_at,
    round(e.d::numeric, 2) AS distance_km
  FROM eligible e
  -- Nearest first, which is the stated priority when the same product is available from several
  -- eligible branches. Price then name break ties deterministically.
  ORDER BY e.d ASC, e.selling_price ASC, e.product_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;


--
-- Name: set_active_branch(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_active_branch(p_branch_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_branch public.branches;
  v_member public.memberships;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  SELECT * INTO v_member FROM public.memberships
   WHERE user_id = v_actor AND tenant_id = v_branch.tenant_id AND status = 'active';
  IF NOT FOUND OR (v_member.role <> 'owner' AND
     NOT (p_branch_id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;
  INSERT INTO public.user_active_shops(user_id, shop_id, branch_id, updated_at)
  VALUES (v_actor, v_branch.tenant_id, p_branch_id, now())
  ON CONFLICT(user_id) DO UPDATE
    SET shop_id = EXCLUDED.shop_id, branch_id = EXCLUDED.branch_id, updated_at = now();
  RETURN jsonb_build_object('success', true, 'tenant_id', v_branch.tenant_id,
    'branch_id', v_branch.id, 'branch_name', v_branch.name,
    'membership_role', v_member.role, 'membership_id', v_member.id);
END;
$$;


--
-- Name: set_active_shop(uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_active_shop(p_shop_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_role membership_role;
  v_membership uuid;
  v_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_shop_id IS NULL THEN RAISE EXCEPTION 'VALIDATION: a shop id is required'; END IF;

  -- The membership is the permission. Nothing about the caller's current context can widen it.
  SELECT m.role, m.id INTO v_role, v_membership
  FROM memberships m
  WHERE m.user_id = v_actor
    AND m.tenant_id = p_shop_id
    AND m.status = 'active';

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of shop %', p_shop_id;
  END IF;

  INSERT INTO user_active_shops (user_id, shop_id, updated_at)
  VALUES (v_actor, p_shop_id, now())
  ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, updated_at = now();

  SELECT s.name INTO v_name FROM shops s WHERE s.id = p_shop_id;

  RETURN jsonb_build_object(
    'success', true,
    'active_shop_id', p_shop_id,
    'shop_name', v_name,
    'membership_role', v_role,
    'membership_id', v_membership
  );
END;
$$;


--
-- Name: set_customer_credit_limit(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_customer_credit_limit(p_customer_id uuid, p_credit_limit numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop uuid;
  v_before numeric;
BEGIN
  IF p_credit_limit IS NULL OR p_credit_limit < 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_LIMIT';
  END IF;

  SELECT shop_id, credit_limit INTO v_shop, v_before FROM customers WHERE id = p_customer_id;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  PERFORM authorize_business_action('customers.edit', v_shop);

  UPDATE customers
     SET credit_limit = p_credit_limit,
         updated_at = now()
   WHERE id = p_customer_id;

  -- Same shape as the rest of the trail (0011/0012): who did it, to which record, and both
  -- values, so a limit that moves later can be explained.
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (
    app_current_user_id(),
    'customer_credit_limit_set',
    'customer',
    p_customer_id,
    jsonb_build_object('from', v_before, 'to', p_credit_limit)
  );

  RETURN p_credit_limit;
END;
$$;


--
-- Name: set_marketplace_settings(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_marketplace_settings(p_shop_id uuid, p_enabled boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_role   membership_role;
  v_before record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or an admin can manage marketplace listing';
  END IF;

  SELECT m.role INTO v_role
    FROM memberships m
   WHERE m.user_id = v_actor AND m.tenant_id = p_shop_id AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this branch';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin can manage marketplace listing';
  END IF;

  SELECT s.marketplace_enabled, s.latitude, s.longitude
    INTO v_before
    FROM shops s
   WHERE s.id = p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  -- Turning the switch on for a branch with no pin is refused rather than accepted-and-ignored,
  -- and this check matters more now, not less: with no owner-set distance, the pin is the ONLY
  -- thing the owner contributes to being findable. A listed branch that was never located could
  -- never be measured against any search, so the switch would claim something untrue.
  IF p_enabled AND (v_before.latitude IS NULL OR v_before.longitude IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION: this branch has no location, so it cannot serve the marketplace';
  END IF;

  UPDATE shops
     SET marketplace_enabled = p_enabled
   WHERE id = p_shop_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'marketplace_settings_changed', 'shop', p_shop_id,
          jsonb_build_object(
            'enabled', p_enabled,
            'was_enabled', v_before.marketplace_enabled
          ));

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'marketplace_enabled', p_enabled
  );
END;
$$;


--
-- Name: set_place(text, uuid, double precision, double precision, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_place(p_table text, p_id uuid, p_latitude double precision, p_longitude double precision, p_label text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_source text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_table text := lower(trim(COALESCE(p_table,'')));
  v_tenant uuid;
  v_before jsonb;
  v_updated int;
  v_clearing boolean := p_latitude IS NULL AND p_longitude IS NULL;
BEGIN
  IF v_table NOT IN ('customers','branches','shops') THEN RAISE EXCEPTION 'VALIDATION: invalid location target'; END IF;
  IF NOT v_clearing AND (p_latitude IS NULL OR p_longitude IS NULL OR
    NOT (p_latitude BETWEEN 23.0 AND 37.5 AND p_longitude BETWEEN 60.0 AND 78.0)) THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;
  IF v_table = 'branches' THEN
    SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_id AND is_active;
    PERFORM 1 FROM public.shops WHERE id = v_tenant FOR UPDATE;
    PERFORM public.authorize_business_action('settings.edit',v_tenant,p_id);
  ELSIF v_table = 'shops' THEN
    v_tenant := public.authorize_business_action('settings.edit',p_id);
  ELSE
    v_tenant := public.authorize_business_action('customers.edit');
  END IF;
  EXECUTE format('SELECT jsonb_build_object(''latitude'',latitude,''longitude'',longitude,''address'',address) FROM public.%I WHERE id=$1 AND %I=$2 FOR UPDATE',
    v_table,CASE WHEN v_table='branches' THEN 'tenant_id' WHEN v_table='shops' THEN 'id' ELSE 'shop_id' END)
    INTO v_before USING p_id,v_tenant;
  IF v_before IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: nothing of yours matches that row'; END IF;
  EXECUTE format('UPDATE public.%I SET latitude=$1,longitude=$2,location_label=NULLIF($3,''''),
    address=COALESCE(NULLIF($4,''''),address),location_source=NULLIF($5,'''') WHERE id=$6',v_table)
    USING p_latitude,p_longitude,p_label,p_address,p_source,p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RAISE EXCEPTION 'NOT_FOUND: nothing of yours matches that row'; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'location_updated',CASE WHEN v_table='branches' THEN 'branch' WHEN v_table='shops' THEN 'shop' ELSE 'customer' END,p_id,
    CASE WHEN v_table='branches' THEN p_id ELSE public.current_branch_id() END,
    jsonb_build_object('before',v_before,'after',jsonb_build_object('latitude',p_latitude,'longitude',p_longitude,'address',p_address),'cleared',v_clearing));
  RETURN jsonb_build_object('ok',true,'table',v_table,'id',p_id,'cleared',v_clearing);
END;
$_$;


--
-- Name: set_product_barcode(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_product_barcode(p_product_id uuid, p_code text, p_source text DEFAULT 'supplied'::text, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_shop  uuid;
  v_code  text := public.barcode_normalize(p_code);
  v_row   uuid;
BEGIN
  SELECT shop_id INTO v_shop FROM public.products WHERE id = p_product_id;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

  PERFORM public.authorize_business_action('products.edit', v_shop);
  IF v_code = '' THEN RAISE EXCEPTION 'BARCODE_EMPTY: a barcode cannot be blank'; END IF;

  -- The delete/replace reason travels to the triggers through the transaction, so the trail
  -- can say why a code was retired without every trigger needing a parameter.
  PERFORM set_config('app.barcode_reason', coalesce(p_reason, ''), true);

  SELECT id INTO v_row FROM public.product_barcodes
   WHERE product_id = p_product_id AND is_primary LIMIT 1;

  IF v_row IS NOT NULL THEN
    UPDATE public.product_barcodes SET code = v_code, source = COALESCE(p_source, 'supplied')
     WHERE id = v_row;
  ELSE
    INSERT INTO public.product_barcodes (shop_id, product_id, code, is_primary, source, created_by)
    VALUES (v_shop, p_product_id, v_code, true, COALESCE(p_source, 'supplied'), v_actor);
  END IF;

  PERFORM set_config('app.barcode_reason', '', true);
  RETURN jsonb_build_object('productId', p_product_id, 'code', v_code);
END;
$$;


--
-- Name: set_stock_alert_settings(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_stock_alert_settings(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_resolved jsonb;
  v_shop uuid;
  v_actor uuid;
  v_threshold int;
  v_frequency text;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId','')::uuid,
    NULLIF(payload->>'userId','')::uuid,
    NULLIF(payload->>'actorId','')::uuid
  );
  v_shop := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_SHOP_CONTEXT';
  END IF;

  -- Changing when the whole shop is alerted is a stock decision, so it carries the same
  -- permission as editing the catalogue. An employee cannot move the shop's alert line.
  PERFORM authorize_business_action('products.edit', v_shop, NULL);

  v_threshold := GREATEST(COALESCE((payload->>'threshold')::int, 10), 0);

  v_frequency := COALESCE(NULLIF(payload->>'frequency',''), 'on_cross');
  IF v_frequency NOT IN ('on_cross', 'daily', 'every_3_days') THEN
    RAISE EXCEPTION 'BAD_FREQUENCY: %', v_frequency;
  END IF;

  INSERT INTO app_settings(shop_id, setting_key, setting_value, description)
  VALUES (v_shop, 'low_stock_threshold_default', v_threshold::text,
          'Default low stock alert threshold')
  ON CONFLICT (shop_id, setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

  INSERT INTO app_settings(shop_id, setting_key, setting_value, description)
  VALUES (v_shop, 'stock_alert_frequency', v_frequency,
          'How often a product that stays low is alerted on')
  ON CONFLICT (shop_id, setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_alert_settings_updated', 'shop', v_shop,
          jsonb_build_object('threshold', v_threshold, 'frequency', v_frequency));

  RETURN jsonb_build_object('threshold', v_threshold, 'frequency', v_frequency);
END;
$$;


--
-- Name: set_user_pin(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.set_user_pin(p_pin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_uid uuid := app_current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  -- The rule is 4–6 digits. Anything else is refused here rather than trusted
  -- from the client, so a weak PIN cannot be written by a crafted request.
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  UPDATE users
     SET pin_hash         = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_failed_count = 0,
         pin_locked_until = NULL,
         updated_at       = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object('status', 'ok');
END $_$;


--
-- Name: stamp_operational_branch(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.stamp_operational_branch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    declare
      v_branch uuid;
      v_shop uuid;
    begin
      if new.branch_id is not null then
        return new;
      end if;

      v_branch := public.current_branch_id();
      if v_branch is null then
        return new;
      end if;

      -- `to_jsonb(new)` rather than `new.shop_id`: the same function serves tables that carry a
      -- shop of their own and tables that reach it through a parent record.
      v_shop := nullif(to_jsonb(new) ->> 'shop_id', '')::uuid;
      if v_shop is not null then
        if not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_shop) then
          return new;
        end if;
      end if;

      new.branch_id := v_branch;
      return new;
    end
    $$;


--
-- Name: transfer_branch_responsibility(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.transfer_branch_responsibility(p_branch_id uuid, p_to_user_id uuid, p_role_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: update_customer_due_date(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_customer_due_date(p_customer_id uuid, p_due_date text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE customers SET due_date = NULLIF(p_due_date, '')::date, updated_at = now() WHERE id = p_customer_id;
END;
$$;


--
-- Name: update_customer_image(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_customer_image(p_customer_id uuid, p_image_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE customers SET image_url = p_image_url, updated_at = now() WHERE id = p_customer_id;
END;
$$;


--
-- Name: update_employee_access(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_employee_access(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_emp uuid := (payload->>'employeeId')::uuid; v_role_id uuid; v_code text; v_grant boolean; v_perm uuid; v_scope uuid[];
BEGIN
  PERFORM public.guard_employee_access_edit(payload);
  v_tenant := authorize_business_action('employees.manage');
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=v_emp AND shop_id=v_tenant AND NOT is_original_owner) THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  -- CHANGED (was: IF payload ? 'membershipRole' THEN v_role := (payload->>'membershipRole')::membership_role; END IF;)
  -- An employee's membership role is not an access setting: owner access comes
  -- from users.is_original_owner and is bypassed by every permission check.
  IF COALESCE(payload->>'membershipRole','') NOT IN ('', 'employee') THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF payload ? 'roleId' AND NULLIF(payload->>'roleId','') IS NOT NULL THEN
    SELECT id INTO v_role_id FROM roles WHERE id=(payload->>'roleId')::uuid AND tenant_id=v_tenant;
    IF v_role_id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  END IF;
  UPDATE memberships SET role_id=COALESCE(v_role_id,role_id), updated_at=now()
    WHERE user_id=v_emp AND tenant_id=v_tenant;
  -- CHANGED (removed: IF v_role IS NOT NULL THEN UPDATE users SET role=... 'admin' ...)
  IF payload ? 'branchScope' THEN
    IF payload->'branchScope' IS NULL OR payload->'branchScope'='null'::jsonb THEN v_scope:=NULL;
    ELSE SELECT array_agg(x::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope') x;
    END IF;
    IF v_scope IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
    UPDATE memberships SET branch_scope=v_scope,updated_at=now() WHERE user_id=v_emp AND tenant_id=v_tenant;
  END IF;
  IF payload->>'resetOverrides'='true' THEN DELETE FROM user_permissions WHERE user_id=v_emp;
  ELSIF payload ? 'overrides' THEN
    DELETE FROM user_permissions WHERE user_id=v_emp AND is_override=true;
    FOR v_code,v_grant IN SELECT key,(value)::boolean FROM jsonb_each_text(payload->'overrides') LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO user_permissions(user_id,permission_id,granted_by,is_override,is_granted) VALUES(v_emp,v_perm,v_actor,true,v_grant); END IF;
    END LOOP;
  ELSIF payload ? 'permissions' THEN
    -- Legacy callers are treated as explicit grants, never role defaults.
    DELETE FROM user_permissions WHERE user_id=v_emp AND is_override=true;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO user_permissions(user_id,permission_id,granted_by,is_override,is_granted) VALUES(v_emp,v_perm,v_actor,true,true); END IF;
    END LOOP;
  END IF;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_access_updated','user',v_emp,payload);
  RETURN jsonb_build_object('id',v_emp,'updated',true);
END; $$;


--
-- Name: update_memberships_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_memberships_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_product(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_product(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_product_id uuid := (payload->>'id')::uuid;
  v_actor uuid;
  v_company_id uuid;
  v_shop uuid;
  v_item jsonb;
  v_variant_id uuid;
  v_unit text;
  v_existing_unit text;
  v_code text;
  v_stock numeric;
  v_cost numeric;
BEGIN
  v_actor := app_current_user_id();

  SELECT shop_id, lower(base_unit) INTO v_shop, v_existing_unit FROM products WHERE id = v_product_id;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;
  PERFORM authorize_business_action('products.edit', v_shop);

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies
     WHERE id = (payload->>'companyId')::uuid AND shop_id = v_shop LIMIT 1;
  ELSIF NULLIF(payload->>'company','') IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies
     WHERE name = payload->>'company' AND shop_id = v_shop LIMIT 1;
  END IF;

  -- A new product is weighed or measured. An existing one that predates that rule may keep
  -- the unit it already has, so opening a legacy product for editing cannot silently
  -- re-denominate it — but no edit may move a product INTO an unusable unit.
  v_unit := lower(NULLIF(payload->>'baseUnit',''));
  IF v_unit IS NOT NULL AND v_unit NOT IN ('kg','liter') AND v_unit IS DISTINCT FROM v_existing_unit THEN
    RAISE EXCEPTION 'INVALID_UNIT: a product is measured in kg or liter, not "%"', v_unit;
  END IF;

  UPDATE products SET
    name = COALESCE(NULLIF(payload->>'name',''), name),
    company_id = COALESCE(v_company_id, company_id),
    category = COALESCE((NULLIF(payload->>'category',''))::product_category, category),
    base_unit = COALESCE(v_unit, base_unit),
    image_url = COALESCE(NULLIF(payload->>'imageUrl',''), image_url),
    -- The listing switch, with the three cases the barcode below also distinguishes: absent
    -- leaves it alone; present-true lists it; present-false unlists it. The timestamp is
    -- stamped on the false→true flip only and preserved while the product stays listed, so
    -- "listed since" means something rather than "whenever it was last saved".
    marketplace_listed = CASE
      WHEN payload ? 'marketplaceListed' THEN COALESCE((payload->>'marketplaceListed')::boolean, false)
      ELSE marketplace_listed END,
    marketplace_listed_at = CASE
      WHEN payload ? 'marketplaceListed' THEN
        CASE WHEN COALESCE((payload->>'marketplaceListed')::boolean, false)
             THEN COALESCE(products.marketplace_listed_at, now())
             ELSE NULL END
      ELSE marketplace_listed_at END,
    updated_at = now()
  WHERE id = v_product_id;

  -- The code itself lives in product_barcodes; the mirror trigger updates products.barcode.
  --
  -- Three cases, and the difference between them is what the payload says, not what it happens
  -- to contain: absent leaves the code alone; present and empty removes it; present with a code
  -- sets it. A removal travels to the delete trigger as a reason, so the history says why the
  -- code was retired rather than leaving a bare 'deleted'.
  IF payload ? 'barcode' THEN
    v_code := public.barcode_normalize(payload->>'barcode');

    IF v_code = '' THEN
      PERFORM set_config('app.barcode_reason', 'barcode cleared on the product screen', true);
      DELETE FROM product_barcodes WHERE product_id = v_product_id;
      PERFORM set_config('app.barcode_reason', '', true);
    ELSE
      IF EXISTS (
        SELECT 1 FROM product_barcodes
         WHERE shop_id = v_shop AND code = v_code AND product_id <> v_product_id
      ) THEN
        RAISE EXCEPTION 'BARCODE_TAKEN: "%" is already on another product in this shop', v_code;
      END IF;

      UPDATE product_barcodes SET code = v_code
       WHERE product_id = v_product_id AND is_primary;

      IF NOT FOUND THEN
        INSERT INTO product_barcodes(shop_id, product_id, code, is_primary, source, created_by)
        VALUES(v_shop, v_product_id, v_code, true, 'supplied', v_actor);
      END IF;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb)) LOOP
    v_variant_id := NULLIF(v_item->>'id','')::uuid;

    IF v_variant_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM product_variants WHERE id = v_variant_id AND product_id = v_product_id)
    THEN
      -- Stock is not in this list on purpose: the catalogue does not own it (0145), and the
      -- `protect_product_stock` trigger refuses a write to the product's rollup anyway.
      UPDATE product_variants SET
        name = COALESCE(NULLIF(v_item->>'name',''), name),
        selling_price = COALESCE((v_item->>'sellingPrice')::numeric, selling_price),
        cost_price = COALESCE((v_item->>'costPrice')::numeric, cost_price),
        unit_size = GREATEST(COALESCE(NULLIF((v_item->>'unitSize')::numeric, 0), unit_size), 0.001),
        qty_step = GREATEST(COALESCE(NULLIF((v_item->>'qtyStep')::numeric, 0), qty_step), 0.001),
        low_stock_threshold = GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, low_stock_threshold), 0),
        -- Present-but-empty clears the date; absent leaves it alone. Without that
        -- distinction, a date typed by mistake could never be removed, and a payload that
        -- simply does not mention expiry would silently wipe it.
        expiry_date = CASE WHEN v_item ? 'expiryDate'
                           THEN NULLIF(v_item->>'expiryDate','')::date
                           ELSE expiry_date END,
        updated_at = now()
      WHERE id = v_variant_id;
    ELSIF NULLIF(v_item->>'name','') IS NOT NULL THEN
      -- A pack added while editing is a creation, so it may arrive with stock — written as
      -- an opening movement for the same reason as on create.
      v_stock := GREATEST(COALESCE((v_item->>'stockQty')::numeric, 0), 0);
      v_cost  := COALESCE((v_item->>'costPrice')::numeric, 0);

      INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold,unit_size,qty_step,is_active,expiry_date)
      VALUES (
        v_product_id,
        v_item->>'name',
        COALESCE((v_item->>'sellingPrice')::numeric, 0),
        v_cost,
        v_stock,
        GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, 5), 0),
        GREATEST(COALESCE(NULLIF((v_item->>'unitSize')::numeric, 0), 1), 0.001),
        GREATEST(COALESCE(NULLIF((v_item->>'qtyStep')::numeric, 0), 1), 0.001),
        true,
        NULLIF(v_item->>'expiryDate','')::date
      ) RETURNING id INTO v_variant_id;

      IF v_stock > 0 THEN
        INSERT INTO inventory_movements(
          variant_id, product_id, movement_type, qty_before, qty_change, qty_after,
          reference_type, reference_id, unit_cost, notes, created_by, branch_id
        ) VALUES (
          v_variant_id, v_product_id, 'adjustment', 0, v_stock, v_stock,
          'product', v_variant_id, v_cost, 'Opening stock', v_actor, NULLIF(payload->>'branchId','')::uuid
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'product_updated', 'product', v_product_id, payload);

  RETURN jsonb_build_object('id', v_product_id);
END;
$$;


--
-- Name: update_reminder_occurrence_status(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_reminder_occurrence_status(payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_auth_user_id uuid;
BEGIN
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;
  UPDATE reminder_occurrences
  SET status = (payload->>'status')::text,
      sent_at = CASE WHEN payload ? 'sent_at' THEN (payload->>'sent_at')::timestamptz ELSE sent_at END,
      sent_channel = CASE WHEN payload ? 'sent_channel' THEN payload->>'sent_channel' ELSE sent_channel END,
      message = CASE WHEN payload ? 'message' THEN payload->>'message' ELSE message END,
      updated_at = now()
  WHERE id = (payload->>'occurrence_id')::uuid;
END; $$;


--
-- Name: update_role(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_role(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid := (payload->>'roleId')::uuid; v_code text; v_perm uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  -- The tenant check is the authorization: a role of ANOTHER shop is not found here, and the
  -- answer names that rather than the built-in flag the version before this refused on.
  IF NOT EXISTS(SELECT 1 FROM roles WHERE id=v_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  UPDATE roles SET name=COALESCE(NULLIF(payload->>'name',''),name), description=COALESCE(payload->>'description',description), updated_at=now()
    WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload ? 'permissions' THEN
    DELETE FROM role_permissions WHERE role_id=v_id;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO role_permissions(role_id,permission_id) VALUES(v_id,v_perm) ON CONFLICT DO NOTHING; END IF;
    END LOOP;
  END IF;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'role_updated','role',v_id,payload);
  RETURN jsonb_build_object('id',v_id,'updated',true);
END; $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: upsert_reminder_occurrence(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.upsert_reminder_occurrence(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_auth_user_id uuid;
  v_existing jsonb;
BEGIN
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;
  SELECT row_to_json(occ) INTO v_existing
  FROM reminder_occurrences occ
  WHERE occ.occurrence_key = (payload->>'occurrence_key');
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO reminder_occurrences (
    config_id, customer_id, occurrence_number, stage, crop_name,
    occurrence_key, scheduled_date, status, tone
  ) VALUES (
    (payload->>'config_id')::uuid, (payload->>'customer_id')::uuid,
    (payload->>'occurrence_number')::int, payload->>'stage',
    payload->>'crop_name', payload->>'occurrence_key',
    (payload->>'scheduled_date')::date, payload->>'status', payload->>'tone'
  ) RETURNING row_to_json(reminder_occurrences.*) INTO v_existing;
  RETURN v_existing;
END;
$$;


--
-- Name: validate_member_branch_scope(); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.validate_member_branch_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF NEW.role = 'owner' THEN RETURN NEW; END IF;
  -- Lock the target branches rather than serializing all business operations.
  -- Archive holds FOR UPDATE on its branch; a racing assignment waits and then
  -- re-checks is_active. No reverse membership lock is taken by archive.
  PERFORM 1 FROM public.branches WHERE tenant_id=NEW.tenant_id
    AND id=ANY(COALESCE(NEW.branch_scope,'{}'::uuid[])) ORDER BY id FOR SHARE;
  IF TG_OP = 'INSERT' AND NEW.branch_scope IS NULL THEN RETURN NEW; END IF;
  IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(NEW.branch_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = NEW.tenant_id AND b.is_active
    )
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: verify_user_pin(text); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.verify_user_pin(p_pin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := app_current_user_id();
  v_hash    text;
  v_failed  int;
  v_locked  timestamptz;
  v_max     constant int := 5;
  v_cooldown constant interval := interval '60 seconds';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  SELECT pin_hash, coalesce(pin_failed_count, 0), pin_locked_until
    INTO v_hash, v_failed, v_locked
    FROM users WHERE id = v_uid;

  -- No hash on file: the caller has never set a PIN (or it was cleared). The app
  -- turns this into the OTP path, which is the documented recovery route.
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('status', 'no_pin');
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object(
      'status', 'locked',
      'retryAfterSeconds', ceil(extract(epoch FROM (v_locked - now())))
    );
  END IF;

  IF p_pin IS NOT NULL AND v_hash = extensions.crypt(p_pin, v_hash) THEN
    UPDATE users SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = v_uid;
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  v_failed := v_failed + 1;
  UPDATE users
     SET pin_failed_count = v_failed,
         pin_locked_until = CASE WHEN v_failed >= v_max THEN now() + v_cooldown ELSE NULL END
   WHERE id = v_uid;

  RETURN jsonb_build_object('status', 'wrong', 'attemptsLeft', greatest(0, v_max - v_failed));
END $$;


--
-- Name: void_sale(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
  v_actor uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_already_returned numeric(14,4);
  v_sale_shop uuid;
BEGIN
  PERFORM public.guard_operational_request('void_sale',jsonb_build_object('saleId',p_sale_id));
  v_actor := COALESCE(app_current_user_id(), p_voided_by);

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = p_sale_id;
  PERFORM authorize_business_action('sales.void', COALESCE(v_sale_shop, current_shop_id()));

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    v_change := ROUND(v_item.qty - v_already_returned, 4);

    IF v_item.variant_id IS NOT NULL AND v_change > 0 THEN
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = v_item.variant_id;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_change;
      UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_item.variant_id;
      v_restored_stock := v_restored_stock + v_change;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, created_by, created_at)
      VALUES (v_item.product_id, v_item.variant_id, 'void', v_before, v_change, v_after,
        'void', p_sale_id, v_actor, now());
    END IF;
  END LOOP;

  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_sale.total_amount > 0 THEN
    UPDATE customers SET total_purchases = GREATEST(0, total_purchases - v_sale.total_amount), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (gen_random_uuid(), p_sale_id, p_reason, v_actor, now())
  RETURNING id INTO v_void_id;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, voided_by_name = (SELECT name FROM users WHERE id = v_actor), void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'sale_voided', 'sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'reversedOutstanding', v_unpaid));

  PERFORM public.guard_operational_request('void_sale',jsonb_build_object('saleId',p_sale_id));
 RETURN jsonb_build_object('id', v_void_id, 'saleId', p_sale_id, 'restoredStock', v_restored_stock, 'reversedOutstanding', v_unpaid, 'status', 'voided');
END;
$$;


--
-- Name: void_sale_v1(jsonb); Type: FUNCTION; Schema: public; Owner: -
--


CREATE FUNCTION public.void_sale_v1(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_sale_id uuid := (payload->>'saleId')::uuid;
  v_reason text := payload->>'reason';
  v_notes text := payload->>'notes';
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_void_window interval;
BEGIN
  PERFORM public.guard_operational_request('void_sale_v1',payload);
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED'; END IF;

  -- Get void window from settings (default 24h)
  SELECT (setting_value || ' hours')::interval INTO v_void_window
    FROM app_settings WHERE shop_id = v_sale.shop_id AND setting_key = 'void_window_hours';
  IF v_void_window IS NULL THEN v_void_window := interval '24 hours'; END IF;

  IF (now() - v_sale.created_at) > v_void_window THEN
    RAISE EXCEPTION 'VOID_WINDOW_EXPIRED';
  END IF;

  -- Restore stock
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = v_sale_id LOOP
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty + v_item.qty WHERE id = v_item.variant_id;
      INSERT INTO inventory_movements(variant_id,movement_type,qty_before,qty_change,qty_after,reference_type,reference_id,created_by)
      SELECT v_item.variant_id,'void',stock_qty-v_item.qty,v_item.qty,stock_qty,'void',v_sale_id,v_actor_id
      FROM product_variants WHERE id = v_item.variant_id;
    END IF;
  END LOOP;

  -- Reverse customer balance
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = greatest(outstanding_balance - v_sale.outstanding_balance,0),
      total_purchases = greatest(total_purchases - v_sale.total_amount,0),
      total_paid = greatest(total_paid - v_sale.amount_paid,0) WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET is_voided=true, voided_at=now(), voided_by=v_actor_id, void_reason=v_reason WHERE id=v_sale_id;
  INSERT INTO voids(sale_id,reason,notes,voided_by) VALUES (v_sale_id,v_reason,v_notes,v_actor_id) RETURNING id INTO v_void_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'sale_voided','sale',v_sale_id,jsonb_build_object('reason',v_reason,'total',v_sale.total_amount));
  INSERT INTO notifications(kind,title,body,entity_id,actor_id,actor_name) VALUES ('sale','Sale voided '||v_sale.sale_number,coalesce(v_actor_name,'Admin')||' voided Rs. '||v_sale.total_amount::text,v_sale_id,v_actor_id,v_actor_name);

  PERFORM public.guard_operational_request('void_sale_v1',payload);
 RETURN jsonb_build_object('id',v_void_id,'saleId',v_sale_id,'status','voided');
END; $$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    -- the same values as wal2json sent them, which is what filters compare against
    raw_columns realtime.wal_column[] =
        array_agg((x->>'name', x->>'type', x->>'typeoid', x->'value', null, null)::realtime.wal_column)
        from jsonb_array_elements(wal -> 'columns') x;
    raw_old_columns realtime.wal_column[] =
        array_agg((x->>'name', x->>'type', x->>'typeoid', x->'value', null, null)::realtime.wal_column)
        from jsonb_array_elements(wal -> 'identity') x;

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(raw_columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(raw_old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$$;


--
-- Name: authorize(text, text, text, text, text, text[], text[]); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.authorize(role_name text, topic_name text, claims text, sub text, headers text, read_extensions text[], write_extensions text[], OUT read_allowed boolean[], OUT write_allowed boolean[]) RETURNS record
    LANGUAGE plpgsql
    AS $$
declare
  probe_ids uuid[];
  probe_inserted_at timestamp := now() at time zone 'utc';
  visible_ids uuid[];
  ext text;
  allowed boolean;
begin
  -- The probe inserts are rolled back, but they still give the transaction an xid, so it ends
  -- in a commit. Nothing durable was written, so skip waiting on the WAL flush and sync standbys.
  -- Set outside the block below, whose rollback would undo it.
  perform set_config('synchronous_commit', 'off', true);

  -- The RAISE at the end of this block rolls back everything in it.
  begin
    probe_ids := array(select gen_random_uuid() from unnest(read_extensions));

    insert into realtime.messages (id, topic, extension, inserted_at, updated_at)
    select p.id, topic_name, p.extension, probe_inserted_at, probe_inserted_at
    from unnest(probe_ids, read_extensions) as p(id, extension);

    perform set_config('role', role_name, true),
            set_config('realtime.topic', topic_name, true),
            set_config('request.jwt.claims', claims, true),
            set_config('request.jwt.claim.sub', sub, true),
            set_config('request.jwt.claim.role', role_name, true),
            set_config('request.headers', headers, true);

    -- One lookup for every probe, by the full primary key.
    visible_ids := array(
      select m.id
      from realtime.messages m
      where m.inserted_at = probe_inserted_at
        and m.id = any(probe_ids));

    read_allowed := array(
      select p.id = any(visible_ids)
      from unnest(probe_ids) with ordinality as p(id, n)
      order by p.n);

    write_allowed := '{}';

    foreach ext in array write_extensions loop
      begin
        insert into realtime.messages (topic, extension, inserted_at, updated_at)
        values (topic_name, ext, now() at time zone 'utc', now() at time zone 'utc');

        allowed := true;
      exception when insufficient_privilege then
        allowed := false;
      end;

      write_allowed := write_allowed || allowed;
    end loop;

    raise sqlstate 'RTA01';
  exception when sqlstate 'RTA01' then
    null;
  end;
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
/*
Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
*/
declare
    op_symbol text = (
        case
            when op = 'eq' then '='
            when op = 'neq' then '!='
            when op = 'lt' then '<'
            when op = 'lte' then '<='
            when op = 'gt' then '>'
            when op = 'gte' then '>='
            when op = 'in' then '= any'
            else 'UNKNOWN OP'
        end
    );
    res boolean;
begin
    execute format(
        'select %L::'|| type_::text || ' ' || op_symbol
        || ' ( %L::'
        || (
            case
                when op = 'in' then type_::text || '[]'
                else type_::text end
        )
        || ')', val_1, val_2) into res;
    return res;
end;
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$$;


--
-- Name: filters_hash(realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.filters_hash(filters realtime.user_defined_filter[]) RETURNS bytea
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  select pg_catalog.int8send(pg_catalog.hash_array_extended(filters, 0))
      || pg_catalog.int8send(pg_catalog.hash_array_extended(filters, 1))
$$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: list_changes_sync(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.list_changes_sync(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures the slot is read exactly once.
  consumed AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         realtime.settled_changes(
           slot_name, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM consumed
    WHERE consumed.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM consumed,
         realtime.apply_rls(
           wal := consumed.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE consumed.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT
    realtime.wal2json_escape_identifier(nsp.nspname::text)
    || '.'
    || realtime.wal2json_escape_identifier(pc.relname::text)
  FROM pg_class pc
  JOIN pg_namespace nsp ON pc.relnamespace = nsp.oid
  WHERE pc.oid = entity
$$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: send_binary(bytea, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, binary_payload, event, topic, private, extension)
    VALUES (generated_id, payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: settled_changes(name, integer, text[]); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.settled_changes(slot_name name, max_changes integer, VARIADIC opts text[]) RETURNS TABLE(lsn pg_lsn, xid xid, data text)
    LANGUAGE plpgsql
    AS $$
declare
  upto pg_lsn;
  total bigint;
  xids xid[];
  starts bigint[];
  snapshot pg_snapshot;
  running_xids xid[];
  xmax_age int;
  cut bigint;
begin
  -- Each statement in a volatile function takes its own snapshot, which is what lets the
  -- check below see a writer that was still in flight when the peek ran. Under REPEATABLE
  -- READ the snapshot never advances, so a deferred change would never be released.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'realtime.settled_changes requires READ COMMITTED';
  end if;

  -- The peek and the read below cover the same WAL, so the read cannot reach a commit the
  -- check never saw.
  upto := pg_current_wal_flush_lsn();

  -- One entry per transaction, in commit order: its xid and the position of its first
  -- change. The peek uses the caller's own options, so max_changes counts exactly what the
  -- read counts. A non-transactional logical message is emitted as soon as it is decoded,
  -- tagged with the xid of whatever transaction wrote it, so it does not mark where that
  -- transaction starts.
  select coalesce(sum(g.n), 0),
         array_agg(g.x order by g.first) filter (where g.first is not null),
         array_agg(g.first order by g.first) filter (where g.first is not null)
    into total, xids, starts
    from (
      select p.xid as x, count(*) as n,
             min(p.ord) filter (where not case
               when starts_with(p.data, '{"action":"M"') then (p.data::jsonb->>'transactional')::boolean is false
               else false
             end) as first
      from pg_logical_slot_peek_changes(slot_name, upto, max_changes, variadic opts)
           with ordinality as p(lsn, xid, data, ord)
      group by p.xid
    ) g;

  -- Nothing for the caller, but the slot still has to move past what the peek covered.
  if total = 0 then
    perform pg_replication_slot_advance(slot_name, upto);
    return;
  end if;

  if xids is not null then
    -- Taken after the peek is materialized, so a writer that was still in flight during
    -- decoding is guaranteed to show up here.
    snapshot := pg_current_snapshot();

    -- A commit record reaches the WAL before the writer leaves the proc array, so a change
    -- can be decoded while its row is invisible. apply_rls would resolve a policy against a
    -- row it cannot see and authorize it for nobody, while the read consumed it regardless.
    --
    -- xip lists transactions running when the snapshot was taken. It does not cover a writer
    -- whose xid sits at or beyond xmax, which never appears there, so the horizon is checked
    -- too. age() counts backwards from the current xid and so compares correctly across
    -- wraparound.
    select coalesce(array_agg(running.x::xid), array[]::xid[])
      into running_xids
      from pg_snapshot_xip(snapshot) running(x);
    xmax_age := age(pg_snapshot_xmax(snapshot)::xid);

    select min(u.s) into cut
      from unnest(xids, starts) as u(x, s)
      where u.x = any(running_xids) or age(u.x) <= xmax_age;
  end if;

  -- The read stops right after the commit that brings its count to upto_nchanges, so the
  -- count of changes in front of the first unsettled transaction stops it just before that
  -- transaction.
  if cut is null then
    return query
      select p.* from pg_logical_slot_get_changes(slot_name, upto, max_changes, variadic opts) p;
  elsif cut > 1 then
    return query
      select p.* from pg_logical_slot_get_changes(slot_name, upto, (cut - 1)::int, variadic opts) p;
  end if;
end;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    -- Normalize selected_columns order so ARRAY['a','b'] and ARRAY['b','a'] are treated
    -- as the same subscription group in apply_rls. Preserve an empty array as '{}'
    -- ("primary keys only") so it stays distinct from NULL ("all columns"); array_agg
    -- over an empty set would otherwise collapse '{}' back to NULL.
    if new.selected_columns is not null then
        new.selected_columns = coalesce(
            (
                select array_agg(c order by c)
                from unnest(new.selected_columns) c
            ),
            '{}'::text[]
        );
    end if;

    return new;
end;
$$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: wal2json_escape_identifier(text); Type: FUNCTION; Schema: realtime; Owner: -
--


CREATE FUNCTION realtime.wal2json_escape_identifier(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- Prefix `\`, `,`, `.`, and any whitespace with `\`
  SELECT regexp_replace(name, '([\\,.[:space:]])', '\\\1', 'g')
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: delete_lifecycle_objects(uuid[]); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.delete_lifecycle_objects(object_ids uuid[]) RETURNS TABLE(id uuid, is_delete_marker boolean, metadata jsonb)
    LANGUAGE plpgsql
    AS $$
DECLARE
    object_id uuid;
    deleted_row storage.objects%ROWTYPE;
    deleted_ids uuid[];
    deleted_markers boolean[];
    deleted_metadata jsonb[];
    bulk_deleted boolean := false;
BEGIN
    -- Surface pre-existing deferred violations instead of treating them as blocked rows.
    SET CONSTRAINTS ALL IMMEDIATE;
    PERFORM set_config('storage.allow_delete_query', 'true', true);

    -- One subxact keeps the subxid cache from overflowing; rows return only once it commits.
    BEGIN
        WITH deleted AS (
            DELETE FROM storage.objects AS object_row
              WHERE object_row.id = ANY(object_ids) AND object_row.archived_at IS NOT NULL
              RETURNING object_row.id, object_row.is_delete_marker, object_row.metadata
        )
        SELECT array_agg(deleted.id), array_agg(deleted.is_delete_marker), array_agg(deleted.metadata)
          INTO deleted_ids, deleted_markers, deleted_metadata
          FROM deleted;
        bulk_deleted := true;
    EXCEPTION
        WHEN OTHERS THEN
            -- User triggers may use insufficient_privilege to block a row.
            IF SQLSTATE <> '42501' AND left(SQLSTATE, 2) IN ('08', '40', '42', '53', '55', '57', '58', 'XX') THEN
                RAISE;
            END IF;
    END;
    IF bulk_deleted THEN
        RETURN QUERY SELECT * FROM unnest(deleted_ids, deleted_markers, deleted_metadata);
        RETURN;
    END IF;

    FOREACH object_id IN ARRAY object_ids LOOP
        BEGIN
            DELETE FROM storage.objects AS object_row
              WHERE object_row.id = object_id AND object_row.archived_at IS NOT NULL
              RETURNING object_row.* INTO deleted_row;
            IF FOUND THEN
                id := deleted_row.id;
                is_delete_marker := deleted_row.is_delete_marker;
                metadata := deleted_row.metadata;
                RETURN NEXT;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLSTATE <> '42501' AND left(SQLSTATE, 2) IN ('08', '40', '42', '53', '55', '57', '58', 'XX') THEN
                    RAISE;
                END IF;
        END;
    END LOOP;
END;
$$;


--
-- Name: enforce_bucket_lifecycle_service_role(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.enforce_bucket_lifecycle_service_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
  IF current_user::text IS DISTINCT FROM TG_ARGV[0] THEN
    -- Keep this check AFTER caller RLS accepts the proposed row. The API
    -- recognizes this exact signal after rolling back its permission probe.
    RAISE EXCEPTION 'bucket control columns may only be changed by the configured storage service role'
      USING ERRCODE = 'PST01',
            SCHEMA = TG_TABLE_SCHEMA,
            TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_NAME;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: enforce_versioning_status_transition(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.enforce_versioning_status_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.versioning_status = OLD.versioning_status THEN
        RETURN NEW;
    END IF;

    IF NEW.versioning_status = 'DISABLED' OR
       (OLD.versioning_status = 'DISABLED' AND NEW.versioning_status = 'SUSPENDED') THEN
        RAISE EXCEPTION 'Cannot transition bucket versioning status from % to %',
            OLD.versioning_status, NEW.versioning_status;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN p_delimiter <> ''
         AND position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(
        p_key,
        length(p_prefix)
            + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1))
            + length(p_delimiter) - 1
    )
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(text, text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.get_size_by_bucket(noncurrent_versions text DEFAULT 'include'::text, delete_markers text DEFAULT 'include'::text) RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'include');
    delete_markers := COALESCE(delete_markers, 'include');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'include';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'include';
    END IF;

    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        where (noncurrent_versions != 'exclude' OR obj.archived_at IS NULL)
          and (noncurrent_versions != 'only' OR obj.archived_at IS NOT NULL)
          and (delete_markers != 'exclude' OR NOT obj.is_delete_marker)
          and (delete_markers != 'only' OR obj.is_delete_marker)
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text, raw_prefix_param text DEFAULT NULL::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $_$
WITH candidates AS (
    SELECT
        upload.key AS object_key,
        CASE
            WHEN position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1)) > 0
            THEN left(
                upload.key,
                length(coalesce($7, $2))
                    + position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1))
                    + length($3) - 1
            )
            ELSE upload.key
        END AS result_key,
        upload.id,
        upload.created_at,
        position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1)) > 0 AS is_common_prefix
    FROM storage.s3_multipart_uploads AS upload
    WHERE upload.bucket_id = $1
      AND upload.key COLLATE "C" LIKE $2 || '%'
), filtered AS (
    SELECT candidate.*
    FROM candidates AS candidate
    WHERE $5 = ''
       OR candidate.result_key COLLATE "C" > $5
       OR (
           candidate.result_key COLLATE "C" = $5
           AND NOT candidate.is_common_prefix
           AND $6 <> ''
           -- A completed or aborted marker repeats the remaining same-key uploads.
           AND COALESCE(
               (candidate.created_at, candidate.id COLLATE "C") > (
                   SELECT marker.created_at, marker.id COLLATE "C"
                   FROM storage.s3_multipart_uploads AS marker
                   WHERE marker.bucket_id = $1
                     AND marker.key COLLATE "C" = $5
                     AND marker.id = $6
               ),
               TRUE
           )
       )
), ranked AS (
    SELECT
        filtered.*,
        row_number() OVER (
            PARTITION BY filtered.result_key COLLATE "C"
            ORDER BY filtered.created_at, filtered.id COLLATE "C"
        ) AS prefix_rank
    FROM filtered
)
SELECT ranked.result_key, ranked.id, ranked.created_at
FROM ranked
WHERE NOT ranked.is_common_prefix OR ranked.prefix_rank = 1
ORDER BY ranked.result_key COLLATE "C", ranked.created_at, ranked.id COLLATE "C"
LIMIT $4;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text, text, text, timestamp with time zone, text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text, next_token_archived_at timestamp with time zone DEFAULT NULL::timestamp with time zone, next_token_version text DEFAULT ''::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_start_relative TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;
    v_version_filter TEXT;

    -- true when noncurrent_versions can return >1 row per name; keeps them
    -- ordered most-recent-first and lets pagination resume mid-key
    v_multi_row BOOLEAN;
    v_name_order TEXT;
    v_exact_range_predicate TEXT;
    v_strict_range_predicate TEXT;
    v_inclusive_range_predicate TEXT;

    -- Seek state for the current name. archived_at is normalized to JavaScript's
    -- millisecond precision and version breaks ties within the same millisecond.
    -- Current rows use 'infinity'; NULL means no tiebreak has been established.
    v_next_seek TEXT;
    v_next_seek_at TIMESTAMPTZ;
    v_next_seek_version TEXT;
    v_next_seek_strict BOOLEAN := false;
    v_cursor_is_folder BOOLEAN;
    v_count INT := 0;
    v_previous_seek TEXT;
    v_previous_seek_at TIMESTAMPTZ;
    v_previous_seek_version TEXT;
    v_previous_count INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;
    v_batch_query_strict TEXT;
    v_delete_marker_peek_query TEXT;
    v_delete_marker_peek_query_strict TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);
    v_next_seek_at := NULL;
    v_next_seek_version := '';

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    v_multi_row := noncurrent_versions IN ('only', 'include');
    v_name_order := CASE WHEN v_is_asc THEN 'ASC' ELSE 'DESC' END;

    v_version_filter := '';
    IF noncurrent_versions = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NULL';
    ELSIF noncurrent_versions = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NOT NULL';
    END IF;
    IF delete_markers = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND NOT o.is_delete_marker';
    ELSIF delete_markers = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.is_delete_marker';
    END IF;

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Keep caller-provided cursors inside the requested prefix range.
    IF v_start <> '' AND v_upper_bound IS NOT NULL THEN
        IF v_is_asc THEN
            IF v_start COLLATE "C" < v_prefix COLLATE "C" THEN
                v_start := '';
            ELSIF v_start COLLATE "C" >= v_upper_bound COLLATE "C" THEN
                RETURN;
            END IF;
        ELSE
            IF v_start COLLATE "C" < v_prefix COLLATE "C" THEN
                RETURN;
            ELSIF v_start COLLATE "C" >= v_upper_bound COLLATE "C" THEN
                v_start := '';
            END IF;
        END IF;
    END IF;

    v_start_relative := substring(v_start FROM length(v_prefix) + 1);

    -- Direction affects only the indexed name range and its ordering. Cursor
    -- state transitions and within-key version ordering stay shared.
    IF v_is_asc THEN
        v_exact_range_predicate := 'TRUE';
        v_strict_range_predicate := 'o.name COLLATE "C" > $2';
        v_inclusive_range_predicate := 'o.name COLLATE "C" >= $2';
        IF v_upper_bound IS NOT NULL THEN
            v_exact_range_predicate := 'o.name COLLATE "C" < $3';
            v_strict_range_predicate := v_strict_range_predicate || ' AND o.name COLLATE "C" < $3';
            v_inclusive_range_predicate := v_inclusive_range_predicate || ' AND o.name COLLATE "C" < $3';
        END IF;
    ELSE
        v_exact_range_predicate := 'TRUE';
        v_strict_range_predicate := 'o.name COLLATE "C" < $2';
        v_inclusive_range_predicate := 'o.name COLLATE "C" < $2';
        IF v_prefix <> '' THEN
            v_exact_range_predicate := 'o.name COLLATE "C" >= $3';
            v_strict_range_predicate := v_strict_range_predicate || ' AND o.name COLLATE "C" >= $3';
            v_inclusive_range_predicate := v_inclusive_range_predicate || ' AND o.name COLLATE "C" >= $3';
        END IF;
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    -- The multi-row order matches the externally serialized cursor exactly:
    -- archived_at at millisecond precision, then version as the final tiebreak.
    --
    -- When v_multi_row, the seek is a keyset tuple comparison ("name > $2 OR
    -- (name = $2 AND tiebreak)") - Postgres won't split that OR into indexable
    -- form (confirmed even with fully literal values), so as one WHERE clause
    -- it forces a full bucket scan filtered row-by-row. Splitting it into two
    -- independently-indexable branches (exact name match with the tiebreak
    -- filter, vs. strictly-past names) combined with UNION ALL lets each
    -- branch keep name as a real index condition; the outer ORDER BY/LIMIT
    -- re-merges them into the same page the single query used to produce.
    IF v_multi_row THEN
        v_batch_query := format(
            $sql$
            SELECT *
            FROM (
                (
                    SELECT o.name, o.id, o.updated_at, o.created_at,
                           o.last_accessed_at, o.metadata, o.version,
                           o.archived_at, o.is_delete_marker, o.is_versioned
                    FROM storage.objects o
                    WHERE o.bucket_id = $1
                      AND o.name COLLATE "C" = $2
                      AND %s
                      AND NOT $7::boolean
                      AND (
                          $5::timestamptz IS NULL
                          OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < $5
                          OR (
                              COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = $5
                              AND COALESCE(o.version, '') > $6
                          )
                      )
                      %s
                    ORDER BY
                        COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC,
                        COALESCE(o.version, '') ASC
                    LIMIT $4
                )
                UNION ALL
                (
                    SELECT o.name, o.id, o.updated_at, o.created_at,
                           o.last_accessed_at, o.metadata, o.version,
                           o.archived_at, o.is_delete_marker, o.is_versioned
                    FROM storage.objects o
                    WHERE o.bucket_id = $1
                      AND %s
                      %s
                    ORDER BY
                        o.name COLLATE "C" %s,
                        COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC,
                        COALESCE(o.version, '') ASC
                    LIMIT $4
                )
            ) sub
            ORDER BY
                sub.name COLLATE "C" %s,
                COALESCE(date_trunc('milliseconds', sub.archived_at), 'infinity'::timestamptz) DESC,
                COALESCE(sub.version, '') ASC
            LIMIT $4
            $sql$,
            v_exact_range_predicate,
            v_version_filter,
            v_strict_range_predicate,
            v_version_filter,
            v_name_order,
            v_name_order
        );
    ELSE
        v_batch_query := format(
            $sql$
            SELECT o.name, o.id, o.updated_at, o.created_at,
                   o.last_accessed_at, o.metadata, o.version,
                   o.archived_at, o.is_delete_marker, o.is_versioned
            FROM storage.objects o
            WHERE o.bucket_id = $1
              AND %s
              %s
            ORDER BY o.name COLLATE "C" %s, o.archived_at DESC
            LIMIT $4
            $sql$,
            v_inclusive_range_predicate,
            v_version_filter,
            v_name_order
        );

        -- Strict counterpart of the query above: used once the single-row
        -- ASC batch advance (below) has left v_next_seek pointing at the
        -- last row already emitted, so an inclusive predicate would
        -- re-match it forever. Only single-row mode ever sets strict mode,
        -- so this variant is never needed when v_multi_row.
        v_batch_query_strict := format(
            $sql$
            SELECT o.name, o.id, o.updated_at, o.created_at,
                   o.last_accessed_at, o.metadata, o.version,
                   o.archived_at, o.is_delete_marker, o.is_versioned
            FROM storage.objects o
            WHERE o.bucket_id = $1
              AND %s
              %s
            ORDER BY o.name COLLATE "C" %s, o.archived_at DESC
            LIMIT $4
            $sql$,
            v_strict_range_predicate,
            v_version_filter,
            v_name_order
        );
    END IF;

    -- The static peek predicates cannot use the partial delete-marker index
    -- once PL/pgSQL switches to a generic plan because whether
    -- is_delete_marker is required remains parameter-dependent. Reuse the
    -- already-specialized batch query with a one-row limit for this sparse
    -- filter so the plan sees a literal `o.is_delete_marker` predicate.
    IF delete_markers = 'only' THEN
        v_delete_marker_peek_query :=
            'SELECT marker_page.name FROM (' || v_batch_query || ') marker_page LIMIT 1';
        IF NOT v_multi_row THEN
            v_delete_marker_peek_query_strict :=
                'SELECT marker_page.name FROM (' || v_batch_query_strict || ') marker_page LIMIT 1';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor performs one specialized initial seek so
            -- partial current-version and delete-marker indexes remain available.
            EXECUTE format(
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1%s%s ORDER BY o.name COLLATE "C" DESC LIMIT 1',
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND o.name COLLATE "C" >= $2 AND o.name COLLATE "C" < $3'
                    ELSE ''
                END,
                v_version_filter
            )
            INTO v_next_seek
            USING _bucket_id, v_prefix, v_upper_bound;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Folder continuation tokens retain their trailing delimiter. A
        -- delimiter-less startAfter is always a literal key boundary.
        v_cursor_is_folder := delimiter_param <> ''
            AND v_start_relative <> ''
            AND right(v_start_relative, length(delimiter_param)) = delimiter_param;

        IF v_cursor_is_folder THEN
            v_next_seek := CASE
                WHEN right(v_start, length(delimiter_param)) = delimiter_param
                    THEN v_start
                ELSE v_start || delimiter_param
            END;
            IF v_is_asc THEN
                v_next_seek := left(v_next_seek, -1)
                    || chr(ascii(right(v_next_seek, 1)) + 1);
            END IF;
            v_next_seek_strict := NOT v_is_asc;
        ELSE
            -- leaf object: when v_multi_row, stay on v_start with the
            -- caller-supplied tiebreak so a page boundary mid-key resumes
            -- that key's remaining rows instead of skipping them. Truncate
            -- to milliseconds like every other v_next_seek_at assignment -
            -- harmless today since object.ts's cursor always round-trips
            -- through JS Date first, but this shouldn't rely on that.
            IF v_multi_row THEN
                v_next_seek := v_start;
                v_next_seek_at := date_trunc('milliseconds', next_token_archived_at);
                v_next_seek_version := coalesce(next_token_version, '');
                v_next_seek_strict := coalesce(next_token, '') = '';
            ELSIF v_is_asc THEN
                v_next_seek := v_start;
                v_next_seek_strict := true;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        v_previous_seek := v_next_seek;
        v_previous_seek_at := v_next_seek_at;
        v_previous_seek_version := v_next_seek_version;
        v_previous_count := v_count;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        -- v_multi_row is branched here (rather than folded into the WHERE
        -- clause as a bound parameter) so each concrete query keeps an
        -- unconditional seek predicate - once PL/pgSQL switches to its
        -- cached generic plan (after 5 calls), a parameter-gated
        -- "(NOT v_multi_row AND name >= $x) OR (v_multi_row AND ...)"
        -- predicate stops the planner from using name as an index
        -- condition at all, degrading every subsequent peek to a full
        -- index scan filtered row-by-row instead of a bounded range scan.
        -- v_multi_row's seek predicate is a keyset tuple comparison
        -- ("name > x OR (name = x AND tiebreak)") - Postgres does not
        -- split this OR into indexable form even with fully literal
        -- values, so it falls back to a full scan filtered row-by-row.
        -- Splitting it into two independently-indexable branches (exact
        -- name match with the tiebreak filter, vs. strictly-past name)
        -- combined with UNION ALL lets each branch keep name as a real
        -- index condition; the outer ORDER BY/LIMIT picks whichever of
        -- the (at most 2) rows sorts first.
        IF delete_markers = 'only' THEN
            EXECUTE CASE WHEN v_next_seek_strict AND NOT v_multi_row
                THEN v_delete_marker_peek_query_strict
                ELSE v_delete_marker_peek_query
            END
                INTO v_peek_name
                USING _bucket_id, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END,
                    1, v_next_seek_at, v_next_seek_version, v_next_seek_strict;
        ELSIF v_multi_row THEN
            IF v_is_asc THEN
                IF v_upper_bound IS NOT NULL THEN
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND o.name COLLATE "C" < v_upper_bound
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" > v_next_seek AND o.name COLLATE "C" < v_upper_bound
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" ASC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" > v_next_seek
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" ASC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSE
                IF v_upper_bound IS NOT NULL THEN
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND o.name COLLATE "C" >= v_prefix
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" DESC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" DESC LIMIT 1;
                ELSE
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" DESC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" DESC LIMIT 1;
                END IF;
            END IF;
        ELSE
            -- Single-row mode is always noncurrent_versions='exclude'. Keep
            -- this predicate literal so generic plans use the current index.
            IF v_is_asc THEN
                IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" > v_next_seek
                      AND o.name COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSIF v_next_seek_strict THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" > v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSIF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" >= v_next_seek
                      AND o.name COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" >= v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSE
                IF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" < v_next_seek
                      AND o.name COLLATE "C" >= v_prefix
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" DESC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" < v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" DESC LIMIT 1;
                END IF;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := v_common_prefix;
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            version := NULL;
            archived_at := NULL;
            is_delete_marker := NULL;
            is_versioned := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1)
                    || chr(ascii(right(v_common_prefix, 1)) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
            v_next_seek_at := NULL;
            v_next_seek_version := '';
            v_next_seek_strict := NOT v_is_asc;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE CASE WHEN v_next_seek_strict AND NOT v_multi_row THEN v_batch_query_strict ELSE v_batch_query END
                USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size, v_next_seek_at, v_next_seek_version,
                v_next_seek_strict
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it. Reset
                    -- strict mode too it may have been set by an earlier
                    -- row in this same batch (see the single-row ASC advance
                    -- below), and v_next_seek here is the folder-triggering
                    -- row's own name, which the next peek must find inclusively.
                    v_next_seek := CASE
                        WHEN v_is_asc THEN v_current.name
                        ELSE v_current.name || delimiter_param
                    END;
                    v_next_seek_at := NULL;
                    v_next_seek_version := '';
                    v_next_seek_strict := false;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                version := v_current.version;
                archived_at := v_current.archived_at;
                is_delete_marker := v_current.is_delete_marker;
                is_versioned := v_current.is_versioned;
                RETURN NEXT;
                v_count := v_count + 1;

                -- when v_multi_row, stay on this name and record its
                -- archived_at as the new tiebreak so remaining rows for the
                -- same key are picked up before moving to the next name
                IF v_multi_row THEN
                    v_next_seek := v_current.name;
                    v_next_seek_at := COALESCE(date_trunc('milliseconds', v_current.archived_at), 'infinity'::timestamptz);
                    v_next_seek_version := COALESCE(v_current.version, '');
                    v_next_seek_strict := false;
                ELSIF v_is_asc THEN
                    -- Appending the delimiter as a fake lexical successor
                    -- would skip a real key like `name || '!'` (or any
                    -- character sorting below the delimiter), which sorts
                    -- between `name` and `name || delimiter`. Track the real
                    -- name and mark the next comparison strict instead.
                    v_next_seek := v_current.name;
                    v_next_seek_strict := true;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;

        IF v_count = v_previous_count
           AND v_next_seek IS NOT DISTINCT FROM v_previous_seek
           AND v_next_seek_at IS NOT DISTINCT FROM v_previous_seek_at
           AND v_next_seek_version IS NOT DISTINCT FROM v_previous_seek_version THEN
            RAISE EXCEPTION 'storage.list_objects_with_delimiter made no progress at seek (%, %, %)',
                v_next_seek, v_next_seek_at, v_next_seek_version;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_active_lifecycle_states(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.protect_active_lifecycle_states() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM storage.bucket_lifecycle_states
        WHERE bucket_id = OLD.id
          AND NOT (
              continuation IS NULL
              OR (continuation @> '{"continuationVersion": 1}' AND continuation #> '{batch,inFlight}' IS NULL)
          )
    ) THEN
        RAISE EXCEPTION 'update or delete on table "buckets" violates foreign key constraint "bucket_lifecycle_states_bucket_id_fkey" on table "bucket_lifecycle_states"'
            USING ERRCODE = 'foreign_key_violation',
                  DETAIL = format('Key (id)=(%s) is still referenced from table "bucket_lifecycle_states".', OLD.id),
                  SCHEMA = 'storage',
                  TABLE = 'bucket_lifecycle_states',
                  CONSTRAINT = 'bucket_lifecycle_states_bucket_id_fkey';
    END IF;
    RETURN OLD;
END;
$$;


--
-- Name: protect_bucket_control_columns(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.protect_bucket_control_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  configuration_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_configuration IS NOT NULL
       OR NEW.lifecycle_configuration_generation IS NOT NULL THEN
      IF NOT pg_has_role(current_user, TG_ARGV[0], 'MEMBER') THEN
        RAISE EXCEPTION 'only members of the configured storage service role may insert lifecycle policy state'
          USING ERRCODE = '42501',
                HINT = format(
                  'Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.',
                  TG_ARGV[0]
                );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  configuration_changed =
    OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
    OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation;

  IF NOT configuration_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.type IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'bucket versioning and lifecycle controls require a Standard bucket'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     AND NEW.lifecycle_configuration_generation IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     OR NEW.lifecycle_configuration_generation IS NULL
     OR OLD.lifecycle_configuration IS NOT DISTINCT FROM NEW.lifecycle_configuration
     OR OLD.lifecycle_configuration_generation IS NOT DISTINCT FROM NEW.lifecycle_configuration_generation THEN
    RAISE EXCEPTION 'a changed lifecycle policy requires a new non-null generation'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: reconcile_lifecycle_state(text, boolean); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.reconcile_lifecycle_state(target_bucket_id text, policy_changed boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
    bucket storage.buckets%ROWTYPE;
    active boolean;
    idle boolean;
    state_generation uuid;
BEGIN
    SELECT * INTO bucket FROM storage.buckets WHERE id = target_bucket_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT continuation IS NULL OR (
               continuation @> '{"continuationVersion": 1}'
               AND continuation #> '{batch,inFlight}' IS NULL
           ), generation
    INTO idle, state_generation
    FROM storage.bucket_lifecycle_states
    WHERE bucket_id = target_bucket_id
    FOR UPDATE;

    IF bucket.lifecycle_configuration IS NULL THEN
        DELETE FROM storage.bucket_lifecycle_states
        WHERE bucket_id = target_bucket_id
          AND idle IS TRUE;

        UPDATE storage.bucket_lifecycle_states
        SET next_run_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE bucket_id = target_bucket_id
          AND idle IS NOT TRUE;
        RETURN;
    END IF;

    active := bucket.versioning_status <> 'DISABLED'
        AND bucket.lifecycle_configuration @> '{"rules":[{"status":"Enabled"}]}'::jsonb;

    -- The state row records the generation it was reconciled with so callers need not detect
    -- policy changes. Rows without a recorded generation keep their work.
    policy_changed := policy_changed OR (
        state_generation IS NOT NULL AND state_generation <> bucket.lifecycle_configuration_generation
    );

    INSERT INTO storage.bucket_lifecycle_states AS state (bucket_id, generation, next_run_at)
    VALUES (bucket.id, bucket.lifecycle_configuration_generation, CASE WHEN active THEN clock_timestamp() END)
    ON CONFLICT (bucket_id) DO UPDATE
    SET next_run_at = CASE
            WHEN policy_changed THEN
                CASE WHEN active OR idle IS NOT TRUE THEN clock_timestamp() END
            ELSE EXCLUDED.next_run_at
        END,
        generation = EXCLUDED.generation,
        claim_id = CASE WHEN policy_changed AND idle IS TRUE
                        THEN NULL ELSE state.claim_id END,
        claim_until = CASE WHEN policy_changed AND idle IS TRUE
                           THEN NULL ELSE state.claim_until END,
        continuation = CASE WHEN policy_changed AND idle IS TRUE
                            THEN NULL ELSE state.continuation END,
        failure_count = CASE WHEN policy_changed AND idle IS TRUE
                             THEN 0 ELSE state.failure_count END,
        last_error = CASE WHEN policy_changed AND idle IS TRUE
                          THEN NULL ELSE state.last_error END,
        updated_at = clock_timestamp()
    WHERE policy_changed OR (state.next_run_at IS NULL AND EXCLUDED.next_run_at IS NOT NULL);
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_prefix_len INT;
    v_prefix_start INT;
    v_combined_levels INT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;
    v_version_filter TEXT;
    v_multi_row BOOLEAN;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;
    v_delete_marker_peek_query TEXT;
    v_delete_marker_peek_query_strict TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_next_seek_at TIMESTAMPTZ;
    v_next_seek_version TEXT;
    v_next_seek_strict BOOLEAN := false;
    v_count INT := 0;
    v_skipped INT := 0;
    v_previous_seek TEXT;
    v_previous_seek_at TIMESTAMPTZ;
    v_previous_seek_version TEXT;
    v_previous_count INT;
    v_previous_skipped INT;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_prefix_len := length(coalesce(prefix, ''));
    v_prefix_start := coalesce(array_length(string_to_array(coalesce(prefix, ''), v_delimiter), 1), 1);
    v_combined_levels := coalesce(array_length(string_to_array(v_prefix, v_delimiter), 1), 1);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);
    v_next_seek_at := NULL;
    v_next_seek_version := '';

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    v_multi_row := noncurrent_versions IN ('only', 'include');

    v_version_filter := '';
    IF noncurrent_versions = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NULL';
    ELSIF noncurrent_versions = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NOT NULL';
    END IF;
    IF delete_markers = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND NOT o.is_delete_marker';
    ELSIF delete_markers = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.is_delete_marker';
    END IF;

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT array_to_string(path_tokens[$1:$2], '/') AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $3 || '%%'
                  AND bucket_id = $4
                  AND array_length(objects.path_tokens, 1) <> $2
                  AND ($7 != 'exclude' OR objects.archived_at IS NULL)
                  AND ($7 != 'only' OR objects.archived_at IS NOT NULL)
                  AND ($8 != 'exclude' OR NOT objects.is_delete_marker)
                  AND ($8 != 'only' OR objects.is_delete_marker)
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata,
                   NULL::text AS version,
                   NULL::timestamptz AS archived_at,
                   NULL::boolean AS is_delete_marker,
                   NULL::boolean AS is_versioned FROM folders)
            UNION ALL
            (SELECT array_to_string(path_tokens[$1:$2], '/') AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata,
                   version, archived_at, is_delete_marker, is_versioned
             FROM storage.objects
             WHERE objects.name ILIKE $3 || '%%'
               AND bucket_id = $4
               AND array_length(objects.path_tokens, 1) = $2
               AND ($7 != 'exclude' OR objects.archived_at IS NULL)
               AND ($7 != 'only' OR objects.archived_at IS NOT NULL)
               AND ($8 != 'exclude' OR NOT objects.is_delete_marker)
               AND ($8 != 'only' OR objects.is_delete_marker)
             -- name, then version, as tiebreaks so two versions of the same
             -- key tying on the sort column still sort deterministically
             ORDER BY %I %s, name COLLATE "C" %s, COALESCE(version, '') %s)
            LIMIT $5 OFFSET $6
            $sql$, v_sort_order, v_order_by, v_sort_order, v_sort_order, v_sort_order
        ) USING v_prefix_start, v_combined_levels, v_prefix, bucketname, v_limit, offsets, noncurrent_versions, delete_markers;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build a resume-safe batch query. The exact-name branch returns remaining
    -- versions after the current (archived_at, version) boundary; the strict
    -- name branch returns subsequent keys. UNION ALL keeps both predicates
    -- independently indexable.
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" > $2 AND lower(o.name) COLLATE "C" < $3' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" ASC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" > $2' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" ASC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 AND lower(o.name) COLLATE "C" >= $3' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" DESC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" DESC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        END IF;
    END IF;

    -- Keep the delete-marker predicate literal so the cached generic
    -- plan can use idx_objects_delete_markers during the main-loop peek.
    IF delete_markers = 'only' THEN
        IF v_multi_row THEN
            v_delete_marker_peek_query :=
                'SELECT marker_page.name FROM (' || v_batch_query || ') marker_page LIMIT 1';
        ELSIF v_is_asc THEN
            -- Two separate literal query strings, not one gated by a bound
            -- boolean: folding "$n AND op1 OR NOT $n AND op2" into a single
            -- query defeats the generic plan's ability to push either
            -- comparison into the index. Branching in PL/pgSQL control flow
            -- instead keeps each query's index condition intact.
            v_delete_marker_peek_query :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" >= $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" < $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1';
            -- Strict variant: used once the single-row ASC batch advance
            -- (below) has left v_next_seek pointing at the last row already
            -- emitted, so a plain >= would re-match it forever.
            v_delete_marker_peek_query_strict :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" > $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" < $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1';
        ELSE
            v_delete_marker_peek_query :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" < $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" >= $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC performs one specialized initial seek so partial current-version
        -- and delete-marker indexes remain available.
        EXECUTE format(
            'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1%s%s ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1',
            CASE WHEN v_upper_bound IS NOT NULL
                THEN ' AND lower(o.name) COLLATE "C" >= $2 AND lower(o.name) COLLATE "C" < $3'
                ELSE ''
            END,
            v_version_filter
        )
        INTO v_peek_name
        USING bucketname, v_prefix_lower, v_upper_bound;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch and
    -- the delete-marker-only path
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        v_previous_seek := v_next_seek;
        v_previous_seek_at := v_next_seek_at;
        v_previous_seek_version := v_next_seek_version;
        v_previous_count := v_count;
        v_previous_skipped := v_skipped;

        -- STEP 1: PEEK
        v_peek_name := NULL;
        IF delete_markers = 'only' THEN
            EXECUTE CASE WHEN v_next_seek_strict
                THEN v_delete_marker_peek_query_strict
                ELSE v_delete_marker_peek_query
            END
                INTO v_peek_name
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END,
                    1, v_next_seek_at, v_next_seek_version;
        ELSIF v_multi_row AND v_next_seek_at IS NOT NULL THEN
            SELECT o.name INTO v_peek_name
            FROM storage.objects o
            WHERE o.bucket_id = bucketname
              AND lower(o.name) COLLATE "C" = v_next_seek
              AND (COALESCE(o.archived_at, 'infinity'::timestamptz) < v_next_seek_at
                   OR (COALESCE(o.archived_at, 'infinity'::timestamptz) = v_next_seek_at
                       AND COALESCE(o.version, '') > v_next_seek_version))
              AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
              AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
              AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
              AND (delete_markers != 'only' OR o.is_delete_marker)
            ORDER BY COALESCE(o.archived_at, 'infinity'::timestamptz) DESC,
                     COALESCE(o.version, '') ASC
            LIMIT 1;

            -- The current key is exhausted. Clear its version boundary and
            -- make the following ASC name peek strict. Appending '/' is not a
            -- valid lexical successor because keys ending in characters such
            -- as '!' sort between the exhausted name and name || '/'.
            IF v_peek_name IS NULL THEN
                IF v_is_asc THEN
                    v_next_seek_strict := true;
                END IF;
                v_next_seek_at := NULL;
                v_next_seek_version := '';
            END IF;
        END IF;

        -- Single-row mode is always noncurrent_versions='exclude'. Keep the
        -- current-row predicate literal so generic plans use the current index.
        IF delete_markers != 'only' AND v_peek_name IS NULL AND NOT v_multi_row THEN
            IF v_is_asc THEN
                IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSIF v_next_seek_strict THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSIF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSIF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                  AND o.archived_at IS NULL
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                  AND o.archived_at IS NULL
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        ELSIF delete_markers != 'only' AND v_peek_name IS NULL AND v_is_asc THEN
            IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSIF v_next_seek_strict THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSIF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSIF delete_markers != 'only' AND v_peek_name IS NULL THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- If the peek landed on a different key than we were tracking, any
        -- version boundary belongs to the OLD key and must not leak into the
        -- new one - e.g. the deleteMarkers='only' peek doesn't know or care
        -- whether it's continuing the same key or jumping to a new one, so
        -- it never clears these itself.
        IF lower(v_peek_name) IS DISTINCT FROM v_next_seek THEN
            v_next_seek_at := NULL;
            v_next_seek_version := '';
        END IF;

        -- The peek is authoritative for the next key to process. This is
        -- especially important after exhausting a multi-version key: the
        -- version boundary has been cleared, so executing the batch against
        -- a stale v_next_seek would replay every version of that old key.
        v_next_seek := lower(v_peek_name);
        v_next_seek_strict := false;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := substring(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter) from v_prefix_len + 1);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                version := NULL;
                archived_at := NULL;
                is_delete_marker := NULL;
                is_versioned := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
            v_next_seek_at := NULL;
            v_next_seek_version := '';
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size,
                    v_next_seek_at, v_next_seek_version
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it. Reset
                    -- strict mode too - it may have been set by an earlier
                    -- row in this same batch (see the single-row ASC advance
                    -- below), and v_next_seek here is the folder-triggering
                    -- row's own name, which the next peek must find inclusively.
                    v_next_seek := CASE
                        WHEN v_is_asc THEN lower(v_current.name)
                        ELSE lower(v_current.name) || v_delimiter
                    END;
                    v_next_seek_at := NULL;
                    v_next_seek_version := '';
                    v_next_seek_strict := false;
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := substring(v_current.name from v_prefix_len + 1);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    version := v_current.version;
                    archived_at := v_current.archived_at;
                    is_delete_marker := v_current.is_delete_marker;
                    is_versioned := v_current.is_versioned;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Multi-row mode must remain on this key until all of its
                -- versions have crossed the internal batch boundary.
                IF v_multi_row THEN
                    v_next_seek := lower(v_current.name);
                    v_next_seek_at := COALESCE(v_current.archived_at, 'infinity'::timestamptz);
                    v_next_seek_version := COALESCE(v_current.version, '');
                ELSIF v_is_asc THEN
                    -- Appending the delimiter as a fake lexical successor would
                    -- skip a real key like `name || '!'` (or any character
                    -- sorting below the delimiter), which sorts between `name`
                    -- and `name || delimiter`. Track the real name and mark the
                    -- next comparison strict instead - same fix as the
                    -- exhausted-key case above.
                    v_next_seek := lower(v_current.name);
                    v_next_seek_strict := true;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;

        IF v_count = v_previous_count
           AND v_skipped = v_previous_skipped
           AND v_next_seek IS NOT DISTINCT FROM v_previous_seek
           AND v_next_seek_at IS NOT DISTINCT FROM v_previous_seek_at
           AND v_next_seek_version IS NOT DISTINCT FROM v_previous_seek_version THEN
            RAISE EXCEPTION 'storage.search made no progress at seek (%, %, %)',
                v_next_seek, v_next_seek_at, v_next_seek_version;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text, p_start_after_version text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
    v_prefix_pattern text;
    v_sort_order text;
    v_sort_column text;
    v_version_tiebreak text;
BEGIN
    v_prefix := coalesce(p_prefix, '');
    -- Keep the raw prefix for common-prefix calculations and escape only LIKE metacharacters.
    v_prefix_pattern := replace(v_prefix, chr(92), chr(92) || chr(92));
    v_prefix_pattern := replace(v_prefix_pattern, '%', chr(92) || '%');
    v_prefix_pattern := replace(v_prefix_pattern, '_', chr(92) || '_');

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    -- $9 is only populated in multi-row mode; it's always '' otherwise, so
    -- only use each row's real version as a tiebreak in multi-row mode.
    v_version_tiebreak := CASE WHEN noncurrent_versions IN ('only', 'include') THEN 'COALESCE(version, '''')' ELSE '''''' END;

    -- Defense-in-depth: this function is independently reachable and must
    -- not trust p_sort_order/p_sort_column to already be validated by a
    -- caller. Normalize to the same strict allow-list storage.search_v2
    -- uses before interpolating anything into dynamic SQL below.
    v_sort_order := lower(coalesce(p_sort_order, 'asc'));
    IF v_sort_order NOT IN ('asc', 'desc') THEN
        v_sort_order := 'asc';
    END IF;

    v_sort_column := lower(coalesce(p_sort_column, 'updated_at'));
    IF v_sort_column NOT IN ('updated_at', 'created_at') THEN
        v_sort_column := 'updated_at';
    END IF;

    IF v_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                o.version AS obj_version,
                o.archived_at AS obj_archived_at,
                o.is_delete_marker AS obj_is_delete_marker,
                o.is_versioned AS obj_is_versioned,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $10 || '%%'
              AND ($7 != 'exclude' OR o.archived_at IS NULL)
              AND ($7 != 'only' OR o.archived_at IS NOT NULL)
              AND ($8 != 'exclude' OR NOT o.is_delete_marker)
              AND ($8 != 'only' OR o.is_delete_marker)
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                common_prefix AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                NULL::text AS version,
                NULL::timestamptz AS archived_at,
                NULL::boolean AS is_delete_marker,
                NULL::boolean AS is_versioned,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                obj_version AS version,
                obj_archived_at AS archived_at,
                obj_is_delete_marker AS is_delete_marker,
                obj_is_versioned AS is_versioned,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz),
                    name COLLATE "C",
                    %s
                ) %s ROW(
                    -- truncated the same way as the stored value above
                    date_trunc('milliseconds', COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz)),
                    $5,
                    $9
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata,
            version,
            archived_at,
            is_delete_marker,
            is_versioned
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s,
            COALESCE(version, '') %s
        LIMIT $4
    $sql$,
        v_sort_column,
        v_version_tiebreak,
        v_cursor_op,
        v_sort_column,
        v_sort_order,
        v_sort_order,
        v_sort_order
    );

    -- version is the third tiebreak component for two versions of the same
    -- key tying on both timestamp and name (see filtered CTE / ORDER BY above)
    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after, noncurrent_versions, delete_markers, coalesce(p_start_after_version, ''), v_prefix_pattern;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text, text, text, timestamp with time zone, text, boolean); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text, start_after_archived_at timestamp with time zone DEFAULT NULL::timestamp with time zone, start_after_version text DEFAULT ''::text, start_after_is_continuation boolean DEFAULT false) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata,
            l.version,
            l.archived_at,
            l.is_delete_marker,
            l.is_versioned
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            CASE WHEN start_after_is_continuation THEN '' ELSE start_after END,
            CASE WHEN start_after_is_continuation THEN start_after ELSE '' END,
            v_sort_ord,
            noncurrent_versions,
            delete_markers,
            start_after_archived_at,
            start_after_version
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after,
            noncurrent_versions, delete_markers, start_after_version
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: wake_lifecycle_state(); Type: FUNCTION; Schema: storage; Owner: -
--


CREATE FUNCTION storage.wake_lifecycle_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.lifecycle_configuration IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM storage.reconcile_lifecycle_state(NEW.id, false);
    RETURN NEW;
END;
$$;


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: mfa_recovery_code_sets; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.mfa_recovery_code_sets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    mfa_factor_id uuid NOT NULL,
    failed_verification_count integer DEFAULT 0 NOT NULL,
    verification_locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mfa_recovery_code_sets_failed_verification_count_check CHECK ((failed_verification_count >= 0))
);


--
-- Name: mfa_recovery_codes; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.mfa_recovery_codes (
    id uuid NOT NULL,
    mfa_recovery_code_set_id uuid NOT NULL,
    code_hash text NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--


CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--


ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: scim_tokens; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.scim_tokens (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    token_hash text NOT NULL,
    prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    CONSTRAINT scim_tokens_expires_at_future CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT scim_tokens_revoked_after_created CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at))),
    CONSTRAINT scim_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: scim_users; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.scim_users (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    user_id uuid,
    resource jsonb NOT NULL,
    user_name text GENERATED ALWAYS AS (lower((resource ->> 'userName'::text))) STORED NOT NULL,
    external_id text GENERATED ALWAYS AS ((resource ->> 'externalId'::text)) STORED,
    active boolean GENERATED ALWAYS AS (COALESCE(((resource ->> 'active'::text))::boolean, true)) STORED NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--


CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    setting_key character varying(100) NOT NULL,
    setting_value text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid,
    details jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_name text,
    branch_name text,
    tenant_id uuid,
    branch_id uuid,
    actor_role text,
    actor_role_id uuid,
    branch_scope uuid[]
);


--
-- Name: barcode_history; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.barcode_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    product_id uuid NOT NULL,
    code character varying NOT NULL,
    previous_code character varying,
    action character varying NOT NULL,
    source character varying,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    reason character varying,
    CONSTRAINT barcode_history_action_check CHECK (((action)::text = ANY ((ARRAY['added'::character varying, 'replaced'::character varying, 'deleted'::character varying])::text[])))
);


--
-- Name: barcode_registry; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.barcode_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    code character varying NOT NULL,
    product_id uuid,
    first_product_id uuid,
    status character varying DEFAULT 'active'::character varying NOT NULL,
    source character varying DEFAULT 'generated'::character varying NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_by uuid,
    retired_at timestamp with time zone,
    retired_reason character varying,
    CONSTRAINT barcode_registry_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'retired'::character varying])::text[])))
);


--
-- Name: branch_responsibility; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.branch_responsibility (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid,
    role_id uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revoke_reason text
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    address text,
    phone character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude double precision,
    longitude double precision,
    location_label text,
    location_source text,
    CONSTRAINT branches_location_in_pakistan CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND ((latitude >= (23.0)::double precision) AND (latitude <= (37.5)::double precision)) AND ((longitude >= (60.0)::double precision) AND (longitude <= (78.0)::double precision)))))
);


--
-- Name: business_settings; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.business_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    crops jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    shop_id uuid DEFAULT public.current_shop_id(),
    setting_key character varying(100),
    setting_value text,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cash_reconciliations; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.cash_reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    reconciliation_date date NOT NULL,
    expected_cash numeric(14,2) NOT NULL,
    counted_cash numeric(14,2) NOT NULL,
    variance numeric(14,2) NOT NULL,
    notes text,
    reconciled_by uuid NOT NULL,
    reconciled_by_name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_error_events; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.client_error_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment character varying(20) NOT NULL,
    app_version character varying(40),
    screen character varying(120),
    error_code character varying(80),
    message text NOT NULL,
    user_id uuid,
    shop_id uuid,
    branch_id uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_error_events_details_check CHECK ((pg_column_size(details) <= 2048)),
    CONSTRAINT client_error_events_environment_check CHECK (((environment)::text = ANY ((ARRAY['development'::character varying, 'staging'::character varying, 'production'::character varying])::text[]))),
    CONSTRAINT client_error_events_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 500)))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact_person text,
    phone text,
    address text,
    logo_url text,
    outstanding_payable numeric(14,2) DEFAULT 0 NOT NULL,
    total_purchases numeric(14,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date
);


--
-- Name: credit_limit_requests; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.credit_limit_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    customer_name text NOT NULL,
    requested_by text NOT NULL,
    current_limit numeric NOT NULL,
    requested_limit numeric NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text DEFAULT ''::text,
    CONSTRAINT credit_limit_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: customer_crops; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.customer_crops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    crop_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    acreage numeric,
    planting_date date,
    expected_harvest date
);


--
-- Name: customer_payments; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.customer_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    notes text,
    recorded_by uuid,
    recorded_by_name text,
    balance_after numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    idempotency_key text,
    payment_group_id uuid,
    split_index integer DEFAULT 0 NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    address text,
    image_url text,
    credit_limit numeric(14,2) DEFAULT 0 NOT NULL,
    outstanding_balance numeric(14,2) DEFAULT 0 NOT NULL,
    total_purchases numeric(14,2) DEFAULT 0 NOT NULL,
    total_paid numeric(14,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date,
    latitude double precision,
    longitude double precision,
    location_label text,
    location_source text
);


--
-- Name: incident_rate_limits; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.incident_rate_limits (
    actor_id text NOT NULL,
    component text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 1 NOT NULL
);


--
-- Name: incident_signatures; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.incident_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fingerprint text NOT NULL,
    type text NOT NULL,
    component text NOT NULL,
    source text NOT NULL,
    message_template text NOT NULL,
    occurrence_count integer DEFAULT 1 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolution_id uuid,
    environment text DEFAULT 'qa'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_component CHECK ((component = ANY (ARRAY['auth'::text, 'sales'::text, 'inventory'::text, 'customers'::text, 'payments'::text, 'returns'::text, 'signals'::text, 'images'::text, 'ui'::text, 'infrastructure'::text]))),
    CONSTRAINT valid_environment CHECK ((environment = ANY (ARRAY['qa'::text, 'ci'::text, 'production'::text]))),
    CONSTRAINT valid_source CHECK ((source = ANY (ARRAY['client'::text, 'server'::text, 'test'::text, 'ci'::text, 'agent'::text]))),
    CONSTRAINT valid_type CHECK ((type = ANY (ARRAY['error'::text, 'broken_workflow'::text, 'sync_failure'::text, 'auth_failure'::text, 'performance'::text, 'regression'::text, 'agent_loop'::text])))
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signature_id uuid NOT NULL,
    status text DEFAULT 'detected'::text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    message text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    stack_trace text,
    environment text DEFAULT 'qa'::text NOT NULL,
    user_action text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT valid_incident_environment CHECK ((environment = ANY (ARRAY['qa'::text, 'ci'::text, 'production'::text]))),
    CONSTRAINT valid_incident_severity CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT valid_incident_status CHECK ((status = ANY (ARRAY['detected'::text, 'triaged'::text, 'investigating'::text, 'root_cause_found'::text, 'fix_proposed'::text, 'fixed'::text, 'verifying'::text, 'verified'::text, 'resolved'::text, 'false_positive'::text, 'duplicate'::text, 'superseded'::text, 'blocked'::text])))
);


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variant_id uuid,
    movement_type public.movement_type NOT NULL,
    qty_before numeric(12,4) NOT NULL,
    qty_change numeric(12,4) NOT NULL,
    qty_after numeric(12,4) NOT NULL,
    reference_type character varying(50),
    reference_id uuid,
    batch_id uuid,
    unit_cost numeric(12,2),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    product_id uuid,
    branch_id uuid,
    CONSTRAINT check_qty_after_non_negative CHECK ((qty_after >= (0)::numeric))
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    sku text,
    selling_price numeric(12,2) DEFAULT 0 NOT NULL,
    cost_price numeric(12,2) DEFAULT 0 NOT NULL,
    stock_qty integer DEFAULT 0 NOT NULL,
    unit_size numeric(10,4) DEFAULT 1 NOT NULL,
    qty_step numeric(10,4) DEFAULT 1 NOT NULL,
    low_stock_threshold integer DEFAULT 5 NOT NULL,
    expiry_date date,
    is_active boolean DEFAULT true NOT NULL,
    batch_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_variants_qty_step_check CHECK ((qty_step > (0)::numeric)),
    CONSTRAINT product_variants_stock_qty_check CHECK ((stock_qty >= 0)),
    CONSTRAINT product_variants_unit_size_check CHECK ((unit_size > (0)::numeric)),
    CONSTRAINT variants_qty_step_positive CHECK ((qty_step > (0)::numeric)),
    CONSTRAINT variants_unit_size_positive CHECK ((unit_size > (0)::numeric))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    company text DEFAULT ''::text NOT NULL,
    company_id uuid,
    category public.product_category DEFAULT 'other'::public.product_category NOT NULL,
    image_url text,
    barcode text,
    base_unit text DEFAULT 'piece'::text NOT NULL,
    stock_qty numeric(14,4) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    marketplace_listed boolean DEFAULT false NOT NULL,
    marketplace_listed_at timestamp with time zone,
    CONSTRAINT products_stock_qty_check CHECK ((stock_qty >= (0)::numeric)),
    CONSTRAINT products_stock_qty_non_negative CHECK ((stock_qty >= (0)::numeric))
);


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    address text,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    join_code text,
    marketplace_enabled boolean DEFAULT false NOT NULL,
    latitude double precision,
    longitude double precision,
    location_label text,
    location_source text
);


--
-- Name: marketplace_listings; Type: VIEW; Schema: public; Owner: -
--


CREATE VIEW public.marketplace_listings AS
 SELECT v.id AS listing_id,
    s.id AS branch_id,
    s.name AS branch_name,
    s.address AS branch_address,
    round((s.latitude)::numeric, 4) AS branch_latitude,
    round((s.longitude)::numeric, 4) AS branch_longitude,
    s.location_label AS branch_location_label,
    p.id AS product_id,
    p.name AS product_name,
    (p.category)::text AS category,
    p.image_url,
    v.id AS variant_id,
    v.name AS variant_label,
    v.unit_size,
    v.qty_step,
    p.base_unit,
    v.selling_price,
        CASE
            WHEN (v.stock_qty > 0) THEN 'available'::text
            ELSE 'out_of_stock'::text
        END AS availability,
    p.marketplace_listed_at AS listed_at,
    GREATEST(p.updated_at, v.updated_at) AS updated_at
   FROM ((public.product_variants v
     JOIN public.products p ON ((p.id = v.product_id)))
     JOIN public.shops s ON ((s.id = p.shop_id)))
  WHERE (s.marketplace_enabled AND (s.latitude IS NOT NULL) AND (s.longitude IS NOT NULL) AND p.marketplace_listed AND p.is_active AND v.is_active AND (v.stock_qty > 0) AND (v.selling_price > (0)::numeric));


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.notification_kind NOT NULL,
    title text NOT NULL,
    body text,
    entity_id uuid,
    actor_id uuid,
    actor_name text,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    entity_type character varying,
    is_read boolean DEFAULT false NOT NULL,
    message text,
    shop_id uuid
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(100) NOT NULL,
    module character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    label_en character varying(200) NOT NULL,
    label_ur character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_barcodes; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.product_barcodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    code character varying(64) NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    source character varying(16) DEFAULT 'generated'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_variants_public; Type: VIEW; Schema: public; Owner: -
--


CREATE VIEW public.product_variants_public WITH (security_invoker='true') AS
 SELECT id,
    product_id,
    name,
    sku,
    selling_price,
    unit_size,
    qty_step,
    low_stock_threshold,
    expiry_date,
    stock_qty,
    is_active
   FROM public.product_variants v
  WHERE (EXISTS ( SELECT 1
           FROM public.products p
          WHERE ((p.id = v.product_id) AND (p.shop_id = public.current_shop_id()))));


--
-- Name: purchase_items; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    variant_id uuid,
    variant_name text NOT NULL,
    qty numeric(12,4) NOT NULL,
    cost_price numeric(12,2) DEFAULT 0 NOT NULL,
    line_total numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    unit_size numeric(14,4) DEFAULT 1 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    base_unit character varying DEFAULT 'piece'::character varying NOT NULL
);


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_number text NOT NULL,
    company_id uuid,
    company_name text NOT NULL,
    total_amount numeric(14,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(14,2) DEFAULT 0 NOT NULL,
    outstanding_payable numeric(14,2) DEFAULT 0 NOT NULL,
    payment_method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    note text,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    idempotency_key text,
    amount_due numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    notes text,
    recorded_by uuid,
    recorded_by_name character varying,
    due_date date
);


--
-- Name: reminder_configs; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.reminder_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    enabled boolean DEFAULT true,
    start_days integer DEFAULT 1,
    anchor text DEFAULT 'after_credit'::text NOT NULL,
    repeat_type text DEFAULT 'escalate'::text NOT NULL,
    interval_n integer DEFAULT 7,
    interval_unit text DEFAULT 'days'::text,
    escalation jsonb DEFAULT '[]'::jsonb,
    ends text DEFAULT 'paid'::text,
    ends_date date,
    ends_count integer DEFAULT 5,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    group_id uuid,
    group_name text,
    shop_id uuid DEFAULT public.current_shop_id()
);


--
-- Name: reminder_logs; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.reminder_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    customer_name text,
    config_id uuid,
    tone text,
    message text,
    channel text,
    sent_at timestamp with time zone DEFAULT now(),
    shop_id uuid DEFAULT public.current_shop_id(),
    occurrence_id uuid
);


--
-- Name: reminder_occurrences; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.reminder_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    occurrence_number integer DEFAULT 1 NOT NULL,
    stage text,
    crop_name text,
    occurrence_key text NOT NULL,
    scheduled_date date NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    tone text,
    sent_at timestamp with time zone,
    sent_channel text,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    shop_id uuid DEFAULT public.current_shop_id()
);


--
-- Name: return_items; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid NOT NULL,
    sale_item_id uuid,
    product_id uuid,
    product_name text NOT NULL,
    variant_id uuid,
    variant_name text NOT NULL,
    qty numeric(12,4) NOT NULL,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL,
    line_total numeric(14,2) DEFAULT 0 NOT NULL,
    refund_amount numeric(14,2) DEFAULT 0 NOT NULL,
    restock boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    qty_to_return numeric(12,2) DEFAULT 0 NOT NULL
);


--
-- Name: returns; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_number text NOT NULL,
    sale_id uuid,
    customer_id uuid,
    customer_name text NOT NULL,
    total_refund numeric(14,2) DEFAULT 0 NOT NULL,
    resolution text DEFAULT 'refund'::text NOT NULL,
    note text,
    processed_by uuid,
    processed_by_name text,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    idempotency_key text,
    branch_id uuid,
    refund_amount numeric(14,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sale_items; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    variant_id uuid,
    variant_name text NOT NULL,
    qty numeric(12,4) NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    line_total numeric(14,2) NOT NULL,
    cogs_amount numeric(14,2) DEFAULT 0 NOT NULL,
    unit_size numeric(10,4) DEFAULT 1,
    base_unit text DEFAULT 'piece'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sale_submissions; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.sale_submissions (
    shop_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    sale_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_number text NOT NULL,
    customer_id uuid,
    customer_name text DEFAULT ''::text,
    historical_customer_name text,
    historical_customer_phone text,
    historical_customer_address text,
    employee_id uuid,
    employee_name text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    total_amount numeric(14,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(14,2) DEFAULT 0 NOT NULL,
    outstanding_balance numeric(14,2) DEFAULT 0 NOT NULL,
    payment_type public.payment_type DEFAULT 'full'::public.payment_type NOT NULL,
    payment_method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    is_voided boolean DEFAULT false NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    voided_by_name text,
    void_reason text,
    note text,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_phone text,
    customer_address text,
    branch_id uuid,
    customer_name_snapshot character varying(255),
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    amount_due numeric(14,2) DEFAULT 0 NOT NULL,
    due_date date,
    notes text
);


--
-- Name: shop_requests; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.shop_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_name character varying(255) NOT NULL,
    owner_phone character varying(20) NOT NULL,
    shop_name character varying(255) NOT NULL,
    shop_address text,
    shop_city character varying(100),
    shop_type character varying(50) DEFAULT 'retail'::character varying,
    business_registration_number character varying(100),
    logo_url text,
    cnic_front_url text,
    cnic_back_url text,
    business_license_url text,
    status public.shop_request_status DEFAULT 'pending'::public.shop_request_status NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone character varying(20),
    latitude double precision,
    longitude double precision,
    location_label text,
    location_source text,
    CONSTRAINT shop_requests_location_in_pakistan CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND ((latitude >= (23.0)::double precision) AND (latitude <= (37.5)::double precision)) AND ((longitude >= (60.0)::double precision) AND (longitude <= (78.0)::double precision)))))
);


--
-- Name: stock_adjustments; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.stock_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    variant_id uuid,
    variant_name text NOT NULL,
    adjustment_type public.adjustment_kind NOT NULL,
    qty_before numeric(12,4) NOT NULL,
    qty_change numeric(12,4) NOT NULL,
    qty_after numeric(12,4) NOT NULL,
    reason text,
    adjusted_by uuid,
    adjusted_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    idempotency_key text,
    shop_id uuid
);


--
-- Name: supplier_payments; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.supplier_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    notes text,
    recorded_by uuid,
    recorded_by_name text,
    payable_after numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    idempotency_key text
);


--
-- Name: user_active_shops; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.user_active_shops (
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid
);


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.user_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    is_override boolean DEFAULT false NOT NULL,
    is_granted boolean DEFAULT true NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    role public.user_role DEFAULT 'employee'::public.user_role NOT NULL,
    is_original_owner boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    pin_hash character varying(255),
    employee_number text,
    job_title text,
    photo_url text,
    shop_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    first_login_at timestamp with time zone,
    last_login_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pin_failed_count integer DEFAULT 0 NOT NULL,
    pin_locked_until timestamp with time zone
);


--
-- Name: users_public; Type: VIEW; Schema: public; Owner: -
--


CREATE VIEW public.users_public WITH (security_invoker='true') AS
 SELECT id,
    name,
    role,
    phone,
    shop_id,
    is_active,
    created_at,
    updated_at
   FROM public.users;


--
-- Name: voids; Type: TABLE; Schema: public; Owner: -
--


CREATE TABLE public.voids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    reason character varying(50) NOT NULL,
    notes text,
    voided_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    inserted_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone
)
PARTITION BY RANGE (inserted_at);


--
-- Name: messages_2026_10_16; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.messages_2026_10_16 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    inserted_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_10_17; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.messages_2026_10_17 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    inserted_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_10_18; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.messages_2026_10_18 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    inserted_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_10_19; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.messages_2026_10_19 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    inserted_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_10_20; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.messages_2026_10_20 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    inserted_at timestamp without time zone DEFAULT timezone('utc'::text, clock_timestamp()) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone DEFAULT now()
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--


CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    selected_columns text[],
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--


ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bucket_lifecycle_states; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.bucket_lifecycle_states (
    bucket_id text NOT NULL,
    generation uuid,
    next_run_at timestamp with time zone,
    claim_id uuid,
    claim_until timestamp with time zone,
    continuation jsonb,
    last_started_at timestamp with time zone,
    last_completed_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_result jsonb,
    failure_count integer DEFAULT 0 NOT NULL,
    last_error jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bucket_lifecycle_continuation_object_check CHECK (((continuation IS NULL) OR (jsonb_typeof(continuation) = 'object'::text))),
    CONSTRAINT bucket_lifecycle_failure_count_check CHECK ((failure_count >= 0)),
    CONSTRAINT bucket_lifecycle_last_result_object_check CHECK (((last_result IS NULL) OR (jsonb_typeof(last_result) = 'object'::text))),
    CONSTRAINT bucket_lifecycle_recovery_due_check CHECK (((next_run_at IS NOT NULL) OR (NOT jsonb_path_exists(COALESCE(continuation, '{}'::jsonb), '$."batch"."inFlight"'::jsonpath))))
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL,
    versioning_status text DEFAULT 'DISABLED'::text NOT NULL,
    lifecycle_configuration jsonb,
    lifecycle_configuration_generation uuid,
    CONSTRAINT buckets_lifecycle_configuration_pair_check CHECK (((lifecycle_configuration IS NULL) = (lifecycle_configuration_generation IS NULL))),
    CONSTRAINT buckets_lifecycle_configuration_shape_check CHECK (((lifecycle_configuration IS NULL) OR ((jsonb_typeof(lifecycle_configuration) = 'object'::text) AND (lifecycle_configuration ? 'rules'::text) AND
CASE
    WHEN (jsonb_typeof((lifecycle_configuration -> 'rules'::text)) = 'array'::text) THEN ((jsonb_array_length((lifecycle_configuration -> 'rules'::text)) >= 1) AND (jsonb_array_length((lifecycle_configuration -> 'rules'::text)) <= 1000))
    ELSE false
END))),
    CONSTRAINT buckets_lifecycle_configuration_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR ((lifecycle_configuration IS NULL) AND (lifecycle_configuration_generation IS NULL)))),
    CONSTRAINT buckets_versioning_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR (versioning_status = 'DISABLED'::text))),
    CONSTRAINT buckets_versioning_status_check CHECK ((versioning_status = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text])))
);


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lifecycle_abandoned_artifacts; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.lifecycle_abandoned_artifacts (
    bucket_id text NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    version text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    archived_at timestamp with time zone,
    is_delete_marker boolean DEFAULT false NOT NULL,
    is_versioned boolean DEFAULT false NOT NULL
);


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--


CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migration_divergences; Type: TABLE; Schema: supabase_migrations; Owner: -
--


CREATE TABLE supabase_migrations.schema_migration_divergences (
    version text NOT NULL,
    kind text NOT NULL,
    recorded_sha256 text NOT NULL,
    current_sha256 text NOT NULL,
    reason text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by text DEFAULT CURRENT_USER NOT NULL,
    CONSTRAINT schema_migration_divergences_kind_check CHECK ((kind = ANY (ARRAY['superseded'::text, 'not-applicable'::text])))
);


--
-- Name: schema_migration_files; Type: TABLE; Schema: supabase_migrations; Owner: -
--


CREATE TABLE supabase_migrations.schema_migration_files (
    version text NOT NULL,
    filename text NOT NULL,
    sha256 text NOT NULL,
    bytes integer NOT NULL,
    source text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_by text DEFAULT CURRENT_USER NOT NULL,
    reconciled_at timestamp with time zone,
    reconcile_note text,
    CONSTRAINT schema_migration_files_source_check CHECK ((source = ANY (ARRAY['applied'::text, 'adopted'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: -
--


CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text
);


--
-- Name: messages_2026_10_16; Type: TABLE ATTACH; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_10_16 FOR VALUES FROM ('2026-10-16 00:00:00') TO ('2026-10-17 00:00:00');


--
-- Name: messages_2026_10_17; Type: TABLE ATTACH; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_10_17 FOR VALUES FROM ('2026-10-17 00:00:00') TO ('2026-10-18 00:00:00');


--
-- Name: messages_2026_10_18; Type: TABLE ATTACH; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_10_18 FOR VALUES FROM ('2026-10-18 00:00:00') TO ('2026-10-19 00:00:00');


--
-- Name: messages_2026_10_19; Type: TABLE ATTACH; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_10_19 FOR VALUES FROM ('2026-10-19 00:00:00') TO ('2026-10-20 00:00:00');


--
-- Name: messages_2026_10_20; Type: TABLE ATTACH; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_10_20 FOR VALUES FROM ('2026-10-20 00:00:00') TO ('2026-10-21 00:00:00');


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: -
--


COPY public.app_settings (id, shop_id, setting_key, setting_value, description, created_at, updated_at) FROM stdin;
20ed2d07-ded9-43f1-940f-61f5dc0f1538	00000000-0000-0000-0000-000000000001	low_stock_threshold_default	10	Default low stock alert threshold	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00
9722b4d3-80f7-42e9-9663-3c9d464f970b	00000000-0000-0000-0000-000000000001	expiry_warning_days	30	Days before expiry to show warning	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00
772de7fc-70d2-4688-9c2a-a64242dc7235	00000000-0000-0000-0000-000000000001	void_window_hours	24	Hours after sale to allow void	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00
2723e637-544b-4ad1-8e15-81ff76cb199e	00000000-0000-0000-0000-000000000001	credit_limit_override_policy	warn_allow_log	Employee credit limit policy	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00
cff078e7-1f6b-4029-ab2d-0c274606d74a	00000000-0000-0000-0000-000000000001	seed_kg_step	0.5	Default kg increment for seed products	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00
\.


--
-- Data for Name: audit_events; Type: TABLE DATA; Schema: public; Owner: -
--


COPY public.branches (id, tenant_id, name, is_default, address, phone, is_active, created_at, latitude, longitude, location_label, location_source) FROM stdin;
d717d974-9ad9-4d11-b75d-7a44c00ae72d	00000000-0000-0000-0000-000000000001	Default Shop - Main	t	\N	\N	t	2026-10-17 15:00:49.425821+00	\N	\N	\N	\N
\.


--
-- Data for Name: business_settings; Type: TABLE DATA; Schema: public; Owner: -
--


COPY public.permissions (id, code, module, action, label_en, label_ur, created_at) FROM stdin;
4d02a069-fd6e-41d8-ac8e-e00618dbcd48	customers.view	customers	view	View Customers	صارفین دیکھیں	2026-10-17 15:00:49.425821+00
736c2960-d6c4-4f43-a9c8-a323f9bd10f0	customers.create	customers	create	Create Customers	صارفین بنائیں	2026-10-17 15:00:49.425821+00
a72ca83e-57af-4ad8-a805-95f6190f3b1d	customers.edit	customers	edit	Edit Customers	صارفین میں ترمیم کریں	2026-10-17 15:00:49.425821+00
f600ef7b-6c07-4755-a6c6-e4563fff08f4	customers.delete	customers	delete	Delete/Archive Customers	صارفین حذف کریں	2026-10-17 15:00:49.425821+00
e636b0cd-f790-4b75-8c43-b1fc8a7da136	customers.payments	customers	payments	Record Customer Payments	صارفین کی ادائیگیاں درج کریں	2026-10-17 15:00:49.425821+00
57f8fb9b-d3a3-430e-abe6-70210f8147e9	products.view	products	view	View Products	مصنوعات دیکھیں	2026-10-17 15:00:49.425821+00
719dfaf1-ff0a-4fd8-a6e3-981b970819c1	products.create	products	create	Create Products	مصنوعات بنائیں	2026-10-17 15:00:49.425821+00
1b798026-a3e5-4546-acce-9d515581f8d0	products.edit	products	edit	Edit Products	مصنوعات میں ترمیم کریں	2026-10-17 15:00:49.425821+00
4644c284-7571-4e37-9b9c-13b3aed2be16	products.delete	products	delete	Delete Products	مصنوعات حذف کریں	2026-10-17 15:00:49.425821+00
de359623-9e3a-4eeb-9b5b-0ad277ac1105	sales.view	sales	view	View Sales	فروخت دیکھیں	2026-10-17 15:00:49.425821+00
83b82f80-97af-4712-ae4f-37f6118aeb07	sales.create	sales	create	Create Sales	فروخت بنائیں	2026-10-17 15:00:49.425821+00
b6e85d60-166b-4a2a-9bbe-dcd7b45577ee	sales.void	sales	void	Void Sales	فروخت منسوخ کریں	2026-10-17 15:00:49.425821+00
9e83412e-68fd-402f-92b3-87ec0ebdf9b2	returns.view	returns	view	View Returns	واپسیاں دیکھیں	2026-10-17 15:00:49.425821+00
d6052864-4aa9-499d-a12b-36eda7ccfa9d	returns.create	returns	create	Process Returns	واپسیاں کریں	2026-10-17 15:00:49.425821+00
ea134047-32e1-4cf5-b3eb-7f3379f6cc1c	purchases.view	purchases	view	View Purchases	خریداری دیکھیں	2026-10-17 15:00:49.425821+00
788d8901-f4c2-47e4-ad63-30c07fd8ed93	purchases.create	purchases	create	Create Purchases	خریداری بنائیں	2026-10-17 15:00:49.425821+00
ed15f502-4d8e-4d2c-aaff-92473e4fcf9b	payments.view	payments	view	View Payments	ادائیگیاں دیکھیں	2026-10-17 15:00:49.425821+00
52cb4f1b-7d02-4235-87b0-2e7129ce4b0b	payments.supplier	payments	supplier	Record Supplier Payments	سپلائر ادائیگیاں درج کریں	2026-10-17 15:00:49.425821+00
288053f4-01bb-496d-94e3-7de326ff73b4	inventory.view	inventory	view	View Inventory	انوینٹری دیکھیں	2026-10-17 15:00:49.425821+00
ce225fa4-5da6-4099-8856-3497e60b1ba3	inventory.adjust	inventory	adjust	Adjust Stock	اسٹاک ایڈجسٹ کریں	2026-10-17 15:00:49.425821+00
bba513e5-ae2e-4f6f-a076-f34dee072389	companies.view	companies	view	View Suppliers	سپلائرز دیکھیں	2026-10-17 15:00:49.425821+00
037ac30c-f7de-4849-bf64-ff598586f008	companies.create	companies	create	Create Suppliers	سپلائرز بنائیں	2026-10-17 15:00:49.425821+00
2e4aa150-f081-4c35-85ad-78eecedccc1e	companies.edit	companies	edit	Edit Suppliers	سپلائرز میں ترمیم کریں	2026-10-17 15:00:49.425821+00
7622b73c-c72a-4f91-86c3-193f4ab7e5d5	reports.view	reports	view	View Reports	رپورٹس دیکھیں	2026-10-17 15:00:49.425821+00
77c39679-9b73-440c-a318-4208769cde7f	employees.view	employees	view	View Employees	عملہ دیکھیں	2026-10-17 15:00:49.425821+00
87704489-d385-4cab-90de-5c504eef8baf	employees.manage	employees	manage	Manage Employees	عملہ میں ترمیم کریں	2026-10-17 15:00:49.425821+00
9d2e41d6-849f-4117-afd7-e0a66f8112a6	settings.view	settings	view	View Settings	ترتیبات دیکھیں	2026-10-17 15:00:49.425821+00
3b27e449-f0c9-4d1c-bad6-d9945817577b	settings.edit	settings	edit	Edit Settings	ترتیبات میں ترمیم کریں	2026-10-17 15:00:49.425821+00
52552ba7-d5bb-45d8-916d-95c4a77188f1	activity.view	activity	view	View Activity Log	سرگرمی لاگ دیکھیں	2026-10-17 15:00:49.425821+00
49e0fa8a-a447-47de-b088-e0c9470d23e7	notifications.view	notifications	view	View Notifications	اطلاعات دیکھیں	2026-10-17 15:00:49.425821+00
2ac7cbf3-6ae7-40f0-94d4-41882a6c6564	alerts.view	alerts	view	View Action Center	ایکشن سینٹر دیکھیں	2026-10-17 15:00:49.425821+00
1ef7fc1d-a46e-4615-b912-a41dd96ff45d	alerts.manage	alerts	manage	Manage Alerts	الرٹس میں ترمیم کریں	2026-10-17 15:00:49.425821+00
\.


--
-- Data for Name: product_barcodes; Type: TABLE DATA; Schema: public; Owner: -
--


COPY public.role_permissions (id, role_id, permission_id, created_at) FROM stdin;
2df8a197-9619-4b26-8566-5481b6d477ba	dc1f76e5-873a-4043-8e64-d0b2245e1351	4d02a069-fd6e-41d8-ac8e-e00618dbcd48	2026-10-17 15:00:49.425821+00
f65d34e8-76f4-4e60-bcb7-69089e155ad0	dc1f76e5-873a-4043-8e64-d0b2245e1351	736c2960-d6c4-4f43-a9c8-a323f9bd10f0	2026-10-17 15:00:49.425821+00
21cf5a76-f04c-470d-bc94-f040afceafc3	dc1f76e5-873a-4043-8e64-d0b2245e1351	57f8fb9b-d3a3-430e-abe6-70210f8147e9	2026-10-17 15:00:49.425821+00
436737c5-b54a-4ea3-8097-28b772327009	dc1f76e5-873a-4043-8e64-d0b2245e1351	de359623-9e3a-4eeb-9b5b-0ad277ac1105	2026-10-17 15:00:49.425821+00
15fd3b9a-60e2-4065-9642-5d0eaa2b6a7c	dc1f76e5-873a-4043-8e64-d0b2245e1351	83b82f80-97af-4712-ae4f-37f6118aeb07	2026-10-17 15:00:49.425821+00
198e34a2-198f-4619-bc89-72f393f4ba9b	dc1f76e5-873a-4043-8e64-d0b2245e1351	288053f4-01bb-496d-94e3-7de326ff73b4	2026-10-17 15:00:49.425821+00
89340716-f841-4692-9a24-e0cbd425b8db	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	4d02a069-fd6e-41d8-ac8e-e00618dbcd48	2026-10-17 15:00:49.425821+00
1290d04c-205a-4c18-ab46-7fd946ac1f06	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	736c2960-d6c4-4f43-a9c8-a323f9bd10f0	2026-10-17 15:00:49.425821+00
09b7e5cc-e289-4966-9f43-e115f2139c5c	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	a72ca83e-57af-4ad8-a805-95f6190f3b1d	2026-10-17 15:00:49.425821+00
e6045eae-0134-4dc2-93ba-28278f78d554	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	e636b0cd-f790-4b75-8c43-b1fc8a7da136	2026-10-17 15:00:49.425821+00
6155d91e-ba9f-4319-aaa6-829acc05d0c4	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	57f8fb9b-d3a3-430e-abe6-70210f8147e9	2026-10-17 15:00:49.425821+00
04219b9c-df9e-4846-9019-c4da11d75cbd	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	de359623-9e3a-4eeb-9b5b-0ad277ac1105	2026-10-17 15:00:49.425821+00
85b93336-ecef-48ba-8762-81f5c030c5f1	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	83b82f80-97af-4712-ae4f-37f6118aeb07	2026-10-17 15:00:49.425821+00
420a506b-4da8-4f63-b99d-dfe2ef2d1eff	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	b6e85d60-166b-4a2a-9bbe-dcd7b45577ee	2026-10-17 15:00:49.425821+00
998ff521-13d0-4925-91ce-9387ad72732e	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	9e83412e-68fd-402f-92b3-87ec0ebdf9b2	2026-10-17 15:00:49.425821+00
0e164492-8be9-4fd0-8be2-b6dd26ba1877	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	d6052864-4aa9-499d-a12b-36eda7ccfa9d	2026-10-17 15:00:49.425821+00
a454d128-0e57-41f9-b8be-c10212da2505	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	288053f4-01bb-496d-94e3-7de326ff73b4	2026-10-17 15:00:49.425821+00
e2392cf7-d87e-4088-9860-18e52801cbb3	cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	7622b73c-c72a-4f91-86c3-193f4ab7e5d5	2026-10-17 15:00:49.425821+00
734a80c8-6048-4ded-b5ee-7265cd18ef40	ea2c0487-184e-4d04-ac8d-2da78aefa143	4d02a069-fd6e-41d8-ac8e-e00618dbcd48	2026-10-17 15:00:49.425821+00
2bf0fb30-e0f8-40bf-bc0f-72b02892ad27	ea2c0487-184e-4d04-ac8d-2da78aefa143	736c2960-d6c4-4f43-a9c8-a323f9bd10f0	2026-10-17 15:00:49.425821+00
ca5e8703-18e6-4c2c-936a-46013aad4dd6	ea2c0487-184e-4d04-ac8d-2da78aefa143	a72ca83e-57af-4ad8-a805-95f6190f3b1d	2026-10-17 15:00:49.425821+00
cab0d88b-f686-424c-8232-c2621872b32c	ea2c0487-184e-4d04-ac8d-2da78aefa143	f600ef7b-6c07-4755-a6c6-e4563fff08f4	2026-10-17 15:00:49.425821+00
a7a622a4-36de-43b6-ab41-08ea4572e811	ea2c0487-184e-4d04-ac8d-2da78aefa143	e636b0cd-f790-4b75-8c43-b1fc8a7da136	2026-10-17 15:00:49.425821+00
d4c97cb8-a738-46b9-aaa7-6560d65481c5	ea2c0487-184e-4d04-ac8d-2da78aefa143	57f8fb9b-d3a3-430e-abe6-70210f8147e9	2026-10-17 15:00:49.425821+00
43b2ba9b-8733-4439-8c17-4ffe88d3552c	ea2c0487-184e-4d04-ac8d-2da78aefa143	719dfaf1-ff0a-4fd8-a6e3-981b970819c1	2026-10-17 15:00:49.425821+00
73e3d381-05aa-413b-b355-21a7977862b0	ea2c0487-184e-4d04-ac8d-2da78aefa143	1b798026-a3e5-4546-acce-9d515581f8d0	2026-10-17 15:00:49.425821+00
3c40b7a7-b3fc-4bfa-ad45-edd49f4f90bf	ea2c0487-184e-4d04-ac8d-2da78aefa143	4644c284-7571-4e37-9b9c-13b3aed2be16	2026-10-17 15:00:49.425821+00
889608a2-687a-4e3a-815c-4f61b92ff5a1	ea2c0487-184e-4d04-ac8d-2da78aefa143	de359623-9e3a-4eeb-9b5b-0ad277ac1105	2026-10-17 15:00:49.425821+00
e4ab9049-a1fa-44af-8818-a31a07d73334	ea2c0487-184e-4d04-ac8d-2da78aefa143	83b82f80-97af-4712-ae4f-37f6118aeb07	2026-10-17 15:00:49.425821+00
8d78ac39-08ab-4001-8cb7-c17b803178b5	ea2c0487-184e-4d04-ac8d-2da78aefa143	b6e85d60-166b-4a2a-9bbe-dcd7b45577ee	2026-10-17 15:00:49.425821+00
99ae9b39-b016-4c38-9bfd-269b4116226e	ea2c0487-184e-4d04-ac8d-2da78aefa143	9e83412e-68fd-402f-92b3-87ec0ebdf9b2	2026-10-17 15:00:49.425821+00
3419bd74-9678-4dcf-84a8-b73f813a12dd	ea2c0487-184e-4d04-ac8d-2da78aefa143	d6052864-4aa9-499d-a12b-36eda7ccfa9d	2026-10-17 15:00:49.425821+00
854f1adc-f66a-410b-a0aa-61576fdc3745	ea2c0487-184e-4d04-ac8d-2da78aefa143	ea134047-32e1-4cf5-b3eb-7f3379f6cc1c	2026-10-17 15:00:49.425821+00
91528d1d-854f-4a4c-8967-8d29e128a0bc	ea2c0487-184e-4d04-ac8d-2da78aefa143	788d8901-f4c2-47e4-ad63-30c07fd8ed93	2026-10-17 15:00:49.425821+00
1d666076-5f2d-4810-927e-a3534da5de60	ea2c0487-184e-4d04-ac8d-2da78aefa143	ed15f502-4d8e-4d2c-aaff-92473e4fcf9b	2026-10-17 15:00:49.425821+00
7322015d-6fa0-44cb-a083-7d3e8a910c14	ea2c0487-184e-4d04-ac8d-2da78aefa143	52cb4f1b-7d02-4235-87b0-2e7129ce4b0b	2026-10-17 15:00:49.425821+00
2d53f5d5-8c55-41d4-b544-e95cdd6f606d	ea2c0487-184e-4d04-ac8d-2da78aefa143	288053f4-01bb-496d-94e3-7de326ff73b4	2026-10-17 15:00:49.425821+00
bb1cb02d-15c3-490e-b203-2b9fa8a6e35a	ea2c0487-184e-4d04-ac8d-2da78aefa143	ce225fa4-5da6-4099-8856-3497e60b1ba3	2026-10-17 15:00:49.425821+00
e22eaf7f-b6bd-45a0-9866-6ee1cf100c25	ea2c0487-184e-4d04-ac8d-2da78aefa143	bba513e5-ae2e-4f6f-a076-f34dee072389	2026-10-17 15:00:49.425821+00
88a5f65f-2163-4256-9062-3bae5776d4e8	ea2c0487-184e-4d04-ac8d-2da78aefa143	037ac30c-f7de-4849-bf64-ff598586f008	2026-10-17 15:00:49.425821+00
50ff169b-9751-469e-aed5-bbc1269002da	ea2c0487-184e-4d04-ac8d-2da78aefa143	2e4aa150-f081-4c35-85ad-78eecedccc1e	2026-10-17 15:00:49.425821+00
e72060f3-57e8-4d24-baf7-d3d363503902	ea2c0487-184e-4d04-ac8d-2da78aefa143	7622b73c-c72a-4f91-86c3-193f4ab7e5d5	2026-10-17 15:00:49.425821+00
b45887d6-8010-4afa-9618-3c11b16372ce	ea2c0487-184e-4d04-ac8d-2da78aefa143	9d2e41d6-849f-4117-afd7-e0a66f8112a6	2026-10-17 15:00:49.425821+00
432dbbef-e538-4efd-b50d-0835a53963d4	ea2c0487-184e-4d04-ac8d-2da78aefa143	52552ba7-d5bb-45d8-916d-95c4a77188f1	2026-10-17 15:00:49.425821+00
49abd067-af8a-42c3-b90a-1c5f850ab8a4	ea2c0487-184e-4d04-ac8d-2da78aefa143	49e0fa8a-a447-47de-b088-e0c9470d23e7	2026-10-17 15:00:49.425821+00
63641074-cc38-4ec3-b08f-ebb02e592a9d	ea2c0487-184e-4d04-ac8d-2da78aefa143	2ac7cbf3-6ae7-40f0-94d4-41882a6c6564	2026-10-17 15:00:49.425821+00
0c7f7a14-9378-4c28-ade1-ff7147971925	ea2c0487-184e-4d04-ac8d-2da78aefa143	1ef7fc1d-a46e-4615-b912-a41dd96ff45d	2026-10-17 15:00:49.425821+00
96c05b16-9b93-4608-9cbb-1fbd94d8d22d	a7487843-b703-4362-a1f8-2762461a2f3e	57f8fb9b-d3a3-430e-abe6-70210f8147e9	2026-10-17 15:00:49.425821+00
a027806b-78aa-4b92-9869-682c4302fe12	a7487843-b703-4362-a1f8-2762461a2f3e	719dfaf1-ff0a-4fd8-a6e3-981b970819c1	2026-10-17 15:00:49.425821+00
01983e81-6b11-4b2e-bc13-82aaa669d279	a7487843-b703-4362-a1f8-2762461a2f3e	1b798026-a3e5-4546-acce-9d515581f8d0	2026-10-17 15:00:49.425821+00
56688c03-35df-429a-b416-2ed5f7a0fed8	a7487843-b703-4362-a1f8-2762461a2f3e	ea134047-32e1-4cf5-b3eb-7f3379f6cc1c	2026-10-17 15:00:49.425821+00
caf121c2-cf97-4cc9-b2ed-1753a2cf1183	a7487843-b703-4362-a1f8-2762461a2f3e	788d8901-f4c2-47e4-ad63-30c07fd8ed93	2026-10-17 15:00:49.425821+00
af646841-fdbd-403a-8e84-91df90376445	a7487843-b703-4362-a1f8-2762461a2f3e	ed15f502-4d8e-4d2c-aaff-92473e4fcf9b	2026-10-17 15:00:49.425821+00
936193df-2cb2-4250-be5e-c61268b535ce	a7487843-b703-4362-a1f8-2762461a2f3e	52cb4f1b-7d02-4235-87b0-2e7129ce4b0b	2026-10-17 15:00:49.425821+00
79f74247-b952-4c2c-8303-62530346cb6a	a7487843-b703-4362-a1f8-2762461a2f3e	288053f4-01bb-496d-94e3-7de326ff73b4	2026-10-17 15:00:49.425821+00
04c13858-a0b4-4d42-922d-1c08cc633c82	a7487843-b703-4362-a1f8-2762461a2f3e	ce225fa4-5da6-4099-8856-3497e60b1ba3	2026-10-17 15:00:49.425821+00
f7fd8b4e-66ce-4d6f-a4f6-99ba76e022f2	a7487843-b703-4362-a1f8-2762461a2f3e	bba513e5-ae2e-4f6f-a076-f34dee072389	2026-10-17 15:00:49.425821+00
c761a93f-39e5-4556-84a1-b62a6fd823d1	a7487843-b703-4362-a1f8-2762461a2f3e	037ac30c-f7de-4849-bf64-ff598586f008	2026-10-17 15:00:49.425821+00
c0ddab54-bb62-40ca-96b5-928ca0a29f7e	a7487843-b703-4362-a1f8-2762461a2f3e	2e4aa150-f081-4c35-85ad-78eecedccc1e	2026-10-17 15:00:49.425821+00
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--


COPY public.roles (id, tenant_id, name, description, is_system, created_at, updated_at) FROM stdin;
dc1f76e5-873a-4043-8e64-d0b2245e1351	00000000-0000-0000-0000-000000000001	Sales Employee	Shop floor: sales, customers, product viewing	t	2026-10-17 15:00:49.425821+00	2026-10-17 15:00:49.425821+00
cd0c4f57-f18c-4dca-9c92-09e9f0dfa2c8	00000000-0000-0000-0000-000000000001	Sales Manager	Full sales management: sales, customers, returns, reports	t	2026-10-17 15:00:49.425821+00	2026-10-17 15:00:49.425821+00
ea2c0487-184e-4d04-ac8d-2da78aefa143	00000000-0000-0000-0000-000000000001	Store Manager	Full store operations: all except employee/settings management	t	2026-10-17 15:00:49.425821+00	2026-10-17 15:00:49.425821+00
a7487843-b703-4362-a1f8-2762461a2f3e	00000000-0000-0000-0000-000000000001	Inventory Clerk	Stock management: products, inventory, suppliers	t	2026-10-17 15:00:49.425821+00	2026-10-17 15:00:49.425821+00
\.


--
-- Data for Name: sale_items; Type: TABLE DATA; Schema: public; Owner: -
--


COPY public.shops (id, name, phone, address, owner_id, created_at, join_code, marketplace_enabled, latitude, longitude, location_label, location_source) FROM stdin;
00000000-0000-0000-0000-000000000001	AgriShop Local Development	\N	\N	\N	2026-08-24 21:37:09.170551+00	\N	f	\N	\N	\N	\N
\.


--
-- Data for Name: stock_adjustments; Type: TABLE DATA; Schema: public; Owner: -
--


COPY storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type, versioning_status, lifecycle_configuration, lifecycle_configuration_generation) FROM stdin;
product-images	product-images	\N	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00	t	f	\N	\N	\N	STANDARD	DISABLED	\N	\N
employee-photos	employee-photos	\N	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00	t	f	\N	\N	\N	STANDARD	DISABLED	\N	\N
company-logos	company-logos	\N	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00	t	f	\N	\N	\N	STANDARD	DISABLED	\N	\N
customer-images	customer-images	\N	2026-08-24 21:37:09.170551+00	2026-08-24 21:37:09.170551+00	t	f	\N	\N	\N	STANDARD	DISABLED	\N	\N
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: -
--


SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 100, true);


--
-- Name: subscription_id_seq; Type: SEQUENCE SET; Schema: realtime; Owner: -
--


SELECT pg_catalog.setval('realtime.subscription_id_seq', 8749, true);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_mfa_factor_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_mfa_factor_id_key UNIQUE (mfa_factor_id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_user_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_user_id_key UNIQUE (user_id);


--
-- Name: mfa_recovery_codes mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: scim_tokens scim_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.scim_tokens
    ADD CONSTRAINT scim_tokens_pkey PRIMARY KEY (id);


--
-- Name: scim_users scim_users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: barcode_history barcode_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.barcode_history
    ADD CONSTRAINT barcode_history_pkey PRIMARY KEY (id);


--
-- Name: barcode_registry barcode_registry_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.barcode_registry
    ADD CONSTRAINT barcode_registry_code_unique UNIQUE (shop_id, code);


--
-- Name: barcode_registry barcode_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.barcode_registry
    ADD CONSTRAINT barcode_registry_pkey PRIMARY KEY (id);


--
-- Name: branch_responsibility branch_responsibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branch_responsibility
    ADD CONSTRAINT branch_responsibility_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: business_settings business_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.business_settings
    ADD CONSTRAINT business_settings_pkey PRIMARY KEY (id);


--
-- Name: cash_reconciliations cash_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.cash_reconciliations
    ADD CONSTRAINT cash_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: client_error_events client_error_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.client_error_events
    ADD CONSTRAINT client_error_events_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: credit_limit_requests credit_limit_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.credit_limit_requests
    ADD CONSTRAINT credit_limit_requests_pkey PRIMARY KEY (id);


--
-- Name: customer_crops customer_crops_customer_id_crop_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_crops
    ADD CONSTRAINT customer_crops_customer_id_crop_name_key UNIQUE (customer_id, crop_name);


--
-- Name: customer_crops customer_crops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_crops
    ADD CONSTRAINT customer_crops_pkey PRIMARY KEY (id);


--
-- Name: customer_payments customer_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_pkey PRIMARY KEY (id);


--
-- Name: customers customers_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_unique UNIQUE (phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: incident_rate_limits incident_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.incident_rate_limits
    ADD CONSTRAINT incident_rate_limits_pkey PRIMARY KEY (actor_id, component, window_start);


--
-- Name: incident_signatures incident_signatures_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.incident_signatures
    ADD CONSTRAINT incident_signatures_fingerprint_key UNIQUE (fingerprint);


--
-- Name: incident_signatures incident_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.incident_signatures
    ADD CONSTRAINT incident_signatures_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_user_id_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_tenant_id_key UNIQUE (user_id, tenant_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_key UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: product_barcodes product_barcodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: purchase_items purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_purchase_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_purchase_number_key UNIQUE (purchase_number);


--
-- Name: reminder_configs reminder_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_configs
    ADD CONSTRAINT reminder_configs_pkey PRIMARY KEY (id);


--
-- Name: reminder_logs reminder_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_pkey PRIMARY KEY (id);


--
-- Name: reminder_occurrences reminder_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_occurrences
    ADD CONSTRAINT reminder_occurrences_pkey PRIMARY KEY (id);


--
-- Name: return_items return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_pkey PRIMARY KEY (id);


--
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


--
-- Name: returns returns_return_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_return_number_key UNIQUE (return_number);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: sale_items sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);


--
-- Name: sale_submissions sale_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_submissions
    ADD CONSTRAINT sale_submissions_pkey PRIMARY KEY (shop_id, idempotency_key);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: sales sales_sale_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_sale_number_key UNIQUE (sale_number);


--
-- Name: shop_requests shop_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.shop_requests
    ADD CONSTRAINT shop_requests_pkey PRIMARY KEY (id);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: stock_adjustments stock_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id);


--
-- Name: supplier_payments supplier_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_pkey PRIMARY KEY (id);


--
-- Name: reminder_occurrences unique_occurrence_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_occurrences
    ADD CONSTRAINT unique_occurrence_key UNIQUE (occurrence_key);


--
-- Name: cash_reconciliations unique_shop_reconciliation_date; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.cash_reconciliations
    ADD CONSTRAINT unique_shop_reconciliation_date UNIQUE (shop_id, reconciliation_date);


--
-- Name: app_settings unique_shop_setting; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT unique_shop_setting UNIQUE (shop_id, setting_key);


--
-- Name: user_active_shops user_active_shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_active_shops
    ADD CONSTRAINT user_active_shops_pkey PRIMARY KEY (user_id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_permission_id_key UNIQUE (user_id, permission_id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: voids voids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.voids
    ADD CONSTRAINT voids_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_10_16 messages_2026_10_16_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages_2026_10_16
    ADD CONSTRAINT messages_2026_10_16_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_10_17 messages_2026_10_17_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages_2026_10_17
    ADD CONSTRAINT messages_2026_10_17_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_10_18 messages_2026_10_18_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages_2026_10_18
    ADD CONSTRAINT messages_2026_10_18_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_10_19 messages_2026_10_19_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages_2026_10_19
    ADD CONSTRAINT messages_2026_10_19_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_10_20 messages_2026_10_20_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.messages_2026_10_20
    ADD CONSTRAINT messages_2026_10_20_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages messages_payload_exclusive; Type: CHECK CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE realtime.messages
    ADD CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL))) NOT VALID;


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--


ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: bucket_lifecycle_states bucket_lifecycle_states_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.bucket_lifecycle_states
    ADD CONSTRAINT bucket_lifecycle_states_pkey PRIMARY KEY (bucket_id);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: lifecycle_abandoned_artifacts lifecycle_abandoned_artifacts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.lifecycle_abandoned_artifacts
    ADD CONSTRAINT lifecycle_abandoned_artifacts_pkey PRIMARY KEY (bucket_id, key);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: schema_migration_divergences schema_migration_divergences_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--


ALTER TABLE ONLY supabase_migrations.schema_migration_divergences
    ADD CONSTRAINT schema_migration_divergences_pkey PRIMARY KEY (version);


--
-- Name: schema_migration_files schema_migration_files_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--


ALTER TABLE ONLY supabase_migrations.schema_migration_files
    ADD CONSTRAINT schema_migration_files_pkey PRIMARY KEY (version);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--


ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: idx_users_created_at_desc; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_users_email ON auth.users USING btree (email);


--
-- Name: idx_users_last_sign_in_at_desc; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);


--
-- Name: idx_users_name; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: mfa_recovery_codes_set_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX mfa_recovery_codes_set_id_idx ON auth.mfa_recovery_codes USING btree (mfa_recovery_code_set_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: scim_tokens_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_tokens_expires_at_idx ON auth.scim_tokens USING btree (expires_at);


--
-- Name: scim_tokens_revoked_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_tokens_revoked_at_idx ON auth.scim_tokens USING btree (revoked_at);


--
-- Name: scim_tokens_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_tokens_sso_provider_id_idx ON auth.scim_tokens USING btree (sso_provider_id);


--
-- Name: scim_tokens_token_hash_key; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX scim_tokens_token_hash_key ON auth.scim_tokens USING btree (token_hash);


--
-- Name: scim_users_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_created_at_idx ON auth.scim_users USING btree (sso_provider_id, created_at, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_deleted_at_idx ON auth.scim_users USING btree (deleted_at);


--
-- Name: scim_users_external_id_key; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX scim_users_external_id_key ON auth.scim_users USING btree (sso_provider_id, external_id) WHERE ((external_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: scim_users_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_id_idx ON auth.scim_users USING btree (sso_provider_id, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_sso_provider_id_idx ON auth.scim_users USING btree (sso_provider_id);


--
-- Name: scim_users_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_updated_at_idx ON auth.scim_users USING btree (sso_provider_id, updated_at, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_user_id_idx ON auth.scim_users USING btree (user_id);


--
-- Name: scim_users_user_name_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX scim_users_user_name_idx ON auth.scim_users USING btree (sso_provider_id, user_name COLLATE "C", id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_user_name_key; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX scim_users_user_name_key ON auth.scim_users USING btree (sso_provider_id, user_name) WHERE (deleted_at IS NULL);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--


CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--


CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: audit_events_branch_history_idx; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX audit_events_branch_history_idx ON public.audit_events USING btree (tenant_id, branch_id, created_at DESC, id DESC);


--
-- Name: branch_responsibility_one_active; Type: INDEX; Schema: public; Owner: -
--


CREATE UNIQUE INDEX branch_responsibility_one_active ON public.branch_responsibility USING btree (branch_id) WHERE (revoked_at IS NULL);


--
-- Name: branch_responsibility_tenant_idx; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX branch_responsibility_tenant_idx ON public.branch_responsibility USING btree (tenant_id);


--
-- Name: branch_responsibility_user_idx; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX branch_responsibility_user_idx ON public.branch_responsibility USING btree (user_id);


--
-- Name: business_settings_shop_key_idx; Type: INDEX; Schema: public; Owner: -
--


CREATE UNIQUE INDEX business_settings_shop_key_idx ON public.business_settings USING btree (shop_id, setting_key) WHERE (setting_key IS NOT NULL);


--
-- Name: idx_app_settings_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_app_settings_shop_id ON public.app_settings USING btree (shop_id);


--
-- Name: idx_audit_events_entity_type; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_audit_events_entity_type ON public.audit_events USING btree (entity_type);


--
-- Name: idx_audit_events_user_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_audit_events_user_id ON public.audit_events USING btree (user_id);


--
-- Name: idx_branches_tenant; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_branches_tenant ON public.branches USING btree (tenant_id);


--
-- Name: idx_cash_reconciliations_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_cash_reconciliations_shop_id ON public.cash_reconciliations USING btree (shop_id);


--
-- Name: idx_client_error_events_environment_time; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_client_error_events_environment_time ON public.client_error_events USING btree (environment, occurred_at DESC);


--
-- Name: idx_companies_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_companies_shop_id ON public.companies USING btree (shop_id);


--
-- Name: idx_credit_limit_requests_customer; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_credit_limit_requests_customer ON public.credit_limit_requests USING btree (customer_id);


--
-- Name: idx_credit_limit_requests_status; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_credit_limit_requests_status ON public.credit_limit_requests USING btree (status);


--
-- Name: idx_customer_crops_customer; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_customer_crops_customer ON public.customer_crops USING btree (customer_id);


--
-- Name: idx_customer_payments_customer_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_customer_payments_customer_id ON public.customer_payments USING btree (customer_id);


--
-- Name: idx_customers_is_archived; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_customers_is_archived ON public.customers USING btree (is_archived);


--
-- Name: idx_customers_name_phone; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_customers_name_phone ON public.customers USING btree (name, phone);


--
-- Name: idx_customers_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_customers_shop_id ON public.customers USING btree (shop_id);


--
-- Name: idx_inventory_movements_created_at; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_inventory_movements_created_at ON public.inventory_movements USING btree (created_at);


--
-- Name: idx_inventory_movements_product_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_inventory_movements_product_id ON public.inventory_movements USING btree (product_id);


--
-- Name: idx_inventory_movements_variant_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_inventory_movements_variant_id ON public.inventory_movements USING btree (variant_id);


--
-- Name: idx_memberships_tenant; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_memberships_tenant ON public.memberships USING btree (tenant_id);


--
-- Name: idx_memberships_user; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_memberships_user ON public.memberships USING btree (user_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_shop_branch_created; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_notifications_shop_branch_created ON public.notifications USING btree (shop_id, branch_id, created_at DESC);


--
-- Name: idx_permissions_module; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_permissions_module ON public.permissions USING btree (module);


--
-- Name: idx_products_barcode; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_products_barcode ON public.products USING btree (barcode);


--
-- Name: idx_products_barcode_lookup; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_products_barcode_lookup ON public.products USING btree (barcode) WHERE (barcode IS NOT NULL);


--
-- Name: idx_products_base_unit; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_products_base_unit ON public.products USING btree (base_unit);


--
-- Name: idx_products_company_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_products_company_id ON public.products USING btree (company_id);


--
-- Name: idx_products_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_products_shop_id ON public.products USING btree (shop_id);


--
-- Name: idx_products_stock_qty; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_products_stock_qty ON public.products USING btree (stock_qty);


--
-- Name: idx_purchases_created_at; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_purchases_created_at ON public.purchases USING btree (created_at DESC);


--
-- Name: idx_purchases_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_purchases_shop_id ON public.purchases USING btree (shop_id);


--
-- Name: idx_reminder_configs_customer; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_configs_customer ON public.reminder_configs USING btree (customer_id);


--
-- Name: idx_reminder_logs_customer; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_logs_customer ON public.reminder_logs USING btree (customer_id);


--
-- Name: idx_reminder_logs_occurrence; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_logs_occurrence ON public.reminder_logs USING btree (occurrence_id) WHERE (occurrence_id IS NOT NULL);


--
-- Name: idx_reminder_logs_one_per_occurrence; Type: INDEX; Schema: public; Owner: -
--


CREATE UNIQUE INDEX idx_reminder_logs_one_per_occurrence ON public.reminder_logs USING btree (occurrence_id) WHERE (occurrence_id IS NOT NULL);


--
-- Name: idx_reminder_occurrences_config; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_occurrences_config ON public.reminder_occurrences USING btree (config_id);


--
-- Name: idx_reminder_occurrences_customer; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_occurrences_customer ON public.reminder_occurrences USING btree (customer_id);


--
-- Name: idx_reminder_occurrences_scheduled; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_occurrences_scheduled ON public.reminder_occurrences USING btree (scheduled_date);


--
-- Name: idx_reminder_occurrences_status; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_reminder_occurrences_status ON public.reminder_occurrences USING btree (status);


--
-- Name: idx_returns_idempotency_key; Type: INDEX; Schema: public; Owner: -
--


CREATE UNIQUE INDEX idx_returns_idempotency_key ON public.returns USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_returns_sale_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_returns_sale_id ON public.returns USING btree (sale_id);


--
-- Name: idx_role_permissions_role; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_role_permissions_role ON public.role_permissions USING btree (role_id);


--
-- Name: idx_roles_tenant; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_roles_tenant ON public.roles USING btree (tenant_id);


--
-- Name: idx_sale_items_sale_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sale_items_sale_id ON public.sale_items USING btree (sale_id);


--
-- Name: idx_sales_composite_date_status; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_composite_date_status ON public.sales USING btree (created_at DESC, is_voided);


--
-- Name: idx_sales_created_at; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_created_at ON public.sales USING btree (created_at DESC);


--
-- Name: idx_sales_customer_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_customer_id ON public.sales USING btree (customer_id);


--
-- Name: idx_sales_employee_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_employee_id ON public.sales USING btree (employee_id);


--
-- Name: idx_sales_is_voided; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_is_voided ON public.sales USING btree (is_voided);


--
-- Name: idx_sales_payment_method; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_payment_method ON public.sales USING btree (payment_method);


--
-- Name: idx_sales_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_shop_id ON public.sales USING btree (shop_id);


--
-- Name: idx_sales_status; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_sales_status ON public.sales USING btree (status);


--
-- Name: idx_shop_requests_phone; Type: INDEX; Schema: public; Owner: -
--


CREATE UNIQUE INDEX idx_shop_requests_phone ON public.shop_requests USING btree (owner_phone);


--
-- Name: idx_stock_adjustments_variant_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_stock_adjustments_variant_id ON public.stock_adjustments USING btree (variant_id);


--
-- Name: idx_supplier_payments_company_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_supplier_payments_company_id ON public.supplier_payments USING btree (company_id);


--
-- Name: idx_user_permissions_override; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_user_permissions_override ON public.user_permissions USING btree (user_id, is_override, is_granted);


--
-- Name: idx_user_permissions_user; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_user_permissions_user ON public.user_permissions USING btree (user_id);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_shop_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_users_shop_id ON public.users USING btree (shop_id);


--
-- Name: idx_voids_sale_id; Type: INDEX; Schema: public; Owner: -
--


CREATE INDEX idx_voids_sale_id ON public.voids USING btree (sale_id);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_replay_index; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX messages_replay_index ON ONLY realtime.messages USING btree (topic, inserted_at DESC, COALESCE(expires_at, 'infinity'::timestamp without time zone)) WHERE ((extension = 'broadcast'::text) AND (private = true));


--
-- Name: messages_2026_10_16_topic_inserted_at_coalesce_idx; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX messages_2026_10_16_topic_inserted_at_coalesce_idx ON realtime.messages_2026_10_16 USING btree (topic, inserted_at DESC, COALESCE(expires_at, 'infinity'::timestamp without time zone)) WHERE ((extension = 'broadcast'::text) AND (private = true));


--
-- Name: messages_2026_10_17_topic_inserted_at_coalesce_idx; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX messages_2026_10_17_topic_inserted_at_coalesce_idx ON realtime.messages_2026_10_17 USING btree (topic, inserted_at DESC, COALESCE(expires_at, 'infinity'::timestamp without time zone)) WHERE ((extension = 'broadcast'::text) AND (private = true));


--
-- Name: messages_2026_10_18_topic_inserted_at_coalesce_idx; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX messages_2026_10_18_topic_inserted_at_coalesce_idx ON realtime.messages_2026_10_18 USING btree (topic, inserted_at DESC, COALESCE(expires_at, 'infinity'::timestamp without time zone)) WHERE ((extension = 'broadcast'::text) AND (private = true));


--
-- Name: messages_2026_10_19_topic_inserted_at_coalesce_idx; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX messages_2026_10_19_topic_inserted_at_coalesce_idx ON realtime.messages_2026_10_19 USING btree (topic, inserted_at DESC, COALESCE(expires_at, 'infinity'::timestamp without time zone)) WHERE ((extension = 'broadcast'::text) AND (private = true));


--
-- Name: messages_2026_10_20_topic_inserted_at_coalesce_idx; Type: INDEX; Schema: realtime; Owner: -
--


CREATE INDEX messages_2026_10_20_topic_inserted_at_coalesce_idx ON realtime.messages_2026_10_20 USING btree (topic, inserted_at DESC, COALESCE(expires_at, 'infinity'::timestamp without time zone)) WHERE ((extension = 'broadcast'::text) AND (private = true));


--
-- Name: subscription_subscription_id_entity_filters_hash_key; Type: INDEX; Schema: realtime; Owner: -
--


CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_hash_key ON realtime.subscription USING btree (subscription_id, entity, realtime.filters_hash(filters), action_filter, COALESCE(selected_columns, '{}'::text[]));


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucket_lifecycle_states_due_idx; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX bucket_lifecycle_states_due_idx ON storage.bucket_lifecycle_states USING btree (next_run_at, bucket_id) WHERE (next_run_at IS NOT NULL);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: idx_objects_current_version; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (archived_at IS NULL);


--
-- Name: idx_objects_delete_markers; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX idx_objects_delete_markers ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE is_delete_marker;


--
-- Name: idx_objects_null_version; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (NOT is_versioned);


--
-- Name: lifecycle_abandoned_artifacts_attempted_at_idx; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX lifecycle_abandoned_artifacts_attempted_at_idx ON storage.lifecycle_abandoned_artifacts USING btree (attempted_at);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: objects_archived_due_idx; Type: INDEX; Schema: storage; Owner: -
--


CREATE INDEX objects_archived_due_idx ON storage.objects USING btree (bucket_id, archived_at, name COLLATE "C") INCLUDE (id, version, is_delete_marker) WHERE (archived_at IS NOT NULL);


--
-- Name: objects_archived_order_uq; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX objects_archived_order_uq ON storage.objects USING btree (bucket_id, name COLLATE "C", archived_at) WHERE (archived_at IS NOT NULL);


--
-- Name: objects_bucket_id_name_version_key; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects USING btree (bucket_id, name COLLATE "C", version) NULLS NOT DISTINCT;


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--


CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: messages_2026_10_16_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_10_16_pkey;


--
-- Name: messages_2026_10_16_topic_inserted_at_coalesce_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_replay_index ATTACH PARTITION realtime.messages_2026_10_16_topic_inserted_at_coalesce_idx;


--
-- Name: messages_2026_10_17_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_10_17_pkey;


--
-- Name: messages_2026_10_17_topic_inserted_at_coalesce_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_replay_index ATTACH PARTITION realtime.messages_2026_10_17_topic_inserted_at_coalesce_idx;


--
-- Name: messages_2026_10_18_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_10_18_pkey;


--
-- Name: messages_2026_10_18_topic_inserted_at_coalesce_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_replay_index ATTACH PARTITION realtime.messages_2026_10_18_topic_inserted_at_coalesce_idx;


--
-- Name: messages_2026_10_19_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_10_19_pkey;


--
-- Name: messages_2026_10_19_topic_inserted_at_coalesce_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_replay_index ATTACH PARTITION realtime.messages_2026_10_19_topic_inserted_at_coalesce_idx;


--
-- Name: messages_2026_10_20_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_10_20_pkey;


--
-- Name: messages_2026_10_20_topic_inserted_at_coalesce_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--


ALTER INDEX realtime.messages_replay_index ATTACH PARTITION realtime.messages_2026_10_20_topic_inserted_at_coalesce_idx;


--
-- Name: user_active_shops audit_branch_selection_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_branch_selection_trg AFTER INSERT OR UPDATE ON public.user_active_shops FOR EACH ROW EXECUTE FUNCTION public.audit_branch_selection();


--
-- Name: audit_events audit_context_stamp_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_context_stamp_trg BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_context_stamp();


--
-- Name: sales audit_final_sale_created_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE CONSTRAINT TRIGGER audit_final_sale_created_trg AFTER INSERT ON public.sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.audit_final_sale_created();


--
-- Name: audit_events audit_identity_labels_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_identity_labels_trg BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_identity_labels();


--
-- Name: memberships audit_membership_access_change_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_membership_access_change_trg AFTER UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.audit_membership_access_change();


--
-- Name: customer_payments audit_operational_snapshot_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_operational_snapshot_trg AFTER INSERT OR UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.audit_operational_snapshot();


--
-- Name: stock_adjustments audit_operational_snapshot_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_operational_snapshot_trg AFTER INSERT OR UPDATE ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.audit_operational_snapshot();


--
-- Name: supplier_payments audit_operational_snapshot_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER audit_operational_snapshot_trg AFTER INSERT OR UPDATE ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.audit_operational_snapshot();


--
-- Name: memberships clear_active_shop_on_membership_delete_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER clear_active_shop_on_membership_delete_trg AFTER DELETE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.clear_active_shop_on_membership_delete();


--
-- Name: memberships memberships_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.update_memberships_updated_at();


--
-- Name: notifications notifications_stamp; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER notifications_stamp BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notifications_stamp();


--
-- Name: return_items return_items_mirror_qty_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER return_items_mirror_qty_trg BEFORE INSERT OR UPDATE ON public.return_items FOR EACH ROW EXECUTE FUNCTION public.return_items_mirror_qty();


--
-- Name: audit_events stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: customer_payments stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: inventory_movements stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: notifications stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: purchases stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: returns stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.returns FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: sales stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: stock_adjustments stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: supplier_payments stamp_operational_branch_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER stamp_operational_branch_trg BEFORE INSERT ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_branch();


--
-- Name: users trg_prevent_role_escalation; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER trg_prevent_role_escalation BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();


--
-- Name: customers trg_protect_customer_archive; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER trg_protect_customer_archive BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.protect_customer_archive();


--
-- Name: customers trg_protect_customer_financials; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER trg_protect_customer_financials BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.protect_customer_financials();


--
-- Name: products trg_protect_product_stock; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER trg_protect_product_stock BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.protect_product_stock();


--
-- Name: sales trg_protect_sale_financials; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER trg_protect_sale_financials BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.protect_sale_financials();


--
-- Name: companies update_companies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers update_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_variants update_product_variants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER update_product_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sales update_sales_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: memberships validate_member_branch_scope_trg; Type: TRIGGER; Schema: public; Owner: -
--


CREATE TRIGGER validate_member_branch_scope_trg BEFORE INSERT OR UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.validate_member_branch_scope();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--


CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets enforce_versioning_status_transition; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER enforce_versioning_status_transition BEFORE UPDATE OF versioning_status ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_versioning_status_transition();


--
-- Name: buckets protect_active_lifecycle_states; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER protect_active_lifecycle_states BEFORE DELETE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_active_lifecycle_states();


--
-- Name: buckets protect_bucket_control_insert; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');


--
-- Name: buckets protect_bucket_control_update; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();


--
-- Name: buckets protect_bucket_control_update_role; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role');


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: buckets wake_lifecycle_on_policy_write; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER wake_lifecycle_on_policy_write AFTER INSERT OR UPDATE OF lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.wake_lifecycle_state();


--
-- Name: buckets wake_lifecycle_on_versioning_enable; Type: TRIGGER; Schema: storage; Owner: -
--


CREATE TRIGGER wake_lifecycle_on_versioning_enable AFTER UPDATE OF versioning_status ON storage.buckets FOR EACH ROW WHEN ((new.lifecycle_configuration IS NOT NULL)) EXECUTE FUNCTION storage.wake_lifecycle_state();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_mfa_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_mfa_factor_id_fkey FOREIGN KEY (mfa_factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_codes mfa_recovery_codes_mfa_recovery_code_set_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_mfa_recovery_code_set_id_fkey FOREIGN KEY (mfa_recovery_code_set_id) REFERENCES auth.mfa_recovery_code_sets(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_tokens scim_tokens_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.scim_tokens
    ADD CONSTRAINT scim_tokens_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_users scim_users_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_users scim_users_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--


ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: app_settings app_settings_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: branch_responsibility branch_responsibility_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branch_responsibility
    ADD CONSTRAINT branch_responsibility_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: branch_responsibility branch_responsibility_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branch_responsibility
    ADD CONSTRAINT branch_responsibility_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: branch_responsibility branch_responsibility_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branch_responsibility
    ADD CONSTRAINT branch_responsibility_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: branch_responsibility branch_responsibility_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branch_responsibility
    ADD CONSTRAINT branch_responsibility_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: branch_responsibility branch_responsibility_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branch_responsibility
    ADD CONSTRAINT branch_responsibility_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: branches branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: cash_reconciliations cash_reconciliations_reconciled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.cash_reconciliations
    ADD CONSTRAINT cash_reconciliations_reconciled_by_fkey FOREIGN KEY (reconciled_by) REFERENCES public.users(id);


--
-- Name: cash_reconciliations cash_reconciliations_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.cash_reconciliations
    ADD CONSTRAINT cash_reconciliations_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: client_error_events client_error_events_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.client_error_events
    ADD CONSTRAINT client_error_events_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: client_error_events client_error_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.client_error_events
    ADD CONSTRAINT client_error_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: companies companies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: companies companies_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: credit_limit_requests credit_limit_requests_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.credit_limit_requests
    ADD CONSTRAINT credit_limit_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_crops customer_crops_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_crops
    ADD CONSTRAINT customer_crops_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_payments customer_payments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: customer_payments customer_payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: customer_payments customer_payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: customers customers_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id);


--
-- Name: customers customers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: customers customers_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: incidents incidents_signature_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES public.incident_signatures(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: inventory_movements inventory_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inventory_movements inventory_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: inventory_movements inventory_movements_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: memberships memberships_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: memberships memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: product_barcodes product_barcodes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_barcodes product_barcodes_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: product_barcodes product_barcodes_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.product_barcodes
    ADD CONSTRAINT product_barcodes_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: products products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: products products_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: purchase_items purchase_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: purchase_items purchase_items_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchase_items purchase_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: purchases purchases_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: purchases purchases_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: purchases purchases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: purchases purchases_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: reminder_configs reminder_configs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_configs
    ADD CONSTRAINT reminder_configs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: reminder_logs reminder_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: reminder_logs reminder_logs_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.reminder_occurrences(id) ON DELETE CASCADE;


--
-- Name: reminder_occurrences reminder_occurrences_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_occurrences
    ADD CONSTRAINT reminder_occurrences_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.reminder_configs(id) ON DELETE CASCADE;


--
-- Name: reminder_occurrences reminder_occurrences_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.reminder_occurrences
    ADD CONSTRAINT reminder_occurrences_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: return_items return_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: return_items return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id) ON DELETE CASCADE;


--
-- Name: return_items return_items_sale_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_sale_item_id_fkey FOREIGN KEY (sale_item_id) REFERENCES public.sale_items(id);


--
-- Name: return_items return_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: returns returns_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: returns returns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: returns returns_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: returns returns_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: returns returns_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: sale_items sale_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: sale_items sale_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;


--
-- Name: sale_items sale_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: sale_submissions sale_submissions_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_submissions
    ADD CONSTRAINT sale_submissions_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;


--
-- Name: sale_submissions sale_submissions_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sale_submissions
    ADD CONSTRAINT sale_submissions_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: sales sales_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: sales sales_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: sales sales_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: sales sales_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: sales sales_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);


--
-- Name: stock_adjustments stock_adjustments_adjusted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_adjusted_by_fkey FOREIGN KEY (adjusted_by) REFERENCES public.users(id);


--
-- Name: stock_adjustments stock_adjustments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: stock_adjustments stock_adjustments_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: stock_adjustments stock_adjustments_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: supplier_payments supplier_payments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: supplier_payments supplier_payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: supplier_payments supplier_payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: user_active_shops user_active_shops_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_active_shops
    ADD CONSTRAINT user_active_shops_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: user_active_shops user_active_shops_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_active_shops
    ADD CONSTRAINT user_active_shops_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: user_active_shops user_active_shops_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_active_shops
    ADD CONSTRAINT user_active_shops_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: user_permissions user_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: users users_deactivated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.users(id);


--
-- Name: users users_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: voids voids_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.voids
    ADD CONSTRAINT voids_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: voids voids_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


ALTER TABLE ONLY public.voids
    ADD CONSTRAINT voids_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);


--
-- Name: bucket_lifecycle_states bucket_lifecycle_states_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.bucket_lifecycle_states
    ADD CONSTRAINT bucket_lifecycle_states_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--


ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--


ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY app_settings_insert ON public.app_settings FOR INSERT TO authenticated WITH CHECK ((public.app_is_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: app_settings app_settings_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO authenticated USING ((shop_id = public.current_shop_id()));


--
-- Name: app_settings app_settings_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY app_settings_update ON public.app_settings FOR UPDATE TO authenticated USING ((public.app_is_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.app_is_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events audit_events_no_client_writes; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY audit_events_no_client_writes ON public.audit_events FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: audit_events audit_events_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY audit_events_select ON public.audit_events FOR SELECT TO authenticated USING ((public.has_effective_permission('activity.view'::character varying) AND (tenant_id = public.current_shop_id()) AND ((public.allowed_branch_scope() IS NULL) OR (branch_id = ANY (public.allowed_branch_scope())))));


--
-- Name: customer_payments authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.customer_payments FOR SELECT TO authenticated USING (true);


--
-- Name: purchase_items authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.purchase_items FOR SELECT TO authenticated USING (true);


--
-- Name: return_items authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.return_items FOR SELECT TO authenticated USING (true);


--
-- Name: returns authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.returns FOR SELECT TO authenticated USING (true);


--
-- Name: sale_items authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.sale_items FOR SELECT TO authenticated USING (true);


--
-- Name: supplier_payments authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.supplier_payments FOR SELECT TO authenticated USING (true);


--
-- Name: voids authenticated_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY authenticated_select ON public.voids FOR SELECT TO authenticated USING (true);


--
-- Name: barcode_history; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.barcode_history ENABLE ROW LEVEL SECURITY;

--
-- Name: barcode_registry; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.barcode_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: branch_responsibility; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.branch_responsibility ENABLE ROW LEVEL SECURITY;

--
-- Name: branch_responsibility branch_responsibility_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY branch_responsibility_select ON public.branch_responsibility FOR SELECT TO authenticated USING (((tenant_id = public.current_shop_id()) AND ((public.allowed_branch_scope() IS NULL) OR (branch_id = ANY (public.allowed_branch_scope())))));


--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: branches branches_select_tenant; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY branches_select_tenant ON public.branches FOR SELECT TO authenticated USING (((tenant_id = public.current_shop_id()) AND ((public.allowed_branch_scope() IS NULL) OR (id = ANY (public.allowed_branch_scope())))));


--
-- Name: business_settings; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: business_settings business_settings_delete; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY business_settings_delete ON public.business_settings FOR DELETE TO authenticated USING ((shop_id = public.current_shop_id()));


--
-- Name: business_settings business_settings_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY business_settings_insert ON public.business_settings FOR INSERT TO authenticated WITH CHECK ((shop_id = public.current_shop_id()));


--
-- Name: business_settings business_settings_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY business_settings_select ON public.business_settings FOR SELECT TO authenticated USING ((shop_id = public.current_shop_id()));


--
-- Name: business_settings business_settings_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY business_settings_update ON public.business_settings FOR UPDATE TO authenticated USING ((shop_id = public.current_shop_id())) WITH CHECK ((shop_id = public.current_shop_id()));


--
-- Name: cash_reconciliations; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.cash_reconciliations ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_reconciliations cash_reconciliations_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY cash_reconciliations_insert ON public.cash_reconciliations FOR INSERT TO authenticated WITH CHECK ((public.app_is_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: cash_reconciliations cash_reconciliations_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY cash_reconciliations_select ON public.cash_reconciliations FOR SELECT TO authenticated USING ((public.app_is_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: client_error_events; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.client_error_events ENABLE ROW LEVEL SECURITY;

--
-- Name: client_error_events client_error_events_insert_only; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY client_error_events_insert_only ON public.client_error_events FOR INSERT TO authenticated WITH CHECK ((((environment)::text = ANY ((ARRAY['development'::character varying, 'staging'::character varying, 'production'::character varying])::text[])) AND (message IS NOT NULL) AND ((char_length(message) >= 1) AND (char_length(message) <= 500))));


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY companies_delete_anon ON public.companies FOR DELETE TO authenticated USING (false);


--
-- Name: companies companies_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY companies_insert_anon ON public.companies FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: companies companies_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY companies_select_anon ON public.companies FOR SELECT TO authenticated USING (true);


--
-- Name: companies companies_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY companies_update_anon ON public.companies FOR UPDATE TO authenticated USING (false);


--
-- Name: credit_limit_requests; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.credit_limit_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_limit_requests credit_limit_requests_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY credit_limit_requests_delete_anon ON public.credit_limit_requests FOR DELETE TO authenticated USING (false);


--
-- Name: credit_limit_requests credit_limit_requests_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY credit_limit_requests_insert_anon ON public.credit_limit_requests FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: credit_limit_requests credit_limit_requests_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY credit_limit_requests_select ON public.credit_limit_requests FOR SELECT TO authenticated USING (true);


--
-- Name: credit_limit_requests credit_limit_requests_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY credit_limit_requests_update_anon ON public.credit_limit_requests FOR UPDATE TO authenticated USING (false);


--
-- Name: customer_crops; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.customer_crops ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_crops customer_crops_tenant; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customer_crops_tenant ON public.customer_crops TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.customers c
  WHERE ((c.id = customer_crops.customer_id) AND (c.shop_id = public.current_shop_id()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customers c
  WHERE ((c.id = customer_crops.customer_id) AND (c.shop_id = public.current_shop_id())))));


--
-- Name: customer_payments; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_payments customer_payments_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customer_payments_branch_select ON public.customer_payments AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_delete_anon ON public.customers FOR DELETE TO authenticated USING (false);


--
-- Name: customers customers_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: customers customers_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_insert_anon ON public.customers FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: customers customers_insert_auth; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_insert_auth ON public.customers FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: customers customers_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated USING (true);


--
-- Name: customers customers_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_select_anon ON public.customers FOR SELECT TO authenticated USING (true);


--
-- Name: customers customers_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: customers customers_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_update_anon ON public.customers FOR UPDATE TO authenticated USING (false);


--
-- Name: customers customers_update_auth; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY customers_update_auth ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: incident_rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.incident_rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.incident_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: incidents; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements inventory_movements_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY inventory_movements_branch_select ON public.inventory_movements AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: inventory_movements inventory_movements_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY inventory_movements_delete_anon ON public.inventory_movements FOR DELETE TO authenticated USING (false);


--
-- Name: inventory_movements inventory_movements_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY inventory_movements_insert_anon ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: inventory_movements inventory_movements_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY inventory_movements_select_anon ON public.inventory_movements FOR SELECT TO authenticated USING (true);


--
-- Name: inventory_movements inventory_movements_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY inventory_movements_update_anon ON public.inventory_movements FOR UPDATE TO authenticated USING (false);


--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships memberships_select_own; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY memberships_select_own ON public.memberships FOR SELECT TO authenticated USING ((user_id = (NULLIF(((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text), ''::text))::uuid));


--
-- Name: memberships memberships_select_tenant_admin; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY memberships_select_tenant_admin ON public.memberships FOR SELECT TO authenticated USING (((tenant_id = public.current_shop_id()) AND public.app_is_admin()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated WITH CHECK (((shop_id = ANY (public.my_shop_ids())) AND public.notification_branch_visible(branch_id)));


--
-- Name: notifications notifications_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (((shop_id = ANY (public.my_shop_ids())) AND public.notification_branch_visible(branch_id)));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING (((shop_id = ANY (public.my_shop_ids())) AND public.notification_branch_visible(branch_id))) WITH CHECK (((shop_id = ANY (public.my_shop_ids())) AND public.notification_branch_visible(branch_id)));


--
-- Name: companies permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.companies AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('companies.create'::character varying)));


--
-- Name: customer_payments permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.customer_payments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('customers.payments'::character varying)));


--
-- Name: customers permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.customers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('customers.create'::character varying)));


--
-- Name: inventory_movements permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.inventory_movements AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('inventory.adjust'::character varying)));


--
-- Name: products permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('products.create'::character varying)));


--
-- Name: purchases permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.purchases AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('purchases.create'::character varying)));


--
-- Name: returns permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.returns AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('returns.create'::character varying)));


--
-- Name: sales permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.sales AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('sales.create'::character varying)));


--
-- Name: stock_adjustments permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.stock_adjustments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('inventory.adjust'::character varying)));


--
-- Name: supplier_payments permission_insert_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_insert_gate ON public.supplier_payments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('payments.supplier'::character varying)));


--
-- Name: companies permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.companies AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('companies.view'::character varying)));


--
-- Name: customer_payments permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.customer_payments AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('customers.view'::character varying)));


--
-- Name: customers permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('customers.view'::character varying)));


--
-- Name: inventory_movements permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.inventory_movements AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('inventory.view'::character varying)));


--
-- Name: products permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.products AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('products.view'::character varying)));


--
-- Name: purchases permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.purchases AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('purchases.view'::character varying)));


--
-- Name: returns permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.returns AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('returns.view'::character varying)));


--
-- Name: sales permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('sales.view'::character varying)));


--
-- Name: stock_adjustments permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.stock_adjustments AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('inventory.view'::character varying)));


--
-- Name: supplier_payments permission_read_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_read_gate ON public.supplier_payments AS RESTRICTIVE FOR SELECT TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('payments.view'::character varying)));


--
-- Name: companies permission_update_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_update_gate ON public.companies AS RESTRICTIVE FOR UPDATE TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('companies.edit'::character varying))) WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('companies.edit'::character varying)));


--
-- Name: customers permission_update_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_update_gate ON public.customers AS RESTRICTIVE FOR UPDATE TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('customers.edit'::character varying))) WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('customers.edit'::character varying)));


--
-- Name: products permission_update_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_update_gate ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('products.edit'::character varying))) WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('products.edit'::character varying)));


--
-- Name: sales permission_update_gate; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permission_update_gate ON public.sales AS RESTRICTIVE FOR UPDATE TO authenticated USING (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('sales.create'::character varying))) WITH CHECK (((public.current_branch_id() IS NOT NULL) AND public.has_effective_permission('sales.create'::character varying)));


--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions permissions_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY permissions_select ON public.permissions FOR SELECT TO authenticated USING (true);


--
-- Name: product_barcodes; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants product_variants_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY product_variants_delete_anon ON public.product_variants FOR DELETE TO authenticated USING (false);


--
-- Name: product_variants product_variants_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY product_variants_insert ON public.product_variants FOR INSERT TO authenticated WITH CHECK ((public.app_is_admin() AND (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND (p.shop_id = public.current_shop_id()))))));


--
-- Name: product_variants product_variants_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY product_variants_select ON public.product_variants FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND (p.shop_id = public.current_shop_id())))));


--
-- Name: product_variants product_variants_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY product_variants_update ON public.product_variants FOR UPDATE TO authenticated USING ((public.app_is_admin() AND (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND (p.shop_id = public.current_shop_id())))))) WITH CHECK ((public.app_is_admin() AND (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND (p.shop_id = public.current_shop_id()))))));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY products_delete_anon ON public.products FOR DELETE TO authenticated USING (false);


--
-- Name: products products_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY products_insert_anon ON public.products FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: products products_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY products_select_anon ON public.products FOR SELECT TO authenticated USING (true);


--
-- Name: products products_update_all; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY products_update_all ON public.products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: products products_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY products_update_anon ON public.products FOR UPDATE TO authenticated USING (false);


--
-- Name: companies public_all_companies; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY public_all_companies ON public.companies TO authenticated USING (true) WITH CHECK (true);


--
-- Name: inventory_movements public_all_inventory_movements; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY public_all_inventory_movements ON public.inventory_movements TO authenticated USING (true) WITH CHECK (true);


--
-- Name: products public_all_products; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY public_all_products ON public.products TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchases public_all_purchases; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY public_all_purchases ON public.purchases TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shop_requests public_all_shop_requests; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY public_all_shop_requests ON public.shop_requests TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shops public_all_shops; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY public_all_shops ON public.shops TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_items; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_items purchase_items_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchase_items_delete_anon ON public.purchase_items FOR DELETE TO authenticated USING (false);


--
-- Name: purchase_items purchase_items_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchase_items_insert_anon ON public.purchase_items FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: purchase_items purchase_items_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchase_items_select_anon ON public.purchase_items FOR SELECT TO authenticated USING (true);


--
-- Name: purchase_items purchase_items_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchase_items_update_anon ON public.purchase_items FOR UPDATE TO authenticated USING (false);


--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases purchases_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchases_branch_select ON public.purchases AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: purchases purchases_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchases_delete_anon ON public.purchases FOR DELETE TO authenticated USING (false);


--
-- Name: purchases purchases_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchases_insert_anon ON public.purchases FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: purchases purchases_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchases_select_anon ON public.purchases FOR SELECT TO authenticated USING (true);


--
-- Name: purchases purchases_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY purchases_update_anon ON public.purchases FOR UPDATE TO authenticated USING (false);


--
-- Name: reminder_configs; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.reminder_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_configs reminder_configs_delete; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_configs_delete ON public.reminder_configs FOR DELETE TO authenticated USING ((shop_id = public.current_shop_id()));


--
-- Name: reminder_configs reminder_configs_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_configs_insert ON public.reminder_configs FOR INSERT TO authenticated WITH CHECK (((shop_id = public.current_shop_id()) AND ((customer_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.customers c
  WHERE ((c.id = reminder_configs.customer_id) AND (c.shop_id = public.current_shop_id())))))));


--
-- Name: reminder_configs reminder_configs_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_configs_select ON public.reminder_configs FOR SELECT TO authenticated USING ((shop_id = public.current_shop_id()));


--
-- Name: reminder_configs reminder_configs_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_configs_update ON public.reminder_configs FOR UPDATE TO authenticated USING ((shop_id = public.current_shop_id())) WITH CHECK ((shop_id = public.current_shop_id()));


--
-- Name: reminder_logs; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_logs reminder_logs_all; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_logs_all ON public.reminder_logs TO authenticated USING (true);


--
-- Name: reminder_occurrences; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.reminder_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_occurrences reminder_occurrences_all; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_occurrences_all ON public.reminder_occurrences TO authenticated USING (true);


--
-- Name: reminder_occurrences reminder_occurrences_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_occurrences_insert_anon ON public.reminder_occurrences FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: reminder_occurrences reminder_occurrences_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_occurrences_select_anon ON public.reminder_occurrences FOR SELECT TO authenticated USING (true);


--
-- Name: reminder_occurrences reminder_occurrences_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY reminder_occurrences_update_anon ON public.reminder_occurrences FOR UPDATE TO authenticated USING (false);


--
-- Name: return_items; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: return_items return_items_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY return_items_delete_anon ON public.return_items FOR DELETE TO authenticated USING (false);


--
-- Name: return_items return_items_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY return_items_insert_anon ON public.return_items FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: return_items return_items_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY return_items_select_anon ON public.return_items FOR SELECT TO authenticated USING (true);


--
-- Name: return_items return_items_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY return_items_update_anon ON public.return_items FOR UPDATE TO authenticated USING (false);


--
-- Name: returns; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

--
-- Name: returns returns_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY returns_branch_select ON public.returns AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: returns returns_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY returns_delete_anon ON public.returns FOR DELETE TO authenticated USING (false);


--
-- Name: returns returns_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY returns_insert_anon ON public.returns FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: returns returns_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY returns_select_anon ON public.returns FOR SELECT TO authenticated USING (true);


--
-- Name: returns returns_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY returns_update_anon ON public.returns FOR UPDATE TO authenticated USING (false);


--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions role_permissions_delete; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY role_permissions_delete ON public.role_permissions FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = public.current_shop_id())))) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = public.app_current_user_id()) AND (u.role = 'admin'::public.user_role))))));


--
-- Name: role_permissions role_permissions_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY role_permissions_insert ON public.role_permissions FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = public.current_shop_id())))) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = public.app_current_user_id()) AND (u.role = 'admin'::public.user_role))))));


--
-- Name: role_permissions role_permissions_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY role_permissions_select ON public.role_permissions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = public.current_shop_id())))));


--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: roles roles_delete; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY roles_delete ON public.roles FOR DELETE TO authenticated USING (((tenant_id = public.current_shop_id()) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = public.app_current_user_id()) AND (u.role = 'admin'::public.user_role)))) AND (NOT is_system)));


--
-- Name: roles roles_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY roles_insert ON public.roles FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.current_shop_id()) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = public.app_current_user_id()) AND (u.role = 'admin'::public.user_role))))));


--
-- Name: roles roles_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY roles_select ON public.roles FOR SELECT TO authenticated USING ((tenant_id = public.current_shop_id()));


--
-- Name: roles roles_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY roles_update ON public.roles FOR UPDATE TO authenticated USING (((tenant_id = public.current_shop_id()) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = public.app_current_user_id()) AND (u.role = 'admin'::public.user_role))))));


--
-- Name: sale_items; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_items sale_items_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sale_items_delete_anon ON public.sale_items FOR DELETE TO authenticated USING (false);


--
-- Name: sale_items sale_items_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sale_items_insert_anon ON public.sale_items FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: sale_items sale_items_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sale_items_select_anon ON public.sale_items FOR SELECT TO authenticated USING (true);


--
-- Name: sale_items sale_items_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sale_items_update_anon ON public.sale_items FOR UPDATE TO authenticated USING (false);


--
-- Name: sale_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.sale_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_submissions sale_submissions_no_client_access; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sale_submissions_no_client_access ON public.sale_submissions TO authenticated USING (false) WITH CHECK (false);


--
-- Name: sales; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

--
-- Name: sales sales_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_branch_select ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: sales sales_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_delete_anon ON public.sales FOR DELETE TO authenticated USING (false);


--
-- Name: sales sales_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_insert ON public.sales FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: sales sales_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_insert_anon ON public.sales FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: sales sales_insert_auth; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_insert_auth ON public.sales FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: sales sales_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated USING (true);


--
-- Name: sales sales_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_select_anon ON public.sales FOR SELECT TO authenticated USING (true);


--
-- Name: sales sales_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_update ON public.sales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sales sales_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_update_anon ON public.sales FOR UPDATE TO authenticated USING (false);


--
-- Name: sales sales_update_auth; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY sales_update_auth ON public.sales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shop_requests; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.shop_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_requests shop_requests_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY shop_requests_insert_anon ON public.shop_requests FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: shop_requests shop_requests_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY shop_requests_select_anon ON public.shop_requests FOR SELECT TO authenticated USING (true);


--
-- Name: shop_requests shop_requests_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY shop_requests_update_anon ON public.shop_requests FOR UPDATE TO authenticated USING (false);


--
-- Name: shops; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_adjustments stock_adjustments_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY stock_adjustments_branch_select ON public.stock_adjustments AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: stock_adjustments stock_adjustments_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY stock_adjustments_insert ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK ((public.app_is_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: stock_adjustments stock_adjustments_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY stock_adjustments_select ON public.stock_adjustments FOR SELECT TO authenticated USING ((public.app_is_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: supplier_payments; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_payments supplier_payments_branch_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY supplier_payments_branch_select ON public.supplier_payments AS RESTRICTIVE FOR SELECT TO authenticated USING ((branch_id = ANY (public.current_branch_scope())));


--
-- Name: supplier_payments supplier_payments_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY supplier_payments_delete_anon ON public.supplier_payments FOR DELETE TO authenticated USING (false);


--
-- Name: supplier_payments supplier_payments_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY supplier_payments_insert_anon ON public.supplier_payments FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: supplier_payments supplier_payments_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY supplier_payments_select_anon ON public.supplier_payments FOR SELECT TO authenticated USING (true);


--
-- Name: supplier_payments supplier_payments_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY supplier_payments_update_anon ON public.supplier_payments FOR UPDATE TO authenticated USING (false);


--
-- Name: user_active_shops; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.user_active_shops ENABLE ROW LEVEL SECURITY;

--
-- Name: user_active_shops user_active_shops_select_own; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY user_active_shops_select_own ON public.user_active_shops FOR SELECT TO authenticated USING ((user_id = public.app_current_user_id()));


--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions user_permissions_delete; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY user_permissions_delete ON public.user_permissions FOR DELETE TO authenticated USING ((public.app_is_admin() AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = user_permissions.user_id) AND (m.tenant_id = public.current_shop_id()))))));


--
-- Name: user_permissions user_permissions_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY user_permissions_insert ON public.user_permissions FOR INSERT TO authenticated WITH CHECK ((public.app_is_admin() AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = user_permissions.user_id) AND (m.tenant_id = public.current_shop_id()))))));


--
-- Name: user_permissions user_permissions_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY user_permissions_select ON public.user_permissions FOR SELECT TO authenticated USING (((user_id = public.app_current_user_id()) OR (public.app_is_admin() AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = user_permissions.user_id) AND (m.tenant_id = public.current_shop_id())))))));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY users_insert ON public.users FOR INSERT TO authenticated WITH CHECK ((shop_id = public.current_shop_id()));


--
-- Name: users users_select; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY users_select ON public.users FOR SELECT TO authenticated USING (((shop_id = public.current_shop_id()) OR (id = public.app_current_user_id())));


--
-- Name: users users_update; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated USING (((shop_id = public.current_shop_id()) OR (id = public.app_current_user_id()))) WITH CHECK (((shop_id = public.current_shop_id()) OR (id = public.app_current_user_id())));


--
-- Name: voids; Type: ROW SECURITY; Schema: public; Owner: -
--


ALTER TABLE public.voids ENABLE ROW LEVEL SECURITY;

--
-- Name: voids voids_delete_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY voids_delete_anon ON public.voids FOR DELETE TO authenticated USING (false);


--
-- Name: voids voids_insert_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY voids_insert_anon ON public.voids FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: voids voids_select_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY voids_select_anon ON public.voids FOR SELECT TO authenticated USING (true);


--
-- Name: voids voids_update_anon; Type: POLICY; Schema: public; Owner: -
--


CREATE POLICY voids_update_anon ON public.voids FOR UPDATE TO authenticated USING (false);


--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--


ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: bucket_lifecycle_states; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.bucket_lifecycle_states ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: objects images auth write; Type: POLICY; Schema: storage; Owner: -
--


CREATE POLICY "images auth write" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = ANY (ARRAY['product-images'::text, 'employee-photos'::text, 'company-logos'::text, 'customer-images'::text])));


--
-- Name: objects images public read; Type: POLICY; Schema: storage; Owner: -
--


CREATE POLICY "images public read" ON storage.objects FOR SELECT USING ((bucket_id = ANY (ARRAY['product-images'::text, 'employee-photos'::text, 'company-logos'::text, 'customer-images'::text])));


--
-- Name: lifecycle_abandoned_artifacts; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.lifecycle_abandoned_artifacts ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--


ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--


CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: -
--


CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime companies; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.companies;


--
-- Name: supabase_realtime customer_payments; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.customer_payments;


--
-- Name: supabase_realtime customers; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.customers;


--
-- Name: supabase_realtime notifications; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.notifications;


--
-- Name: supabase_realtime product_variants; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.product_variants;


--
-- Name: supabase_realtime products; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.products;


--
-- Name: supabase_realtime purchases; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.purchases;


--
-- Name: supabase_realtime returns; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.returns;


--
-- Name: supabase_realtime sale_items; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.sale_items;


--
-- Name: supabase_realtime sales; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.sales;


--
-- Name: supabase_realtime stock_adjustments; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.stock_adjustments;


--
-- Name: supabase_realtime users; Type: PUBLICATION TABLE; Schema: public; Owner: -
--


ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.users;


--
-- Name: supabase_realtime_messages_publication messages; Type: PUBLICATION TABLE; Schema: realtime; Owner: -
--


ALTER PUBLICATION supabase_realtime_messages_publication ADD TABLE ONLY realtime.messages;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--


CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--


CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--


CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--


CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--


CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--


CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict mqVdDRpiZ491jRPZMdcNCFrku31eUJsJQewJ9dP8BiH2dA9ZdR7LcQZc6tKwvLf



-- ── supplement: the RBAC surface production never received ─────────────
-- ═══════════════════════════════════════════════════════════════════════════════
-- LOCAL-CI SUPPLEMENT — the RBAC surface production never received.
--
-- WHY THIS FILE EXISTS
--   The local-CI baseline artifact is built from the production dump at ledger
--   0304 (see scripts/dev/build-local-ci-baseline.mjs). Production's ledger
--   never received migrations 0107/0108, so the dump has no `business_areas`
--   table and none of the three functions below — but the integration suite
--   reads `business_areas` (tests/integration/rbacEnforcement.test.ts) and the
--   RBAC surface is incomplete without them. The forward files (0233-0302)
--   do not recreate them: 0107 as a whole is NOT replayable onto this schema
--   (its role_permissions bootstrap references the a0000000-… role ids, which
--   production replaced with its own ids — the INSERT would fail its foreign
--   key), so only the parts that are safe to carry are reproduced here.
--
-- WHAT IS IN HERE (verbatim excerpts, nothing invented)
--   * `business_areas` table + RLS policy + grant + the 14 seeded areas:
--     supabase/migrations/0107_roles_rbac_model.sql §§1, 6, 7, 8.
--   * `has_permission(varchar)`: 0108_authoritative_access_and_business_areas.sql.
--   * `create_business_area(jsonb)` + `update_business_area(jsonb)`: same file.
--   Every statement is CREATE OR REPLACE / IF NOT EXISTS / ON CONFLICT DO
--   NOTHING, so re-running this file is safe.
--
-- WHAT IS DELIBERATELY NOT IN HERE
--   * The 0107 role bootstrap (a0000000-… ids): production's roles already
--     exist under its own ids and the artifact carries those rows.
--   * `get_effective_permissions` / `has_effective_permission` /
--     `get_my_permissions` / `create_employee`: later migrations redefined
--     them and production already carries those definitions.
--
-- SAFETY
--   * This file is schema + reference rows only. It names no person, no
--     phone number, no password, and no fixture identity from
--     scripts/lib/fixture-identities.mjs. The build script refuses to write
--     an artifact that carries one.
--   * It is applied ONLY as part of the local-CI baseline artifact (appended
--     by the build script). It is never applied to QA or production.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. BUSINESS AREAS (0107 §1) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code        varchar(50) NOT NULL,  -- e.g. 'sales', 'inventory'
  name_en     varchar(100) NOT NULL,
  name_ur     varchar(100) NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

-- 2. RLS (0107 §6, business_areas only) ─────────────────────────────────────

ALTER TABLE business_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_areas_select ON business_areas;
CREATE POLICY business_areas_select ON business_areas
  FOR SELECT USING (
    tenant_id = COALESCE(
      (SELECT m.tenant_id FROM memberships m WHERE m.user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND m.status = 'active' LIMIT 1),
      (SELECT shop_id FROM users WHERE id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid)
    )
  );

-- 3. GRANT (0107 §7, business_areas only) ───────────────────────────────────

GRANT SELECT ON business_areas TO authenticated;

-- 4. BOOTSTRAP: default business areas (0107 §8) ────────────────────────────

INSERT INTO business_areas (tenant_id, code, name_en, name_ur, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sales',       'Sales',       'فروخت',       1),
  ('00000000-0000-0000-0000-000000000001', 'customers',   'Customers',   'صارفین',      2),
  ('00000000-0000-0000-0000-000000000001', 'products',    'Products',    'مصنوعات',     3),
  ('00000000-0000-0000-0000-000000000001', 'inventory',   'Inventory',   'انوینٹری',    4),
  ('00000000-0000-0000-0000-000000000001', 'purchases',   'Purchases',   'خریداری',     5),
  ('00000000-0000-0000-0000-000000000001', 'payments',    'Payments',    'ادائیگیاں',   6),
  ('00000000-0000-0000-0000-000000000001', 'companies',   'Suppliers',   'سپلائرز',     7),
  ('00000000-0000-0000-0000-000000000001', 'returns',     'Returns',     'واپسیاں',     8),
  ('00000000-0000-0000-0000-000000000001', 'employees',   'Employees',   'عملہ',        9),
  ('00000000-0000-0000-0000-000000000001', 'reports',     'Reports',     'رپورٹس',      10),
  ('00000000-0000-0000-0000-000000000001', 'settings',    'Settings',    'ترتیبات',     11),
  ('00000000-0000-0000-0000-000000000001', 'activity',    'Activity',    'سرگرمی',      12),
  ('00000000-0000-0000-0000-000000000001', 'notifications','Notifications','اطلاعات',  13),
  ('00000000-0000-0000-0000-000000000001', 'alerts',      'Alerts',      'الرٹس',       14)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 5. has_permission (0108) ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION has_permission(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT has_effective_permission(p_code, NULL) $$;
GRANT EXECUTE ON FUNCTION has_permission(varchar) TO authenticated;

-- 6. create_business_area (0108) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_business_area(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  INSERT INTO business_areas(tenant_id, code, name_en, name_ur, sort_order)
  VALUES(v_tenant, lower(regexp_replace(trim(payload->>'code'), '[^a-z0-9_]+', '_', 'g')),
    trim(payload->>'nameEn'), COALESCE(NULLIF(trim(payload->>'nameUr'), ''), trim(payload->>'nameEn')),
    COALESCE((payload->>'sortOrder')::int, 0)) RETURNING id INTO v_id;
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES(v_actor, 'business_area_created', 'business_area', v_id, payload);
  RETURN jsonb_build_object('id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION create_business_area(jsonb) TO authenticated;

-- 7. update_business_area (0108) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_business_area(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid := (payload->>'id')::uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  UPDATE business_areas SET name_en=COALESCE(NULLIF(payload->>'nameEn',''),name_en),
    name_ur=COALESCE(NULLIF(payload->>'nameUr',''),name_ur),
    sort_order=COALESCE((payload->>'sortOrder')::int,sort_order),
    is_active=COALESCE((payload->>'isActive')::boolean,is_active)
  WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES(v_actor,'business_area_updated','business_area',v_id,payload);
  RETURN jsonb_build_object('id',v_id,'updated',true);
END; $$;
GRANT EXECUTE ON FUNCTION update_business_area(jsonb) TO authenticated;
