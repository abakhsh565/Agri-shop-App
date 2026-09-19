-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0115: tenant RLS restoration + anon hardening
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE (measured against the QA project with a real authenticated JWT):
--
--   * 21 tables have RLS enabled with ZERO policies. For the `authenticated`
--     role that is a silent deny-all: reads return 0 rows and writes fail with
--     "new row violates row-level security policy".
--   * Proven failures this caused:
--       - shops            → 1 row exists, 0 visible to the app
--       - reminder_configs → INSERT rejected; the Reminder Configuration screen
--                            reports success because the error was ignored
--       - payments         → INSERT rejected
--   * 23 tenant-owned write RPCs were executable by `anon`.
--   * reminder_configs / reminder_occurrences / reminder_logs had NO tenant
--     column at all, so reminders could never be tenant-isolated.
--   * update_admin_profile trusted a caller-supplied `userId` parameter, so any
--     authenticated user could rename or re-photo ANOTHER user.
--
-- This migration is ADDITIVE. It restores access that the tenant model intends,
-- adds the missing tenant ownership to the reminder subsystem, and revokes
-- execution only where a JWT is provably required. No business rule is weakened,
-- and platform/Engineering-OS tables keep their intentional deny-all.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. SHOPS: a tenant may read its own shop ─────────────────────────────────
-- Match the existing convention used by customers/products/sales policies.
DROP POLICY IF EXISTS shops_select_own ON public.shops;
CREATE POLICY shops_select_own ON public.shops
  FOR SELECT TO authenticated
  USING (id = current_shop_id());

-- ── 2. BUSINESS SETTINGS: tenant-owned, was deny-all ─────────────────────────
DROP POLICY IF EXISTS business_settings_select ON public.business_settings;
CREATE POLICY business_settings_select ON public.business_settings
  FOR SELECT TO authenticated USING (shop_id = current_shop_id());

DROP POLICY IF EXISTS business_settings_insert ON public.business_settings;
CREATE POLICY business_settings_insert ON public.business_settings
  FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());

DROP POLICY IF EXISTS business_settings_update ON public.business_settings;
CREATE POLICY business_settings_update ON public.business_settings
  FOR UPDATE TO authenticated
  USING (shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

DROP POLICY IF EXISTS business_settings_delete ON public.business_settings;
CREATE POLICY business_settings_delete ON public.business_settings
  FOR DELETE TO authenticated USING (shop_id = current_shop_id());

-- ── 3. REMINDERS: establish tenant ownership, then scope it ──────────────────
-- These tables had no tenant column, which is why they could not be isolated.
-- The default resolves the tenant from the caller's active membership, so an
-- existing client insert needs no change; the policy still rejects a caller
-- that tries to write another tenant's id.
ALTER TABLE public.reminder_configs
  ADD COLUMN IF NOT EXISTS shop_id uuid NOT NULL DEFAULT current_shop_id();

ALTER TABLE public.reminder_occurrences
  ADD COLUMN IF NOT EXISTS shop_id uuid DEFAULT current_shop_id();

ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS shop_id uuid DEFAULT current_shop_id();

-- Backfill anything created before the column existed (no-op when empty).
UPDATE public.reminder_configs
   SET shop_id = (SELECT id FROM public.shops ORDER BY created_at LIMIT 1)
 WHERE shop_id IS NULL;
UPDATE public.reminder_occurrences o
   SET shop_id = c.shop_id
  FROM public.reminder_configs c
 WHERE o.config_id = c.id AND o.shop_id IS NULL;
UPDATE public.reminder_logs l
   SET shop_id = c.shop_id
  FROM public.reminder_configs c
 WHERE l.config_id = c.id AND l.shop_id IS NULL;

CREATE INDEX IF NOT EXISTS reminder_configs_shop_idx ON public.reminder_configs (shop_id);
CREATE INDEX IF NOT EXISTS reminder_occurrences_shop_idx ON public.reminder_occurrences (shop_id);

DROP POLICY IF EXISTS reminder_configs_select ON public.reminder_configs;
CREATE POLICY reminder_configs_select ON public.reminder_configs
  FOR SELECT TO authenticated USING (shop_id = current_shop_id());

DROP POLICY IF EXISTS reminder_configs_insert ON public.reminder_configs;
CREATE POLICY reminder_configs_insert ON public.reminder_configs
  FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());

