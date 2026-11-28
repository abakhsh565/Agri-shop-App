-- 0343 — the upload names its shop, so a farmer with two shops can still send.
--
-- WHAT WAS WRONG. `farmer_media_identity(p_token)` resolved the upload's folder with
-- `farmer_shop_scope(v_farmer, null)`. That helper is deliberately strict: with no shop named it
-- raises for a farmer linked to more than one shop, because guessing would put one shop's voice
-- note in another shop's folder. `farmer-media` turned the raise into `401 NOT_AUTHORIZED`, so the
-- microphone and the camera worked for a single-shop farmer and failed for everybody else — the
-- exact accounts the multi-dealer flow exists for.
--
-- WHAT THIS DOES. The token still names the farmer; the request may now also name the shop the
-- farmer is talking to. The scope check is unchanged, only its question is: "may this farmer write
-- into THIS shop?" A shop the farmer is not linked to is still refused, and a request that names no
-- shop while the farmer has several is still refused — with the scope's own sentence, which the
-- app can show instead of a generic 401.
--
-- WHY THE OLD OVERLOAD IS DROPPED. Two functions with the same name but different arity make
-- PostgREST's RPC resolution depend on the payload's keys; leaving the one-argument version in place
-- is what let the old deploy keep working by accident and made a rollback silently restore the bug.
-- One signature, one rule.

drop function if exists public.farmer_media_identity(text);

create or replace function public.farmer_media_identity(
  p_token   text,
  p_shop_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
begin
  return jsonb_build_object('farmer_id', v_farmer, 'shop_id', v_shop);
end;
$$;

comment on function public.farmer_media_identity(text, uuid) is
  'Who may upload for this token, and into which shop folder. A multi-shop farmer must name the shop; the scope check refuses one he is not linked to.';

revoke all on function public.farmer_media_identity(text, uuid) from public, anon, authenticated;
grant execute on function public.farmer_media_identity(text, uuid) to service_role;
