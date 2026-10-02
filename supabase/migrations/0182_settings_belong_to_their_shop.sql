-- ============================================================
-- 0182 — a shop's settings belong to that shop
-- ============================================================
-- FINDING (measured on QA 2026-10-02, reproduced by tests/integration/appSettingsIsolation.test.ts
-- and backups/appsettings-probe.mjs). Found by re-probing the 0178/0180 question after 0181:
-- *which policies are reachable by an authenticated session but do not constrain the row to the
-- caller's shop?* `app_settings` was the last remaining answer outside reference data:
--
--   1. `app_settings_select` was `USING (true)` for `authenticated`. `app_settings` is NOT
--      reference data: it is per-shop configuration keyed by `(shop_id, setting_key)` — the
--      stock-alert threshold and frequency the owner sets, plus `void_window_hours`,
--      `expiry_warning_days` and `credit_limit_override_policy`. Any authenticated session —
--      the other shop's employee included — could read every shop's row through PostgREST.
--
--   2. `app_settings_insert` was `WITH CHECK (app_is_admin())` and `app_settings_update` was
--      `USING (app_is_admin())` — the 0180 shape. `app_is_admin()` answers "is this caller an
--      admin", never "of this row", so an admin of shop A could insert a row tagged
--      `shop_id = <shop B>` and could update shop B's threshold. The FK is `shop_id → shops(id)`,
--      so the boundary is the `shop_id` column itself.
--
-- WHY THE CLIENT PATH CAN BE CLOSED WITHOUT LOSING ANYTHING. Every function that touches
-- `app_settings` is SECURITY DEFINER with `search_path` pinned (measured on QA):
--
--   * `get_stock_alert_settings`  — the reader the app calls (authorizes `products.view`)
--   * `set_stock_alert_settings`  — the writer the app calls (authorizes `products.edit`,
--                                    derives shop and actor via `resolve_shop_and_actor`)
--   * `void_sale_v1`              — reads `void_window_hours` for the sale's own shop
--
-- They run with the owner's rights, so neither the narrowed policies nor the caller's own
-- role can reach them. No screen reads the table directly (zero `.from('app_settings')`
-- matches in `src/`), so nothing legitimate is on the path being closed.
--
-- SCOPE
--   Applied to QA/staging first (this file, in the ledger). Production is migrated forward only
--   by the schema-strategy decision, never by replaying history. No other policy is touched:
--   `permissions_select` stays permissive on purpose — `permissions` is global reference data
--   with no `shop_id`. `app_settings_delete` does not exist and stays that way: DELETE is
--   withheld by RLS rather than by a privilege.

-- ── 1. a shop reads its own settings ───────────────────────────────────────
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (shop_id = current_shop_id());

comment on policy app_settings_select on public.app_settings is
  'A shop''s own configuration only. It was USING (true), which let any authenticated session read every shop''s threshold, frequency and void window.';

-- ── 2. only the shop''s admins write, and only into their own shop ───────────
drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert to authenticated
  with check (app_is_admin() and shop_id = current_shop_id());

comment on policy app_settings_insert on public.app_settings is
  'app_is_admin() alone is not a boundary (0180): it says "is an admin", not "of this shop". The shop predicate is what makes the tag truthful.';

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using (app_is_admin() and shop_id = current_shop_id())
  with check (app_is_admin() and shop_id = current_shop_id());

comment on policy app_settings_update on public.app_settings is
  'Both the row being changed and the row it becomes must belong to the caller''s shop.';

-- ── 3. proof, in the migration itself ──────────────────────────────────────
do $$
declare
  v_wide text;
  v_open text;
begin
  -- Every remaining policy on the table must constrain the row to the caller's shop.
  select string_agg(p.polname, ', ')
    into v_wide
    from pg_policy p
   where p.polrelid = 'public.app_settings'::regclass
     and coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '')
         !~ 'current_shop_id';

  if v_wide is not null then
    raise exception '0182 left an app_settings policy with no shop predicate: %', v_wide;
  end if;

  -- And none may be the literal `true` again.
  select string_agg(p.polname, ', ')
    into v_open
    from pg_policy p
   where p.polrelid = 'public.app_settings'::regclass
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') = 'true';

  if v_open is not null then
    raise exception '0182 left a permissive app_settings policy: %', v_open;
  end if;

  raise notice '0182: app_settings is scoped to the caller''s shop; the DEFINER RPCs are unchanged';
end $$;
