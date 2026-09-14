-- 0074: Incident RPCs (UPDATED — matches deployed state)
-- Phase 4.1 — record_incident (ingestion) + search_incidents (read)
--
-- KEY FIX: Environment derived from current_database(), not client settings
-- KEY FIX: POSIX-compatible regex (\d → [0-9], \b → [[:<:]]/[[:>:]])
-- KEY FIX: search_incidents uses subquery to avoid ORDER BY conflicts

-- ─── record_incident ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_incident(
  p_type text,
  p_severity text,
  p_source text,
  p_component text,
  p_message text,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_stack_trace text DEFAULT NULL,
  p_user_action text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
$fn$;

-- ─── search_incident_by_fingerprint ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_incident_by_fingerprint(
  p_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_result jsonb;
  v_signature record;
  v_incidents jsonb;
BEGIN
  SELECT * INTO v_signature
  FROM public.incident_signatures
  WHERE fingerprint = p_fingerprint;

  IF v_signature IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(sub.* ORDER BY sub.created_at DESC) INTO v_incidents
  FROM (
    SELECT i.id, i.status, i.severity, left(i.message, 200) as message, i.created_at
    FROM public.incidents i
    WHERE i.signature_id = v_signature.id
    ORDER BY i.created_at DESC
    LIMIT 10
  ) sub;

  v_result := jsonb_build_object(
    'signature', jsonb_build_object(
      'id', v_signature.id,
      'fingerprint', v_signature.fingerprint,
      'type', v_signature.type,
      'component', v_signature.component,
      'source', v_signature.source,
      'message_template', left(v_signature.message_template, 200),
      'occurrence_count', v_signature.occurrence_count,
      'first_seen_at', v_signature.first_seen_at,
      'last_seen_at', v_signature.last_seen_at,
      'resolution_id', v_signature.resolution_id,
      'environment', v_signature.environment
    ),
    'recent_incidents', COALESCE(v_incidents, '[]'::jsonb)
  );

  RETURN v_result;
END;
$fn$;

-- ─── search_incidents ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_incidents(
  p_component text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(sub.* ORDER BY sub.created_at DESC) INTO v_result
  FROM (
    SELECT 
      i.id,
      i.signature_id,
      i.status,
      i.severity,
      left(i.message, 200) as message,
      i.context,
      i.environment,
      i.user_action,
      i.created_at,
      i.resolved_at,
      jsonb_build_object(
        'fingerprint', s.fingerprint,
        'type', s.type,
        'component', s.component,
        'source', s.source,
        'occurrence_count', s.occurrence_count
      ) as signature
    FROM public.incidents i
    JOIN public.incident_signatures s ON s.id = i.signature_id
    WHERE (p_component IS NULL OR s.component = p_component)
      AND (p_type IS NULL OR s.type = p_type)
      AND (p_severity IS NULL OR i.severity = p_severity)
      AND (p_status IS NULL OR i.status = p_status)
    ORDER BY i.created_at DESC
    LIMIT LEAST(COALESCE(p_limit, 50), 100)
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$fn$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.record_incident(text, text, text, text, text, jsonb, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_incident(text, text, text, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_incident_by_fingerprint(text) TO anon;
GRANT EXECUTE ON FUNCTION public.search_incident_by_fingerprint(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_incidents(text, text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_incidents(text, text, text, text, integer) TO authenticated;
