-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0142: a supplier can be archived without destroying its history
-- ═══════════════════════════════════════════════════════════════════════════════
-- Company Details offered no way to remove a supplier. `companies.is_active`
-- already existed and nothing ever wrote it, so this adds the sanctioned writer,
-- modelled on `archive_customer` (0112): soft, permission-gated, tenant-scoped.
--
-- History is preserved by construction: archiving flips a flag and touches no
-- purchase row. Every recorded purchase keeps its own `company_name` snapshot, so
-- purchase history, reports and supplier payments read exactly as before.
--
-- One safeguard is enforced here rather than in the UI: a supplier the shop still
-- OWES money to cannot be archived. Archiving hides the company from the
-- operational lists, which would bury a live payable while the debt remained —
-- the one case where "remove from the app" and "preserve the records" conflict.
-- The owner settles the balance (or does not archive) instead.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.archive_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_company record;
BEGIN
  v_actor := app_current_user_id();

  SELECT id, name, shop_id, outstanding_payable INTO v_company
    FROM companies WHERE id = p_company_id;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  PERFORM authorize_business_action('companies.edit', v_company.shop_id);

  -- Never hide a supplier that is still owed money: the payable would vanish from
  -- Payments while the debt stayed on the books.
  IF COALESCE(v_company.outstanding_payable, 0) > 0 THEN
    RAISE EXCEPTION 'COMPANY_HAS_PAYABLE: settle the outstanding payable before archiving this supplier';
  END IF;

  UPDATE companies
     SET is_active = false, updated_at = now()
   WHERE id = p_company_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'company_archived', 'company', p_company_id,
    jsonb_build_object('name', v_company.name));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.archive_company(uuid) TO authenticated;
