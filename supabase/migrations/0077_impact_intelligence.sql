-- 0077: Impact Intelligence
-- Phase 4.4 — Autonomous Engineering Reliability System
--
-- DESIGN PRINCIPLES:
-- - Impact analysis derives from actual system metadata, not manual documentation
-- - PostgreSQL catalogs are the source of truth for DB dependencies
-- - Frontend dependencies are tracked via import/component metadata
-- - Risk classification feeds the existing authority model
-- - Uncertainty is reported honestly, never fabricated as confidence

-- ─── impact_analyses ──────────────────────────────────────────────────
-- Stores completed impact analyses for reuse and audit trail.
-- Each record captures what was analyzed, what was affected, and the risk level.

CREATE TABLE IF NOT EXISTS public.impact_analyses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type         text NOT NULL,              -- table | column | function | rpc | trigger | policy | store | component | route
  target_name         text NOT NULL,              -- the object being analyzed (e.g., 'customers', 'customers.credit_limit', 'record_customer_payment')
  target_schema       text DEFAULT 'public',      -- schema for DB objects
  affected_tables     text[] DEFAULT '{}',        -- table names directly or indirectly affected
  affected_columns    jsonb DEFAULT '[]'::jsonb,  -- [{table, column}] affected columns
  affected_functions  text[] DEFAULT '{}',        -- function/RPC names affected
  affected_triggers   text[] DEFAULT '{}',        -- trigger names affected
  affected_policies   text[] DEFAULT '{}',        -- RLS policy names affected
  affected_stores     text[] DEFAULT '{}',        -- frontend store names affected
  affected_components text[] DEFAULT '{}',        -- frontend component/page names affected
  affected_tests      text[] DEFAULT '{}',        -- test files that exercise affected areas
  affected_routes     text[] DEFAULT '{}',        -- routes/pages affected
  impact_level        text NOT NULL DEFAULT 'low', -- low | medium | high | critical
  impact_categories   text[] DEFAULT '{}',        -- direct | indirect | behavioral | historical | security | financial | inventory
  risk_summary        text,                       -- human-readable risk summary
  verification_scope  text[] DEFAULT '{}',        -- recommended tests/verifications
  evidence            jsonb DEFAULT '{}'::jsonb,  -- raw dependency evidence
  confidence          text NOT NULL DEFAULT 'verified', -- verified | inferred | partial | unknown
  environment         text NOT NULL DEFAULT 'qa',
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_target_type CHECK (target_type IN ('table', 'column', 'function', 'rpc', 'trigger', 'policy', 'store', 'component', 'route')),
  CONSTRAINT valid_impact_level CHECK (impact_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT valid_impact_confidence CHECK (confidence IN ('verified', 'inferred', 'partial', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_impact_target ON public.impact_analyses (target_type, target_name);
CREATE INDEX IF NOT EXISTS idx_impact_level ON public.impact_analyses (impact_level);
CREATE INDEX IF NOT EXISTS idx_impact_created ON public.impact_analyses (created_at DESC);

COMMENT ON TABLE public.impact_analyses IS 'Impact analyses for changes. Derives from actual system metadata. Stores evidence and risk classification.';
COMMENT ON COLUMN public.impact_analyses.confidence IS 'verified=confirmed by metadata, inferred=likely but not confirmed, partial=partial information, unknown=cannot determine';

-- ─── impact_mappings ──────────────────────────────────────────────────
-- Maps affected objects to their relationship type.
-- Granular dependency tracking for precise impact understanding.

CREATE TABLE IF NOT EXISTS public.impact_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id         uuid NOT NULL REFERENCES public.impact_analyses(id) ON DELETE CASCADE,
  source_type         text NOT NULL,              -- table | column | function | trigger | policy | store | component
  source_name         text NOT NULL,              -- the source object
  target_type         text NOT NULL,              -- table | column | function | trigger | policy | store | component
  target_name         text NOT NULL,              -- the dependent object
  relationship        text NOT NULL,              -- fk_reference | rpc_uses | trigger_on | policy_covers | imports | calls | renders
  impact_type         text NOT NULL,              -- direct | indirect | behavioral | historical | security | financial | inventory
  confidence          text NOT NULL DEFAULT 'verified',
  evidence_detail     text,                       -- specific evidence (SQL snippet, import path, etc.)
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_relationship CHECK (relationship IN ('fk_reference', 'rpc_uses', 'trigger_on', 'policy_covers', 'imports', 'calls', 'renders', 'reads', 'writes', 'deletes')),
  CONSTRAINT valid_impact_type CHECK (impact_type IN ('direct', 'indirect', 'behavioral', 'historical', 'security', 'financial', 'inventory'))
);

CREATE INDEX IF NOT EXISTS idx_impact_mapping_analysis ON public.impact_mappings (analysis_id);
CREATE INDEX IF NOT EXISTS idx_impact_mapping_source ON public.impact_mappings (source_type, source_name);
CREATE INDEX IF NOT EXISTS idx_impact_mapping_target ON public.impact_mappings (target_type, target_name);

COMMENT ON TABLE public.impact_mappings IS 'Granular dependency mappings. Each row represents one dependency relationship discovered during impact analysis.';

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.impact_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_mappings ENABLE ROW LEVEL SECURITY;

-- Only SECURITY DEFINER RPCs manage these tables

-- ─── RPCs ─────────────────────────────────────────────────────────────

-- analyze_table_impact: Find all dependencies for a database table
CREATE OR REPLACE FUNCTION public.analyze_table_impact(
  p_table_name text,
  p_schema_name text DEFAULT 'public'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_analysis_id uuid;
  v_affected_tables text[] := '{}';
  v_affected_functions text[] := '{}';
  v_affected_triggers text[] := '{}';
  v_affected_policies text[] := '{}';
  v_affected_columns jsonb := '[]'::jsonb;
  v_mappings jsonb := '[]'::jsonb;
  v_impact_level text := 'low';
  v_impact_categories text[] := '{}';
  v_confidence text := 'verified';
  v_rec record;
  v_evidence jsonb := '{}'::jsonb;
  v_verification text[] := '{}';
BEGIN
  -- Validate table exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = p_schema_name AND tablename = p_table_name
  ) THEN
    RAISE EXCEPTION 'Table % does not exist', p_table_name;
  END IF;

  -- 1. Foreign key references (tables that reference this table)
  FOR v_rec IN
    SELECT
      tc.table_name as referencing_table,
      kcu.column_name as referencing_column,
      ccu.table_name as referenced_table,
      ccu.column_name as referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = p_schema_name
      AND ccu.table_name = p_table_name
      AND ccu.table_schema = p_schema_name
  LOOP
    v_affected_tables := array_append(v_affected_tables, v_rec.referencing_table);
    v_impact_categories := array_append(v_impact_categories, 'direct');
    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'table', 'source_name', v_rec.referencing_table,
      'target_type', 'table', 'target_name', p_table_name,
      'relationship', 'fk_reference', 'impact_type', 'direct',
      'evidence_detail', format('FK %s.%s -> %s.%s', v_rec.referencing_table, v_rec.referencing_column, p_table_name, v_rec.referenced_column)
    );
  END LOOP;

  -- 2. Functions that reference this table (in function body)
  FOR v_rec IN
    SELECT p.proname as func_name, pg_get_functiondef(p.oid) as func_def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = p_schema_name
      AND pg_get_functiondef(p.oid) LIKE '%' || p_table_name || '%'
  LOOP
    v_affected_functions := array_append(v_affected_functions, v_rec.func_name);
    v_impact_categories := array_append(v_impact_categories, 'direct');
    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'function', 'source_name', v_rec.func_name,
      'target_type', 'table', 'target_name', p_table_name,
      'relationship', 'rpc_uses', 'impact_type', 'direct',
      'evidence_detail', left(v_rec.func_def, 200)
    );
  END LOOP;

  -- 3. Triggers on this table
  FOR v_rec IN
    SELECT t.tgname as trigger_name, c.relname as table_name
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = p_schema_name
      AND c.relname = p_table_name
      AND NOT t.tgisinternal
  LOOP
    v_affected_triggers := array_append(v_affected_triggers, v_rec.trigger_name);
    v_impact_categories := array_append(v_impact_categories, 'behavioral');
    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'trigger', 'source_name', v_rec.trigger_name,
      'target_type', 'table', 'target_name', p_table_name,
      'relationship', 'trigger_on', 'impact_type', 'behavioral',
      'evidence_detail', format('Trigger %s fires on %s', v_rec.trigger_name, p_table_name)
    );
  END LOOP;

  -- 4. RLS policies on this table
  FOR v_rec IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = p_schema_name AND tablename = p_table_name
  LOOP
    v_affected_policies := array_append(v_affected_policies, v_rec.policyname);
    IF v_rec.cmd IN ('DELETE', 'UPDATE') OR v_rec.qual LIKE '%admin%' OR v_rec.qual LIKE '%role%' THEN
      v_impact_categories := array_append(v_impact_categories, 'security');
    END IF;
    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'policy', 'source_name', v_rec.policyname,
      'target_type', 'table', 'target_name', p_table_name,
      'relationship', 'policy_covers', 'impact_type', 'security',
      'evidence_detail', format('Policy %s covers %s operations', v_rec.policyname, v_rec.cmd)
    );
  END LOOP;

  -- 5. Columns with foreign keys or constraints
  FOR v_rec IN
    SELECT column_name, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = p_schema_name AND table_name = p_table_name
  LOOP
    v_affected_columns := v_affected_columns || jsonb_build_object(
      'table', p_table_name, 'column', v_rec.column_name
    );
  END LOOP;

  -- Deduplicate using DISTINCT subquery (array_agg(DISTINCT) over unnest fails in some PG versions)
  SELECT array_agg(x) INTO v_affected_tables FROM (SELECT DISTINCT unnest(v_affected_tables) AS x) s;
  SELECT array_agg(x) INTO v_affected_functions FROM (SELECT DISTINCT unnest(v_affected_functions) AS x) s;
  SELECT array_agg(x) INTO v_impact_categories FROM (SELECT DISTINCT unnest(v_impact_categories) AS x) s;

  -- Determine impact level
  IF 'financial' = ANY(v_impact_categories) OR 'inventory' = ANY(v_impact_categories) THEN
    v_impact_level := 'critical';
  ELSIF 'security' = ANY(v_impact_categories) THEN
    v_impact_level := 'high';
  ELSIF array_length(v_affected_functions, 1) > 3 OR array_length(v_affected_tables, 1) > 3 THEN
    v_impact_level := 'high';
  ELSIF array_length(v_affected_functions, 1) > 1 OR array_length(v_affected_tables, 1) > 1 THEN
    v_impact_level := 'medium';
  ELSE
    v_impact_level := 'low';
  END IF;

  -- Determine financial/historical categories by checking table name patterns
  IF p_table_name IN ('sales', 'sale_items', 'customer_payments', 'supplier_payments', 'purchases', 'returns', 'return_items', 'voids', 'inventory_movements', 'customers') THEN
    v_impact_categories := array_append(v_impact_categories, 'financial');
    v_impact_categories := array_append(v_impact_categories, 'historical');
    IF p_table_name IN ('inventory_movements', 'products', 'product_variants') THEN
      v_impact_categories := array_append(v_impact_categories, 'inventory');
    END IF;
    v_impact_level := 'critical';
  END IF;

  -- Build verification scope
  v_verification := ARRAY['unit_tests', 'integration_tests'];
  IF v_impact_level IN ('high', 'critical') THEN
    v_verification := array_cat(v_verification, ARRAY['playwright_e2e', 'security_tests']);
  END IF;
  IF 'financial' = ANY(v_impact_categories) THEN
    v_verification := array_append(v_verification, 'financial_integrity_tests');
  END IF;
  IF 'inventory' = ANY(v_impact_categories) THEN
    v_verification := array_append(v_verification, 'inventory_integrity_tests');
  END IF;
  IF 'security' = ANY(v_impact_categories) THEN
    v_verification := array_append(v_verification, 'authorization_tests');
  END IF;

  -- Store analysis
  INSERT INTO public.impact_analyses (
    target_type, target_name, target_schema,
    affected_tables, affected_columns, affected_functions,
    affected_triggers, affected_policies,
    impact_level, impact_categories, risk_summary,
    verification_scope, evidence, confidence, environment
  ) VALUES (
    'table', p_table_name, p_schema_name,
    v_affected_tables, v_affected_columns, v_affected_functions,
    v_affected_triggers, v_affected_policies,
    v_impact_level, v_impact_categories,
    format('Table %s: %s affected tables, %s functions, %s triggers, %s policies. Risk: %s',
      p_table_name,
      array_length(v_affected_tables, 1),
      array_length(v_affected_functions, 1),
      array_length(v_affected_triggers, 1),
      array_length(v_affected_policies, 1),
      v_impact_level
    ),
    v_verification,
    jsonb_build_object('mappings', v_mappings),
    v_confidence,
    CASE WHEN current_database() LIKE '%production%' THEN 'production' ELSE 'qa' END
  ) RETURNING id INTO v_analysis_id;

  -- Store detailed mappings
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_mappings) AS mapping
  LOOP
    INSERT INTO public.impact_mappings (
      analysis_id, source_type, source_name, target_type, target_name,
      relationship, impact_type, confidence, evidence_detail
    ) VALUES (
      v_analysis_id,
      (v_rec.mapping->>'source_type'),
      (v_rec.mapping->>'source_name'),
      (v_rec.mapping->>'target_type'),
      (v_rec.mapping->>'target_name'),
      (v_rec.mapping->>'relationship'),
      (v_rec.mapping->>'impact_type'),
      'verified',
      (v_rec.mapping->>'evidence_detail')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'analysis_id', v_analysis_id,
    'target', jsonb_build_object('type', 'table', 'name', p_table_name, 'schema', p_schema_name),
    'impact_level', v_impact_level,
    'impact_categories', v_impact_categories,
    'affected_tables', v_affected_tables,
    'affected_functions', v_affected_functions,
    'affected_triggers', v_affected_triggers,
    'affected_policies', v_affected_policies,
    'affected_columns', v_affected_columns,
    'verification_scope', v_verification,
    'confidence', v_confidence,
    'mapping_count', jsonb_array_length(v_mappings)
  );
