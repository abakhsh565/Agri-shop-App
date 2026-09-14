-- 0075: Verified Resolutions + Engineering Memory
-- Phase 4.2 — Verified Engineering Knowledge Layer
--
-- DESIGN PRINCIPLES:
-- - Memory is NEVER authoritative over the actual system source of truth
-- - Only verified knowledge is trusted for automatic reuse
-- - Hypotheses/inferences assist investigation but never become permanent truth
-- - Sensitive data (customer names, phones, financial values) must not be stored
-- - Memory is append-only with supersession history (never destructive overwrite)
-- - Regression tests are part of the resolution — stale tests invalidate the resolution

-- ─── known_resolutions ───────────────────────────────────────────────────
-- A verified root cause + fix + prevention mechanism.
-- Multiple incidents can map to one resolution (recurring bug → same fix).
-- Resolutions persist indefinitely (unlike raw incident telemetry).

CREATE TABLE IF NOT EXISTS public.known_resolutions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,                    -- short descriptive title
  root_cause          text NOT NULL,                    -- verified root cause explanation
  root_cause_confidence text NOT NULL DEFAULT 'verified', -- hypothesis | inferred | verified
  fix_description     text NOT NULL,                    -- what was actually changed
  fix_files           jsonb DEFAULT '[]'::jsonb,        -- affected file paths (sanitized)
  fix_components      text[] DEFAULT '{}',               -- affected system components
  affected_entity     text,                             -- e.g., 'customer', 'product', 'sale'
  applicability       jsonb DEFAULT '{}'::jsonb,         -- conditions under which this resolution applies
  status              text NOT NULL DEFAULT 'active',    -- active | superseded | stale
  superseded_by       uuid,                             -- FK to the resolution that replaced this one
  verified_at         timestamptz,                      -- when the fix was verified with evidence
  verified_by         text,                             -- what verified it: 'test', 'manual', 'ci'
  regression_test_ids uuid[] DEFAULT '{}',              -- IDs of regression tests that prove this fix
  environment         text NOT NULL DEFAULT 'qa',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_resolution_status CHECK (status IN ('active', 'superseded', 'stale')),
  CONSTRAINT valid_confidence CHECK (root_cause_confidence IN ('hypothesis', 'inferred', 'verified')),
  CONSTRAINT valid_resolution_environment CHECK (environment IN ('qa', 'ci', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_resolutions_status ON public.known_resolutions (status);
CREATE INDEX IF NOT EXISTS idx_resolutions_component ON public.known_resolutions USING GIN (fix_components);
CREATE INDEX IF NOT EXISTS idx_resolutions_entity ON public.known_resolutions (affected_entity);

COMMENT ON TABLE public.known_resolutions IS 'Verified root cause + fix + prevention. Multiple incidents can map to one resolution. Persists indefinitely.';
COMMENT ON COLUMN public.known_resolutions.root_cause_confidence IS 'hypothesis=guessed, inferred=evidence suggests, verified=reproduced and confirmed with evidence.';
COMMENT ON COLUMN public.known_resolutions.status IS 'active=current, superseded=replaced by newer resolution, stale=regression test failing or code changed.';

-- ─── resolution_regression_tests ─────────────────────────────────────────
-- Links a resolution to the specific regression test(s) that prove it works.
-- If the linked test fails, the resolution is no longer trusted.

CREATE TABLE IF NOT EXISTS public.resolution_regression_tests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_id   uuid NOT NULL REFERENCES public.known_resolutions(id) ON DELETE CASCADE,
  test_name       text NOT NULL,                       -- e.g., 'should archive customer preserves sales'
  test_file       text NOT NULL,                       -- e.g., 'tests/integration/securityAudit.test.ts'
  test_type       text NOT NULL DEFAULT 'vitest',      -- vitest | playwright | manual
  last_verified   timestamptz,                         -- when the test last passed
  last_status     text,                                -- pass | fail | skipped
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_test_type CHECK (test_type IN ('vitest', 'playwright', 'manual')),
  CONSTRAINT valid_test_status CHECK (last_status IN ('pass', 'fail', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_resolution_tests_resolution ON public.resolution_regression_tests (resolution_id);

COMMENT ON TABLE public.resolution_regression_tests IS 'Links verified resolutions to regression tests. If the test fails, the resolution is stale.';

-- ─── engineering_memory ──────────────────────────────────────────────────
-- Reusable engineering lessons that persist across sessions/tasks.
-- Categories: failure_pattern, prevention_rule, technical_decision, verified_business_rule
-- Business rules can only be recorded, not created, by this system.

CREATE TABLE IF NOT EXISTS public.engineering_memory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category        text NOT NULL,                       -- failure_pattern | prevention_rule | technical_decision | verified_business_rule
  title           text NOT NULL,                       -- short lesson title
  description     text NOT NULL,                       -- what was learned
  component       text NOT NULL,                       -- system component
  affected_entity text,                                -- relevant entity type
  resolution_id   uuid,                                -- FK to the resolution that taught this (nullable)
  confidence      text NOT NULL DEFAULT 'verified',    -- hypothesis | inferred | verified
  status          text NOT NULL DEFAULT 'active',      -- active | superseded | stale
  superseded_by   uuid,                                -- FK to memory that replaced this
  evidence        jsonb DEFAULT '{}'::jsonb,            -- sanitized evidence links (test IDs, commit hashes, etc.)
  applicability   jsonb DEFAULT '{}'::jsonb,            -- conditions under which this lesson applies
  environment     text NOT NULL DEFAULT 'qa',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_memory_category CHECK (category IN ('failure_pattern', 'prevention_rule', 'technical_decision', 'verified_business_rule')),
  CONSTRAINT valid_memory_status CHECK (status IN ('active', 'superseded', 'stale')),
  CONSTRAINT valid_memory_confidence CHECK (confidence IN ('hypothesis', 'inferred', 'verified')),
  CONSTRAINT valid_memory_environment CHECK (environment IN ('qa', 'ci', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_memory_category ON public.engineering_memory (category);
CREATE INDEX IF NOT EXISTS idx_memory_component ON public.engineering_memory (component);
CREATE INDEX IF NOT EXISTS idx_memory_status ON public.engineering_memory (status);
CREATE INDEX IF NOT EXISTS idx_memory_resolution ON public.engineering_memory (resolution_id);

COMMENT ON TABLE public.engineering_memory IS 'Reusable engineering lessons. Memory is NEVER authoritative over the actual system source of truth.';
COMMENT ON COLUMN public.engineering_memory.confidence IS 'hypothesis=guessed, inferred=evidence suggests, verified=reproduced and confirmed.';

-- ─── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.known_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resolution_regression_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineering_memory ENABLE ROW LEVEL SECURITY;

-- Service-role manages resolutions and memory (via SECURITY DEFINER RPCs)
-- No anon/authenticated direct access to these tables

-- ─── RPCs ────────────────────────────────────────────────────────────────

-- record_resolution: Create or update a verified resolution
CREATE OR REPLACE FUNCTION public.record_resolution(
  p_title text,
  p_root_cause text,
  p_fix_description text,
  p_fix_files jsonb DEFAULT '[]'::jsonb,
  p_fix_components text[] DEFAULT '{}',
  p_affected_entity text DEFAULT NULL,
  p_confidence text DEFAULT 'verified',
  p_regression_test_ids uuid[] DEFAULT '{}',
  p_incident_signature_id uuid DEFAULT NULL,
  p_applicability jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_environment text;
  v_db_name text;
BEGIN
  -- Validate confidence
  IF p_confidence NOT IN ('hypothesis', 'inferred', 'verified') THEN
    RAISE EXCEPTION 'Invalid confidence: %', p_confidence;
  END IF;

  -- Only verified resolutions can be recorded with regression tests
  IF p_confidence != 'verified' AND array_length(p_regression_test_ids, 1) > 0 THEN
    RAISE EXCEPTION 'Only verified resolutions can have regression tests';
  END IF;

  -- Determine environment
  v_db_name := current_database();
  IF v_db_name LIKE '%production%' OR v_db_name LIKE '%prod%' THEN
    v_environment := 'production';
  ELSIF v_db_name LIKE '%ci%' OR v_db_name LIKE '%test%' THEN
    v_environment := 'ci';
  ELSE
    v_environment := 'qa';
  END IF;

  -- Insert resolution
  INSERT INTO public.known_resolutions (
    title, root_cause, root_cause_confidence, fix_description,
    fix_files, fix_components, affected_entity, applicability,
    regression_test_ids, verified_at, verified_by, environment
  ) VALUES (
    left(p_title, 500),
    left(p_root_cause, 2000),
    p_confidence,
    left(p_fix_description, 2000),
    p_fix_files,
    p_fix_components,
    p_affected_entity,
    p_applicability,
    p_regression_test_ids,
    CASE WHEN p_confidence = 'verified' THEN now() ELSE NULL END,
    CASE WHEN p_confidence = 'verified' THEN 'test' ELSE NULL END,
    v_environment
  )
  RETURNING id INTO v_id;

  -- Link to incident signature if provided
  IF p_incident_signature_id IS NOT NULL THEN
    UPDATE public.incident_signatures
    SET resolution_id = v_id, updated_at = now()
    WHERE id = p_incident_signature_id;
  END IF;

  RETURN v_id;
END;
$fn$;

-- link_resolution: Connect an incident signature to an existing resolution
CREATE OR REPLACE FUNCTION public.link_resolution(
  p_signature_id uuid,
  p_resolution_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- Verify both exist
  IF NOT EXISTS (SELECT 1 FROM public.incident_signatures WHERE id = p_signature_id) THEN
    RAISE EXCEPTION 'Incident signature not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.known_resolutions WHERE id = p_resolution_id AND status = 'active') THEN
    RAISE EXCEPTION 'Resolution not found or not active';
  END IF;

  UPDATE public.incident_signatures
  SET resolution_id = p_resolution_id, updated_at = now()
  WHERE id = p_signature_id;

  RETURN true;
END;
$fn$;

-- search_resolutions: Find resolutions by component, entity, or text
CREATE OR REPLACE FUNCTION public.search_resolutions(
  p_component text DEFAULT NULL,
  p_entity text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_limit integer DEFAULT 20
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
      r.id, r.title, r.root_cause, r.root_cause_confidence,
      r.fix_description, r.fix_components, r.affected_entity,
      r.status, r.verified_at, r.verified_by,
      r.regression_test_ids, r.applicability, r.created_at,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'test_name', t.test_name,
          'test_file', t.test_file,
          'test_type', t.test_type,
          'last_status', t.last_status,
          'last_verified', t.last_verified
        ))
        FROM public.resolution_regression_tests t
        WHERE t.resolution_id = r.id
      ) as regression_tests
    FROM public.known_resolutions r
    WHERE (p_status IS NULL OR r.status = p_status)
      AND (p_component IS NULL OR p_component = ANY(r.fix_components))
      AND (p_entity IS NULL OR r.affected_entity = p_entity)
    ORDER BY r.created_at DESC
    LIMIT LEAST(COALESCE(p_limit, 20), 50)
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$fn$;

-- record_memory: Create an engineering memory entry
CREATE OR REPLACE FUNCTION public.record_memory(
  p_category text,
  p_title text,
  p_description text,
  p_component text,
  p_affected_entity text DEFAULT NULL,
  p_resolution_id uuid DEFAULT NULL,
  p_confidence text DEFAULT 'verified',
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_applicability jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_environment text;
  v_db_name text;
BEGIN
  IF p_category NOT IN ('failure_pattern', 'prevention_rule', 'technical_decision', 'verified_business_rule') THEN
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;
  IF p_confidence NOT IN ('hypothesis', 'inferred', 'verified') THEN
    RAISE EXCEPTION 'Invalid confidence: %', p_confidence;
  END IF;

  v_db_name := current_database();
  IF v_db_name LIKE '%production%' OR v_db_name LIKE '%prod%' THEN
    v_environment := 'production';
  ELSIF v_db_name LIKE '%ci%' OR v_db_name LIKE '%test%' THEN
    v_environment := 'ci';
  ELSE
    v_environment := 'qa';
  END IF;

  INSERT INTO public.engineering_memory (
    category, title, description, component, affected_entity,
    resolution_id, confidence, evidence, applicability, environment
  ) VALUES (
    p_category,
    left(p_title, 500),
    left(p_description, 2000),
    p_component,
    p_affected_entity,
    p_resolution_id,
    p_confidence,
    p_evidence,
    p_applicability,
    v_environment
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- search_memory: Find engineering memories by component, category
CREATE OR REPLACE FUNCTION public.search_memory(
  p_component text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_limit integer DEFAULT 20
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
      m.id, m.category, m.title, m.description,
      m.component, m.affected_entity, m.resolution_id,
      m.confidence, m.status, m.evidence, m.applicability,
      m.created_at,
      r.title as resolution_title,
      r.status as resolution_status
    FROM public.engineering_memory m
    LEFT JOIN public.known_resolutions r ON r.id = m.resolution_id
    WHERE (p_status IS NULL OR m.status = p_status)
      AND (p_component IS NULL OR m.component = p_component)
      AND (p_category IS NULL OR m.category = p_category)
    ORDER BY m.created_at DESC
    LIMIT LEAST(COALESCE(p_limit, 20), 50)
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$fn$;

-- supersede_resolution: Mark old resolution as superseded by a new one
CREATE OR REPLACE FUNCTION public.supersede_resolution(
  p_old_resolution_id uuid,
  p_new_resolution_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.known_resolutions WHERE id = p_old_resolution_id AND status = 'active') THEN
    RAISE EXCEPTION 'Old resolution not found or not active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.known_resolutions WHERE id = p_new_resolution_id AND status = 'active') THEN
    RAISE EXCEPTION 'New resolution not found or not active';
  END IF;
  IF p_old_resolution_id = p_new_resolution_id THEN
    RAISE EXCEPTION 'Cannot supersede a resolution with itself';
  END IF;

  -- Mark old as superseded
  UPDATE public.known_resolutions
  SET status = 'superseded', superseded_by = p_new_resolution_id, updated_at = now()
  WHERE id = p_old_resolution_id;

  -- Update incident signatures that pointed to old resolution
  UPDATE public.incident_signatures
  SET resolution_id = p_new_resolution_id, updated_at = now()
  WHERE resolution_id = p_old_resolution_id;

  -- Update memory entries that referenced old resolution
  UPDATE public.engineering_memory
  SET status = 'stale', updated_at = now()
  WHERE resolution_id = p_old_resolution_id AND status = 'active';

  RETURN true;
END;
$fn$;

-- mark_resolution_stale: Mark resolution as stale when regression test fails
CREATE OR REPLACE FUNCTION public.mark_resolution_stale(
  p_resolution_id uuid,
  p_test_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.known_resolutions WHERE id = p_resolution_id AND status = 'active') THEN
    RAISE EXCEPTION 'Resolution not found or not active';
  END IF;

  -- Update regression test status if provided
  IF p_test_id IS NOT NULL THEN
    UPDATE public.resolution_regression_tests
    SET last_status = 'fail', last_verified = now()
    WHERE id = p_test_id AND resolution_id = p_resolution_id;
  END IF;

  -- Check if any regression test is failing
  IF EXISTS (
    SELECT 1 FROM public.resolution_regression_tests
    WHERE resolution_id = p_resolution_id AND last_status = 'fail'
  ) THEN
    UPDATE public.known_resolutions
    SET status = 'stale', updated_at = now()
    WHERE id = p_resolution_id;

    -- Also mark linked memory as stale
    UPDATE public.engineering_memory
    SET status = 'stale', updated_at = now()
    WHERE resolution_id = p_resolution_id AND status = 'active';
  END IF;

  RETURN true;
END;
$fn$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.record_resolution(text, text, text, jsonb, text[], text, text, uuid[], uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.record_resolution(text, text, text, jsonb, text[], text, text, uuid[], uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_resolution(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.link_resolution(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_resolutions(text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_resolutions(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_memory(text, text, text, text, text, uuid, text, jsonb, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.record_memory(text, text, text, text, text, uuid, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_memory(text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_memory(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_resolution(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.supersede_resolution(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_resolution_stale(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mark_resolution_stale(uuid, uuid) TO authenticated;
