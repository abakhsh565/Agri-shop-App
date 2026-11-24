-- 0337 — the upload asks the database which shop, and a dealer with two shops is not a stranger.
--
-- WHAT WAS WRONG. `farmer-media` decided a dealer upload by reading `marketplace_farmer_links`
-- directly with the service role. That table is deliberately closed to every client role, and the
-- service role has no grant on it either — 0336 revoked the table from `public, anon, authenticated`
-- and PostgREST then refused the service role as well. The function ignored the error and answered
-- `NOT_LINKED` for a farmer who *was* linked, which is the safe failure but the wrong answer.
--
-- WHY THE FIX IS IN SQL, NOT IN THE FUNCTION. "Which shop may this person upload into, for THIS
-- farmer?" is a membership question, and memberships already have exactly one authority. Moving it
-- here means the function never reads a protected table, never sees a grant it should not have, and
-- cannot be edited into a wider rule than the RPC's own.
--
-- WHAT ELSE THIS CORRECTS. `farmer_media_attachment` resolved the dealer's shop with
-- `resolve_active_shop(p_user_id)` — ONE shop. A dealer who belongs to two shops was refused a
-- message in his second shop even though his membership there is active. The check is now the
-- membership of the message's own shop, which is the question that was always meant.

-- ── 1. The upload's target ──────────────────────────────────────────────────────────────────
-- Called only by the edge function, with a user id it has already verified against the JWT. It is
-- NOT a client-callable "which shop do I belong to" API: `auth.uid()` cannot be trusted here (the
-- caller is the service role), so the function passes the verified id and this refuses anything the
-- membership does not cover.
create or replace function public.farmer_media_upload_target(
  p_user_id uuid,
  p_farmer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
begin
  if p_user_id is null then
    raise exception 'NOT_AUTHORIZED: a signed-in dealer is required';
  end if;
  if p_farmer_id is null then
    raise exception 'VALIDATION: a farmer is required';
  end if;

  select l.shop_id
    into v_shop
    from public.marketplace_farmer_links l
    join public.memberships mb
      on mb.tenant_id = l.shop_id
     and mb.user_id = p_user_id
     and mb.status = 'active'
   where l.farmer_id = p_farmer_id
   order by l.created_at
   limit 1;

  if v_shop is null then
    -- One refusal for "not your farmer" and "no such farmer": a caller must not be able to probe
    -- which farmers exist in shops he cannot see.
    raise exception 'NOT_LINKED: that farmer is not linked to a shop you belong to';
  end if;

  return jsonb_build_object('shop_id', v_shop, 'farmer_id', p_farmer_id);
end;
$$;

revoke all on function public.farmer_media_upload_target(uuid, uuid) from public, anon, authenticated;
grant execute on function public.farmer_media_upload_target(uuid, uuid) to service_role;

-- ── 2. The download's authorisation, by membership of the message's own shop ─────────────────
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
    select m.id, m.shop_id, m.farmer_id, m.direction, m.created_at,
           a.kind, a.mime_type, a.size_bytes, a.duration_ms, a.storage_path, a.storage_bucket
      into v_row
      from public.farmer_messages m
      join public.farmer_message_attachments a on a.message_id = m.id
     where m.id = p_message_id
       and exists (select 1 from public.memberships mb
                    where mb.user_id = p_user_id
                      and mb.tenant_id = m.shop_id
                      and mb.status = 'active');
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

-- ── 3. The new lookup is declared server-only, and proved ────────────────────────────────────
do $server_only$
declare
  v_server_only constant text[] := array['farmer_media_upload_target'];
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

    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);

    if has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception '0337: % is still executable by a client role', v_sig;
    end if;
    if not has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception '0337: % is not reachable by the media function', v_sig;
    end if;
  end loop;
end
$server_only$;

do $proof$
begin
  -- The download path still refuses both client roles, and still reaches the service role.
  if has_function_privilege('anon', 'public.farmer_media_attachment(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.farmer_media_attachment(uuid, text, uuid)', 'EXECUTE') then
    raise exception '0337: a client role can call the media lookup';
  end if;
  if not has_function_privilege('service_role', 'public.farmer_media_attachment(uuid, text, uuid)', 'EXECUTE') then
    raise exception '0337: the media function cannot reach its lookup';
  end if;

  -- The upload target resolves through memberships and links, never through a client-supplied shop.
  if pg_get_functiondef('public.farmer_media_upload_target(uuid, uuid)'::regprocedure) not like '%marketplace_farmer_links%' then
    raise exception '0337: the upload target no longer reads the farmer link';
  end if;
  if pg_get_functiondef('public.farmer_media_upload_target(uuid, uuid)'::regprocedure) not like '%memberships%' then
    raise exception '0337: the upload target no longer checks membership';
  end if;

  -- The attachment lookup answers for the message's own shop, not one resolved shop.
  if pg_get_functiondef('public.farmer_media_attachment(uuid, text, uuid)'::regprocedure) like '%resolve_active_shop%' then
    raise exception '0337: the download still resolves one shop instead of the message''s shop';
  end if;
end
$proof$;

comment on function public.farmer_media_upload_target(uuid, uuid) is
  'The shop a dealer may upload into for one farmer: the intersection of his active memberships and the shops that link that farmer. Service role only; the edge function passes the user id it verified from the JWT.';
