-- 0334 — the app updates itself without the store.
--
-- WHAT THIS IS FOR. An APK is expensive: the owner has to send it, the shop has to install it, and
-- nothing that shipped can be fixed until they do. Everything in this app except the native shell is
-- web code, so the shell should be installed once and the code should arrive by itself.
--
-- THE SHAPE. Three things, and nothing else:
--
--   * `ota_bundles` — one row per published web bundle: which channel it belongs to, its version, the
--     zip, that zip's sha256, and the *native* build it needs. It is server-only: every client grant
--     is revoked, and only `service_role` (the publisher and the manifest function) may touch it.
--   * `ota_manifest(channel, native_version, current)` — answers one question for one installed app:
--     "is there a bundle for me, and where is it?" It is `security definer` and revoked from `anon`
--     and `authenticated`, so it cannot become a second way to read the table. The app reaches it
--     through the `ota-manifest` edge function, which adds the per-project channel allow-list.
--   * the `ota-bundles` storage bucket — a PUBLIC read bucket, on purpose. A bundle is the app's own
--     code, not a secret; what protects an install from a bad download is the sha256 the manifest
--     carries (the plugin verifies it before swapping the WebView), not the URL's obscurity. A
--     private bucket would need a signed URL per download, and a bundle published in March would stop
--     being installable in April.
--
-- WHY A CHANNEL IS A COLUMN AND ALSO A DEPLOYMENT. The column is what the publisher writes and what
-- the manifest answers. The deployment is the second lock: `dev`/`staging` live in the QA project and
-- `production` lives in the production project, so a staging phone cannot receive a production bundle
-- even if it asked for it — the row does not exist in the database it can reach. The edge function's
-- `OTA_ALLOWED_CHANNELS` is the third: a project refuses to serve a channel it was not configured for.
--
-- WHY `native_min`. A web bundle may only ever be installed into a shell that has the native plugins
-- it calls. Publishing a bundle that uses a plugin the installed APK does not have is the one way an
-- OTA update can brick a working app, so the publisher must state the native build it requires and the
-- manifest refuses to offer the bundle to an older shell. A native change is therefore: new APK, bump
-- `versionCode`, publish bundles with the new `native_min`.
--
-- ROLLBACK. `status` moves `candidate → active → superseded`, and a partial unique index makes "two
-- active bundles on one channel" impossible rather than merely discouraged. Rolling back is activating
-- the previous row again; the currently-active row becomes `superseded` in the same statement.

-- ── The ledger ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.ota_bundles (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  version text not null,
  native_min integer not null default 1,
  url text not null,
  checksum text not null,
  size_bytes bigint not null default 0,
  notes text,
  status text not null default 'candidate',
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  constraint ota_bundles_channel_check check (channel in ('dev', 'staging', 'production')),
  constraint ota_bundles_version_check check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$'),
  constraint ota_bundles_checksum_check check (checksum ~ '^[0-9a-f]{64}$'),
  constraint ota_bundles_status_check check (status in ('candidate', 'active', 'superseded', 'rolled_back')),
  constraint ota_bundles_native_min_check check (native_min >= 1),
  constraint ota_bundles_size_check check (size_bytes >= 0),
  -- https only, with one deliberate exception: the local stack serves the `dev` channel over
  -- loopback while the developer is testing the updater itself. A row that points anywhere else over
  -- plain http is refused, so this cannot become "http is fine now".
  constraint ota_bundles_url_check check (
    url ~ '^https://'
    or url ~ '^http://(127\.0\.0\.1|localhost):[0-9]{2,5}/'
  ),
  constraint ota_bundles_channel_version_key unique (channel, version)
);

comment on table public.ota_bundles is
  'Published web bundles per OTA channel. Server-only: written by the publisher, read by ota_manifest.';

-- One active bundle per channel, enforced by the database rather than by the publisher's care.
create unique index if not exists ota_bundles_one_active_per_channel
  on public.ota_bundles (channel)
  where status = 'active';

alter table public.ota_bundles enable row level security;

-- No client may read or write this table. The manifest function is the only reader, and it exposes
-- exactly one active bundle per call rather than the history.
revoke all on table public.ota_bundles from public, anon, authenticated;
grant select, insert, update, delete on table public.ota_bundles to service_role;

-- ── Version order ──────────────────────────────────────────────────────────────────────────
-- The app compares bundle versions to decide whether an offer is an update. A string comparison puts
-- `1.10.0` before `1.9.0`, which is exactly how an OTA system stops updating and nobody notices for a
-- week; this compares the three numbers and then treats a prerelease as older than its release.
create or replace function public.ota_compare_versions(p_left text, p_right text)
returns integer
language sql
immutable
set search_path = public
as $fn$
  with l as (select regexp_match(p_left, '^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-(.+))?$') as m),
       r as (select regexp_match(p_right, '^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-(.+))?$') as m)
  select case
    when (l.m) is null or (r.m) is null then 0
    when ((l.m)[1]::int, (l.m)[2]::int, (l.m)[3]::int) > ((r.m)[1]::int, (r.m)[2]::int, (r.m)[3]::int) then 1
    when ((l.m)[1]::int, (l.m)[2]::int, (l.m)[3]::int) < ((r.m)[1]::int, (r.m)[2]::int, (r.m)[3]::int) then -1
    when (l.m)[4] is null and (r.m)[4] is not null then 1
    when (l.m)[4] is not null and (r.m)[4] is null then -1
    when coalesce((l.m)[4], '') > coalesce((r.m)[4], '') then 1
    when coalesce((l.m)[4], '') < coalesce((r.m)[4], '') then -1
    else 0
  end as comparison
  from l, r
