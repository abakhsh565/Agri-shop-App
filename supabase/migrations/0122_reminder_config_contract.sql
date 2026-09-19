-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0122: reminder_configs contract
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE (live browser network log, real authenticated session):
--   GET /rest/v1/reminder_configs?select=*&customer_id=eq.<uuid> → 400
--   The application filters reminder_configs by customer_id and writes
--   customer_id, enabled, start_days, repeat_type, interval_n, interval_unit,
--   escalation, ends, ends_date, ends_count — NONE of which existed. So reminder
--   configuration could never load or save, exactly like the occurrence drift
--   fixed in 0116.
--
-- Additive: the legacy columns are preserved; the columns the application
-- already implements are added so the database matches the real contract.
-- customer_id also gives per-customer tenant ownership (config → customer).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reminder_configs
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS start_days integer,
  ADD COLUMN IF NOT EXISTS repeat_type text,
  ADD COLUMN IF NOT EXISTS interval_n integer,
  ADD COLUMN IF NOT EXISTS interval_unit text,
  ADD COLUMN IF NOT EXISTS escalation text,
  ADD COLUMN IF NOT EXISTS ends text,
  ADD COLUMN IF NOT EXISTS ends_date date,
  ADD COLUMN IF NOT EXISTS ends_count integer;

CREATE INDEX IF NOT EXISTS reminder_configs_customer_idx
  ON public.reminder_configs (shop_id, customer_id);

-- A config's customer must belong to the same tenant as the config. This is the
-- same ownership rule the occurrence RPC enforces, applied at the data layer so
-- a direct write cannot attach a config to another tenant's customer.
CREATE OR REPLACE FUNCTION public.enforce_reminder_config_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_customer_shop uuid;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.shop_id INTO v_customer_shop FROM customers c WHERE c.id = NEW.customer_id;
  IF v_customer_shop IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  IF NEW.shop_id IS NOT NULL AND NEW.shop_id IS DISTINCT FROM v_customer_shop THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: reminder customer belongs to another tenant';
  END IF;
  IF NEW.shop_id IS NULL THEN
    NEW.shop_id := v_customer_shop;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_reminder_config_tenant_trg ON public.reminder_configs;
CREATE TRIGGER enforce_reminder_config_tenant_trg
  BEFORE INSERT OR UPDATE ON public.reminder_configs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reminder_config_tenant();
