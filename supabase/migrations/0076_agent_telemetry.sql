-- 0076: Agent Telemetry + Loop Detection
-- Phase 4.3 — Autonomous Engineering Reliability System
--
-- DESIGN PRINCIPLES:
-- - Task groups multiple attempts; one attempt ≠ one task
-- - Progress is NEW EVIDENCE, not merely more commands executed
-- - Loop detection forces strategy change or escalation
-- - Agent telemetry does NOT replace actual verification
-- - Sensitive data (secrets, credentials, business data) must not be stored
-- - Memory is consulted before repeating investigation

-- ─── agent_tasks ─────────────────────────────────────────────────────
-- Groups multiple attempts belonging to one engineering task.
-- A task represents: "fix this bug" / "add this feature" / "investigate this issue"

CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_group_id       uuid NOT NULL DEFAULT gen_random_uuid(), -- stable group ID for related tasks
  description         text NOT NULL,                    -- what the task is trying to accomplish
  module              text,                              -- system module/area (auth, sales, inventory, etc.)
  entity_type         text,                              -- relevant entity (customer, product, sale, etc.)
  status              text NOT NULL DEFAULT 'active',   -- active | in_progress | escalating | escalated | resolved | abandoned
  current_strategy    text,                              -- the current investigation/approach strategy
  attempt_count       integer NOT NULL DEFAULT 0,        -- total attempts for this task
  strategy_change_count integer NOT NULL DEFAULT 0,      -- how many times strategy has changed
  escalation_level    integer NOT NULL DEFAULT 0,        -- 0=none, 1=strategy review, 2=human review, 3=blocker
  escalation_reason   text,                              -- why escalation was triggered
  linked_incident_id  uuid,                              -- FK to incidents (if this task was triggered by an incident)
  linked_resolution_id uuid,                             -- FK to known_resolutions (if a resolution was found/created)
  evidence_summary    jsonb DEFAULT '{}'::jsonb,          -- summary of evidence gathered across attempts
  resolution_summary  text,                              -- what was ultimately done to resolve (set on completion)
  environment         text NOT NULL DEFAULT 'qa',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,

  CONSTRAINT valid_task_status CHECK (status IN ('active', 'in_progress', 'escalating', 'escalated', 'resolved', 'abandoned')),
  CONSTRAINT valid_task_environment CHECK (environment IN ('qa', 'ci', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON public.agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_module ON public.agent_tasks (module);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_group ON public.agent_tasks (task_group_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_incident ON public.agent_tasks (linked_incident_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_resolution ON public.agent_tasks (linked_resolution_id);

COMMENT ON TABLE public.agent_tasks IS 'Groups multiple attempts for one engineering task. Task ≠ attempt.';
COMMENT ON COLUMN public.agent_tasks.task_group_id IS 'Stable group ID — one task may produce multiple task records if restructured.';
COMMENT ON COLUMN public.agent_tasks.attempt_count IS 'Total attempts for this task. Incremented on each record_attempt.';
COMMENT ON COLUMN public.agent_tasks.strategy_change_count IS 'How many times the investigation approach has changed.';
COMMENT ON COLUMN public.agent_tasks.escalation_level IS '0=none, 1=strategy review, 2=human review, 3=blocker — escalates on repeated failure.';

-- ─── agent_attempts ──────────────────────────────────────────────────
-- Individual attempts within a task.
-- Each attempt records what was tried, what evidence was produced, and whether progress occurred.

CREATE TABLE IF NOT EXISTS public.agent_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  attempt_number      integer NOT NULL,                  -- sequential within the task
  strategy            text NOT NULL,                      -- what approach was used (e.g., "inspect RPC", "fix migration", "change auth flow")
  description         text,                               -- what specifically was done
  files_changed       text[] DEFAULT '{}',                -- file paths modified (sanitized)
  commands_executed   text[] DEFAULT '{}',                -- commands/tools run
  tests_run           text[] DEFAULT '{}',                -- test names/files executed
  test_results        jsonb DEFAULT '{}'::jsonb,          -- { passed: N, failed: N, skipped: N }
  evidence_produced   text[] DEFAULT '{}',                -- what new information was gained
  failure_reason      text,                               -- why this attempt did not fully resolve the task
  failure_category    text,                               -- categorization: auth_error, schema_mismatch, test_failure, logic_error, timeout, etc.
  progress_made       boolean NOT NULL DEFAULT false,     -- did this attempt produce meaningful new evidence?
  strategy_changed    boolean NOT NULL DEFAULT false,     -- is this a different strategy from the previous attempt?
  linked_incident_id  uuid,                               -- FK to incidents if this attempt resolved/encountered one
  environment         text NOT NULL DEFAULT 'qa',
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_failure_category CHECK (failure_category IS NULL OR failure_category IN (
    'auth_error', 'schema_mismatch', 'test_failure', 'logic_error', 'timeout',
    'permission_denied', 'data_corruption', 'race_condition', 'dependency_error',
    'configuration_error', 'api_error', 'type_error', 'null_reference',
    'constraint_violation', 'not_found', 'unknown'
  )),
  CONSTRAINT valid_attempt_environment CHECK (environment IN ('qa', 'ci', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_agent_attempts_task ON public.agent_attempts (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_attempts_strategy ON public.agent_attempts (task_id, strategy);
CREATE INDEX IF NOT EXISTS idx_agent_attempts_progress ON public.agent_attempts (task_id, progress_made);

COMMENT ON TABLE public.agent_attempts IS 'Individual attempts within a task. Each records strategy, evidence, and progress.';
COMMENT ON COLUMN public.agent_attempts.progress_made IS 'TRUE = meaningful new evidence was produced. FALSE = repeated same approach with same result.';
COMMENT ON COLUMN public.agent_attempts.strategy_changed IS 'TRUE = different approach from previous attempt. Used for loop detection.';

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_attempts ENABLE ROW LEVEL SECURITY;

-- Only SECURITY DEFINER RPCs manage these tables
-- No anon/authenticated direct access

-- ─── RPCs ─────────────────────────────────────────────────────────────

-- start_agent_task: Create a new engineering task
CREATE OR REPLACE FUNCTION public.start_agent_task(
  p_description text,
  p_module text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_incident_id uuid DEFAULT NULL,
  p_resolution_id uuid DEFAULT NULL
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
  IF length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Task description is required';
  END IF;

  v_db_name := current_database();
  IF v_db_name LIKE '%production%' OR v_db_name LIKE '%prod%' THEN
    v_environment := 'production';
  ELSIF v_db_name LIKE '%ci%' OR v_db_name LIKE '%test%' THEN
    v_environment := 'ci';
  ELSE
    v_environment := 'qa';
  END IF;

  INSERT INTO public.agent_tasks (
    description, module, entity_type, status, current_strategy,
    linked_incident_id, linked_resolution_id, environment
  ) VALUES (
    left(p_description, 500),
    p_module,
    p_entity_type,
    'in_progress',
    NULL,
    p_incident_id,
    p_resolution_id,
    v_environment
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- record_attempt: Record an engineering attempt with evidence
CREATE OR REPLACE FUNCTION public.record_attempt(
  p_task_id uuid,
  p_strategy text,
  p_description text DEFAULT NULL,
  p_files_changed text[] DEFAULT '{}',
  p_commands_executed text[] DEFAULT '{}',
  p_tests_run text[] DEFAULT '{}',
  p_test_results jsonb DEFAULT '{}'::jsonb,
  p_evidence_produced text[] DEFAULT '{}',
  p_failure_reason text DEFAULT NULL,
  p_failure_category text DEFAULT NULL,
  p_progress_made boolean DEFAULT false,
  p_incident_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_attempt_number integer;
  v_prev_strategy text;
  v_strategy_changed boolean;
  v_environment text;
  v_db_name text;
BEGIN
  -- Validate task exists and is active
  IF NOT EXISTS (SELECT 1 FROM public.agent_tasks WHERE id = p_task_id AND status IN ('active', 'in_progress')) THEN
    RAISE EXCEPTION 'Task not found or not in active state';
  END IF;

  -- Validate failure category
  IF p_failure_category IS NOT NULL AND p_failure_category NOT IN (
    'auth_error', 'schema_mismatch', 'test_failure', 'logic_error', 'timeout',
    'permission_denied', 'data_corruption', 'race_condition', 'dependency_error',
    'configuration_error', 'api_error', 'type_error', 'null_reference',
    'constraint_violation', 'not_found', 'unknown'
  ) THEN
    RAISE EXCEPTION 'Invalid failure category: %', p_failure_category;
  END IF;

  -- Sanitize inputs — strip sensitive data from file paths and descriptions
  -- (files_changed, commands_executed, tests_run are sanitized by the caller,
  --  but we enforce size limits server-side)

  v_db_name := current_database();
  IF v_db_name LIKE '%production%' OR v_db_name LIKE '%prod%' THEN
    v_environment := 'production';
  ELSIF v_db_name LIKE '%ci%' OR v_db_name LIKE '%test%' THEN
    v_environment := 'ci';
  ELSE
    v_environment := 'qa';
  END IF;

  -- Get attempt number and detect strategy change
  SELECT COALESCE(MAX(attempt_number), 0) + 1
  INTO v_attempt_number
  FROM public.agent_attempts WHERE task_id = p_task_id;

  SELECT strategy INTO v_prev_strategy
  FROM public.agent_attempts WHERE task_id = p_task_id
  ORDER BY created_at DESC LIMIT 1;

  -- First attempt (no previous strategy) is not a strategy change
  v_strategy_changed := (v_prev_strategy IS NOT NULL AND v_prev_strategy IS DISTINCT FROM p_strategy);

  -- Insert attempt
  INSERT INTO public.agent_attempts (
    task_id, attempt_number, strategy, description,
    files_changed, commands_executed, tests_run, test_results,
    evidence_produced, failure_reason, failure_category,
    progress_made, strategy_changed, linked_incident_id, environment
  ) VALUES (
    p_task_id,
    v_attempt_number,
    left(p_strategy, 200),
    left(COALESCE(p_description, ''), 2000),
    p_files_changed,
    p_commands_executed,
    p_tests_run,
    p_test_results,
    p_evidence_produced,
    left(COALESCE(p_failure_reason, ''), 2000),
    p_failure_category,
    p_progress_made,
    v_strategy_changed,
    p_incident_id,
    v_environment
  )
  RETURNING id INTO v_id;

  -- Update task counters
  UPDATE public.agent_tasks
  SET
    attempt_count = attempt_count + 1,
    strategy_change_count = CASE WHEN v_strategy_changed THEN strategy_change_count + 1 ELSE strategy_change_count END,
    current_strategy = left(p_strategy, 200),
    updated_at = now()
  WHERE id = p_task_id;

  RETURN v_id;
END;
$fn$;

-- detect_loop: Analyze attempt history for loop patterns
-- Returns a JSON object with loop detection results
CREATE OR REPLACE FUNCTION public.detect_loop(
  p_task_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_total_attempts integer;
  v_no_progress_count integer;
  v_same_strategy_streak integer;
  v_current_strategy text;
  v_same_strategy_count integer;
  v_same_failure_count integer;
  v_latest_failure text;
  v_loop_detected boolean := false;
  v_loop_type text := NULL;
  v_recommendation text := NULL;
  v_task_status text;
BEGIN
  -- Get task status
  SELECT status INTO v_task_status
  FROM public.agent_tasks WHERE id = p_task_id;

  IF v_task_status IS NULL THEN
    RETURN jsonb_build_object('error', 'Task not found');
  END IF;

  IF v_task_status NOT IN ('active', 'in_progress') THEN
    RETURN jsonb_build_object('loop_detected', false, 'reason', 'Task not in active state');
  END IF;

  -- Count total attempts
  SELECT COUNT(*) INTO v_total_attempts
  FROM public.agent_attempts WHERE task_id = p_task_id;

  -- Count consecutive no-progress attempts (from most recent)
  WITH ordered AS (
    SELECT progress_made, strategy, failure_reason, failure_category,
           ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
    FROM public.agent_attempts WHERE task_id = p_task_id
  )
  SELECT COUNT(*) INTO v_no_progress_count
  FROM ordered
  WHERE rn <= 5 AND progress_made = false;

  -- Count current strategy streak
  SELECT strategy INTO v_current_strategy
  FROM public.agent_attempts WHERE task_id = p_task_id
  ORDER BY created_at DESC LIMIT 1;

  WITH ordered AS (
    SELECT strategy, ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
    FROM public.agent_attempts WHERE task_id = p_task_id
  )
  SELECT COUNT(*) INTO v_same_strategy_count
  FROM ordered
  WHERE strategy = v_current_strategy AND rn <= 5;

  -- Count same failure category streak
  SELECT failure_category INTO v_latest_failure
  FROM public.agent_attempts WHERE task_id = p_task_id AND failure_category IS NOT NULL
  ORDER BY created_at DESC LIMIT 1;

  IF v_latest_failure IS NOT NULL THEN
    WITH ordered AS (
      SELECT failure_category, ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
      FROM public.agent_attempts WHERE task_id = p_task_id AND failure_category IS NOT NULL
    )
    SELECT COUNT(*) INTO v_same_failure_count
    FROM ordered
    WHERE failure_category = v_latest_failure AND rn <= 5;
  ELSE
    v_same_failure_count := 0;
  END IF;

  -- Loop detection rules

  -- Rule 1: Same strategy 3+ times without progress
  IF v_same_strategy_count >= 3 AND v_no_progress_count >= 3 THEN
    v_loop_detected := true;
    v_loop_type := 'same_strategy_loop';
    v_recommendation := 'Repeated same strategy ' || v_same_strategy_count || ' times without progress. Change investigation approach: try a different layer (UI → store → RPC → DB). Check engineering memory for known resolutions.';

  -- Rule 2: 5+ consecutive no-progress attempts
  ELSIF v_no_progress_count >= 5 THEN
    v_loop_detected := true;
    v_loop_type := 'no_evidence_loop';
    v_recommendation := v_no_progress_count || ' consecutive attempts produced no new evidence. Stop current approach. Review all evidence collected. Check engineering memory. Consider escalating.';

  -- Rule 3: Same failure category 3+ times
  ELSIF v_same_failure_count >= 3 THEN
    v_loop_detected := true;
    v_loop_type := 'same_failure_loop';
    v_recommendation := 'Same failure category "' || v_latest_failure || '" occurred ' || v_same_failure_count || ' times. Root cause may be different from assumed. Inspect upstream/downstream systems.';

  -- Rule 4: 10+ total attempts without resolution (generic overwork)
  ELSIF v_total_attempts >= 10 AND v_no_progress_count >= 3 THEN
    v_loop_detected := true;
    v_loop_type := 'persistent_failure';
    v_recommendation := v_total_attempts || ' attempts made. Recent ' || v_no_progress_count || ' showed no progress. Escalate for human review with full evidence summary.';
  END IF;

  RETURN jsonb_build_object(
    'loop_detected', v_loop_detected,
    'loop_type', v_loop_type,
    'recommendation', v_recommendation,
    'total_attempts', v_total_attempts,
    'no_progress_count', v_no_progress_count,
    'same_strategy_count', v_same_strategy_count,
    'same_failure_count', v_same_failure_count,
    'current_strategy', v_current_strategy
  );
END;
$fn$;

-- escalate_task: Mark a task as escalated with reason
CREATE OR REPLACE FUNCTION public.escalate_task(
  p_task_id uuid,
  p_level integer,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agent_tasks WHERE id = p_task_id) THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF p_level < 1 OR p_level > 3 THEN
    RAISE EXCEPTION 'Escalation level must be 1-3';
  END IF;

  UPDATE public.agent_tasks
  SET
    status = 'escalated',
    escalation_level = p_level,
    escalation_reason = left(p_reason, 2000),
    updated_at = now()
  WHERE id = p_task_id;

  RETURN true;
END;
$fn$;

-- resolve_task: Mark a task as resolved with summary
CREATE OR REPLACE FUNCTION public.resolve_task(
  p_task_id uuid,
  p_resolution_summary text,
  p_resolution_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agent_tasks WHERE id = p_task_id AND status IN ('active', 'in_progress', 'escalated')) THEN
    RAISE EXCEPTION 'Task not found or not in resolvable state';
  END IF;

  UPDATE public.agent_tasks
  SET
    status = 'resolved',
    resolution_summary = left(p_resolution_summary, 2000),
    linked_resolution_id = COALESCE(p_resolution_id, linked_resolution_id),
    resolved_at = now(),
    updated_at = now()
  WHERE id = p_task_id;

  -- Update linked incident if present
  UPDATE public.incidents
  SET status = 'resolved', resolved_at = now(), updated_at = now()
  WHERE id = (SELECT linked_incident_id FROM public.agent_tasks WHERE id = p_task_id)
    AND status NOT IN ('resolved', 'false_positive', 'duplicate', 'superseded');

  RETURN true;
END;
$fn$;

-- abandon_task: Mark a task as abandoned (could not be resolved)
CREATE OR REPLACE FUNCTION public.abandon_task(
  p_task_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agent_tasks WHERE id = p_task_id AND status IN ('active', 'in_progress', 'escalating')) THEN
    RAISE EXCEPTION 'Task not found or not in abandonable state';
  END IF;

  UPDATE public.agent_tasks
  SET
    status = 'abandoned',
    escalation_reason = left(p_reason, 2000),
    updated_at = now()
  WHERE id = p_task_id;

  RETURN true;
END;
$fn$;

-- search_agent_tasks: Find tasks by status, module, etc.
CREATE OR REPLACE FUNCTION public.search_agent_tasks(
  p_status text DEFAULT NULL,
  p_module text DEFAULT NULL,
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
      t.id, t.description, t.module, t.entity_type, t.status,
      t.current_strategy, t.attempt_count, t.strategy_change_count,
      t.escalation_level, t.escalation_reason,
      t.resolution_summary, t.environment,
      t.created_at, t.updated_at, t.resolved_at,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'attempt_number', a.attempt_number,
          'strategy', a.strategy,
          'progress_made', a.progress_made,
          'failure_category', a.failure_category,
          'created_at', a.created_at
        ) ORDER BY a.attempt_number)
        FROM public.agent_attempts a WHERE a.task_id = t.id
      ) as attempts
    FROM public.agent_tasks t
    WHERE (p_status IS NULL OR t.status = p_status)
      AND (p_module IS NULL OR t.module = p_module)
    ORDER BY t.created_at DESC
    LIMIT LEAST(COALESCE(p_limit, 20), 50)
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$fn$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.start_agent_task(text, text, text, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.start_agent_task(text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_attempt(uuid, text, text, text[], text[], text[], jsonb, text[], text, text, boolean, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.record_attempt(uuid, text, text, text[], text[], text[], jsonb, text[], text, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_loop(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.detect_loop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_task(uuid, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.escalate_task(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_task(uuid, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_task(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_task(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.abandon_task(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_agent_tasks(text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_agent_tasks(text, text, integer) TO authenticated;
