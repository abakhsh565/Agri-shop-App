-- ═══════════════════════════════════════════════════════════════════════════════
-- 0230 — Storage images are readable by anyone and writable by no anonymous caller
--
-- THE DEFECT (measured on production, 2026-10-18)
--   `storage.objects` carried four policies addressed to role `public`, each scoped only by bucket:
--
--     public_all_storage_delete  DELETE  USING (bucket_id = ANY(ARRAY[…four image buckets…]))
--     public_all_storage_insert  INSERT  CHECK (bucket_id = ANY(…))
--     public_all_storage_update  UPDATE  USING (bucket_id = ANY(…))
--     public_all_storage_select  SELECT  USING (bucket_id = ANY(…))
--
--   so an unauthenticated client holding the publishable key the browser bundle already ships could
--   delete, overwrite or upload any image in all four buckets. That is not a theory: the 71 demo
--   images were removed through the Storage API with nothing but that key
--   (`device-evidence/production-demo-identities-removed-2026-10-18.md` §5).
--
--   The `authenticated` policies were bucket-wide too (`images auth delete`, `images auth update`,
--   and the two older "their uploads" ones), so any signed-in member of any shop could delete or
--   overwrite another shop's images through the Storage API.
--
-- WHAT THIS FILE DOES — and why it is this small
--   * every INSERT/UPDATE/DELETE/ALL policy on `storage.objects` addressed to `public` or `anon` is
--     dropped (by name, from the catalogue, so an unknown older name cannot survive);
--   * the four `authenticated` UPDATE/DELETE policies are dropped as well, and none is created:
--     `src/lib/storage.ts` only ever uploads a new, unique path (`upsert: false`) and reads a public
--     URL — the application has no code path that updates or deletes a stored object, so an
--     authenticated write policy would be surface with no user. With no policy, RLS denies by
--     default and only the service role can remove an object.
--   * exactly two policies remain: one public SELECT restricted to the four image buckets (the
--     buckets are public and the app renders `getPublicUrl`, so reads are intended), and one
--     authenticated INSERT restricted to the same four buckets (the upload screen is behind login).
--
--   It does NOT scope ownership by `owner_id = auth.uid()`: that column is populated by the Storage
--   API from the request's JWT, and this project has no live signed-in upload to prove it (the demo
--   rows carried an empty `owner_id` because they were written while the public INSERT policy was in
--   force). A policy that depends on an unproven column is worse than no write policy at all; the
--   upload path itself cannot overwrite anything, because every upload is a fresh random name.
--
-- WHAT IT REFUSES TO LEAVE BEHIND
--   The block at the end raises if any policy on `storage.objects` lets anon/public write, or if any
--   UPDATE/DELETE policy survives for any client role at all — so a future file cannot quietly
--   re-open this without this one failing on the next replay.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. No anonymous/public write of any kind, whatever the policy is called ─────────────────────
do $drop_public$
declare
  r record;
begin
  for r in
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and (roles && array['public', 'anon']::name[])
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
    raise notice '0230: dropped public write policy %', r.policyname;
  end loop;
end
$drop_public$;

-- ── 2. The known authenticated write policies that are bucket-wide, not owner-scoped ────────────
drop policy if exists "images auth delete" on storage.objects;
drop policy if exists "images auth update" on storage.objects;
drop policy if exists "Authenticated users can delete their uploads" on storage.objects;
drop policy if exists "Authenticated users can update their uploads" on storage.objects;

-- Duplicates of the two policies kept below; one definition each is enough and two naming the same
-- thing is how a later edit recreates the split this file is closing.
drop policy if exists "public_all_storage_select" on storage.objects;
drop policy if exists "Public read access for image buckets" on storage.objects;
drop policy if exists "Authenticated users can upload images" on storage.objects;

-- ── 3. The two policies that should exist, created only where they are absent ───────────────────
do $ensure$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'images public read'
  ) then
    create policy "images public read" on storage.objects
      for select to public
      using (bucket_id = any (array['product-images', 'employee-photos', 'company-logos', 'customer-images']));
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'images auth write'
  ) then
    create policy "images auth write" on storage.objects
      for insert to authenticated
      with check (bucket_id = any (array['product-images', 'employee-photos', 'company-logos', 'customer-images']));
  end if;
end
$ensure$;

-- ── 4. The properties, asserted instead of assumed ──────────────────────────────────────────────
do $verify$
declare
  v_public_write text[];
  v_client_delete_update text[];
  v_read int;
  v_upload int;
begin
  select array_agg(policyname || '/' || cmd) into v_public_write
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and (roles && array['public', 'anon']::name[]);
  if v_public_write is not null then
    raise exception '0230: an anonymous caller can still write storage.objects: %', array_to_string(v_public_write, ', ');
  end if;

  select array_agg(policyname || '/' || cmd) into v_client_delete_update
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('UPDATE', 'DELETE');
  if v_client_delete_update is not null then
    raise exception '0230: an object can still be updated or deleted by a client role: %',
      array_to_string(v_client_delete_update, ', ');
  end if;

  select count(*) into v_read
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT' and policyname = 'images public read';
  select count(*) into v_upload
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT' and policyname = 'images auth write';
  if v_read <> 1 or v_upload <> 1 then
    raise exception '0230: expected exactly one public read and one authenticated upload policy (read=%, upload=%)', v_read, v_upload;
  end if;

  raise notice '0230: storage.objects now has public read + authenticated upload, and no client write/delete';
end
$verify$;
