-- ═══════════════════════════════════════════════════════════════════════════════
-- 0225 — The idempotency ledger's policy names one role, not two
--
-- `0224` created `sale_submissions` and copied its access rule from staging, where the deny-all policy
-- is addressed to `anon, authenticated`. `0223` had just finished making the stronger statement — no
-- policy in `public` names `anon` or `public` at all — and 0224 added one back. The predicate is
-- `false`, so nothing became readable; but an invariant that says "no policy" is worth more than a
-- reviewer having to notice that this one is harmless.
--
-- Narrowing only: the policy still denies every client, and the function that writes through this
-- table is SECURITY DEFINER, so it is unaffected.
-- ═══════════════════════════════════════════════════════════════════════════════

do $narrow$
declare
  v_left text;
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'sale_submissions') then
    drop policy if exists sale_submissions_no_client_access on public.sale_submissions;
    create policy sale_submissions_no_client_access on public.sale_submissions
      for all to authenticated using (false) with check (false);
    revoke all on table public.sale_submissions from public, anon;
    grant select, insert on table public.sale_submissions to authenticated;
  end if;

  -- This file's own property only. The global "no policy names anon" invariant is 0223's, and it
  -- cannot be asserted here: this file is replayed on its own against the frozen baseline, where the
  -- rest of 0223's work is not present.
  select string_agg(policyname, ', ')
    into v_left
    from pg_policies
   where schemaname = 'public' and tablename = 'sale_submissions'
     and ('public' = any (roles) or 'anon' = any (roles));

  if v_left is not null then
    raise exception '0225: sale_submissions policy still names public or anon: %', v_left;
  end if;

  raise notice '0225: no policy in public names anon or public';
end
$narrow$;