$fn$;

revoke all on function public.ota_compare_versions(text, text) from public, anon, authenticated;
grant execute on function public.ota_compare_versions(text, text) to service_role;

-- ── The question an installed app asks ────────────────────────────────────────────────────
create or replace function public.ota_manifest(
  p_channel text,
  p_native_version integer,
  p_current text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_bundle public.ota_bundles;
begin
  select * into v_bundle
  from public.ota_bundles
  where channel = p_channel
    and status = 'active';

  if v_bundle.id is null then
    return jsonb_build_object(
      'update', false,
      'channel', p_channel,
      'reason', 'NO_ACTIVE_BUNDLE'
    );
  end if;

  -- The shell decides what it can run. A bundle that needs a newer APK is not an update, it is an
  -- instruction to update the APK.
  if coalesce(p_native_version, 0) < v_bundle.native_min then
    return jsonb_build_object(
      'update', false,
      'channel', p_channel,
      'reason', 'NATIVE_TOO_OLD',
      'required_native', v_bundle.native_min,
      'version', v_bundle.version
    );
  end if;

  if p_current is not null
     and not (public.ota_compare_versions(v_bundle.version, p_current) > 0) then
    return jsonb_build_object(
      'update', false,
      'channel', p_channel,
      'reason', 'UP_TO_DATE',
      'version', v_bundle.version
    );
  end if;

  return jsonb_build_object(
    'update', true,
    'channel', p_channel,
    'version', v_bundle.version,
    'url', v_bundle.url,
    'checksum', v_bundle.checksum,
    'size_bytes', v_bundle.size_bytes,
    'required_native', v_bundle.native_min,
    'notes', v_bundle.notes
  );
end;
$fn$;

revoke all on function public.ota_manifest(text, integer, text) from public, anon, authenticated;
grant execute on function public.ota_manifest(text, integer, text) to service_role;

-- Declared for the ACL ratchet: both are server-only, and `writtenRpcAnonGuard` compares this list
-- against the ledger's own revokes in both directions.
do $declare$
declare
  v_server_only constant text[] := array[
    'ota_manifest',
    'ota_compare_versions'
  ];
begin
  if array_length(v_server_only, 1) <> 2 then
    raise exception '0334: the server-only declaration lost a name';
  end if;
end;
$declare$;

-- ── Where a bundle lives ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('ota-bundles', 'ota-bundles', true)
on conflict (id) do update set public = true;

-- ── The proof ─────────────────────────────────────────────────────────────────────────────
do $proof$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ota_bundles') then
    raise exception '0334: the bundle ledger was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.ota_bundles'::regclass) then
    raise exception '0334: the bundle ledger is readable without RLS';
  end if;

  if has_table_privilege('anon', 'public.ota_bundles', 'SELECT')
     or has_table_privilege('authenticated', 'public.ota_bundles', 'SELECT') then
    raise exception '0334: a client role can read the bundle ledger';
  end if;

  if has_table_privilege('anon', 'public.ota_bundles', 'INSERT')
     or has_table_privilege('authenticated', 'public.ota_bundles', 'INSERT') then
    raise exception '0334: a client role can publish a bundle';
  end if;

  if not has_table_privilege('service_role', 'public.ota_bundles', 'SELECT') then
    raise exception '0334: the manifest function cannot read the ledger';
  end if;

  if has_function_privilege('anon', 'public.ota_manifest(text, integer, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ota_manifest(text, integer, text)', 'EXECUTE') then
    raise exception '0334: a client role can call the manifest directly';
  end if;

  if not has_function_privilege('service_role', 'public.ota_manifest(text, integer, text)', 'EXECUTE') then
    raise exception '0334: the ota-manifest function cannot reach the manifest';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'ota_bundles_one_active_per_channel'
  ) then
    raise exception '0334: two bundles could be active on one channel at the same time';
  end if;

  if not exists (select 1 from storage.buckets where id = 'ota-bundles' and public) then
    raise exception '0334: the ota-bundles bucket is missing or not readable';
  end if;

  if public.ota_compare_versions('1.10.0', '1.9.0') <> 1 then
    raise exception '0334: version order puts 1.10.0 before 1.9.0';
  end if;
  if public.ota_compare_versions('1.0.0', '1.0.0-rc.1') <> 1 then
    raise exception '0334: a prerelease outranks its release';
  end if;
  if public.ota_compare_versions('1.0.0', '1.0.0') <> 0 then
    raise exception '0334: the same version does not compare equal';
  end if;
end;
$proof$;
