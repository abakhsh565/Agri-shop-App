-- 0270 — the dashboard must read the stock ledger, not a table that never existed.
--
-- 0234 deliberately derives branch stock from inventory_movements rather than
-- maintaining a branch_stock table. 0266 named that non-existent table in the
-- inventory widget, so every Co-Owner dashboard failed at runtime.
DO $$
DECLARE
  v_definition text;
  v_old text := 'AND EXISTS (SELECT 1 FROM public.branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = ANY(v_branches));';
  v_new text := 'AND EXISTS (SELECT 1 FROM public.inventory_movements im WHERE im.product_id = p.id AND im.branch_id = ANY(v_branches));';
BEGIN
  SELECT pg_get_functiondef('public.get_co_owner_dashboard(uuid,text)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  ELSIF position('branch_stock' IN v_definition) > 0 THEN
    RAISE EXCEPTION '0270: unexpected get_co_owner_dashboard body';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
