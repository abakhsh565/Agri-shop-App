-- 0261 — Recorded money keeps its papers, its voice notes and its past.
--
-- WHY THIS EXISTS. 0254 gave the owner one place to record rent, a cash delivery or money taken
-- out, and 0255 let those rows repeat. But a row was still just six numbers and a note: the paper
-- bill it came from had nowhere to live, a spoken explanation had nowhere to live, and a mistyped
-- amount could only be fixed by leaving the mistake in the ledger. The owner asked for receipts,
-- voice notes, corrections and a history of both.
--
-- WHAT IS ADDED, AND WHY EACH SHAPE.
--
--   * `finance_attachments` — one row per object, not an array on the entry. A receipt is a file
--     with its own mime type, size and (for voice) duration; three of them on one entry need three
--     rows or one JSON blob the database cannot count, validate or delete individually. The path
--     is the source of truth for the object, and the entry it belongs to is a real foreign key.
--
--   * `finance_entry_history` — written by a TRIGGER, not by each RPC. Every path that changes a
--     row (a hand-typed correction, a posted recurrence, a delete) gets the same record, and a
--     future writer cannot forget to log. The trigger stores the before and after snapshots as
--     jsonb, so the reader sees which fields moved rather than a sentence that claims they did.
--
--   * Soft delete. A deleted row stays in the table with `deleted_at`, because the history of a
--     money record is itself money information: "we recorded 5,000 rent and later removed it" is
--     different from "rent was never recorded". The ledger and the totals ignore deleted rows; the
--     history does not.
--
--   * A PRIVATE bucket, `finance-receipts`. A receipt can carry a supplier's name, a phone number
--     or a CNIC. It is read through short-lived signed URLs, exactly as the business's papers are
--     (0250), and the storage policy is scoped to the session's own shop AND current branch.
--
-- WHO MAY DO WHAT. Reading a row, its media and its history asks for `payments.view` — the same
-- gate the ledger already has. Writing a correction, deleting, attaching or removing asks for the
-- owner, the same split 0254 made for recording. Nothing here is executable by anon, and no client
-- role can reach the tables directly.

-- ── 1. The entry learns that it can change ─────────────────────────────────────────────────────
ALTER TABLE public.finance_entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 2. The papers ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES public.finance_entries(id) ON DELETE CASCADE,
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN ('photo', 'voice')),
  storage_path text NOT NULL UNIQUE,
  mime         text NOT NULL CHECK (length(mime) BETWEEN 3 AND 120),
  bytes        integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  duration_ms  integer CHECK (duration_ms IS NULL OR (duration_ms BETWEEN 250 AND 600000)),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- A voice note without a length cannot be drawn honestly; a photo with one is a contradiction.
  CONSTRAINT finance_attachment_kind_shape CHECK (
    (kind = 'voice' AND duration_ms IS NOT NULL) OR (kind = 'photo' AND duration_ms IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS finance_attachments_entry
  ON public.finance_attachments (entry_id, created_at);

ALTER TABLE public.finance_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.finance_attachments FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.finance_attachments IS
  'Receipt photos and voice notes attached to one recorded income/expense/drawing. Server-owned; written by attach_finance_media, read by get_finance_entry, removed by remove_finance_media. The object itself lives in the private finance-receipts bucket.';

-- ── 3. The past ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_entry_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES public.finance_entries(id) ON DELETE CASCADE,
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  action       text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changed_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  before_state jsonb,
  after_state  jsonb
);

CREATE INDEX IF NOT EXISTS finance_entry_history_entry
  ON public.finance_entry_history (entry_id, changed_at DESC);

ALTER TABLE public.finance_entry_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.finance_entry_history FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.finance_entry_history IS
  'One row per create, correction or delete of a recorded money entry, with the before/after snapshot. Written by a trigger so every writer is covered; read by get_finance_entry.';

-- One snapshot shape for every writer, so an old row and a new one compare field by field.
CREATE OR REPLACE FUNCTION public.finance_entry_snapshot(p_row public.finance_entries)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'kind',         p_row.kind,
    'amount',       p_row.amount,
    'occurred_on',  p_row.occurred_on,
    'category',     p_row.category,
    'method',       p_row.method,
    'counterparty', p_row.counterparty,
    'note',         p_row.note,
    'deleted_at',   p_row.deleted_at
  );
$$;

