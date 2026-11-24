/**
 * 0336 — a voice note (and a photo) is still a message.
 *
 * WHY THIS FILE EXISTS. The farmer conversation could only carry text. A shopkeeper who cannot
 * read a farmer's complaint in Roman Urdu, and a farmer who cannot type, need to speak. Both
 * directions need it: the dealer records a reply, the farmer records a question.
 *
 * WHAT IT ADDS
 *
 *   · `farmer_message_attachments` — one optional file per message: kind ('voice' | 'image'), its
 *     storage path, mime type, size, and for voice its duration. RLS on, every client grant
 *     revoked, so the only access path is through the functions below (exactly like the message
 *     table itself).
 *   · the body may now be empty (`length(btrim(body)) <= 2000` instead of `>= 1`), because a voice
 *     note with no caption is a complete message. Text behaviour is unchanged: every existing row
 *     still satisfies the new check, so nothing is rewritten and nothing breaks.
 *   · `farmer_api_send_attachment` (anon, token-gated) and `send_farmer_attachment` (authenticated,
 *     membership-scoped) — the two senders. Each validates the storage path against the shop and
 *     farmer it resolved itself, so a caller cannot point a row at somebody else's object.
 *   · `farmer_api_media` / `get_farmer_media` — the metadata the thread needs per message: id,
 *     kind, mime, size, duration, direction (who sent it) and timestamp. No URL: URLs are signed,
 *     short-lived and minted by the media function, never stored.
 *   · `farmer_media_attachment` — the function's single lookup. It decides who is asking (farmer
 *     token or dealer membership) and answers only for a message that participant can see.
 *
 * WHERE THE BYTES LIVE. A PRIVATE bucket, `farmer-chat-media`. There is deliberately no storage
 * policy for anon or authenticated: a farmer has no JWT, so RLS cannot scope him, and a shared
 * bucket policy would make every shop's audio readable to every signed-in user. The upload and the
 * signed link go through the `farmer-media` edge function, which authorises first and then acts
 * with the service role. One door, checked once.
 *
 * WHAT IT DOES NOT DO. It does not rewrite, re-encode or transcribe audio, does not touch text
 * messages, stock, money or any other table, and never deletes a file. Additive and replayable.
 */

-- ── 1. A message may be a file with no caption ───────────────────────────────────────────────
alter table public.farmer_messages
  drop constraint if exists farmer_messages_body_check;

alter table public.farmer_messages
  add constraint farmer_messages_body_check
  check (length(btrim(body)) <= 2000);

comment on constraint farmer_messages_body_check on public.farmer_messages is
  'At most 2000 characters. Zero is allowed because a voice note or a photo is the message; text messages still cannot be blank through the send RPCs.';

-- ── 2. The file that belongs to a message ────────────────────────────────────────────────────
create table if not exists public.farmer_message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null unique references public.farmer_messages(id) on delete cascade,
  shop_id       uuid not null references public.shops(id) on delete cascade,
  farmer_id     uuid not null references public.marketplace_farmers(id) on delete cascade,
  kind          text not null check (kind in ('voice', 'image')),
  storage_bucket text not null default 'farmer-chat-media',
  storage_path  text not null,
  mime_type     text not null,
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  duration_ms   integer check (duration_ms is null or (duration_ms >= 1 and duration_ms <= 600000)),
  width         integer check (width is null or width > 0),
  height        integer check (height is null or height > 0),
  created_at    timestamptz not null default now(),
  constraint farmer_attachment_voice_has_duration check (kind <> 'voice' or duration_ms is not null),
  constraint farmer_attachment_image_has_no_duration check (kind <> 'image' or duration_ms is null)
);

create index if not exists farmer_message_attachments_thread
  on public.farmer_message_attachments (shop_id, farmer_id, created_at desc);

comment on table public.farmer_message_attachments is
  'One optional file per farmer message. `duration_ms` is the recorder''s duration for a voice note (the app shows it without downloading the audio). Server-only: read through farmer_api_media/get_farmer_media and fetched through the farmer-media function.';

