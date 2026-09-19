-- 0109: enforce effective access at the business boundary
-- This migration intentionally changes authorization only; it does not weaken RLS.

-- Customer creation
CREATE OR REPLACE FUNCTION create_customer(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_phone text; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('customers.create', v_shop_id, NULLIF(payload->>'branchId','')::uuid);
  v_phone := NULLIF(payload->>'phone','');
  IF v_phone IS NOT NULL AND EXISTS(SELECT 1 FROM customers WHERE phone=v_phone AND is_archived=false AND shop_id=v_shop_id) THEN RAISE EXCEPTION 'DUPLICATE_CUSTOMER_PHONE'; END IF;
  INSERT INTO customers(id,name,phone,address,credit_limit,created_by,shop_id,created_at,updated_at)
  VALUES(gen_random_uuid(),payload->>'name',v_phone,NULLIF(payload->>'address',''),COALESCE((payload->>'credit_limit')::numeric,0),v_actor,v_shop_id,now(),now()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'name',payload->>'name');
END; $$;
GRANT EXECUTE ON FUNCTION create_customer(jsonb) TO authenticated;

-- Supplier/company creation
CREATE OR REPLACE FUNCTION create_company(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('companies.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  INSERT INTO companies(id,name,contact_person,phone,address,logo_url,outstanding_payable,total_purchases,shop_id,created_at)
  VALUES(gen_random_uuid(),payload->>'name',NULLIF(payload->>'contactPerson',''),NULLIF(payload->>'phone',''),NULLIF(payload->>'address',''),NULLIF(payload->>'logoUrl',''),0,0,v_shop_id,now()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'name',payload->>'name');
END; $$;
GRANT EXECUTE ON FUNCTION create_company(jsonb) TO authenticated;

-- Product creation. Company resolution remains compatible with the frontend name contract.
CREATE OR REPLACE FUNCTION create_product(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product_id uuid; v_resolved jsonb; v_shop_id uuid; v_actor uuid; v_company_id uuid; v_item jsonb;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('products.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN v_company_id := (payload->>'companyId')::uuid;
  ELSIF NULLIF(payload->>'company','') IS NOT NULL THEN SELECT id INTO v_company_id FROM companies WHERE name=payload->>'company' AND shop_id=v_shop_id LIMIT 1; END IF;
  IF v_company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM companies WHERE id=v_company_id AND shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: supplier belongs to another tenant'; END IF;
  INSERT INTO products(id,name,category,company_id,image_url,is_active,shop_id,created_at)
  VALUES(gen_random_uuid(),payload->>'name',COALESCE((payload->>'category')::product_category,'other'),v_company_id,NULLIF(payload->>'imageUrl',''),true,v_shop_id,now()) RETURNING id INTO v_product_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb)) LOOP
    INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold,unit_size,is_active)
    VALUES(v_product_id,v_item->>'name',COALESCE((v_item->>'sellingPrice')::numeric,0),COALESCE((v_item->>'costPrice')::numeric,0),COALESCE((v_item->>'stockQty')::int,0),GREATEST(COALESCE((v_item->>'lowStockThreshold')::int,5),0),GREATEST(COALESCE((v_item->>'unitSize')::numeric,1),1),true);
  END LOOP;
  RETURN jsonb_build_object('id',v_product_id,'name',payload->>'name');
END; $$;
GRANT EXECUTE ON FUNCTION create_product(jsonb) TO authenticated;

-- Sale creation: authorization is checked before any financial or inventory mutation.
CREATE OR REPLACE FUNCTION create_sale(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale_id uuid; v_sale_number text; v_resolved jsonb; v_shop_id uuid; v_actor uuid; v_customer_id uuid; v_total numeric(14,4):=0; v_paid numeric(14,4):=0; v_item jsonb;
BEGIN
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid); v_shop_id:=(v_resolved->>'shop_id')::uuid; v_actor:=(v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('sales.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  v_customer_id:=NULLIF(payload->>'customerId','')::uuid; v_paid:=COALESCE((payload->>'amountPaid')::numeric,0); v_sale_number:='SALE-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');
  INSERT INTO sales(id,sale_number,customer_id,customer_name_snapshot,employee_id,employee_name,total_amount,discount,payment_type,payment_method,amount_paid,amount_due,status,shop_id,created_at,updated_at)
  VALUES(gen_random_uuid(),v_sale_number,v_customer_id,COALESCE((SELECT name FROM customers WHERE id=v_customer_id AND shop_id=v_shop_id),COALESCE(payload->>'customerName','Walk-in')),v_actor,COALESCE(payload->>'employeeName',(SELECT name FROM users WHERE id=v_actor)),0,0,COALESCE(payload->>'paymentType','full')::payment_type,COALESCE(payload->>'paymentMethod','cash')::payment_method,v_paid,0,'completed',v_shop_id,now(),now()) RETURNING id INTO v_sale_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total:=v_total+ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2);
    IF NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NULLIF(v_item->>'productId','')::uuid AND p.shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product belongs to another tenant'; END IF;
    INSERT INTO sale_items(id,sale_id,product_id,variant_id,product_name,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_sale_id,NULLIF(v_item->>'productId','')::uuid,NULLIF(v_item->>'variantId','')::uuid,v_item->>'productName',COALESCE(v_item->>'variantName',''),(v_item->>'qty')::numeric,(v_item->>'unitPrice')::numeric,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2));
    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN UPDATE product_variants SET stock_qty=stock_qty-(v_item->>'qty')::numeric WHERE id=(v_item->>'variantId')::uuid AND stock_qty >= (v_item->>'qty')::numeric; IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF; END IF;
  END LOOP;
  UPDATE sales SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_sale_id;
  IF v_customer_id IS NOT NULL THEN UPDATE customers SET outstanding_balance=outstanding_balance+(v_total-v_paid),total_purchases=total_purchases+v_total,updated_at=now() WHERE id=v_customer_id AND shop_id=v_shop_id; END IF;
  RETURN jsonb_build_object('id',v_sale_id,'saleNumber',v_sale_number,'totalAmount',v_total,'amountPaid',v_paid,'outstandingBalance',GREATEST(0,v_total-v_paid));
END; $$;
GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;

-- Purchase creation
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_number text; v_total numeric(14,4):=0; v_paid numeric(14,4); v_item jsonb; v_company_name text; v_shop_id uuid; v_resolved jsonb;
BEGIN
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid); v_shop_id:=(v_resolved->>'shop_id')::uuid;
  PERFORM authorize_business_action('purchases.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  v_number:='PUR-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0'); v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  SELECT name INTO v_company_name FROM companies WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;
  INSERT INTO purchases(id,purchase_number,company_id,company_name,total_amount,amount_paid,amount_due,status,notes,shop_id,created_at,updated_at)
  VALUES(gen_random_uuid(),v_number,NULLIF(payload->>'companyId','')::uuid,COALESCE(v_company_name,'Unknown'),0,v_paid,0,'completed',payload->>'note',v_shop_id,now(),now()) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total:=v_total+(v_item->>'lineTotal')::numeric;
    INSERT INTO purchase_items(id,purchase_id,product_id,product_name,variant_id,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_id,NULLIF(v_item->>'productId','')::uuid,v_item->>'productName',NULLIF(v_item->>'variantId','')::uuid,COALESCE(v_item->>'variantName',''),(v_item->>'qty')::numeric,(v_item->>'costPrice')::numeric,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),(v_item->>'lineTotal')::numeric);
    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN UPDATE product_variants SET stock_qty=stock_qty+(v_item->>'qty')::numeric WHERE id=(v_item->>'variantId')::uuid; END IF;
  END LOOP;
  UPDATE purchases SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_id;
  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN UPDATE companies SET outstanding_payable=outstanding_payable+(v_total-v_paid),total_purchases=total_purchases+v_total,updated_at=now() WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id; END IF;
  RETURN jsonb_build_object('id',v_id,'purchaseNumber',v_number,'totalAmount',v_total,'outstandingPayable',GREATEST(0,v_total-v_paid));
END; $$;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;

-- Payment and stock RPCs are already SECURITY DEFINER; this guard is additive to
-- their existing business validation and is invoked by the latest deployments.
-- Keep the shared helper public so each future RPC must call it explicitly.
COMMENT ON FUNCTION authorize_business_action(varchar,uuid,uuid) IS 'Mandatory tenant, membership, permission, and optional branch authorization for business RPCs.';
