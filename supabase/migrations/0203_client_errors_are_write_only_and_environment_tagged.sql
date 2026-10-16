-- Client error events — the smallest monitoring that can be proven from this repository.
--
-- WHY THE DATABASE AND NOT A VENDOR
--   There is no error-monitoring provider in this project's catalog, and adding a platform nobody
--   reviewed is exactly the "large observability platform" the scope rules exclude. Supabase is
--   already the stack, already has credentials in every environment, and already has a row-level
--   security model that can hold the two rules that matter here.
--
-- THE RULES, ENFORCED HERE RATHER THAN TRUSTED TO THE WRITER
--   1. `environment` is constrained to the three names the app can actually be in. A staging event
--      cannot be mislabelled as production, and a production event cannot be mistaken for QA noise.
--   2. There is NO select, update or delete policy for `anon`/`authenticated`. An error message can
--      quote a customer's name, a phone number or an amount, so the rows are readable only by the
--      service role. The absence of a read policy is the control — a tenant cannot read another
--      tenant's errors, and one shop cannot even read its own through the client.
--   3. Inserts ARE accepted from clients, including before sign-in: the errors most worth having are
--      the ones that happen on the way in. The payload is bounded (message 500 chars, details 2 KB)
--      so a client cannot use this table as storage.
CREATE TABLE IF NOT EXISTS public.client_error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment varchar(20) NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  app_version varchar(40),
  screen varchar(120),
  error_code varchar(80),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  branch_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 2048),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_error_events_environment_time
  ON public.client_error_events (environment, occurred_at DESC);

ALTER TABLE public.client_error_events ENABLE ROW LEVEL SECURITY;

-- Insert-only, and only insert: nothing below grants SELECT to a client role.
DROP POLICY IF EXISTS client_error_events_insert_only ON public.client_error_events;
CREATE POLICY client_error_events_insert_only ON public.client_error_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- No SELECT/UPDATE/DELETE policy exists on purpose. Without one, RLS denies every client read, so
-- an error row can be written by the app and read by the service role and by nobody else.
GRANT INSERT ON public.client_error_events TO anon, authenticated;
GRANT SELECT ON public.client_error_events TO service_role;

COMMENT ON TABLE public.client_error_events IS
  'Client-side error events. Write-only for clients; read by the service role. environment is '
  'constrained so QA and production events cannot be confused.';