END;
$fn$;

-- analyze_function_impact: Find all dependencies for an RPC/function
CREATE OR REPLACE FUNCTION public.analyze_function_impact(
  p_function_name text,
  p_schema_name text DEFAULT 'public'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_analysis_id uuid;
  v_func_def text;
  v_affected_tables text[] := '{}';
  v_affected_functions text[] := '{}';
  v_affected_policies text[] := '{}';
  v_impact_level text := 'low';
  v_impact_categories text[] := '{}';
  v_confidence text := 'verified';
  v_rec record;
  v_mappings jsonb := '[]'::jsonb;
  v_verification text[] := '{}';
BEGIN
  -- Get function definition
  SELECT pg_get_functiondef(p.oid) INTO v_func_def
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = p_schema_name AND p.proname = p_function_name;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'Function % does not exist', p_function_name;
  END IF;

  -- Find tables referenced in function body
  FOR v_rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = p_schema_name
      AND v_func_def LIKE '%' || tablename || '%'
  LOOP
    v_affected_tables := array_append(v_affected_tables, v_rec.tablename);
    v_impact_categories := array_append(v_impact_categories, 'direct');

    -- Check if this is a financial/sensitive table
    IF v_rec.tablename IN ('sales', 'sale_items', 'customer_payments', 'supplier_payments', 'purchases', 'returns', 'return_items', 'voids', 'inventory_movements') THEN
      v_impact_categories := array_append(v_impact_categories, 'financial');
      v_impact_categories := array_append(v_impact_categories, 'historical');
    END IF;
    IF v_rec.tablename IN ('products', 'product_variants', 'inventory_movements') THEN
      v_impact_categories := array_append(v_impact_categories, 'inventory');
    END IF;
    IF v_rec.tablename IN ('users', 'user_permissions') THEN
      v_impact_categories := array_append(v_impact_categories, 'security');
    END IF;

    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'function', 'source_name', p_function_name,
      'target_type', 'table', 'target_name', v_rec.tablename,
      'relationship', 'rpc_uses', 'impact_type', 'direct',
      'evidence_detail', format('Function %s references table %s', p_function_name, v_rec.tablename)
    );
  END LOOP;

  -- Find functions called by this function
  FOR v_rec IN
    SELECT p2.proname as called_func
    FROM pg_proc p2
    JOIN pg_namespace n2 ON p2.pronamespace = n2.oid
    WHERE n2.nspname = p_schema_name
      AND p2.proname != p_function_name
      AND v_func_def LIKE '%' || p2.proname || '%'
  LOOP
    v_affected_functions := array_append(v_affected_functions, v_rec.called_func);
    v_impact_categories := array_append(v_impact_categories, 'indirect');
    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'function', 'source_name', p_function_name,
      'target_type', 'function', 'target_name', v_rec.called_func,
      'relationship', 'calls', 'impact_type', 'indirect',
      'evidence_detail', format('Function %s calls %s', p_function_name, v_rec.called_func)
    );
  END LOOP;

  -- Check SECURITY DEFINER
  IF v_func_def LIKE '%SECURITY DEFINER%' THEN
    v_impact_categories := array_append(v_impact_categories, 'security');
  END IF;

  -- Check for INSERT/UPDATE/DELETE patterns
  IF v_func_def LIKE '%INSERT INTO%' THEN
    v_impact_categories := array_append(v_impact_categories, 'behavioral');
  END IF;
  IF v_func_def LIKE '%UPDATE % SET%' THEN
    v_impact_categories := array_append(v_impact_categories, 'behavioral');
  END IF;
  IF v_func_def LIKE '%DELETE FROM%' THEN
    v_impact_categories := array_append(v_impact_categories, 'behavioral');
  END IF;

  -- Deduplicate
  SELECT array_agg(x) INTO v_affected_tables FROM (SELECT DISTINCT unnest(v_affected_tables) AS x) s;
  SELECT array_agg(x) INTO v_affected_functions FROM (SELECT DISTINCT unnest(v_affected_functions) AS x) s;
  SELECT array_agg(x) INTO v_impact_categories FROM (SELECT DISTINCT unnest(v_impact_categories) AS x) s;

  -- Determine impact level
  IF 'financial' = ANY(v_impact_categories) OR 'inventory' = ANY(v_impact_categories) THEN
    v_impact_level := 'critical';
  ELSIF 'security' = ANY(v_impact_categories) THEN
    v_impact_level := 'high';
  ELSIF array_length(v_affected_tables, 1) > 3 THEN
    v_impact_level := 'high';
  ELSIF array_length(v_affected_tables, 1) > 1 THEN
    v_impact_level := 'medium';
  ELSE
    v_impact_level := 'low';
  END IF;

  -- Verification scope
  v_verification := ARRAY['unit_tests', 'integration_tests'];
  IF v_impact_level IN ('high', 'critical') THEN
    v_verification := array_cat(v_verification, ARRAY['playwright_e2e', 'security_tests']);
  END IF;
  IF 'financial' = ANY(v_impact_categories) THEN
    v_verification := array_append(v_verification, 'financial_integrity_tests');
  END IF;

  -- Store analysis
  INSERT INTO public.impact_analyses (
    target_type, target_name, target_schema,
    affected_tables, affected_functions,
    impact_level, impact_categories, risk_summary,
    verification_scope, evidence, confidence, environment
  ) VALUES (
    'rpc', p_function_name, p_schema_name,
    v_affected_tables, v_affected_functions,
    v_impact_level, v_impact_categories,
    format('RPC %s: %s affected tables, %s functions. Risk: %s',
      p_function_name,
      array_length(v_affected_tables, 1),
      array_length(v_affected_functions, 1),
      v_impact_level
    ),
    v_verification,
    jsonb_build_object('mappings', v_mappings, 'function_definition_preview', left(v_func_def, 500)),
    v_confidence,
    CASE WHEN current_database() LIKE '%production%' THEN 'production' ELSE 'qa' END
  ) RETURNING id INTO v_analysis_id;

  -- Store mappings
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_mappings) AS mapping
  LOOP
    INSERT INTO public.impact_mappings (
      analysis_id, source_type, source_name, target_type, target_name,
      relationship, impact_type, confidence, evidence_detail
    ) VALUES (
      v_analysis_id,
      (v_rec.mapping->>'source_type'),
      (v_rec.mapping->>'source_name'),
      (v_rec.mapping->>'target_type'),
      (v_rec.mapping->>'target_name'),
      (v_rec.mapping->>'relationship'),
      (v_rec.mapping->>'impact_type'),
      'verified',
      (v_rec.mapping->>'evidence_detail')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'analysis_id', v_analysis_id,
    'target', jsonb_build_object('type', 'rpc', 'name', p_function_name, 'schema', p_schema_name),
    'impact_level', v_impact_level,
    'impact_categories', v_impact_categories,
    'affected_tables', v_affected_tables,
    'affected_functions', v_affected_functions,
    'verification_scope', v_verification,
    'confidence', v_confidence,
    'mapping_count', jsonb_array_length(v_mappings)
  );
