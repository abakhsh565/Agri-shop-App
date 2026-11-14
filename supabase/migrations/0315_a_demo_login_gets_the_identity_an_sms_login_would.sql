-- 0315_a_demo_login_gets_the_identity_an_sms_login_would.sql
--
-- WHY THIS EXISTS (2026-11-14, measured on the development stack):
--
-- On a build with a real SMS provider, the person proves the phone number at registration, and
-- that sign-in is what creates `auth.users` for it. `shop_request_provision` (0314) then takes
-- the account's id FROM that auth user, which is why every read in the app resolves a profile by
-- the session's uid.
--
-- The development stack has no SMS provider: `src/lib/authMode.ts` runs the demo code 123456 and
-- `ensureAuthSession` signs in with the credentials derived from the phone number. Nothing in that
-- path creates the auth user, because the browser deliberately may not (a `signUp` gets a fresh
-- random id, which resolves to no app user — see LOGIN_NOT_READY in src/lib/auth.ts).
--
-- So on development every approval produced a profile on a random uuid with no identity behind it,
-- and the very next sign-in answered "this number is invited, but its sign-in is not ready yet".
-- Measured twice: 923037470366 and 923006655443, both approved, both refused. Fixing that by hand
-- once per number is not a workflow; the approval has to leave the account signable, the way an
-- SMS build does.
--
-- WHAT THIS DOES. One flag, one function, one trigger:
--   * `public.login_bridge` is a single row carrying `enabled`, and it is created **false**. A
--     database that has not explicitly switched it on behaves exactly as it did before this file.
--   * `public.dev_login_identity(phone, preferred_id)` answers with the auth id that number should
--     sign in as: the identity that already exists, or a new one created with the demo
--     derivation, or NULL when the bridge is off.
--   * An AFTER INSERT trigger on `public.users` calls it for the new account, so an approval
--     (dropdown, RPC or script) leaves a login behind without anyone remembering to run anything.
--
-- WHY THAT IS SAFE ON PRODUCTION. The bridge is off unless a database turns it on, and no migration
-- turns it on: development switches it on with `scripts/dev/login-bridge.mjs`. The function is
-- SECURITY DEFINER and EXECUTE-revoked from every client role, so no session can mint a credential
-- for a number it does not own. Its failures are caught and warned, never raised: a login bridge
-- must not be able to break an approval.

-- ─── 1. The switch, off by default ───────────────────────────────────────────────────────────
create table if not exists public.login_bridge (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

insert into public.login_bridge (id, enabled, note)
values (true, false, 'Switched on by scripts/dev/login-bridge.mjs in development only.')
on conflict (id) do nothing;

revoke all on table public.login_bridge from public, anon, authenticated;

comment on table public.login_bridge is
  'Whether this database creates the login identity a real SMS sign-in would have created. Off unless development switches it on.';

-- ─── 2. The identity ────────────────────────────────────────────────────────────────────────
create or replace function public.dev_login_identity(
  p_phone text,
  p_preferred_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_enabled boolean;
  v_e164 text;
  v_existing uuid;
  v_template uuid;
  v_id uuid;
  v_email text;
  v_password text;
  v_cols text;
begin
  select b.enabled into v_enabled from public.login_bridge b where b.id;
  if coalesce(v_enabled, false) is not true then
    return null;
  end if;

  v_e164 := public.canonical_phone(p_phone);
  if v_e164 is null or v_e164 = '' then
    return null;
  end if;

  -- The same derivation the app signs in with (src/lib/auth.ts, phoneToAuthCredentials).
  v_email := 'user-' || v_e164 || '@agrishop.auth.local';
  v_password := 'AgriShop-' || v_e164 || '-2026!';

  -- A number never gets a second identity: whatever already answers for it is the answer.
  select a.id into v_existing
    from auth.users a
   where public.canonical_phone(a.phone) = v_e164
      or a.email = v_email
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_id := coalesce(p_preferred_id, gen_random_uuid());

  -- A profile on this id already has an identity; nothing to make.
  if exists (select 1 from auth.users a where a.id = v_id) then
    return v_id;
  end if;

  -- Copy the shape of a row GoTrue wrote itself: a hand-built row leaves columns NULL that its
  -- own sign-in query scans, which fails as "Database error querying schema". With nothing to
  -- copy from there is also nothing to sign in as, so leave the database untouched.
  select a.id into v_template from auth.users a order by a.created_at limit 1;
  if v_template is null then
    return null;
  end if;

  begin
    create temp table if not exists _login_bridge_row (like auth.users including defaults) on commit drop;
    delete from _login_bridge_row;
    insert into _login_bridge_row select * from auth.users where id = v_template;

    update _login_bridge_row
       set id = v_id,
           email = v_email,
           phone = null,
           phone_confirmed_at = null,
           encrypted_password = crypt(v_password, gen_salt('bf', 6)),
           email_confirmed_at = now(),
           created_at = now(),
           updated_at = now(),
           last_sign_in_at = null;

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a
     where a.attrelid = 'auth.users'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attgenerated = '';

    execute format('insert into auth.users (%s) select %s from _login_bridge_row', v_cols, v_cols);

    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id,
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now())
    on conflict do nothing;

    drop table _login_bridge_row;
  exception when others then
    -- A bridge that cannot make a login is a login to fix, not an approval to lose.
    raise warning 'dev_login_identity(%): %', v_e164, sqlerrm;
    return null;
  end;

  return v_id;
end;
$fn$;

comment on function public.dev_login_identity(text, uuid) is
  'The auth id this phone signs in as on a demo-OTP database: the identity it already has, or the one an SMS sign-in would have created. No-op unless public.login_bridge is enabled. Server-side only.';

revoke execute on function public.dev_login_identity(text, uuid) from public, anon, authenticated;

-- ─── 3. An approval leaves a login behind ──────────────────────────────────────────────────
create or replace function public.users_provision_login_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- The account's id is what the app resolves the session uid against, so the identity is made on
  -- the id the row already has. Off (production, staging), this is a no-op.
  perform public.dev_login_identity(new.phone::text, new.id);
  return new;
end;
$fn$;

comment on function public.users_provision_login_identity() is
  'Gives a newly created account the login identity an SMS sign-in would have created. No-op unless the development login bridge is enabled.';

drop trigger if exists users_provision_login_identity on public.users;
create trigger users_provision_login_identity
  after insert on public.users
  for each row
  execute function public.users_provision_login_identity();

revoke execute on function public.users_provision_login_identity() from public, anon, authenticated;

-- ─── 4. Self-checks ────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.login_bridge where id) then
    raise exception '0315: the login bridge has no switch row, so it could never be turned on';
  end if;

  if (select enabled from public.login_bridge where id) then
    raise exception '0315: the login bridge must arrive switched off — development turns it on with scripts/dev/login-bridge.mjs';
  end if;

  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'users'
       and t.tgname = 'users_provision_login_identity'
       and not t.tgisinternal
  ) then
    raise exception '0315: the users insert trigger is missing, so an approval would still leave no login';
  end if;
end $$;

-- ─── 5. Server-only, in the ledger's own words ─────────────────────────────────────────────
do $acl$
declare
  v_server_only constant text[] := array[
    'dev_login_identity',
    'users_provision_login_identity'
  ];
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname = any (v_server_only)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$acl$;