alter table public.farmer_message_attachments enable row level security;
revoke all on table public.farmer_message_attachments from public, anon, authenticated;

-- ── 3. The private bucket ────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'farmer-chat-media', 'farmer-chat-media', false, 10485760,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 4. Senders ───────────────────────────────────────────────────────────────────────────────
-- The farmer's side. The path is validated against the shop and farmer resolved from the token,
-- so the row can only ever describe an object under this farmer's own folder.
create or replace function public.farmer_api_send_attachment(
  p_token       text,
  p_kind        text,
  p_storage_path text,
  p_mime_type   text,
  p_size_bytes  integer,
  p_duration_ms integer DEFAULT NULL,
  p_body        text    DEFAULT NULL,
  p_shop_id     uuid    DEFAULT NULL
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer  uuid := public.farmer_by_token(p_token);
  v_shop    uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  v_body    text := btrim(coalesce(p_body, ''));
  v_id      uuid;
  v_att     uuid;
  v_at      timestamptz;
begin
  if v_kind not in ('voice', 'image') then
    raise exception 'VALIDATION: a file is voice or image';
  end if;
  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'VALIDATION: a storage path is required';
  end if;
  -- The object must live under this shop's and this farmer's folder. `starts_with` compares the
  -- whole prefix, so "1/2/…" cannot be satisfied by "1/22/…".
  if position(v_shop::text || '/' || v_farmer::text || '/' in p_storage_path) <> 1 then
    raise exception 'NOT_AUTHORIZED: that object is not in this farmer''s conversation';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'VALIDATION: a file is 1 byte to 10 MB';
  end if;
  if v_kind = 'voice' and (p_duration_ms is null or p_duration_ms < 1 or p_duration_ms > 600000) then
    raise exception 'VALIDATION: a voice note needs a duration under 10 minutes';
  end if;
  if v_kind = 'image' and p_duration_ms is not null then
    raise exception 'VALIDATION: an image has no duration';
  end if;
  if length(v_body) > 2000 then
    raise exception 'VALIDATION: a message is at most 2000 characters';
  end if;

  insert into public.farmer_messages (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
  values (v_shop, v_farmer, 'farmer', 'app', v_body, now())
  returning id, created_at into v_id, v_at;

  insert into public.farmer_message_attachments
    (message_id, shop_id, farmer_id, kind, storage_path, mime_type, size_bytes, duration_ms)
  values (v_id, v_shop, v_farmer, v_kind, btrim(p_storage_path), p_mime_type, p_size_bytes, p_duration_ms)
  returning id into v_att;

  return jsonb_build_object(
    'id', v_id,
    'created_at', v_at,
    'direction', 'farmer',
    'attachment', jsonb_build_object(
      'id', v_att, 'kind', v_kind, 'mime_type', p_mime_type,
      'size_bytes', p_size_bytes, 'duration_ms', p_duration_ms, 'storage_path', btrim(p_storage_path)
    )
  );
end;
$$;

revoke all on function public.farmer_api_send_attachment(text, text, text, text, integer, integer, text, uuid)
  from public, authenticated;
grant execute on function public.farmer_api_send_attachment(text, text, text, text, integer, integer, text, uuid)
  to anon;

-- The dealer's side. Same rules, resolved from the membership instead of a token.
create or replace function public.send_farmer_attachment(
  p_farmer_id   uuid,
  p_kind        text,
  p_storage_path text,
  p_mime_type   text,
  p_size_bytes  integer,
  p_duration_ms integer DEFAULT NULL,
  p_body        text    DEFAULT NULL
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.memberships;
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     uuid;
  v_att    uuid;
  v_at     timestamptz;
begin
  v_member := public.owner_membership_for_farmers();

  if not exists (select 1 from public.marketplace_farmer_links l
                  where l.shop_id = v_member.tenant_id and l.farmer_id = p_farmer_id) then
    raise exception 'NOT_FOUND: that farmer is not linked to this shop';
  end if;
  if v_kind not in ('voice', 'image') then
    raise exception 'VALIDATION: a file is voice or image';
  end if;
  if p_storage_path is null or position(v_member.tenant_id::text || '/' || p_farmer_id::text || '/' in p_storage_path) <> 1 then
    raise exception 'NOT_AUTHORIZED: that object is not in this conversation';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'VALIDATION: a file is 1 byte to 10 MB';
  end if;
  if v_kind = 'voice' and (p_duration_ms is null or p_duration_ms < 1 or p_duration_ms > 600000) then
    raise exception 'VALIDATION: a voice note needs a duration under 10 minutes';
  end if;
  if v_kind = 'image' and p_duration_ms is not null then
    raise exception 'VALIDATION: an image has no duration';
  end if;
  if length(v_body) > 2000 then
    raise exception 'VALIDATION: a message is at most 2000 characters';
  end if;

  insert into public.farmer_messages
    (shop_id, farmer_id, direction, channel, body, sent_by, delivered_to_app_at)
  values (v_member.tenant_id, p_farmer_id, 'owner', 'app', v_body, v_member.user_id, now())
  returning id, created_at into v_id, v_at;

  insert into public.farmer_message_attachments
    (message_id, shop_id, farmer_id, kind, storage_path, mime_type, size_bytes, duration_ms)
  values (v_id, v_member.tenant_id, p_farmer_id, v_kind, btrim(p_storage_path), p_mime_type, p_size_bytes, p_duration_ms)
  returning id into v_att;

  return jsonb_build_object(
    'id', v_id,
    'created_at', v_at,
    'direction', 'owner',
    'attachment', jsonb_build_object(
      'id', v_att, 'kind', v_kind, 'mime_type', p_mime_type,
      'size_bytes', p_size_bytes, 'duration_ms', p_duration_ms, 'storage_path', btrim(p_storage_path)
    )
  );
end;
$$;

revoke all on function public.send_farmer_attachment(uuid, text, text, text, integer, integer, text)
  from public, anon;
grant execute on function public.send_farmer_attachment(uuid, text, text, text, integer, integer, text)
  to authenticated;

-- ── 5. Readers ───────────────────────────────────────────────────────────────────────────────
-- One call per thread, not one per message: the app asks for the conversation's files once and
-- gets {message_id, kind, duration, direction, created_at} for each.
create or replace function public.farmer_api_media(p_token text, p_shop_id uuid DEFAULT NULL)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'message_id', m.id,
             'attachment_id', a.id,
             'kind', a.kind,
             'mime_type', a.mime_type,
             'size_bytes', a.size_bytes,
             'duration_ms', a.duration_ms,
             'width', a.width,
             'height', a.height,
             'storage_path', a.storage_path,
             'sender', m.direction,
             'created_at', m.created_at
           ) order by m.created_at)
      from public.farmer_messages m
      join public.farmer_message_attachments a on a.message_id = m.id
     where m.shop_id = v_shop and m.farmer_id = v_farmer
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.farmer_api_media(text, uuid) from public, authenticated;
grant execute on function public.farmer_api_media(text, uuid) to anon;

create or replace function public.get_farmer_media(p_farmer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.memberships;
begin
  v_member := public.owner_membership_for_farmers();
  if not exists (select 1 from public.marketplace_farmer_links l
                  where l.shop_id = v_member.tenant_id and l.farmer_id = p_farmer_id) then
    raise exception 'NOT_FOUND: that farmer is not linked to this shop';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'message_id', m.id,
             'attachment_id', a.id,
             'kind', a.kind,
             'mime_type', a.mime_type,
             'size_bytes', a.size_bytes,
             'duration_ms', a.duration_ms,
             'width', a.width,
             'height', a.height,
             'storage_path', a.storage_path,
             'sender', m.direction,
             'created_at', m.created_at
           ) order by m.created_at)
      from public.farmer_messages m
      join public.farmer_message_attachments a on a.message_id = m.id
     where m.shop_id = v_member.tenant_id and m.farmer_id = p_farmer_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_farmer_media(uuid) from public, anon;
