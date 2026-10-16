-- Keep the existing financial implementations. Add context checks BEFORE any
-- early retry result and repeat them at retry-return sites (including collisions).
CREATE OR REPLACE FUNCTION public.guard_operational_request(p_rpc text,p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permission text;
  v_tenant uuid;
  v_branch uuid := public.current_branch_id();
  v_key text := NULLIF(COALESCE(p_payload->>'idempotencyKey',p_payload->>'idempotency_key'),'');
  v_record_branch uuid;
  v_record_tenant uuid;
  v_record_parent uuid;
  v_requested uuid;
  v_item jsonb;
  v_found boolean := false;
  v_sale_customer uuid;
BEGIN
  v_permission := CASE p_rpc WHEN 'create_sale' THEN 'sales.create' WHEN 'create_purchase' THEN 'purchases.create'
    WHEN 'void_sale' THEN 'sales.void' WHEN 'void_sale_v1' THEN 'sales.void' WHEN 'process_return' THEN 'returns.create'
    WHEN 'record_customer_payment' THEN 'customers.payments' WHEN 'record_supplier_payment' THEN 'payments.supplier'
    WHEN 'adjust_stock' THEN 'inventory.adjust' END;
  IF v_permission IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
  v_tenant := public.authorize_business_action(v_permission::varchar);
  IF NULLIF(p_payload->>'branchId','') IS NOT NULL AND (p_payload->>'branchId')::uuid IS DISTINCT FROM v_branch THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: select the requested branch first';
  END IF;
  IF NULLIF(p_payload->>'shopId','') IS NOT NULL AND (p_payload->>'shopId')::uuid IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF p_rpc IN ('process_return','void_sale','void_sale_v1') THEN
    v_requested := COALESCE(NULLIF(p_payload->>'saleId',''),NULLIF(p_payload->>'sale_id',''))::uuid;
    SELECT shop_id,branch_id,customer_id INTO v_record_tenant,v_record_branch,v_sale_customer FROM public.sales WHERE id=v_requested;
    IF NOT FOUND OR v_record_tenant IS DISTINCT FROM v_tenant OR v_record_branch IS DISTINCT FROM v_branch THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: record branch access denied';
    END IF;
    IF p_rpc='process_return' AND NULLIF(p_payload->>'customerId','') IS NOT NULL AND
      (p_payload->>'customerId')::uuid IS DISTINCT FROM v_sale_customer THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: return customer does not match the sale';
    END IF;
  END IF;
  -- Existing ledgers have tenant/global keys. Never disclose or accept a
  -- successful request from another branch/parent merely because its key matches.
  v_record_branch := NULL; v_record_parent := NULL;
  IF v_key IS NOT NULL THEN
    IF p_rpc='create_sale' THEN
      SELECT s.branch_id INTO v_record_branch FROM public.sale_submissions x
        JOIN public.sales s ON s.id=x.sale_id WHERE x.shop_id=v_tenant AND x.idempotency_key=v_key;
    ELSIF p_rpc='create_purchase' THEN
      SELECT branch_id INTO v_record_branch FROM public.purchases WHERE idempotency_key=v_key;
    ELSIF p_rpc='process_return' THEN
      SELECT branch_id,sale_id INTO v_record_branch,v_record_parent FROM public.returns WHERE idempotency_key=v_key;
    ELSIF p_rpc='record_customer_payment' THEN
      v_requested := NULLIF(p_payload->>'customerId','')::uuid;
      SELECT branch_id,customer_id INTO v_record_branch,v_record_parent FROM public.customer_payments WHERE idempotency_key=v_key LIMIT 1;
    ELSIF p_rpc='record_supplier_payment' THEN
      v_requested := NULLIF(p_payload->>'companyId','')::uuid;
      SELECT branch_id,company_id INTO v_record_branch,v_record_parent FROM public.supplier_payments WHERE idempotency_key=v_key LIMIT 1;
    ELSIF p_rpc='adjust_stock' THEN
      v_requested := NULLIF(p_payload->>'productId','')::uuid;
      SELECT branch_id,product_id INTO v_record_branch,v_record_parent FROM public.stock_adjustments WHERE idempotency_key=v_key LIMIT 1;
    END IF;
    v_found := FOUND;
    IF v_found AND (v_record_branch IS DISTINCT FROM v_branch OR
      (v_record_parent IS NOT NULL AND v_record_parent IS DISTINCT FROM v_requested)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: repeated request belongs to another branch or record';
    END IF;
  END IF;
  -- Master records are business-owned in the existing model. Enforce that
  -- boundary too, and reject a variant paired with someone else's product.
  IF NULLIF(p_payload->>'customerId','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id=(p_payload->>'customerId')::uuid AND shop_id=v_tenant
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: customer access denied'; END IF;
  IF NULLIF(p_payload->>'companyId','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id=(p_payload->>'companyId')::uuid AND shop_id=v_tenant
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: supplier access denied'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(CASE WHEN p_rpc='adjust_stock' THEN jsonb_build_array(p_payload)
    ELSE COALESCE(p_payload->'items','[]'::jsonb) END) LOOP
    IF p_rpc='process_return' AND NOT EXISTS (
      SELECT 1 FROM public.sale_items si WHERE si.id=COALESCE(NULLIF(v_item->>'saleItemId',''),NULLIF(v_item->>'sale_item_id',''))::uuid
        AND si.sale_id=v_requested AND si.product_id IS NOT DISTINCT FROM NULLIF(v_item->>'productId','')::uuid
        AND si.variant_id IS NOT DISTINCT FROM NULLIF(v_item->>'variantId','')::uuid
    ) THEN RAISE EXCEPTION 'ITEM_NOT_OWNED: return product or variant does not match the sale item'; END IF;
    IF NULLIF(v_item->>'productId','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE id=(v_item->>'productId')::uuid AND shop_id=v_tenant
    ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product access denied'; END IF;
    IF NULLIF(v_item->>'variantId','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants v JOIN public.products p ON p.id=v.product_id
      WHERE v.id=(v_item->>'variantId')::uuid AND p.shop_id=v_tenant
        AND p.id=NULLIF(v_item->>'productId','')::uuid
    ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: variant access denied'; END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_operational_request(text,jsonb) FROM PUBLIC,anon,authenticated;

-- Catalog-preserving correction: do not fork seven established financial
-- implementations or reset their signatures/defaults. Refuse an unknown shape.
DO $$
DECLARE
  v_name text;
  v_signature text;
  v_definition text;
  v_guard text;
  v_begin int;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['create_sale','create_purchase','process_return','record_customer_payment',
    'record_supplier_payment','adjust_stock','void_sale','void_sale_v1'] LOOP
    v_signature := CASE WHEN v_name='void_sale' THEN 'public.void_sale(uuid,text,uuid)' ELSE 'public.'||v_name||'(jsonb)' END;
    SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
    IF position('guard_operational_request' IN v_definition)>0 THEN CONTINUE; END IF;
    v_guard := CASE WHEN v_name='void_sale' THEN
      'PERFORM public.guard_operational_request(''void_sale'',jsonb_build_object(''saleId'',p_sale_id));'
      ELSE format('PERFORM public.guard_operational_request(%L,payload);',v_name) END;
    v_begin := position(E'BEGIN\n' IN v_definition);
    IF v_begin=0 THEN RAISE EXCEPTION '0192: unexpected body for %',v_signature; END IF;
    v_definition := overlay(v_definition PLACING E'BEGIN\n  '||v_guard||E'\n' FROM v_begin FOR 6);
    -- Retrying after a concurrent unique-key collision also checks the winner.
    v_definition := replace(v_definition,'RETURN jsonb_build_object',v_guard||E'\n RETURN jsonb_build_object');
    EXECUTE v_definition;
  END LOOP;
END $$;

-- The older compatibility endpoint is not used by the application. The canonical
-- void_sale remains guarded and retains its stock/history/concurrency semantics.
REVOKE ALL ON FUNCTION public.void_sale_v1(jsonb) FROM PUBLIC,anon,authenticated;

-- Selected context is an audit event, never a change to the actual actor.
CREATE OR REPLACE FUNCTION public.audit_branch_selection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF public.app_current_user_id() IS NULL OR NEW.branch_id IS NULL OR
     NEW.user_id IS DISTINCT FROM public.app_current_user_id() THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id AND NEW.shop_id IS NOT DISTINCT FROM OLD.shop_id THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_selected','branch',NEW.branch_id,NEW.branch_id,
    jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN OLD.branch_id ELSE NULL END,'after',NEW.branch_id));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_branch_selection_trg ON public.user_active_shops;
CREATE TRIGGER audit_branch_selection_trg AFTER INSERT OR UPDATE ON public.user_active_shops
  FOR EACH ROW EXECUTE FUNCTION public.audit_branch_selection();

-- Attribute the finalized totals, not the initial zero-valued sales INSERT.
DROP TRIGGER IF EXISTS audit_sale_created_trg ON public.sales;
CREATE OR REPLACE FUNCTION public.audit_operational_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF public.app_current_user_id() IS NULL OR (v_old IS NOT NULL AND v_old=v_new) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='sales' AND EXISTS(SELECT 1 FROM public.audit_events WHERE entity_type='sale'
    AND entity_id=NEW.id AND action='sale_created') THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),CASE WHEN TG_TABLE_NAME='sales' THEN 'sale_created' ELSE TG_TABLE_NAME||'_'||lower(TG_OP) END,
    CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale' WHEN 'customer_payments' THEN 'customer_payment'
      WHEN 'supplier_payments' THEN 'supplier_payment' WHEN 'stock_adjustments' THEN 'stock_adjustment' ELSE TG_TABLE_NAME END,
    NEW.id,NEW.branch_id,jsonb_build_object('before',v_old,'after',v_new));
  RETURN NEW;
END;
$$;
-- Deferred execution sees the finalized row via an explicit read.
CREATE OR REPLACE FUNCTION public.audit_final_sale_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_sale public.sales;
BEGIN
  IF public.app_current_user_id() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id=NEW.id;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'sale_created','sale',v_sale.id,v_sale.branch_id,
    jsonb_build_object('after',jsonb_build_object('saleNumber',v_sale.sale_number,'totalAmount',v_sale.total_amount,
      'amountPaid',v_sale.amount_paid,'amountDue',v_sale.amount_due,'customerId',v_sale.customer_id)));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_final_sale_created_trg ON public.sales;
CREATE CONSTRAINT TRIGGER audit_final_sale_created_trg AFTER INSERT ON public.sales
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.audit_final_sale_created();
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['customer_payments','supplier_payments','stock_adjustments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_operational_snapshot_trg ON public.%I',v_table);
    EXECUTE format('CREATE TRIGGER audit_operational_snapshot_trg AFTER INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.audit_operational_snapshot()',v_table);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
