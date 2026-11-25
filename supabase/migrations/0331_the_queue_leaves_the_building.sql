-- 0331 — the queue leaves the building.
--
-- 0329 writes a row for every event worth a banner: a farmer message, a sale, a credit payment,
-- a visit move, an owner reply. `send-push` is the only thing that can turn such a row into an
-- FCM message, and until this file nothing called it on a schedule. The queue would fill and no
-- phone would ever buzz in a deployed environment — the pipeline was complete except for the
-- thing that starts it. That is the whole of this migration: one job, once a minute, that makes
-- a request only when a row is actually waiting.
--
-- WHERE THE SECRETS LIVE. Not in this repository, and not in the cron command (that text is
-- readable by anyone who can read `cron.job`). The function URL and its `x-push-secret` are read
-- from Supabase Vault, which the operator fills once per environment:
--
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push',
--                              'push_dispatch_url');
--   select vault.create_secret('<random 32+ chars>', 'push_dispatch_secret');
--
-- UNSET IS A SUPPORTED STATE, deliberately. The tick returns without sending, the queue keeps
-- every row, and nothing is lost or falsely marked. It is why this file can arrive on an
-- environment before `send-push` is deployed, and why the order of the two operator steps does
-- not matter.
--
-- WHY THE TICK CHECKS THE QUEUE FIRST. A cron POST every minute is 43,200 requests a month that
-- do nothing on a quiet shop. The check is one index scan on `push_deliveries_pending`; an empty
-- queue costs a row-count, not an HTTP request.
--
-- WHY `attempts < 5`. send-push increments `attempts` and records `last_error` when FCM refuses.
-- A permanently unsendable row must stay visible in the table for the owner to inspect, but it
-- must not be re-attempted forever at one request per minute. After the fifth failure the row
-- waits for a human, exactly as the queue's comment says it should.

-- Scheduled by pg_cron (the scheduler), delivered by pg_net (the HTTP client), configured from
-- Vault. Each is created here as well as in 0034: a file that schedules a job should not depend
-- on a much older file's extension having survived a restore.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create or replace function public.push_dispatch_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url     text;
  v_secret  text;
  v_request bigint;
begin
  -- Nothing waiting: no request, no row touched.
  if not exists (
    select 1
      from public.push_deliveries
     where sent_at is null
       and attempts < 5
  ) then
    return null;
  end if;

  -- Vault absent (a plain Postgres rehearsal) is not an error worth failing a cron run over.
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'push_dispatch_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'push_dispatch_secret';

  -- Not configured yet: the queue keeps its rows and the next minute tries again.
  if v_url is null or v_secret is null then
    return null;
  end if;

  select net.http_post(
    url                  := v_url,
    headers              := jsonb_build_object(
                              'Content-Type',   'application/json',
                              'x-push-secret',  v_secret
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_request;

  return v_request;
end;
$$;

comment on function public.push_dispatch_tick() is
  'Cron entry point: POSTs to the send-push function when deliveries are pending. Reads the URL and x-push-secret from Vault (push_dispatch_url, push_dispatch_secret); returns null and sends nothing when the queue is empty or the environment is not configured.';

-- Server-only. No client role may poke the dispatcher.
revoke all on function public.push_dispatch_tick() from public;
revoke all on function public.push_dispatch_tick() from anon;
revoke all on function public.push_dispatch_tick() from authenticated;

-- Re-running this file replaces the job rather than adding a second one.
select cron.unschedule('send-push-every-minute')
 where exists (select 1 from cron.job where jobname = 'send-push-every-minute');

select cron.schedule(
  'send-push-every-minute',
  '* * * * *',
  $cron$select public.push_dispatch_tick()$cron$
);

-- ── The proof ───────────────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_job bigint;
begin
  if has_function_privilege('anon', 'public.push_dispatch_tick()', 'EXECUTE') then
    raise exception 'the push dispatcher must not be callable by anon';
  end if;
  if has_function_privilege('authenticated', 'public.push_dispatch_tick()', 'EXECUTE') then
    raise exception 'the push dispatcher must not be callable by a signed-in client';
  end if;

  select jobid into v_job from cron.job where jobname = 'send-push-every-minute';
  if v_job is null then
    raise exception 'the push dispatcher is not scheduled';
  end if;
end;
$proof$;