CREATE OR REPLACE FUNCTION public.finance_entry_history_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_actor  uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_actor  := NEW.created_by;
  ELSE
    -- A delete is a correction of a different kind: the row is still there, marked.
    v_action := CASE
      WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted'
      ELSE 'updated'
    END;
    v_actor := COALESCE(NEW.updated_by, NEW.deleted_by, NEW.created_by);
  END IF;

  INSERT INTO public.finance_entry_history (
    entry_id, shop_id, branch_id, action, changed_by, before_state, after_state
  ) VALUES (
    NEW.id,
    NEW.shop_id,
    NEW.branch_id,
    v_action,
    v_actor,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE public.finance_entry_snapshot(OLD) END,
    public.finance_entry_snapshot(NEW)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_entry_history_write ON public.finance_entries;
CREATE TRIGGER finance_entry_history_write
  AFTER INSERT OR UPDATE OF kind, amount, occurred_on, category, method, counterparty, note, deleted_at
  ON public.finance_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.finance_entry_history_write();

-- Existing rows get their own creation record, so a history opened tomorrow is not blank for
-- money recorded today. One row each, dated when the entry was written.
INSERT INTO public.finance_entry_history (
  entry_id, shop_id, branch_id, action, changed_by, changed_at, after_state
)
SELECT fe.id, fe.shop_id, fe.branch_id, 'created', fe.created_by, fe.created_at,
       public.finance_entry_snapshot(fe)
  FROM public.finance_entries fe
 WHERE NOT EXISTS (
   SELECT 1 FROM public.finance_entry_history h WHERE h.entry_id = fe.id
 );

-- ── 4. The private bucket ──────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-receipts',
  'finance-receipts',
  false,
  10485760,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY[
        'image/png', 'image/jpeg', 'image/webp',
        'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'
      ];

-- Path shape: <shop_id>/<branch_id>/<entry_id>/<uuid>.<ext>. The policy checks the first two
-- folders, so an object cannot be read from another branch even by the same business. The RPC
-- below checks the same prefix plus the third folder, because the policy alone would let an
-- attachment row point at a valid object of a different entry.
DROP POLICY IF EXISTS "finance receipts read"   ON storage.objects;
DROP POLICY IF EXISTS "finance receipts write"  ON storage.objects;
-- No DELETE policy: 0230 forbids any later file from re-opening storage.objects to a client
-- mutation, and a receipt is removed by removing the row that names it. 0263 says why.

CREATE POLICY "finance receipts read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'finance-receipts'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
    AND (storage.foldername(name))[2] = public.current_branch_id()::text
  );

CREATE POLICY "finance receipts write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finance-receipts'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
    AND (storage.foldername(name))[2] = public.current_branch_id()::text
  );

