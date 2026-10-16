-- ═══════════════════════════════════════════════════════════════════════════════
-- 0170 — Deleting a number leaves nothing behind, so the number can start again
--
-- THE COMPLAINT, IN THE OWNER'S WORDS. "If I delete the number, you have to clear
--   all the data — if the user creates an account again he will start as a fresh
--   new user, nothing will show from the previous version."
--
-- WHAT WAS ACTUALLY WRONG. `delete_my_account` (0147, corrected by 0156) erased the
--   profile, the membership, the auth row and — for an owner — the shop and
--   everything in it. What it did NOT erase was the caller's own REGISTRATION
--   REQUEST, and that row is guarded by
--
--       CREATE UNIQUE INDEX idx_shop_requests_phone ON shop_requests(owner_phone)
--
--   so wherever 0019's index is in force the number could never register again: the
--   insert collided with a request about a shop that no longer existed, and the app
--   showed a failure the owner could do nothing about. The data was gone; the
--   doorway was nailed shut. And even with no index, the row is a live claim about a
--   deleted shop: `get_my_shop_request` — which the sign-in screen calls to decide
--   whether to offer registration — would answer "you already have a request"
--   against a shop that no longer exists.
--
-- THE FIX. The caller's own request rows go with the caller. They are matched on
--   the last ten digits, because the request may hold the local spelling
--   (`03001234567`) while the profile holds the E.164 one (`923001234567`) — the
--   same number written two ways, which a plain equality would miss.
--
-- WHAT THIS DOES NOT TOUCH. Another shop's request rows, another person's
--   account, and every row of a shop the caller does not own: deleting your own
--   account is a self-service act, and 0147's rule — the caller erases only what
--   is theirs — is unchanged.
--
-- BASE. This is 0156's body plus the one deletion above. 0156 fixed two hard errors
--   this function had never survived (the `varchar` comparison, and the
--   `users_shop_id_fkey` cycle broken by letting the logins go of the shop before the
--   purge). Rewriting this function from 0147 instead — which this file first did —
--   silently regressed both, and the lane below caught it twice before it shipped:
--   `invalid input syntax for type integer` from the loop variable, then `update or
--   delete on table "shops" violates foreign key constraint users_shop_id_fkey`. The
--   body below is the corrected one, so a replay of migrations ends here, not at
--   0147.
--
-- VERIFIED BY: tests/integration/accountDeletion.test.ts, which registers a real
--   number through the app's own RPCs, approves it, deletes it as that user, and
--   proves the number can register again and starts empty.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_mine uuid[];
  v_staff uuid[];
  v_keeper uuid;
  v_phone text;
  v_requests int := 0;
  -- 0156: the loop variable holds a shop id. Declaring it `int` made every iteration
  -- cast a uuid to an integer before the body was ever reached.
  v_shops uuid;
  v_shop_count int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Read the number first: after the rows below are deleted there is nothing left to read it from.
  SELECT phone INTO v_phone FROM users WHERE id = v_actor;

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

  -- NEW IN 0170: the number's own registration request, so this number can register again.
  -- Matched on the last ten digits: `03001234567` and `923001234567` are the same number
  -- written two ways, and only one of them is stored here.
  IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) >= 10 THEN
    DELETE FROM shop_requests
     WHERE right(regexp_replace(owner_phone, '\D', '', 'g'), 10)
         = right(regexp_replace(v_phone,      '\D', '', 'g'), 10);
    GET DIAGNOSTICS v_requests = ROW_COUNT;
  END IF;

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

  RETURN jsonb_build_object('ok', true, 'shops', v_shop_count, 'requests', v_requests);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_my_account() TO authenticated;

COMMENT ON FUNCTION delete_my_account() IS
  'Erases the caller: their shops and everything in them, their membership, their profile, their '
  'login and their registration request, so the same number can register again as a new user.';
