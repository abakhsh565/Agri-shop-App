-- Archiving IS the delete: it carries its own permission (customers.delete) and its own
-- tenant check, enforced inside archive_customer/restore_customer (0112). But the UPDATE
-- policy on public.customers (permission_update_gate) only asks for customers.edit, so a
-- client holding customers.edit could set is_archived = true straight through PostgREST and
-- never touch customers.delete at all — the permission that exists to gate removal could be
-- bypassed with no RPC involved.
--
-- The RPC stays the only supported path. archive_customer/restore_customer are SECURITY
-- DEFINER and authorize customers.delete themselves, so this guard deliberately does what
-- protect_customer_financials (0037) already does for the financial columns: it constrains
-- writes made AS THE CALLING ROLE, and leaves owner-run functions (and an administrator
-- connected as postgres) untouched.
CREATE OR REPLACE FUNCTION public.protect_customer_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- SECURITY DEFINER functions run as the owner and authorize the actor themselves.
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF OLD.is_archived IS DISTINCT FROM NEW.is_archived
     OR OLD.archived_at IS DISTINCT FROM NEW.archived_at
     OR OLD.archived_by IS DISTINCT FROM NEW.archived_by THEN
    IF NOT public.has_effective_permission('customers.delete') THEN
      RAISE EXCEPTION
        'DELETE_PERMISSION_REQUIRED: archiving or restoring a customer requires the customers.delete permission — use archive_customer / restore_customer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_archive ON public.customers;
CREATE TRIGGER trg_protect_customer_archive
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer_archive();
