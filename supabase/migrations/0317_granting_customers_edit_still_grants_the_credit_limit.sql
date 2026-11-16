-- 0317_granting_customers_edit_still_grants_the_credit_limit.sql
--
-- WHY THIS EXISTS (measured 2026-11-16, CI run 43786025437 on staging):
--
-- `creditRequest` asserts the invariant `0311` states in its own words: "whoever may edit a
-- customer may set their limit". `0311` restored it by inserting the missing pairs — ONCE. It
-- never installed anything that keeps the invariant true, and its own header says so ("0251
-- copied the grant only onto the roles that existed when it ran, and the copy drifted"). The copy
-- drifted again: QA held three roles with `customers.edit` and no `customers.credit_limit`, and the
-- suite failed with "expected 3 to be 0" on staging and on PR #69 alike, a batch that touches no
-- permission at all.
--
-- So this file does both halves, and the second half is the one that matters:
--   1. BACKFILL — grant `customers.credit_limit` to every role that already holds
--      `customers.edit`. Same insert as 0311, idempotent, touches no other grant.
--   2. KEEP IT TRUE — an AFTER INSERT trigger on `role_permissions` that grants the paired
--      permission the moment a role is given `customers.edit`, so a role created tomorrow through
--      the role editor, a template copy or a seeded tenant cannot recreate the gap. It only fires
--      for `customers.edit` (not for `customers.credit_limit`), so it cannot recurse.
--
-- THE PRODUCT GAP THIS CLOSES. Without the pair, the Credit Requests screen offers a role a path
-- to ask for a limit change and `set_customer_credit_limit` then refuses it: the role appears able
-- to do the job and cannot finish it. That is a permission bug people hit, not a tidy-up.
--
-- PRODUCTION. The backfill changes only `role_permissions` rows that are provably missing a grant
-- the invariant requires; the trigger adds no permission by itself. The header of 0311 records the
-- same rule, and production's ledger will run this after 0316 in the same batch.

-- ─── 1. Close the existing gap ───────────────────────────────────────────────────────────────
insert into role_permissions (role_id, permission_id)
select distinct rp.role_id, p_new.id
  from role_permissions rp
  join permissions p_old on p_old.id = rp.permission_id and p_old.code = 'customers.edit'
 cross join permissions p_new
 where p_new.code = 'customers.credit_limit'
on conflict do nothing;

-- ─── 2. Keep it closed ───────────────────────────────────────────────────────────────────────
create or replace function public.role_permissions_pair_customers_credit_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- Only the edit grant pulls the limit grant along. The mirror insert names
  -- `customers.credit_limit`, so this branch cannot fire for it again.
  if exists (
    select 1 from permissions p
     where p.id = new.permission_id
       and p.code = 'customers.edit'
  ) then
    insert into role_permissions (role_id, permission_id)
    select new.role_id, p.id
      from permissions p
     where p.code = 'customers.credit_limit'
    on conflict do nothing;
  end if;
  return null;
end;
$fn$;

comment on function public.role_permissions_pair_customers_credit_limit() is
  'Whoever may edit a customer may set their credit limit: granting customers.edit grants customers.credit_limit too (0317, invariant stated by 0311).';

revoke execute on function public.role_permissions_pair_customers_credit_limit() from public, anon, authenticated;

drop trigger if exists role_permissions_pair_customers_credit_limit on public.role_permissions;
create trigger role_permissions_pair_customers_credit_limit
  after insert on public.role_permissions
  for each row
  execute function public.role_permissions_pair_customers_credit_limit();

-- ─── 3. Self-checks ──────────────────────────────────────────────────────────────────────────
do $$
declare
  v_lost integer;
begin
  select count(*) into v_lost
    from role_permissions rp
    join permissions pe on pe.id = rp.permission_id and pe.code = 'customers.edit'
   where not exists (
     select 1
       from role_permissions rp2
       join permissions pn on pn.id = rp2.permission_id and pn.code = 'customers.credit_limit'
      where rp2.role_id = rp.role_id
   );

  if v_lost > 0 then
    raise exception '0317: % role(s) may edit customers but cannot set a credit limit', v_lost;
  end if;

  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'role_permissions'
       and t.tgname = 'role_permissions_pair_customers_credit_limit'
       and not t.tgisinternal
  ) then
    raise exception '0317: the pairing trigger is missing, so the gap can reopen';
  end if;
end $$;
