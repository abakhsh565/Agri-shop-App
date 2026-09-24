-- 0147 — The admin side is never restricted, and an account can erase itself.
--
-- Two things live here because they are the same subject: who is allowed to act, and how
-- someone leaves.
--
-- 1) ADMIN IS UNRESTRICTED
--    `get_effective_permissions` already shortcut `owner` to every permission code. A shop
--    whose membership role is `admin` — the same person by another spelling, and the only
--    role the admin shell is built for — fell through to its `role_permissions` rows, so an
--    admin could be refused `companies.create` at the RPC guard
--    (`authorize_business_action`) and see "permission denied" while looking at an app that
--    was entirely theirs. Owner and admin now take the same path. This is the single
--    authoritative layer: every business RPC guard and `get_my_permissions()` follow it, and
--    the client's `getCurrentPermissions()` mirrors it — not per-screen exceptions.
--
-- 2) DELETING AN ACCOUNT
--    `delete_my_account()` erases the caller for good. Two honest cases, decided by the
--    schema rather than by a guess:
--
--      • The caller answers for a shop — they own the row (`shops.owner_id`) or hold an
--        owner/admin membership in it — → that shop and its business data are erased with
--        them. There is no half-deleted shop left behind. (Both readings are needed: live
--        data has shops created before `owner_id` was stamped, where the membership is the
--        only record of who the shop belongs to.)
--      • Anyone else (an employee) → their access and login are erased; the shop's records
--        stay, because a shop's history is the shop's, not the employee's. Columns that
--        cannot be null (`sales.employee_id`, `voids.voided_by`,
--        `cash_reconciliations.reconciled_by`) are reassigned to the shop owner so no record
--        is corrupted, and the ones that can be null are detached.
--
--    `auth.users` is removed last so the login cannot survive the data. Nothing here is
--    recoverable, which is exactly what the confirmation in the UI says.
--
--    An employee's not-nullable rows are handed to the shop's owner; where a shop has no
--    other owner-holder left to inherit them, they go with the account rather than leaving
--    a half-deleted employee behind (a deletion that dead-ends is its own defect).

-- ── 1. Owner and admin: all permissions, implicitly ─────────────────────────────
CREATE OR REPLACE FUNCTION get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, app_current_user_id());
  v_caller uuid := app_current_user_id();
  v_tenant uuid;
  v_role membership_role;
  v_role_id uuid;
  v_result text[];
BEGIN
  IF v_user_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_caller IS DISTINCT FROM v_user_id AND NOT app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
  END IF;

  SELECT m.tenant_id, m.role, m.role_id
    INTO v_tenant, v_role, v_role_id
  FROM memberships m
  WHERE m.user_id = v_user_id AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;

  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  -- 'admin' joins 'owner' here: the admin shell is built for both, and a shop's admin is
  -- not a narrowed role. Narrowing belongs to employees, who are given explicit grants.
  IF v_role IN ('owner', 'admin') THEN
    SELECT array_agg(p.code ORDER BY p.code) INTO v_result FROM permissions p;
    RETURN to_jsonb(COALESCE(v_result, ARRAY[]::text[]));
  END IF;

  SELECT array_agg(code ORDER BY code) INTO v_result
  FROM (
    SELECT p.code
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id
    UNION
    SELECT p.code
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id
      AND up.is_override = true
      AND up.is_granted = true
    EXCEPT
    SELECT p.code
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id
      AND up.is_override = true
      AND up.is_granted = false
  ) effective;

  RETURN to_jsonb(COALESCE(v_result, ARRAY[]::text[]));
END;
$$;
GRANT EXECUTE ON FUNCTION get_effective_permissions(uuid) TO authenticated;

-- ── 2. Erasing a shop's business data ──────────────────────────────────────────
-- FK-safe order, derived from the live schema: every NO ACTION child of `shops` is removed
-- explicitly (grandchildren first, reached through their parent where the child table has no
-- shop_id of its own), and then the `shops` row itself, whose CASCADE children — memberships,
-- branches, roles, business areas, reconciliations, settings, sale_submissions — follow.
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

-- ── 3. Erasing the caller ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_mine uuid[];
  v_staff uuid[];
  v_keeper uuid;
  v_shops int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Shops this account answers for: rows it owns, plus any shop where it holds an
  -- owner/admin membership. Both, because `shops.owner_id` is not stamped on older rows.
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
    UPDATE customers              SET created_by    = NULL WHERE created_by    = ANY(v_staff);
    UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = ANY(v_staff);
    DELETE FROM activity_log WHERE user_id = ANY(v_staff);
    DELETE FROM audit_events WHERE user_id = ANY(v_staff);
    DELETE FROM user_permissions WHERE user_id = ANY(v_staff);

    FOREACH v_shops IN ARRAY v_mine LOOP
      PERFORM purge_shop_data(v_shops);
    END LOOP;

    DELETE FROM users WHERE id = ANY(v_staff);
    DELETE FROM auth.users WHERE id = ANY(v_staff);
  END IF;

  -- The caller's own footprints. Their shop is already gone when they own one; when they
  -- were an employee, this detaches them from the shop's history rather than deleting it.
  UPDATE returns                SET processed_by  = NULL WHERE processed_by  = v_actor;
  UPDATE inventory_movements    SET created_by    = NULL WHERE created_by    = v_actor;
  UPDATE customers              SET created_by    = NULL WHERE created_by    = v_actor;
  UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = v_actor;
  UPDATE shop_requests          SET reviewed_by   = NULL WHERE reviewed_by   = v_actor;
  UPDATE user_permissions       SET granted_by    = NULL WHERE granted_by    = v_actor;
  UPDATE users                  SET created_by    = NULL WHERE created_by    = v_actor;
  DELETE FROM activity_log WHERE user_id = v_actor;
  DELETE FROM audit_events WHERE user_id = v_actor;
  -- Not-nullable attribution is handed to someone still in the shop, so it keeps a valid
  -- record of what happened instead of losing the sale entirely.
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

  RETURN jsonb_build_object('ok', true, 'shops', v_shops);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_my_account() TO authenticated;

COMMENT ON FUNCTION delete_my_account() IS
  'Self-service account deletion. Owner: erases the shops they own and all their data. Employee: erases their access and login, keeping the shop records. Not recoverable.';
