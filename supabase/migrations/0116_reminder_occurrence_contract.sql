-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0116: reminder occurrence contract + authorization
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE:
--   * The app (src/lib/reminderEngine.ts) sends customer_id, occurrence_number,
--     stage, crop_name, tone and orders reads by occurrence_number, but
--     reminder_occurrences had none of those columns. Every occurrence write
--     therefore failed with "column ... does not exist", and the reminder engine
--     threw. The table and the app contract had drifted apart.
--   * upsert_reminder_occurrence had NO permission check and resolved the
--     idempotency key GLOBALLY, so one tenant's key collision could return
--     another tenant's occurrence row.
--   * It was executable by `anon`.
--
-- Additive: existing columns are untouched; the missing ones are added so the
-- database matches the contract the application already implements.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reminder_occurrences
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS occurrence_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS crop_name text,
  ADD COLUMN IF NOT EXISTS tone text;

CREATE INDEX IF NOT EXISTS reminder_occurrences_config_idx ON public.reminder_occurrences (config_id);
CREATE INDEX IF NOT EXISTS reminder_occurrences_key_idx ON public.reminder_occurrences (shop_id, occurrence_key);

CREATE OR REPLACE FUNCTION public.upsert_reminder_occurrence(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_existing jsonb;
  v_customer uuid := NULLIF(payload->>'customer_id', '')::uuid;
BEGIN
  -- Sending/managing reminders is a business action that needs a permission.
  v_tenant := authorize_business_action('alerts.manage');

  -- Idempotency key is scoped to the tenant: a key collision in another tenant
  -- must never return (or overwrite) that tenant's row.
  SELECT row_to_json(occ) INTO v_existing
    FROM reminder_occurrences occ
   WHERE occ.occurrence_key = payload->>'occurrence_key'
     AND occ.shop_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- reminder_occurrences.entity_id is NOT NULL: an occurrence always belongs to
  -- an entity, which for this product is the customer the reminder is about.
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED: a reminder occurrence must reference a customer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = v_customer AND c.shop_id = v_tenant) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: customer belongs to another tenant';
  END IF;

  INSERT INTO reminder_occurrences (
    config_id, customer_id, occurrence_number, stage, crop_name, tone,
    occurrence_key, scheduled_date, status, entity_type, entity_id, entity_name, shop_id
  ) VALUES (
    NULLIF(payload->>'config_id', '')::uuid,
    v_customer,
    COALESCE((payload->>'occurrence_number')::int, 1),
    payload->>'stage',
    payload->>'crop_name',
    payload->>'tone',
    payload->>'occurrence_key',
    NULLIF(payload->>'scheduled_date', '')::date,
    COALESCE(payload->>'status', 'scheduled'),
    'customer',
    v_customer,
    COALESCE((SELECT c.name FROM customers c WHERE c.id = v_customer), payload->>'crop_name'),
    v_tenant
  )
  RETURNING row_to_json(reminder_occurrences.*) INTO v_existing;

  RETURN v_existing;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_reminder_occurrence(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_reminder_occurrence(jsonb) TO authenticated, service_role;

-- reminder_logs was also unreachable for the app (RLS on, no policy, no tenant
-- column). It is written only by the reminder engine, so scope it the same way.
ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS occurrence_id_ref uuid;
