-- 0078: Frontend Impact Intelligence
-- Phase 5 — Extends Phase 4.4 with actual codebase dependency discovery
--
-- DESIGN PRINCIPLES:
-- - Dependency graph is derived from actual source code scanning
-- - Stored as JSONB for flexible querying
-- - SQL functions combine DB metadata + frontend graph for full impact picture
-- - Stale graph data is detectable and refreshable
-- - No source code contents stored — only structural metadata

-- ─── frontend_dependency_graph ────────────────────────────────────────
-- Stores the scanned dependency graph from the codebase.
-- One row per scan, latest is authoritative.

CREATE TABLE IF NOT EXISTS public.frontend_dependency_graph (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_data      jsonb NOT NULL,           -- the full dependency graph JSON
  file_count      integer NOT NULL DEFAULT 0,
  tables_tracked  integer NOT NULL DEFAULT 0,
  rpcs_tracked    integer NOT NULL DEFAULT 0,
  stores_tracked  integer NOT NULL DEFAULT 0,
  routes_tracked  integer NOT NULL DEFAULT 0,
  environment     text NOT NULL DEFAULT 'qa',
  created_at      timestamptz NOT NULL DEFAULT now(),
  is_current      boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_dep_graph_current ON public.frontend_dependency_graph (is_current);

COMMENT ON TABLE public.frontend_dependency_graph IS 'Scanned frontend dependency graph. Latest row with is_current=true is authoritative.';

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.frontend_dependency_graph ENABLE ROW LEVEL SECURITY;

-- ─── RPCs ─────────────────────────────────────────────────────────────

-- load_dependency_graph: Store a scanned dependency graph
CREATE OR REPLACE FUNCTION public.load_dependency_graph(
  p_graph_data jsonb,
  p_file_count integer DEFAULT 0,
  p_tables_tracked integer DEFAULT 0,
  p_rpcs_tracked integer DEFAULT 0,
  p_stores_tracked integer DEFAULT 0,
  p_routes_tracked integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_environment text;
BEGIN
  -- Mark previous graphs as not current
  UPDATE public.frontend_dependency_graph SET is_current = false WHERE is_current = true;

  IF current_database() LIKE '%production%' THEN
    v_environment := 'production';
  ELSE
    v_environment := 'qa';
  END IF;

  INSERT INTO public.frontend_dependency_graph (
    graph_data, file_count, tables_tracked, rpcs_tracked,
    stores_tracked, routes_tracked, environment, is_current
  ) VALUES (
    p_graph_data, p_file_count, p_tables_tracked, p_rpcs_tracked,
    p_stores_tracked, p_routes_tracked, v_environment, true
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- get_current_graph: Get the latest dependency graph
CREATE OR REPLACE FUNCTION public.get_current_graph()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_graph jsonb;
BEGIN
  SELECT graph_data INTO v_graph
  FROM public.frontend_dependency_graph
  WHERE is_current = true
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_graph, '{}'::jsonb);
END;
$fn$;

-- analyze_frontend_impact: Find frontend dependencies for a DB table or RPC
CREATE OR REPLACE FUNCTION public.analyze_frontend_impact(
  p_target_type text,  -- 'table' or 'rpc'
  p_target_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_graph jsonb;
  v_refs jsonb;
  v_stores text[] := '{}';
  v_components text[] := '{}';
  v_pages text[] := '{}';
  v_routes text[] := '{}';
  v_tests text[] := '{}';
  v_hooks text[] := '{}';
  v_all_files text[] := '{}';
  v_rec record;
BEGIN
  -- Get current graph
  v_graph := public.get_current_graph();

  IF v_graph = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'error', 'No dependency graph loaded',
      'action', 'Run scan-frontend-deps.cjs and load_dependency_graph()'
    );
  END IF;

  -- Look up dependencies from the graph
  IF p_target_type = 'table' THEN
    v_refs := v_graph->'tables'->p_target_name;
  ELSIF p_target_type = 'rpc' THEN
    v_refs := v_graph->'rpcs'->p_target_name;
  ELSE
    RETURN jsonb_build_object('error', format('Unsupported target type: %s', p_target_type));
  END IF;

  IF v_refs IS NULL OR v_refs = 'null'::jsonb THEN
    RETURN jsonb_build_object(
      'target', jsonb_build_object('type', p_target_type, 'name', p_target_name),
      'found', false,
      'confidence', 'unknown',
      'note', 'No frontend references found in dependency graph'
    );
  END IF;

  -- Categorize references by layer
  FOR v_rec IN SELECT jsonb_array_elements(v_refs) as ref
  LOOP
    v_all_files := array_append(v_all_files, (v_rec.ref->>'file'));

    CASE (v_rec.ref->>'layer')
      WHEN 'store' THEN v_stores := array_append(v_stores, (v_rec.ref->>'file'));
      WHEN 'hook' THEN v_hooks := array_append(v_hooks, (v_rec.ref->>'file'));
      WHEN 'lib' THEN v_hooks := array_append(v_hooks, (v_rec.ref->>'file'));
      WHEN 'component' THEN v_components := array_append(v_components, (v_rec.ref->>'file'));
      WHEN 'page' THEN v_pages := array_append(v_pages, (v_rec.ref->>'file'));
      WHEN 'test' THEN v_tests := array_append(v_tests, (v_rec.ref->>'file'));
    END CASE;
  END LOOP;

  -- Resolve routes via routePages mapping
  -- routePages: {"/admin/customers": "src/pages/.../CustomersListPage.tsx"}
  IF array_length(v_pages, 1) > 0 AND v_graph ? 'routePages' THEN
    FOR v_rec IN SELECT jsonb_object_keys(v_graph->'routePages') as route_path
    LOOP
      IF (v_graph->'routePages'->>v_rec.route_path) = ANY(v_pages) THEN
        v_routes := array_append(v_routes, v_rec.route_path);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'target', jsonb_build_object('type', p_target_type, 'name', p_target_name),
    'found', true,
    'confidence', 'verified',
    'affected_stores', v_stores,
    'affected_hooks', v_hooks,
    'affected_components', v_components,
    'affected_pages', v_pages,
    'affected_routes', v_routes,
    'affected_tests', v_tests,
    'total_files', array_length(v_all_files, 1)
  );
END;
$fn$;

-- analyze_full_impact: Combined DB + frontend impact for a table
CREATE OR REPLACE FUNCTION public.analyze_full_impact(
  p_target_type text,
  p_target_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_db_impact jsonb;
  v_frontend_impact jsonb;
  v_combined_cats text[] := '{}';
  v_level text;
  v_rec text;
BEGIN
  -- Database impact (Phase 4.4)
  IF p_target_type = 'table' THEN
    v_db_impact := public.analyze_table_impact(p_target_name);
  ELSIF p_target_type IN ('rpc', 'function') THEN
    v_db_impact := public.analyze_function_impact(p_target_name);
  ELSE
    v_db_impact := '{}'::jsonb;
  END IF;

  -- Frontend impact (Phase 5)
  v_frontend_impact := public.analyze_frontend_impact(p_target_type, p_target_name);

  -- Determine combined impact level
  v_level := COALESCE(v_db_impact->>'impact_level', 'low');

  -- Frontend impact elevates risk if many files affected
  IF (v_frontend_impact->>'found')::boolean THEN
    IF COALESCE((v_frontend_impact->>'total_files')::int, 0) > 10 THEN
      IF v_level = 'low' THEN v_level := 'medium';
      ELSIF v_level = 'medium' THEN v_level := 'high';
      END IF;
    END IF;
  END IF;

  -- Combine categories
  FOR v_rec IN SELECT jsonb_array_elements_text(v_db_impact->'impact_categories')
  LOOP
    IF NOT (v_rec = ANY(v_combined_cats)) THEN
      v_combined_cats := array_append(v_combined_cats, v_rec);
    END IF;
  END LOOP;

  IF (v_frontend_impact->>'found')::boolean THEN
    v_combined_cats := array_append(v_combined_cats, 'frontend');
  END IF;

  RETURN jsonb_build_object(
    'target', jsonb_build_object('type', p_target_type, 'name', p_target_name),
    'impact_level', v_level,
    'impact_categories', v_combined_cats,
    'db_impact', v_db_impact,
    'frontend_impact', v_frontend_impact,
    'requires_human_approval', v_level IN ('critical', 'high')
  );
END;
$fn$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.load_dependency_graph(jsonb, integer, integer, integer, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.load_dependency_graph(jsonb, integer, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_graph() TO anon;
GRANT EXECUTE ON FUNCTION public.get_current_graph() TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_frontend_impact(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.analyze_frontend_impact(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_full_impact(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.analyze_full_impact(text, text) TO authenticated;