grant execute on function public.get_farmer_media(uuid) to authenticated;

-- ── 6. The media function's one lookup ───────────────────────────────────────────────────────
-- Called ONLY by the `farmer-media` edge function with the service role. It answers for one
-- message and one caller: a farmer token, or a signed-in dealer's user id. Anything else is a
-- refusal, not an empty result, so a caller learns nothing about messages it cannot see.
create or replace function public.farmer_media_attachment(
  p_message_id uuid,
  p_farmer_token text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  record;
  v_farmer uuid;
  v_shop uuid;
begin
  if p_message_id is null then
    raise exception 'VALIDATION: a message is required';
  end if;

  if p_farmer_token is not null and btrim(p_farmer_token) <> '' then
    v_farmer := public.farmer_by_token(p_farmer_token);
    select m.id, m.shop_id, m.farmer_id, m.direction, m.created_at,
           a.kind, a.mime_type, a.size_bytes, a.duration_ms, a.storage_path, a.storage_bucket
      into v_row
      from public.farmer_messages m
      join public.farmer_message_attachments a on a.message_id = m.id
     where m.id = p_message_id and m.farmer_id = v_farmer;
    if v_row.id is null then
      raise exception 'NOT_FOUND: that message is not in this conversation';
    end if;
  elsif p_user_id is not null then
    v_shop := public.resolve_active_shop(p_user_id);
    select m.id, m.shop_id, m.farmer_id, m.direction, m.created_at,
           a.kind, a.mime_type, a.size_bytes, a.duration_ms, a.storage_path, a.storage_bucket
      into v_row
      from public.farmer_messages m
      join public.farmer_message_attachments a on a.message_id = m.id
     where m.id = p_message_id
       and m.shop_id = v_shop
       and exists (select 1 from public.memberships mb
                    where mb.user_id = p_user_id and mb.tenant_id = v_shop and mb.status = 'active');
    if v_row.id is null then
      raise exception 'NOT_FOUND: that message is not in this shop';
    end if;
  else
    raise exception 'NOT_AUTHORIZED: a farmer token or a signed-in dealer is required';
  end if;

  return jsonb_build_object(
    'message_id', v_row.id,
    'kind', v_row.kind,
    'mime_type', v_row.mime_type,
    'size_bytes', v_row.size_bytes,
    'duration_ms', v_row.duration_ms,
    'storage_bucket', v_row.storage_bucket,
    'storage_path', v_row.storage_path,
    'sender', v_row.direction,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.farmer_media_attachment(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.farmer_media_attachment(uuid, text, uuid) to service_role;

-- The farmer's identity, for the upload path: the function must know which folder to write into
-- before it accepts bytes, and it only has a token.
create or replace function public.farmer_media_identity(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, null);
begin
  return jsonb_build_object('farmer_id', v_farmer, 'shop_id', v_shop);
end;
$$;

revoke all on function public.farmer_media_identity(text) from public, anon, authenticated;
grant execute on function public.farmer_media_identity(text) to service_role;

-- ── 7. The two lookups are declared server-only, not merely revoked ────────────────────────
-- Same rule as 0332/0335: the ledger prints what it revoked, and this file has to name the same set
-- or the guard that compares them goes blind. These two are the edge function's only door into the
-- conversation, so a regression that grants authenticated would hand a signed-in stranger the
-- metadata of every shop's messages.
do $server_only$
declare
  -- All four are revoked from `authenticated`; which role may call them differs, and that
  -- difference is asserted below rather than assumed. farmer_api_media / farmer_api_send_attachment
  -- belong to the farmer app (anon, with a token); the two lookups belong to the edge function.
  v_server_only constant text[] := array[
    'farmer_api_media',
    'farmer_api_send_attachment',
    'farmer_media_attachment',
    'farmer_media_identity'
  ];
  v_fn  record;
  v_sig text;
begin
  for v_fn in
    select p.oid, p.proname, n.nspname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (v_server_only)
  loop
    v_sig := format('%I.%I(%s)', v_fn.nspname, v_fn.proname,
                    pg_get_function_identity_arguments(v_fn.oid));

    -- The farmer app's two doors were granted above; only the function's two lookups are closed to
    -- every client here. Re-revoking the anon doors would undo the GRANT a few lines earlier.
    if v_fn.proname in ('farmer_media_attachment', 'farmer_media_identity') then
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
      execute format('grant execute on function %s to service_role', v_sig);

      if has_function_privilege('anon', v_fn.oid, 'EXECUTE')
         or has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception '0336: % is still executable by a client role', v_sig;
      end if;
      if not has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
        raise exception '0336: % is not reachable by the media function', v_sig;
      end if;
    elsif has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception '0336: % is executable by authenticated, though the farmer app needs it', v_sig;
    end if;
  end loop;
end
$server_only$;

-- ── 8. Proofs ───────────────────────────────────────────────────────────────────────────────
do $proof$
begin
  if has_table_privilege('anon', 'public.farmer_message_attachments', 'SELECT')
     or has_table_privilege('authenticated', 'public.farmer_message_attachments', 'SELECT') then
    raise exception '0336: a client role can read the attachment table directly';
  end if;

  if not has_function_privilege('anon', 'public.farmer_api_send_attachment(text, text, text, text, integer, integer, text, uuid)', 'EXECUTE') then
    raise exception '0336: the farmer app cannot send a voice note';
  end if;
  if has_function_privilege('authenticated', 'public.farmer_api_send_attachment(text, text, text, text, integer, integer, text, uuid)', 'EXECUTE') then
    raise exception '0336: a signed-in session can call the farmer sender';
  end if;
  if not has_function_privilege('authenticated', 'public.send_farmer_attachment(uuid, text, text, text, integer, integer, text)', 'EXECUTE') then
    raise exception '0336: the dealer cannot send a voice note';
  end if;
  if has_function_privilege('anon', 'public.send_farmer_attachment(uuid, text, text, text, integer, integer, text)', 'EXECUTE') then
    raise exception '0336: an anonymous caller can call the dealer sender';
  end if;

  -- The lookup belongs to the function only.
  if has_function_privilege('anon', 'public.farmer_media_attachment(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.farmer_media_attachment(uuid, text, uuid)', 'EXECUTE') then
    raise exception '0336: a client role can call the media lookup';
  end if;
  if not has_function_privilege('service_role', 'public.farmer_media_attachment(uuid, text, uuid)', 'EXECUTE') then
    raise exception '0336: the media function cannot reach its lookup';
  end if;

  -- The bucket must exist and must not be public.
  if not exists (select 1 from storage.buckets b where b.id = 'farmer-chat-media' and b.public = false) then
    raise exception '0336: farmer-chat-media must exist and be private';
  end if;

  -- The relaxed body check must still cap the length at 2000. Asserted from the catalogue, so
  -- the proof does not depend on whether this database happens to hold a linked farmer.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.farmer_messages'::regclass
       and conname = 'farmer_messages_body_check'
       and pg_get_constraintdef(oid) like '%<= 2000%'
  ) then
    raise exception '0336: farmer_messages_body_check does not cap the body at 2000 characters';
  end if;
end;
$proof$;

comment on function public.farmer_api_send_attachment(text, text, text, text, integer, integer, text, uuid) is
  'The farmer app posts a voice note or photo into his own conversation. The storage path must sit under <shop>/<farmer>/ resolved from the token.';
comment on function public.send_farmer_attachment(uuid, text, text, text, integer, integer, text) is
  'The dealer posts a voice note or photo to one farmer. The storage path must sit under <shop>/<farmer>/ resolved from the membership.';
comment on function public.farmer_media_attachment(uuid, text, uuid) is
  'Service-role only. Answers one message''s file for one participant (farmer token or dealer user id) and refuses everyone else.';
