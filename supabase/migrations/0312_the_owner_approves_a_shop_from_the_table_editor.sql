-- 0312_the_owner_approves_a_shop_from_the_table_editor.sql
--
-- WHY THIS EXISTS (owner's request, 2026-11-14):
--
-- A shop request arrives in `public.shop_requests` and the owner wants to act on it from
-- Supabase's Table Editor — open the table, see every request, pick a status from a dropdown —
-- without opening the SQL editor. Two things stopped that from being true:
--
--   1. `status` was `varchar(20)`, so the Table Editor rendered a free-text box, not a dropdown.
--      A Postgres ENUM is what makes that column a dropdown of exactly the values the app knows.
--
--   2. Setting `status = 'approved'` by hand changed the STATUS and nothing else. The shop, the
--      owner account, the membership and the roles are created by
--      `approve_shop_request(request_id, admin_id)` (0167/0150), and there is no trigger on the
--      table — so a dropdown approval left the person approved with no shop to sign in to. This
--      was measured on production tenant `923069856575`: status `pending`, account present,
--      sign-in correctly routed to `/login/under-review`.
--
-- So this file does two things, and only these two:
--
--   * `status` becomes `public.shop_request_status` (`pending`, `approved`, `hold`, `rejected`)
--     — the dropdown the owner asked for. These are the four values the app already speaks:
--     `ShopRequestStatus` in src/stores/shopRequestsStore.ts, and `hold` is what the sign-in path
--     in src/lib/auth.ts treats as "under review" (it routes to /login/under-review).
--   * A BEFORE UPDATE trigger performs the SAME provisioning `approve_shop_request` performs when
--     the row moves to `approved`. The RPC keeps working unchanged (it sets the status itself and
--     the trigger then sees OLD='pending' -> NEW='approved'; the shop it just created is found by
--     the owner check, so nothing is created twice).
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not widen authority: the table is writable only by
-- `service_role`/dashboard and by the platform admin path, so a signed-in shop owner still cannot
-- approve themselves. It creates nothing twice: an account that already owns a shop is not given a
-- second one, and an already-approved row never re-enters the branch.

-- ─── 1. The dropdown's type ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'shop_request_status') then
    create type public.shop_request_status as enum ('pending', 'approved', 'hold', 'rejected');
  end if;
end $$;

-- A type that already exists with a different vocabulary is a real conflict (a second name for
-- "under review" would give the dropdown two spellings of one decision), so it stops the migration
-- instead of being silently accepted.
do $$
declare
  v_missing text;
begin
  select string_agg(want, ', ') into v_missing
    from unnest(array['pending', 'approved', 'hold', 'rejected']) as want
   where not exists (
     select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'shop_request_status' and e.enumlabel = want
   );
  if v_missing is not null then
    raise exception '0312: shop_request_status is missing the label(s) %; the app reads pending/approved/hold/rejected', v_missing;
  end if;
end $$;

-- Any value the enum does not know is parked on `hold` rather than aborting the migration: a
-- request with an unexpected status must still be visible to the owner who has to decide it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shop_requests' and column_name = 'status'
       and data_type in ('character varying', 'text')
  ) then
    execute 'update public.shop_requests set status = ''hold''
              where status is null
                 or status not in (''pending'', ''approved'', ''hold'', ''rejected'')';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shop_requests' and column_name = 'status'
       and data_type in ('character varying', 'text')
  ) then
    -- The default is dropped first: it is a text default and Postgres will not retype the column
    -- while one is attached.
    execute 'alter table public.shop_requests alter column status drop default';
    execute 'alter table public.shop_requests alter column status type public.shop_request_status
               using status::text::public.shop_request_status';
    execute 'alter table public.shop_requests alter column status set default ''pending''::public.shop_request_status';
  end if;
end $$;

comment on type public.shop_request_status is
  'The four decisions a shop request can carry (hold = under review). An enum on purpose: Supabase''s Table Editor renders it as a dropdown, which is how the owner approves a request without the SQL editor.';

-- ─── 2. The dropdown's effect ──────────────────────────────────────────────────────────────
create or replace function public.shop_requests_apply_decision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_user uuid;
  v_shop uuid;
  v_new_user uuid;
begin
  -- Only the transition INTO approved provisions. Re-saving an already-approved row is a no-op.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select u.id into v_existing_user
      from users u
     where public.canonical_phone(u.phone) = public.canonical_phone(new.phone)
     limit 1;

    if v_existing_user is not null then
      -- The phone already answers for an account (the common case: the person registered, was
      -- left pending, and is being approved now). Attach a shop, but never a second one.
      if not exists (select 1 from shops s where s.owner_id = v_existing_user) then
        v_shop := public.create_shop_internal(new.shop_name, v_existing_user);
      end if;
    else
      v_shop := public.create_shop_internal(new.shop_name, null);
      v_new_user := gen_random_uuid();
      insert into users (
        id, name, phone, role, is_original_owner, is_active, employee_number, shop_id, created_by
      ) values (
        v_new_user, new.owner_name, new.phone, 'admin', true, true, 'EMP-001', v_shop,
        coalesce(auth.uid(), new.reviewed_by)
      );
      update shops set owner_id = v_new_user where id = v_shop;
    end if;

    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  end if;

  -- `rejected` and `hold` need no provisioning: the sign-in path in src/lib/auth.ts reads the
  -- status and routes to /login/rejected or /login/under-review. They are named here so the next
  -- reader does not add a second trigger to "handle" them.
  return new;
end;
$function$;

comment on function public.shop_requests_apply_decision() is
  'A decision taken on a shop request does what the decision means: approving provisions the shop, account and membership exactly as approve_shop_request does, so the owner can approve from a dropdown.';

drop trigger if exists shop_requests_apply_decision on public.shop_requests;
create trigger shop_requests_apply_decision
  before update of status on public.shop_requests
  for each row
  execute function public.shop_requests_apply_decision();

revoke execute on function public.shop_requests_apply_decision() from public, anon, authenticated;

-- ─── 3. Prove the two halves exist ────────────────────────────────────────────────────────
do $$
declare
  v_type text;
  v_trigger boolean;
begin
  select t.typname into v_type
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'shop_request_status';
  if v_type is null then
    raise exception '0312: shop_request_status enum is missing';
  end if;

  select exists (
    select 1 from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'shop_requests'
       and tg.tgname = 'shop_requests_apply_decision' and not tg.tgisinternal
  ) into v_trigger;
  if not v_trigger then
    raise exception '0312: the shop_requests decision trigger is missing';
  end if;
end $$;
