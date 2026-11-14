-- 0313_the_decision_calls_the_shop_writer_it_finds.sql
--
-- WHY THIS EXISTS (2026-11-14, measured on the production database):
--
-- 0312 made `shop_requests.status` a dropdown and gave it a trigger that provisions on approval.
-- The owner picked `approved` and production answered:
--
--   ERROR: 42883: function public.create_shop_internal(character varying, unknown) does not exist
--   HINT: No function matches the given name and argument types...
--   CONTEXT: PL/pgSQL function shop_requests_apply_decision() line 21 at assignment
--
-- So the trigger's literal two-argument call resolved on the local stack and did not resolve in
-- production: the writer there is not the three-argument `create_shop_internal(text, uuid, uuid[])`
-- that this release's `0166`/`0301` define. A trigger that hard-codes one arity is a call that
-- breaks the day the writer's shape differs from the branch it was written on — and it broke in the
-- one place where the owner has no way to see why: a cell he clicked.
--
-- WHAT THIS DOES. One small function, `shop_request_make_shop(name, owner)`, resolves the writer
-- that actually exists (`pg_proc`, most parameters first) and calls it with explicit casts, so the
-- varchar/unknown ambiguity that produced 42883 cannot happen: the name is `::text`, the owner is
-- `::uuid`, and the role selection is `::uuid[]` only when the found signature takes one. The
-- trigger keeps its behaviour and its guards and now calls that function instead.
--
-- WHAT IT DOES NOT DO. No new authority (still SECURITY DEFINER, EXECUTE-revoked from every client
-- role), no second shop for an account that already owns one, no provisioning for `hold` or
-- `rejected`, and no change to `approve_shop_request`, which keeps calling the writer itself.

create or replace function public.shop_request_make_shop(p_name text, p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_signature text;
  v_nargs integer;
  v_shop uuid;
begin
  -- `regprocedure` prints `name(types)`, which identifies the function for DDL but is not a call
  -- expression, so the signature is kept for the message and the call is built from the name.
  select p.oid::regprocedure::text, p.pronargs
    into v_signature, v_nargs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'create_shop_internal'
   order by p.pronargs desc
   limit 1;

  if v_signature is null then
    raise exception 'SHOP_WRITER_MISSING: public.create_shop_internal does not exist in this database';
  end if;

  -- The arity is read from the catalogue, so the call cannot drift from it again. Casts are
  -- explicit because `shop_name` is varchar and an untyped NULL matches nothing reliably.
  if v_nargs >= 3 then
    execute 'select public.create_shop_internal($1::text, $2::uuid, $3::uuid[])'
      into v_shop using p_name, p_owner, null;
  else
    execute 'select public.create_shop_internal($1::text, $2::uuid)'
      into v_shop using p_name, p_owner;
  end if;

  return v_shop;
end;
$function$;

comment on function public.shop_request_make_shop(text, uuid) is
  'Calls whichever public.create_shop_internal this database actually has, with explicit casts. The trigger path approves from a dropdown on databases whose writer is not the arity this branch was written on.';

revoke execute on function public.shop_request_make_shop(text, uuid) from public, anon, authenticated;

create or replace function public.shop_requests_apply_decision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_user uuid;
  v_new_user uuid;
  v_shop uuid;
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
        v_shop := public.shop_request_make_shop(new.shop_name::text, v_existing_user);
      end if;
    else
      -- Exactly `approve_shop_request`'s order (0167): the shop first, then the account whose home
      -- shop it is. Creating the account first would insert a user with no shop, which the
      -- membership trigger behind `users` cannot resolve into a home shop.
      v_shop := public.shop_request_make_shop(new.shop_name::text, null);

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
  -- status and routes to /login/rejected or /login/under-review.
  return new;
end;
$function$;

comment on function public.shop_requests_apply_decision() is
  'A decision taken on a shop request does what the decision means: approving provisions the shop, account and membership, so the owner can approve from a dropdown.';

drop trigger if exists shop_requests_apply_decision on public.shop_requests;
create trigger shop_requests_apply_decision
  before update of status on public.shop_requests
  for each row
  execute function public.shop_requests_apply_decision();

-- Prove the writer the trigger needs is resolvable in this database, before anyone clicks.
do $$
declare
  v_signature text;
begin
  select p.oid::regprocedure::text into v_signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_shop_internal'
   order by p.pronargs desc limit 1;
  if v_signature is null then
    raise exception '0313: public.create_shop_internal is missing, so a dropdown approval could not provision';
  end if;
  raise notice '0313: approvals will provision through %', v_signature;
end $$;