DROP POLICY IF EXISTS reminder_configs_update ON public.reminder_configs;
CREATE POLICY reminder_configs_update ON public.reminder_configs
  FOR UPDATE TO authenticated
  USING (shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

DROP POLICY IF EXISTS reminder_configs_delete ON public.reminder_configs;
CREATE POLICY reminder_configs_delete ON public.reminder_configs
  FOR DELETE TO authenticated USING (shop_id = current_shop_id());

DROP POLICY IF EXISTS reminder_occurrences_all ON public.reminder_occurrences;
CREATE POLICY reminder_occurrences_all ON public.reminder_occurrences
  FOR ALL TO authenticated
  USING (shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

DROP POLICY IF EXISTS reminder_logs_all ON public.reminder_logs;
CREATE POLICY reminder_logs_all ON public.reminder_logs
  FOR ALL TO authenticated
  USING (shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

-- ── 4. CREDIT REQUESTS + CROPS: tenant derived through the customer ──────────
-- Neither table carries shop_id; ownership is the customer's tenant.
DROP POLICY IF EXISTS credit_limit_requests_tenant ON public.credit_limit_requests;
CREATE POLICY credit_limit_requests_tenant ON public.credit_limit_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c
                  WHERE c.id = credit_limit_requests.customer_id
                    AND c.shop_id = current_shop_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c
                       WHERE c.id = credit_limit_requests.customer_id
                         AND c.shop_id = current_shop_id()));

DROP POLICY IF EXISTS customer_crops_tenant ON public.customer_crops;
CREATE POLICY customer_crops_tenant ON public.customer_crops
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c
                  WHERE c.id = customer_crops.customer_id
                    AND c.shop_id = current_shop_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c
                       WHERE c.id = customer_crops.customer_id
                         AND c.shop_id = current_shop_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_occurrences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_logs TO authenticated;
GRANT SELECT ON public.shops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_settings TO authenticated;

-- ── 5. PROFILE UPDATE: identity comes from the JWT only ──────────────────────
-- Before: v_user_id fell back to (payload->>'userId'), so any authenticated
-- user could rename or re-photo another user. Now the actor can only edit self.
CREATE OR REPLACE FUNCTION public.update_admin_profile(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := app_current_user_id();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM authorize_tenant_membership(NULL);

  UPDATE users
     SET name = COALESCE(payload->>'name', name),
         photo_url = COALESCE(payload->>'photoUrl', photo_url),
         updated_at = now()
   WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'userId', v_user_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.update_admin_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_admin_profile(jsonb) TO authenticated, service_role;

-- ── 6. REMINDER STATUS: business action + tenant scope ───────────────────────
-- Before: any authenticated user could mark ANY occurrence (any tenant) as sent.
CREATE OR REPLACE FUNCTION public.update_reminder_occurrence_status(payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_occurrence uuid := (payload->>'occurrence_id')::uuid;
  v_owner_shop uuid;
BEGIN
  v_tenant := authorize_business_action('alerts.manage');

  SELECT o.shop_id INTO v_owner_shop FROM reminder_occurrences o WHERE o.id = v_occurrence;
  IF v_owner_shop IS NULL THEN RAISE EXCEPTION 'REMINDER_OCCURRENCE_NOT_FOUND'; END IF;
  IF v_owner_shop IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: reminder belongs to another tenant';
  END IF;

  UPDATE reminder_occurrences
     SET status = (payload->>'status')::text,
         sent_at = CASE WHEN payload ? 'sent_at' THEN (payload->>'sent_at')::timestamptz ELSE sent_at END,
         sent_channel = CASE WHEN payload ? 'sent_channel' THEN payload->>'sent_channel' ELSE sent_channel END,
         message = CASE WHEN payload ? 'message' THEN payload->>'message' ELSE message END,
         updated_at = now()
   WHERE id = v_occurrence;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.update_reminder_occurrence_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_reminder_occurrence_status(jsonb) TO authenticated, service_role;

-- ── 7. SCHEDULED REMINDER JOB: service role only ─────────────────────────────
-- process_reminders iterates every tenant's customers and had PUBLIC EXECUTE,
-- so an anonymous caller could trigger reminder generation for all tenants.
REVOKE EXECUTE ON FUNCTION public.process_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_reminders() TO service_role;

-- ── 8. STRUCTURAL GUARD: no anonymous execution of JWT-guarded writes ────────
-- Only functions that PROVABLY require a JWT (they call the authorize helpers)
-- are touched, so revoking anon cannot break a legitimate unauthenticated path
-- such as registration (insert_shop_request) or login (lookup_user_by_phone).
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proacl IS NOT NULL
       AND array_to_string(p.proacl, ',') ~ 'anon=X'
       AND pg_get_functiondef(p.oid) ~ 'authorize_business_action|authorize_tenant_membership'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
    RAISE NOTICE 'anon revoked on %', f.sig;
  END LOOP;
END $$;
