/**
 * farmerLiveSyncContract — the integration is live, and the live part is not a hole.
 *
 * WHY THIS IS A GUARD AND NOT A COMMENT. `0339` is the file that makes a dealer change reach a
 * farmer in under a second. Every way it can go wrong is silent on a screen that already works:
 *
 *   1. the farmer topic becomes guessable (`farmer:<farmer_id>` instead of a value derived from his
 *      token), so anybody holding the anon key can read every conversation;
 *   2. the dealer's channel is made public to avoid writing a policy, so any listed shop's messages
 *      are readable by anyone who knows its id — and a shop id is published in discovery;
 *   3. the broadcaster starts writing into a business table's policy world, turning
 *      `farmer_messages` from server-owned into client-readable, which is the exact decision
 *      0325/0330 made and this file must not quietly reverse;
 *   4. a push failure starts failing the business write that produced it.
 *
 * None of those break the demo. All four are asserted here, on every run.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/0339_the_farmer_sees_the_branch_and_hears_it_live.sql'),
  'utf8',
);

function bodyOf(name: string): string {
  const start = sql.search(new RegExp(`FUNCTION public\\.${name}\\(`));
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${name} has no closing delimiter`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const TOPIC = bodyOf('farmer_realtime_topic');
const BROADCAST = bodyOf('farmer_broadcast_change');
const ME = bodyOf('farmer_api_me');
const DISPATCH = bodyOf('push_deliveries_dispatch_now');

describe("the farmer's topic is derived from his credential", () => {
  it('hashes nothing new: it reads the token hash the server already stores', () => {
    expect(TOPIC).toMatch(/FROM public\.marketplace_farmer_tokens t/);
    expect(TOPIC).toMatch(/substr\(t\.token_hash, 1, 40\)/);
  });

  it('only answers for a live token, so revocation closes the channel', () => {
    expect(TOPIC).toMatch(/AND t\.revoked_at IS NULL/);
  });

  it('never puts a farmer id in the topic', () => {
    // `farmer:<uuid>` would be guessable from any place that names the farmer; the hash is not.
    expect(TOPIC).not.toMatch(/'farmer:' \|\| p_farmer_id/);
    expect(TOPIC).not.toMatch(/p_farmer_id::text/);
  });

  it('is handed to the farmer by the call he already makes', () => {
    expect(ME).toContain("'realtime_topic'");
    expect(ME).toContain('public.farmer_realtime_topic(v_farmer)');
  });
});

describe('the two topics have two different authorisations', () => {
  it('sends to the farmer on a public channel keyed by his unguessable topic', () => {
    expect(BROADCAST).toMatch(/realtime\.send\(p_payload, p_event, v_farmer_topic, false\)/);
  });

  it('sends to the dealer on a PRIVATE per-shop channel', () => {
    expect(BROADCAST).toMatch(/'shop:' \|\| p_shop_id::text, true/);
  });

  it('does nothing where Realtime is absent, instead of failing the write', () => {
    expect(BROADCAST).toContain("to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL");
  });
});

describe('the dealer channel is authorised by one policy on the Realtime table', () => {
  it('admits exactly an active member of the shop the topic names', () => {
    expect(sql).toMatch(/CREATE POLICY farmer_shop_broadcast ON realtime\.messages/);
    expect(sql).toMatch(/m\.status = 'active'/);
    expect(sql).toMatch(/realtime\.topic\(\) = 'shop:' \|\| m\.tenant_id::text/);
  });

  it('does not open a business table to buy that', () => {
    // The conversation tables keep their decision: RLS on, zero policies, every client grant gone.
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]{0,200}ON public\.farmer_messages/);
    expect(sql).not.toMatch(/GRANT [A-Z ,]+ ON TABLE public\.farmer_messages/);
    expect(sql).not.toMatch(/GRANT [A-Z ,]+ ON TABLE public\.farmer_credit_requests/);
    expect(sql).not.toMatch(/GRANT [A-Z ,]+ ON TABLE public\.farmer_visit_requests/);
  });

  it('proves the conversation tables are still policy-free', () => {
    expect(sql).toContain("RAISE EXCEPTION '0339: a conversation table became client-readable instead of broadcast'");
  });
});

describe('a change is broadcast in the transaction that writes it', () => {
  it('covers messages, credit offers and visit moves', () => {
    for (const trigger of [
      'farmer_messages_broadcast',
      'farmer_credit_requests_broadcast',
      'farmer_visit_requests_broadcast',
    ]) {
      expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
      expect(sql).toContain(`AFTER INSERT`);
    }
  });

  it('carries who wrote it, so neither side mistakes its own message for the other side', () => {
    expect(bodyOf('farmer_messages_broadcast')).toContain("'direction', NEW.direction");
  });

  it('does not re-broadcast an update that changed nothing the screens render', () => {
    const requests = bodyOf('farmer_credit_requests_broadcast');
    expect(requests).toMatch(/NEW\.status IS NOT DISTINCT FROM OLD\.status/);
    expect(requests).toMatch(/NEW\.revision IS NOT DISTINCT FROM OLD\.revision/);
  });
});

describe('push leaves immediately, the cron stays the safety net', () => {
  it('wakes the dispatcher on insert', () => {
    expect(sql).toMatch(/AFTER INSERT ON public\.push_deliveries/);
    expect(DISPATCH).toContain('public.push_dispatch_tick()');
  });

  it('never fails the business write', () => {
    expect(DISPATCH).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });

  it('does nothing without pg_net, and takes one dispatch per burst', () => {
    expect(DISPATCH).toContain("extname = 'pg_net'");
    expect(DISPATCH).toContain('pg_try_advisory_xact_lock');
  });
});

describe('the internals stay server-only', () => {
  it('declares every new helper and trigger function', () => {
    for (const fn of [
      'farmer_shop_profile',
      'farmer_variant_is_available',
      'farmer_realtime_topic',
      'farmer_broadcast_change',
      'farmer_messages_broadcast',
      'farmer_credit_requests_broadcast',
      'farmer_visit_requests_broadcast',
      'push_deliveries_dispatch_now',
    ]) {
      expect(sql).toContain(`'${fn}'`);
    }
  });

  it('revokes them from every client role, and proves it', () => {
    expect(sql).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(sql).toContain("RAISE EXCEPTION '0339: % is executable by a client role'");
  });
});
