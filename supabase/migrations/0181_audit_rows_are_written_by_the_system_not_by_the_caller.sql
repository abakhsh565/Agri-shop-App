-- ============================================================
-- 0181 — audit rows are written by the system, not by the caller
-- ============================================================
-- FINDING (measured on QA 2026-10-02, reproduced by tests/integration/auditIntegrity.test.ts and
-- backups/audit-probe{2,3}.mjs):
--
--   1. `audit_events_insert` was `WITH CHECK (true)` for `authenticated` — the only permissive
--      INSERT policy left in the schema after 0178/0180. The catastrophe it guards against is
--      forged history: `user_id`, `action`, `entity_type`, `entity_id` and `details` are all
--      caller-supplied on that path, so a client could write "someone else cancelled this sale"
--      and the audit table would believe it.
--
--      WHAT IS ACTUALLY REACHABLE TODAY, stated exactly: the forgery is NOT reachable from a
--      client right now, because `authenticated` and `anon` hold **no INSERT privilege** on the
--      table — the grant refuses the write before RLS is consulted (asserted in the suite). So
--      this file closes a LATENT hole, not a live exploit: the policy was the last thing that
--      would still have said yes, and one future `grant insert` would have reopened forgery
--      silently. A boundary that depends on a privilege nobody looks at is not a boundary.
--
--   2. `audit_events_select` was `app_is_admin()` — a role check with no shop predicate, on a
--      table that has no `shop_id` column (attribution is `user_id → users.shop_id`). That one
--      IS live: an admin of shop A read shop B's audit row, reproduced with the real client path
--      (two rows returned, one of them shop B's). This is the same shape 0178/0180 fixed.
--
-- THE TRUSTED WRITER IS UNTOUCHED. ~34 SECURITY DEFINER RPCs (`void_sale`, `process_return`,
-- `adjust_stock`, `delete_role`, `record_customer_payment`, `create_purchase`, …) insert their
-- audit row inside the same transaction as the business change, with attribution they derive
-- from the authenticated session. They run with the owner's rights, so neither the closed policy
-- nor the missing privilege can reach them — which is exactly why the client path can be closed
-- without losing any legitimate event.
--
-- WHY `user_id IS NULL` STAYS VISIBLE TO ADMINS
--   Rows with no actor are the pre-account ones (registration, provisioning) — there is no shop
--   to attribute them to, and hiding them would lose the beginning of a shop's own story. The FK
--   is `ON DELETE NO ACTION`, so a row cannot silently lose its actor when a user is deleted:
--   NULL means "written without an actor", never "the actor went away".
--
-- SCOPE
--   Applied to QA/staging first (this file, in the ledger). Production is migrated forward only
--   by the schema-strategy decision, never by replaying history. No other policy is touched.

-- ── 1. the client cannot write history ─────────────────────────────────────
drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_no_client_writes on public.audit_events
  for insert to authenticated
  with check (false);

comment on policy audit_events_no_client_writes on public.audit_events is
  'Audit history is written by the SECURITY DEFINER RPCs that perform the action, never by the client. An explicit false policy keeps both gates (privilege and RLS) saying no.';

-- ── 2. history is read per shop ────────────────────────────────────────────
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    app_is_admin()
    and (
      user_id is null
      or exists (
        select 1 from public.users u
         where u.id = audit_events.user_id
           and u.shop_id = current_shop_id()
      )
    )
  );

-- ── 3. proof, in the migration itself ──────────────────────────────────────
do $$
declare
  v_open text;
  v_wide text;
begin
  select string_agg(p.polname, ', ')
    into v_open
    from pg_policy p
   where p.polrelid = 'public.audit_events'::regclass
     and p.polcmd = 'a'
     and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true';

  if v_open is not null then
    raise exception '0181 left a permissive INSERT policy on audit_events: %', v_open;
  end if;

  select string_agg(p.polname, ', ')
    into v_wide
    from pg_policy p
   where p.polrelid = 'public.audit_events'::regclass
     and p.polcmd = 'r'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') !~ 'current_shop_id';

  if v_wide is not null then
    raise exception '0181 left a SELECT policy with no shop predicate on audit_events: %', v_wide;
  end if;

  raise notice '0181: audit history is client-read-only and shop-scoped; the RPC writers are unchanged';
end $$;
