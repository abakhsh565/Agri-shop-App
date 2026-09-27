-- 0156 — deleting your own account actually runs.
--
-- `delete_my_account()` (0147) had never been executed end to end. Two things stopped it, both
-- on the first pass of an owner's deletion, and both hard errors:
--
-- 1. `UPDATE customers SET created_by = NULL` compares `customers.created_by` — a `varchar(255)`
--    carried over from the original schema, holding the uuid as text — against a `uuid[]`. The
--    server refuses to guess between those types:
--
--        operator does not exist: character varying = uuid
--
--    The column is compared as text rather than altered to `uuid`: it is a legacy column with
--    no foreign key, rows written before the uuid era may hold something else, and a type
--    change would fail the migration on exactly the data it is meant to leave alone.
--
-- 2. `users.shop_id` references `shops(id)` with NO ACTION, and the function purged the shop
--    *before* removing the logins that point at it:
--
--        update or delete on table "shops" violates foreign key constraint
--        "users_shop_id_fkey" on table "users"
--
--    That is a cycle: the shop cannot go while its people point at it, and the people cannot go
--    while the shop's sales point at them. Letting the logins go of the shop first breaks it —
--    `UPDATE users SET shop_id = NULL` before the purge, the rows themselves removed straight
--    after, once the shop's sales are gone with it.
--
-- Both raised before anything was half-done (the failing statement aborts the whole call), so
-- the only thing that ever showed on screen was "Could not delete your account".
--
-- Apply: `CREATE OR REPLACE` of one function and its `purge_shop_data` helper. Re-runnable,
-- touches no rows.
CREATE OR REPLACE FUNCTION purge_shop_data(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM return_items ri USING returns r WHERE ri.return_id = r.id AND r.shop_id = p_shop_id;
  DELETE FROM voids v USING sales s WHERE v.sale_id = s.id AND s.shop_id = p_shop_id;
  DELETE FROM sale_items si USING sales s WHERE si.sale_id = s.id AND s.shop_id = p_shop_id;
  DELETE FROM returns WHERE shop_id = p_shop_id;
  DELETE FROM sales WHERE shop_id = p_shop_id;

  DELETE FROM purchase_items pi USING purchases p WHERE pi.purchase_id = p.id AND p.shop_id = p_shop_id;
  DELETE FROM supplier_payments WHERE company_id IN (SELECT id FROM companies WHERE shop_id = p_shop_id);
  DELETE FROM purchases WHERE shop_id = p_shop_id;

  DELETE FROM payments WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = p_shop_id);
  DELETE FROM customer_payments WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = p_shop_id);
  DELETE FROM credit_limit_requests WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = p_shop_id);

  DELETE FROM inventory_movements im USING products pr WHERE im.product_id = pr.id AND pr.shop_id = p_shop_id;
  DELETE FROM stock_adjustments WHERE shop_id = p_shop_id;
  DELETE FROM product_variants pv USING products pr WHERE pv.product_id = pr.id AND pr.shop_id = p_shop_id;

  DELETE FROM products  WHERE shop_id = p_shop_id;
  DELETE FROM notifications WHERE shop_id = p_shop_id;
  DELETE FROM customers WHERE shop_id = p_shop_id;
  DELETE FROM companies WHERE shop_id = p_shop_id;

  -- Cascades the shops row's own children and removes the tenant itself.
  DELETE FROM shops WHERE id = p_shop_id;