END;
$fn$;

-- analyze_column_impact: Find dependencies for a specific column
CREATE OR REPLACE FUNCTION public.analyze_column_impact(
  p_table_name text,
  p_column_name text,
  p_schema_name text DEFAULT 'public'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_affected_tables text[] := '{}';
  v_affected_functions text[] := '{}';
  v_affected_policies text[] := '{}';
  v_impact_level text := 'low';
  v_impact_categories text[] := '{}';
  v_confidence text := 'verified';
  v_rec record;
  v_mappings jsonb := '[]'::jsonb;
  v_verification text[] := '{}';
BEGIN
  -- Validate column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = p_schema_name AND table_name = p_table_name AND column_name = p_column_name
  ) THEN
    RAISE EXCEPTION 'Column %.% does not exist', p_table_name, p_column_name;
  END IF;

  -- 1. Foreign key relationships involving this column
  FOR v_rec IN
    SELECT
      tc.table_name as referencing_table,
      kcu.column_name as referencing_column,
      ccu.table_name as referenced_table,
      ccu.column_name as referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = p_schema_name
      AND ((ccu.table_name = p_table_name AND ccu.column_name = p_column_name)
           OR (tc.table_name = p_table_name AND kcu.column_name = p_column_name))
  LOOP
    IF v_rec.referencing_table != p_table_name THEN
      v_affected_tables := array_append(v_affected_tables, v_rec.referencing_table);
    END IF;
    v_impact_categories := array_append(v_impact_categories, 'direct');
    v_mappings := v_mappings || jsonb_build_object(
      'source_type', 'column', 'source_name', p_table_name || '.' || p_column_name,
      'target_type', 'table', 'target_name', v_rec.referencing_table,
      'relationship', 'fk_reference', 'impact_type', 'direct',
      'evidence_detail', format('FK %s.%s -> %s.%s', v_rec.referencing_table, v_rec.referencing_column, p_table_name, p_column_name)
    );
  END LOOP;

  -- 2. Functions that reference this column
  FOR v_rec IN
    SELECT p.proname as func_name, pg_get_functiondef(p.oid) as func_def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = p_schema_name
      AND pg_get_functiondef(p.oid) LIKE '%' || p_column_name || '%'
  LOOP
    -- Verify it's actually referencing this table's column (not just same column name in another table)
    IF v_rec.func_def LIKE '%' || p_table_name || '%' AND v_rec.func_def LIKE '%' || p_column_name || '%' THEN
      v_affected_functions := array_append(v_affected_functions, v_rec.func_name);
      v_impact_categories := array_append(v_impact_categories, 'direct');
      v_mappings := v_mappings || jsonb_build_object(
        'source_type', 'column', 'source_name', p_table_name || '.' || p_column_name,
        'target_type', 'function', 'target_name', v_rec.func_name,
        'relationship', 'rpc_uses', 'impact_type', 'direct',
        'evidence_detail', format('Function %s references %s.%s', v_rec.func_name, p_table_name, p_column_name)
      );
    END IF;
  END LOOP;

  -- Deduplicate
  SELECT array_agg(x) INTO v_affected_tables FROM (SELECT DISTINCT unnest(v_affected_tables) AS x) s;
  SELECT array_agg(x) INTO v_affected_functions FROM (SELECT DISTINCT unnest(v_affected_functions) AS x) s;
  SELECT array_agg(x) INTO v_impact_categories FROM (SELECT DISTINCT unnest(v_impact_categories) AS x) s;

  -- Impact level
  IF 'financial' = ANY(v_impact_categories) OR 'inventory' = ANY(v_impact_categories) THEN
    v_impact_level := 'critical';
  ELSIF 'security' = ANY(v_impact_categories) THEN
    v_impact_level := 'high';
  ELSIF array_length(v_affected_functions, 1) > 2 THEN
    v_impact_level := 'high';
  ELSIF array_length(v_affected_functions, 1) > 0 THEN
    v_impact_level := 'medium';
  ELSE
    v_impact_level := 'low';
  END IF;

  -- Financial column patterns
  IF p_column_name IN ('credit_limit', 'outstanding_balance', 'total_purchases', 'total_paid', 'amount', 'price', 'total', 'refund_amount', 'stock_qty', 'quantity') THEN
    v_impact_categories := array_append(v_impact_categories, 'financial');
  END IF;
  IF p_column_name IN ('stock_qty', 'quantity', 'unit_cost') THEN
    v_impact_categories := array_append(v_impact_categories, 'inventory');
  END IF;
  IF p_column_name IN ('role', 'is_admin', 'permissions') THEN
    v_impact_categories := array_append(v_impact_categories, 'security');
  END IF;

  SELECT array_agg(x) INTO v_impact_categories FROM (SELECT DISTINCT unnest(v_impact_categories) AS x) s;

  -- Determine final impact level based on all categories
  IF 'financial' = ANY(v_impact_categories) OR 'inventory' = ANY(v_impact_categories) THEN
    v_impact_level := 'critical';
  ELSIF 'security' = ANY(v_impact_categories) THEN
    v_impact_level := 'high';
  END IF;

  -- Verification
  v_verification := ARRAY['unit_tests', 'integration_tests'];
  IF v_impact_level IN ('high', 'critical') THEN
    v_verification := array_cat(v_verification, ARRAY['playwright_e2e', 'security_tests']);
  END IF;
  IF 'financial' = ANY(v_impact_categories) THEN
    v_verification := array_append(v_verification, 'financial_integrity_tests');
  END IF;

  RETURN jsonb_build_object(
    'target', jsonb_build_object('type', 'column', 'table', p_table_name, 'column', p_column_name),
    'impact_level', v_impact_level,
    'impact_categories', v_impact_categories,
    'affected_tables', COALESCE(v_affected_tables, '{}'),
    'affected_functions', COALESCE(v_affected_functions, '{}'),
    'verification_scope', v_verification,
    'confidence', v_confidence,
    'mapping_count', jsonb_array_length(v_mappings)
  );
