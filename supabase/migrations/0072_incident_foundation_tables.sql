-- 0072: Incident Foundation Tables
-- Phase 4.1 — Autonomous Engineering Reliability System
--
-- incident_signatures: groups structurally equivalent incidents
-- incidents: individual occurrences with evidence
--
-- DESIGN PRINCIPLES:
-- - Raw telemetry (incidents) has 90-day retention
-- - Verified knowledge (known_resolutions, engineering_memory) persists indefinitely
-- - Sanitization is enforced at the RPC layer, not the table layer
-- - Environment isolation is inherent to separate QA/production databases

-- ─── incident_signatures ────────────────────────────────────────────────
-- Groups recurring structurally equivalent incidents.
-- Owns recurrence/count information.
-- One signature can have many incidents.

CREATE TABLE IF NOT EXISTS public.incident_signatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint     text NOT NULL UNIQUE,       -- structural hash: md5(type:component:source_location:normalized_template)
  type            text NOT NULL,               -- error, broken_workflow, sync_failure, auth_failure, performance, regression, agent_loop
  component       text NOT NULL,               -- auth, sales, inventory, customers, payments, returns, signals, images, ui, infrastructure
  source          text NOT NULL,               -- client, server, test, ci, agent
  message_template text NOT NULL,              -- normalized message with dynamic values replaced
  occurrence_count integer NOT NULL DEFAULT 1, -- how many incidents share this signature
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  resolution_id   uuid,                        -- FK to known_resolutions (nullable, set during triage)
  environment     text NOT NULL DEFAULT 'qa',  -- qa, ci, production (derived from connection, not client)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_type CHECK (type IN ('error', 'broken_workflow', 'sync_failure', 'auth_failure', 'performance', 'regression', 'agent_loop')),
  CONSTRAINT valid_component CHECK (component IN ('auth', 'sales', 'inventory', 'customers', 'payments', 'returns', 'signals', 'images', 'ui', 'infrastructure')),
  CONSTRAINT valid_source CHECK (source IN ('client', 'server', 'test', 'ci', 'agent')),
  CONSTRAINT valid_environment CHECK (environment IN ('qa', 'ci', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_incident_signatures_fingerprint ON public.incident_signatures (fingerprint);
CREATE INDEX IF NOT EXISTS idx_incident_signatures_component ON public.incident_signatures (component);
CREATE INDEX IF NOT EXISTS idx_incident_signatures_type ON public.incident_signatures (type);
CREATE INDEX IF NOT EXISTS idx_incident_signatures_last_seen ON public.incident_signatures (last_seen_at DESC);

COMMENT ON TABLE public.incident_signatures IS 'Groups structurally equivalent incidents. Owns recurrence count. One signature has many incidents.';
COMMENT ON COLUMN public.incident_signatures.fingerprint IS 'Stable structural hash: md5(type:component:source_location:normalized_message_template). Dynamic values stripped.';
COMMENT ON COLUMN public.incident_signatures.occurrence_count IS 'Number of individual incidents sharing this fingerprint. Incremented on each matching occurrence.';

-- ─── incidents ──────────────────────────────────────────────────────────
-- Individual incident occurrences.
-- Each row represents one actual event with its own evidence.
-- Linked to a signature for recurrence tracking.

CREATE TABLE IF NOT EXISTS public.incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id    uuid NOT NULL REFERENCES public.incident_signatures(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'detected',
  severity        text NOT NULL DEFAULT 'medium',
  message         text NOT NULL,               -- sanitized error message (max 2000 chars)
  context         jsonb NOT NULL DEFAULT '{}', -- sanitized diagnostic context (allowlisted fields only)
  stack_trace     text,                        -- sanitized stack trace (max 2000 chars)
  environment     text NOT NULL DEFAULT 'qa',  -- derived from connection target
  user_action     text,                        -- what the user/agent was doing (screen, operation)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,

  CONSTRAINT valid_incident_status CHECK (status IN (
    'detected', 'triaged', 'investigating', 'root_cause_found',
    'fix_proposed', 'fixed', 'verifying', 'verified', 'resolved',
    'false_positive', 'duplicate', 'superseded', 'blocked'
  )),
  CONSTRAINT valid_incident_severity CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT valid_incident_environment CHECK (environment IN ('qa', 'ci', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_signature_id ON public.incidents (signature_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON public.incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents (created_at DESC);
COMMENT ON TABLE public.incidents IS 'Individual incident occurrences. Each row is one actual event. Linked to signature for recurrence tracking.';
COMMENT ON COLUMN public.incidents.message IS 'Sanitized error message. Max 2000 chars. Phone/email/tokens stripped.';
COMMENT ON COLUMN public.incidents.context IS 'Sanitized diagnostic context. Only allowlisted fields permitted. Unknown fields rejected at ingestion.';
COMMENT ON COLUMN public.incidents.stack_trace IS 'Sanitized stack trace. Max 2000 chars. Runtime data stripped.';

-- ─── RLS policies ───────────────────────────────────────────────────────
-- Incidents are append-only for the application.
-- Read access through RPCs only (search_incidents).
-- Service-role can read for QA operations.

ALTER TABLE public.incident_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Anonymous can INSERT incidents (via record_incident RPC which is SECURITY DEFINER)
-- Anonymous cannot SELECT/UPDATE/DELETE incidents directly
CREATE POLICY incidents_insert_anon ON public.incidents
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY incidents_insert_authenticated ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY signatures_insert_anon ON public.incident_signatures
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY signatures_insert_authenticated ON public.incident_signatures
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- No SELECT/UPDATE/DELETE policies for anon/authenticated
-- Read access is through SECURITY DEFINER RPCs only
-- Service-role bypasses RLS for QA operations

-- ─── Grants ─────────────────────────────────────────────────────────────
-- Grant INSERT only to anon and authenticated (for record_incident RPC)
-- Do NOT grant SELECT/UPDATE/DELETE to anon/authenticated

GRANT INSERT ON public.incidents TO anon;
GRANT INSERT ON public.incidents TO authenticated;
GRANT INSERT ON public.incident_signatures TO anon;
GRANT INSERT ON public.incident_signatures TO authenticated;

-- Revoke any broad public access
REVOKE ALL ON public.incidents FROM PUBLIC;
REVOKE ALL ON public.incident_signatures FROM PUBLIC;