END;
$$;
REVOKE ALL ON FUNCTION purge_shop_data(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_mine uuid[];
  v_staff uuid[];
  v_keeper uuid;
  -- The loop variable was declared `int`, which made every iteration cast a shop's uuid to an
  -- integer before the loop body was ever reached ("invalid input syntax for type integer:
  -- 00000000-..."). The count is its own variable; `v_shops` only ever holds a shop id.
  v_shops uuid;
  v_shop_count int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Shops this account answers for: rows it owns, plus any shop where it holds an owner/admin
  -- membership. Both, because `shops.owner_id` is not stamped on older rows.
  SELECT array_agg(DISTINCT sid) INTO v_mine FROM (
    SELECT id AS sid FROM shops WHERE owner_id = v_actor
    UNION
    SELECT tenant_id FROM memberships
     WHERE user_id = v_actor AND role IN ('owner', 'admin') AND status = 'active'
  ) mine;

  IF v_mine IS NOT NULL THEN
    SELECT array_agg(id) INTO v_staff FROM users WHERE shop_id = ANY(v_mine) AND id <> v_actor;
    -- History rows that point at those logins (nullable ones are detached, not destroyed).
    UPDATE returns                SET processed_by  = NULL WHERE processed_by  = ANY(v_staff);
    UPDATE inventory_movements    SET created_by    = NULL WHERE created_by    = ANY(v_staff);
    -- `customers.created_by` is `varchar(255)`: compare as text, not as uuid.
    UPDATE customers              SET created_by    = NULL WHERE created_by    = ANY(v_staff::text[]);
    UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = ANY(v_staff);
    UPDATE user_permissions       SET granted_by    = NULL WHERE granted_by    = ANY(v_staff);
    UPDATE users                  SET created_by    = NULL WHERE created_by    = ANY(v_staff);
    DELETE FROM activity_log WHERE user_id = ANY(v_staff);
    DELETE FROM audit_events WHERE user_id = ANY(v_staff);
    DELETE FROM user_permissions WHERE user_id = ANY(v_staff);

    -- `users.shop_id` is a NO ACTION reference to `shops`, and the sales being purged below are
    -- NO ACTION references to `users`: the logins have to let go of the shop before the shop can
    -- go, and only then can the logins themselves be removed.
    UPDATE users SET shop_id = NULL WHERE shop_id = ANY(v_mine);

    FOREACH v_shops IN ARRAY v_mine LOOP
      PERFORM purge_shop_data(v_shops);
      v_shop_count := v_shop_count + 1;
    END LOOP;

    DELETE FROM users WHERE id = ANY(v_staff);
    DELETE FROM auth.users WHERE id = ANY(v_staff);
  END IF;

  -- The caller's own footprints. Their shop is already gone when they own one; when they were an
  -- employee, this detaches them from the shop's history rather than deleting it.
  UPDATE returns                SET processed_by  = NULL WHERE processed_by  = v_actor;
  UPDATE inventory_movements    SET created_by    = NULL WHERE created_by    = v_actor;
  UPDATE customers              SET created_by    = NULL WHERE created_by    = v_actor::text;
  UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = v_actor;
  UPDATE shop_requests          SET reviewed_by   = NULL WHERE reviewed_by   = v_actor;
  UPDATE user_permissions       SET granted_by    = NULL WHERE granted_by    = v_actor;
  UPDATE users                  SET created_by    = NULL WHERE created_by    = v_actor;
  DELETE FROM activity_log WHERE user_id = v_actor;
  DELETE FROM audit_events WHERE user_id = v_actor;
  -- Not-nullable attribution is handed to someone still in the shop, so it keeps a valid record
  -- of what happened instead of losing the sale entirely.
  SELECT m2.user_id INTO v_keeper
  FROM memberships m1
  JOIN memberships m2 ON m2.tenant_id = m1.tenant_id AND m2.status = 'active'
  WHERE m1.user_id = v_actor AND m2.user_id <> v_actor AND m2.role IN ('owner', 'admin')
  ORDER BY m2.created_at ASC LIMIT 1;
  IF v_keeper IS NOT NULL THEN
    UPDATE sales  SET employee_id = v_keeper WHERE employee_id = v_actor;
    UPDATE voids  SET voided_by   = v_keeper WHERE voided_by   = v_actor;
    UPDATE cash_reconciliations SET reconciled_by = v_keeper WHERE reconciled_by = v_actor;
  ELSE
    -- Nobody left to inherit them: they belong to this account, so they go with it.
    DELETE FROM voids  v USING sales s WHERE v.sale_id = s.id AND v.voided_by = v_actor;
    DELETE FROM sales WHERE employee_id = v_actor;
    DELETE FROM cash_reconciliations WHERE reconciled_by = v_actor;
  END IF;

  DELETE FROM memberships WHERE user_id = v_actor;
  DELETE FROM users WHERE id = v_actor;
  DELETE FROM auth.users WHERE id = v_actor;   -- last: the login cannot outlive the data

  RETURN jsonb_build_object('ok', true, 'shops', v_shop_count);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_my_account() TO authenticated;

COMMENT ON FUNCTION delete_my_account() IS
  'Self-service account deletion. Owner: erases the shops they own and all their data. Employee: erases their access and login, keeping the shop records. Not recoverable.';