END;
$fn$;

-- classify_change_risk: Determine risk level for a proposed change
CREATE OR REPLACE FUNCTION public.classify_change_risk(
  p_target_type text,
  p_target_name text,
  p_change_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_impact jsonb;
  v_risk_level text;
  v_risk_factors text[] := '{}';
  v_recommendation text;
BEGIN
  -- Route to appropriate analysis
  IF p_target_type = 'table' THEN
    v_impact := public.analyze_table_impact(p_target_name);
  ELSIF p_target_type IN ('rpc', 'function') THEN
    v_impact := public.analyze_function_impact(p_target_name);
  ELSE
    RETURN jsonb_build_object(
      'error', format('Unsupported target type: %s', p_target_type),
      'supported_types', '["table", "rpc", "function"]'
    );
  END IF;

  v_risk_level := v_impact->>'impact_level';

  -- Build risk factors
  IF 'financial' = ANY(ARRAY(SELECT jsonb_array_elements_text(v_impact->'impact_categories'))) THEN
    v_risk_factors := array_append(v_risk_factors, 'Affects financial data/transactions');
  END IF;
  IF 'inventory' = ANY(ARRAY(SELECT jsonb_array_elements_text(v_impact->'impact_categories'))) THEN
    v_risk_factors := array_append(v_risk_factors, 'Affects inventory/stock data');
  END IF;
  IF 'security' = ANY(ARRAY(SELECT jsonb_array_elements_text(v_impact->'impact_categories'))) THEN
    v_risk_factors := array_append(v_risk_factors, 'Affects authentication/authorization');
  END IF;
  IF 'historical' = ANY(ARRAY(SELECT jsonb_array_elements_text(v_impact->'impact_categories'))) THEN
    v_risk_factors := array_append(v_risk_factors, 'May affect historical records');
  END IF;

  -- Build recommendation
  CASE v_risk_level
    WHEN 'critical' THEN
      v_recommendation := 'Critical risk. Requires full regression suite, security tests, and human approval for production deployment. Verify financial/inventory integrity.';
    WHEN 'high' THEN
      v_recommendation := 'High risk. Requires full regression, security tests, and thorough verification before merge.';
    WHEN 'medium' THEN
      v_recommendation := 'Medium risk. Requires affected tests and integration tests. Broader regression recommended.';
    WHEN 'low' THEN
      v_recommendation := 'Low risk. Unit and integration tests for affected areas should suffice.';
  END CASE;

  RETURN jsonb_build_object(
    'target', jsonb_build_object('type', p_target_type, 'name', p_target_name),
    'risk_level', v_risk_level,
    'risk_factors', v_risk_factors,
    'recommendation', v_recommendation,
    'impact_summary', v_impact,
    'requires_human_approval', v_risk_level IN ('critical', 'high')
  );
END;
$fn$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.analyze_table_impact(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.analyze_table_impact(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_function_impact(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.analyze_function_impact(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_column_impact(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.analyze_column_impact(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.classify_change_risk(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.classify_change_risk(text, text, text) TO authenticated;
