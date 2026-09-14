-- 0073: Incident Safety Functions (UPDATED — matches deployed state)
-- Phase 4.1 — Sanitization, Rate Limiting, Lifecycle Transition Validation
--
-- KEY FIX: POSIX ERE doesn't support \d shorthand — use [0-9] instead
-- KEY FIX: $$ string escaping — backslashes are literal, not SQL-escaped

-- ─── Sanitization: Text ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sanitize_text(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
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
$fn$;

-- ─── Sanitization: Context (Allowlist) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.sanitize_context(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
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
$fn$;

-- ─── Sanitization: Stack Trace ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sanitize_stack_trace(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
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
$fn$;

-- ─── Fingerprint Generation ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_incident_fingerprint(
  p_type text,
  p_component text,
  p_source text,
  p_message text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
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
$fn$;

-- ─── Rate Limiting ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.incident_rate_limits (
  actor_id        text NOT NULL,
  component       text NOT NULL,
  window_start    timestamptz NOT NULL,
  count           integer NOT NULL DEFAULT 1,
  PRIMARY KEY (actor_id, component, window_start)
);

ALTER TABLE public.incident_rate_limits ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.incident_rate_limits TO anon;
GRANT INSERT ON public.incident_rate_limits TO authenticated;
REVOKE ALL ON public.incident_rate_limits FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  DELETE FROM public.incident_rate_limits
  WHERE window_start < now() - interval '1 day';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_actor text,
  p_component text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
$fn$;

-- ─── Lifecycle Transition Validation ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_valid_transition(
  p_from text,
  p_to text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN (p_from, p_to) IN (
    ('detected',          'triaged'),
    ('triaged',           'investigating'),
    ('investigating',     'root_cause_found'),
    ('root_cause_found',  'fix_proposed'),
    ('fix_proposed',      'fixed'),
    ('fixed',             'verifying'),
    ('verifying',         'verified'),
    ('verified',          'resolved'),
    ('detected',          'false_positive'),
    ('triaged',           'false_positive'),
    ('investigating',     'false_positive'),
    ('detected',          'duplicate'),
    ('triaged',           'duplicate'),
    ('investigating',     'duplicate'),
    ('detected',          'blocked'),
    ('triaged',           'blocked'),
    ('investigating',     'blocked'),
    ('root_cause_found',  'blocked'),
    ('fix_proposed',      'blocked'),
    ('verified',          'investigating'),
    ('resolved',          'investigating'),
    ('resolved',          'superseded')
  );
END;
$fn$;

-- ─── Update Incident Status ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_incident_status(
  p_incident_id uuid,
  p_new_status text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_current_status text;
BEGIN
  SELECT status INTO v_current_status
  FROM public.incidents
  WHERE id = p_incident_id;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Incident not found';
  END IF;

  IF NOT is_valid_transition(v_current_status, p_new_status) THEN
    RAISE EXCEPTION 'Invalid transition: % → %', v_current_status, p_new_status;
  END IF;

  UPDATE public.incidents
  SET status = p_new_status,
      updated_at = now(),
      resolved_at = CASE WHEN p_new_status = 'resolved' THEN now() ELSE resolved_at END
  WHERE id = p_incident_id;

  RETURN true;
END;
$fn$;

-- ─── Grants ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.sanitize_text(text) TO anon;
GRANT EXECUTE ON FUNCTION public.sanitize_text(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_context(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.sanitize_context(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_stack_trace(text) TO anon;
GRANT EXECUTE ON FUNCTION public.sanitize_stack_trace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_incident_fingerprint(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.compute_incident_fingerprint(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_transition(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.is_valid_transition(text, text) TO authenticated;