-- ── 5. Correcting a row ────────────────────────────────────────────────────────────────────────
-- The kind may change: an expense typed where an income belonged is the commonest correction.
-- The cadence may NOT change from here — a posted row is not the rule that posted it (0255), and
-- editing a row must not rewrite future money.
CREATE OR REPLACE FUNCTION public.update_finance_entry(
  p_id           uuid,
  p_kind         text,
  p_amount       numeric,
  p_category     text,
  p_method       text,
  p_occurred_on  date DEFAULT NULL,
  p_counterparty text DEFAULT NULL,
  p_note         text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_row    public.finance_entries;
  v_day    date;
  v_today  date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner corrects recorded money';
  END IF;

  SELECT * INTO v_row FROM public.finance_entries
   WHERE id = p_id AND shop_id = v_member.tenant_id
     AND branch_id = public.current_branch_id()
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry is not in this branch';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry was removed';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('income', 'expense', 'drawing') THEN
    RAISE EXCEPTION 'INVALID_KIND: expected income, expense or drawing';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a recorded amount is above zero';
  END IF;
  IF p_category IS NULL OR btrim(p_category) = '' OR length(btrim(p_category)) > 64 THEN
    RAISE EXCEPTION 'INVALID_CATEGORY';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'bank', 'easypaisa', 'jazzcash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;
  IF p_counterparty IS NOT NULL AND length(btrim(p_counterparty)) > 120 THEN
    RAISE EXCEPTION 'INVALID_COUNTERPARTY';
  END IF;
  IF p_note IS NOT NULL AND length(btrim(p_note)) > 500 THEN
    RAISE EXCEPTION 'INVALID_NOTE';
  END IF;

  v_day := COALESCE(p_occurred_on, v_row.occurred_on);
  IF v_day > v_today THEN
    RAISE EXCEPTION 'INVALID_DATE: money cannot be recorded before it happens';
  END IF;
  IF v_day < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'INVALID_DATE: that day is outside this ledger';
  END IF;

  UPDATE public.finance_entries
     SET kind         = p_kind,
         amount       = p_amount,
         category     = btrim(p_category),
         method       = p_method,
         occurred_on  = v_day,
         counterparty = NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
         note         = NULLIF(btrim(COALESCE(p_note, '')), ''),
         updated_at   = now(),
         updated_by   = v_member.user_id
   WHERE id = v_row.id;
END;
$$;

COMMENT ON FUNCTION public.update_finance_entry(uuid, text, numeric, text, text, date, text, text) IS
  'Corrects one recorded row in the session branch. Owner only; same validation as recording; the trigger writes the before/after history. A posted recurrence row is edited without touching its rule.';

REVOKE ALL ON FUNCTION public.update_finance_entry(uuid, text, numeric, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_finance_entry(uuid, text, numeric, text, text, date, text, text) TO authenticated;

-- Removing money is a soft delete: the row leaves the ledger and the totals, and the history keeps
-- the fact that it existed. The attachments stay with it, so a mistaken delete can still be read.
CREATE OR REPLACE FUNCTION public.delete_finance_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_row    public.finance_entries;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner removes recorded money';
  END IF;

  SELECT * INTO v_row FROM public.finance_entries
   WHERE id = p_id AND shop_id = v_member.tenant_id
     AND branch_id = public.current_branch_id()
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry is not in this branch';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN; -- already gone; a second tap is not an error
  END IF;

  UPDATE public.finance_entries
     SET deleted_at = now(),
         deleted_by = v_member.user_id,
         updated_at = now(),
         updated_by = v_member.user_id
   WHERE id = v_row.id;
END;
$$;

COMMENT ON FUNCTION public.delete_finance_entry(uuid) IS
  'Marks one recorded row deleted in the session branch. Owner only; idempotent; the trigger keeps the before/after history and the ledger stops counting it.';

REVOKE ALL ON FUNCTION public.delete_finance_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_finance_entry(uuid) TO authenticated;

-- ── 6. Attaching a paper or a voice note ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attach_finance_media(
  p_entry_id    uuid,
  p_kind        text,
  p_path        text,
  p_mime        text,
  p_bytes       integer,
  p_duration_ms integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_row    public.finance_entries;
  v_prefix text;
  v_count  integer;
  v_id     uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner attaches a receipt or a voice note';
  END IF;

  SELECT * INTO v_row FROM public.finance_entries
   WHERE id = p_entry_id AND shop_id = v_member.tenant_id
     AND branch_id = public.current_branch_id();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry is not in this branch';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry was removed';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('photo', 'voice') THEN
    RAISE EXCEPTION 'INVALID_KIND: expected photo or voice';
  END IF;
  IF p_path IS NULL OR length(p_path) < 8 OR length(p_path) > 400 THEN
    RAISE EXCEPTION 'INVALID_PATH';
  END IF;
  IF p_bytes IS NULL OR p_bytes <= 0 OR p_bytes > 10485760 THEN
    RAISE EXCEPTION 'INVALID_SIZE: a receipt is up to 10 MB';
  END IF;

  IF p_kind = 'photo' THEN
    IF p_mime NOT IN ('image/png', 'image/jpeg', 'image/webp') THEN
      RAISE EXCEPTION 'INVALID_TYPE: a receipt is a JPEG, PNG or WebP image';
    END IF;
    IF p_duration_ms IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_MEDIA: a photo has no duration';
    END IF;
  ELSE
    IF p_mime NOT IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a') THEN
      RAISE EXCEPTION 'INVALID_TYPE: that is not an audio recording this app can play';
    END IF;
    IF p_duration_ms IS NULL OR p_duration_ms < 250 OR p_duration_ms > 600000 THEN
      RAISE EXCEPTION 'INVALID_MEDIA: a voice note is between a quarter second and ten minutes';
    END IF;
  END IF;

  -- The object must be filed under THIS entry's own folder. The storage policy stops another
  -- shop or branch, but it cannot know which entry a path was meant for; this check can.
  v_prefix := v_member.tenant_id::text || '/' || public.current_branch_id()::text || '/' || p_entry_id::text || '/';
  IF left(p_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'INVALID_PATH: a receipt must be filed under its own entry';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.finance_attachments a
   WHERE a.entry_id = p_entry_id AND a.kind = p_kind;

  -- One entry can carry up to three receipts and up to two voice notes: enough for a paper bill,
  -- a stamped copy and a photo of the goods, and enough to say a sentence twice if need be.
  IF (p_kind = 'photo' AND v_count >= 3) OR (p_kind = 'voice' AND v_count >= 2) THEN
    RAISE EXCEPTION 'LIMIT_REACHED: this entry already carries as many % as it can', p_kind;
  END IF;

  INSERT INTO public.finance_attachments (
    entry_id, shop_id, branch_id, kind, storage_path, mime, bytes, duration_ms, created_by
  ) VALUES (
    p_entry_id, v_member.tenant_id, public.current_branch_id(), p_kind, p_path, p_mime,
    p_bytes, p_duration_ms, v_member.user_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.attach_finance_media(uuid, text, text, text, integer, integer) IS
  'Attaches one receipt photo or voice note to a recorded entry in the session branch. Owner only; validates type, size, duration, the entry''s own folder and the 3-photo / 2-voice limit.';

REVOKE ALL ON FUNCTION public.attach_finance_media(uuid, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_finance_media(uuid, text, text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_finance_media(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_path   text;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner removes a receipt';
  END IF;

  DELETE FROM public.finance_attachments a
   USING public.finance_entries fe
   WHERE a.id = p_id
     AND a.entry_id = fe.id
     AND a.shop_id = v_member.tenant_id
     AND a.branch_id = public.current_branch_id()
  RETURNING storage_path INTO v_path;

  IF v_path IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that attachment is not in this branch';
  END IF;

  -- The caller deletes the object with this path. The row is gone either way; an orphaned object
  -- is storage the owner can no longer see, not a broken entry.
  RETURN v_path;
END;
$$;

COMMENT ON FUNCTION public.remove_finance_media(uuid) IS
  'Removes one attachment row from the session branch and returns the storage path so the caller can delete the object. Owner only.';

REVOKE ALL ON FUNCTION public.remove_finance_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_finance_media(uuid) TO authenticated;

-- ── 7. Reading the ledger, now with what it carries and whether it was corrected ───────────────
DROP FUNCTION IF EXISTS public.get_finance_entries(date, date);

CREATE OR REPLACE FUNCTION public.get_finance_entries(p_from date, p_to date)
RETURNS TABLE (
  id              uuid,
  kind            text,
  amount          numeric,
  occurred_on     date,
  category        text,
  method          text,
  counterparty    text,
  note            text,
  created_at      timestamptz,
  created_by_name text,
  recurrence_id   uuid,
  repeat_every    integer,
  repeat_unit     text,
  updated_at      timestamptz,
  updated_by_name text,
  photo_count     integer,
  voice_count     integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD';
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT public.has_effective_permission('payments.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  v_branch := public.current_branch_id();

  RETURN QUERY
  SELECT fe.id, fe.kind, fe.amount, fe.occurred_on, fe.category, fe.method,
         fe.counterparty, fe.note, fe.created_at,
         u.name::text AS created_by_name,
         fe.recurrence_id,
         fr.repeat_every,
         fr.repeat_unit,
         fe.updated_at,
         eu.name::text AS updated_by_name,
         COALESCE(ac.photos, 0)::integer,
         COALESCE(ac.voices, 0)::integer
    FROM public.finance_entries fe
    LEFT JOIN public.users u ON u.id = fe.created_by
    LEFT JOIN public.users eu ON eu.id = fe.updated_by
    LEFT JOIN public.finance_recurrences fr ON fr.id = fe.recurrence_id
    LEFT JOIN (
      SELECT a.entry_id,
             count(*) FILTER (WHERE a.kind = 'photo') AS photos,
             count(*) FILTER (WHERE a.kind = 'voice') AS voices
        FROM public.finance_attachments a
       GROUP BY a.entry_id
    ) ac ON ac.entry_id = fe.id
   WHERE fe.shop_id = v_member.tenant_id
     AND fe.branch_id = v_branch
     AND fe.deleted_at IS NULL
     AND fe.occurred_on BETWEEN p_from AND p_to
   ORDER BY fe.occurred_on DESC, fe.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_finance_entries(date, date) IS
  'The session branch''s live recorded rows for one PK window, newest first, with who wrote and last corrected it and how many photos/voice notes it carries. Deleted rows are excluded; the same gate and scope as get_finance_totals.';

REVOKE ALL ON FUNCTION public.get_finance_entries(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_entries(date, date) TO authenticated;

-- One entry in full: the row, its papers, and every change made to it.
CREATE OR REPLACE FUNCTION public.get_finance_entry(p_id uuid)
RETURNS TABLE (
  id              uuid,
  kind            text,
  amount          numeric,
  occurred_on     date,
  category        text,
  method          text,
  counterparty    text,
  note            text,
  created_at      timestamptz,
  created_by_name text,
  updated_at      timestamptz,
  updated_by_name text,
  deleted_at      timestamptz,
  recurrence_id   uuid,
  repeat_every    integer,
  repeat_unit     text,
  media           jsonb,
  history         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT public.has_effective_permission('payments.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  v_branch := public.current_branch_id();

  RETURN QUERY
  SELECT fe.id, fe.kind, fe.amount, fe.occurred_on, fe.category, fe.method,
         fe.counterparty, fe.note, fe.created_at,
         u.name::text,
         fe.updated_at,
         eu.name::text,
         fe.deleted_at,
         fe.recurrence_id,
         fr.repeat_every,
         fr.repeat_unit,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', a.id,
                    'kind', a.kind,
                    'mime', a.mime,
                    'bytes', a.bytes,
                    'durationMs', a.duration_ms,
                    'path', a.storage_path,
                    'createdAt', a.created_at
                  ) ORDER BY a.created_at)
             FROM public.finance_attachments a
            WHERE a.entry_id = fe.id
         ), '[]'::jsonb),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', h.id,
                    'action', h.action,
                    'changedAt', h.changed_at,
                    'changedByName', hu.name,
                    'before', h.before_state,
                    'after', h.after_state
                  ) ORDER BY h.changed_at DESC)
             FROM public.finance_entry_history h
             LEFT JOIN public.users hu ON hu.id = h.changed_by
            WHERE h.entry_id = fe.id
         ), '[]'::jsonb)
    FROM public.finance_entries fe
    LEFT JOIN public.users u ON u.id = fe.created_by
    LEFT JOIN public.users eu ON eu.id = fe.updated_by
    LEFT JOIN public.finance_recurrences fr ON fr.id = fe.recurrence_id
   WHERE fe.id = p_id
     AND fe.shop_id = v_member.tenant_id
     AND fe.branch_id = v_branch;
END;
$$;

COMMENT ON FUNCTION public.get_finance_entry(uuid) IS
  'One recorded row with its photos, voice notes and full change history, scoped to the session branch. Same payments.view gate as the ledger; a deleted row is still readable so its history can be seen.';

REVOKE ALL ON FUNCTION public.get_finance_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_entry(uuid) TO authenticated;

-- ── 8. The migration proves its own shape before it commits ────────────────────────────────────
DO $$
DECLARE
  v_public boolean;
  v_cols text[];
  v_policies int;
BEGIN
  SELECT b.public INTO v_public FROM storage.buckets b WHERE b.id = 'finance-receipts';
  IF v_public IS NULL THEN
    RAISE EXCEPTION '0261: the finance-receipts bucket was not created';
  END IF;
  IF v_public THEN
    RAISE EXCEPTION '0261: receipts must not sit in a public bucket';
  END IF;

  SELECT array_agg(column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'finance_entries';
  IF NOT (v_cols @> ARRAY['updated_at', 'updated_by', 'deleted_at', 'deleted_by']) THEN
    RAISE EXCEPTION '0261: finance_entries is missing a correction column (found %)', v_cols;
  END IF;

  IF has_table_privilege('authenticated', 'public.finance_attachments', 'SELECT')
     OR has_table_privilege('anon', 'public.finance_attachments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.finance_entry_history', 'SELECT') THEN
    RAISE EXCEPTION '0261: a client role can reach an attachment or history table directly';
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('finance receipts read', 'finance receipts write');
  IF v_policies <> 2 THEN
    RAISE EXCEPTION '0261: expected two storage policies for finance receipts (found %)', v_policies;
  END IF;

  IF has_function_privilege('anon', 'public.update_finance_entry(uuid,text,numeric,text,text,date,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_finance_entry(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.attach_finance_media(uuid,text,text,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.remove_finance_media(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_finance_entry(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0261: anon can execute a finance correction function';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
