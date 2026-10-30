-- ═══════════════════════════════════════════════════════════════════════════════
-- 0263 — A receipt is removed by its row, not by a client DELETE on storage
--
-- 0261 created a DELETE policy on `storage.objects` for `finance-receipts`, scoped to the session's
-- shop and branch. The app does not need it: removing a receipt removes its row, and the object is
-- already unreachable because the row that named its path is gone.
--
-- `0230` is the permanent rule that no later file re-opens storage to client mutation, and
-- `tests/unit/storagePolicyLockdown.test.ts` reads every migration after it. That guard caught this
-- policy — correctly. A client that can delete objects is a client that can delete a file another
-- screen still references; the app's other uploads (product photos, business papers) never grant it,
-- and a receipt is a private paper, so it must not be the exception.
--
-- WHAT HAPPENS TO THE OBJECT. Nothing on the client. It stays in the private bucket with no row
-- pointing at it: unlistable by the app, unopenable without a signed URL that only a row can ask
-- for, and reclaimable only by server-side maintenance. A storage leak of one private object is the
-- price of not handing every signed-in client a delete grant, and it is the same contract the rest
-- of the app already follows (a replaced business paper also leaves its old object behind).
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "finance receipts delete" on storage.objects;

do $lockdown$
declare
  v_left integer;
begin
  select count(*) into v_left
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname = 'finance receipts delete';

  if v_left > 0 then
    raise exception '0263: the receipt delete policy is still on storage.objects';
  end if;

  -- The two policies the app does rely on must survive the correction: a client may read its own
  -- branch's receipt and upload into it, and nothing else.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'finance receipts read'
  ) then
    raise exception '0263: the receipt read policy was removed by accident';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'finance receipts write'
  ) then
    raise exception '0263: the receipt upload policy was removed by accident';
  end if;

  raise notice '0263: receipts are read and uploaded by their branch, and never deleted by a client';
end
$lockdown$;
