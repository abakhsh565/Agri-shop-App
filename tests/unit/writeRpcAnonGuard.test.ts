/**
 * writeRpcAnonGuard — a write RPC may not be executable by an unauthenticated caller.
 *
 * THE DEFECT THIS EXISTS TO KEEP FIXED, AND WHY A LIVE-SCHEMA GUARD WAS NOT ENOUGH
 *
 * `tests/integration/rbacInvariants.test.ts` Invariant B already fails when the *deployed* schema hands
 * `anon` a write RPC. It caught exactly that on hosted QA, 2026-10-17: nine functions created by `0208`
 * (and re-granted by `0214`'s ACL pass, which reproduces the ledger's own EXECUTE contract) were
 * callable by `anon`. The guard worked — after the batch had been applied.
 *
 * That ordering is the problem this file closes. Production's batch is applied by an owner, once, under
 * time-limited preconditions (plan §8); a check that only runs afterwards reports the defect after it
 * has shipped. So the question is asked HERE, before the apply, on the environment the batch targets:
 * production's own frozen baseline, loaded into PGlite, with the closing file applied.
 *
 * WHAT IS ASSERTED
 *   1. Before `0215`, the surface IS reachable by `anon` on production's baseline. That is the
 *      non-vacuity proof: the assertions below would otherwise pass on a database where the role had
 *      no privileges at all, and a guard that cannot fail is not a guard.
 *   2. After `0215`, no function on the write surface (the same regex the live guard uses, minus the
 *      same pre-session allow-list) is executable by `anon`.
 *   3. The file does not over-reach: the pre-auth read the sign-in screen depends on
 *      (`lookup_user_by_phone`) is still executable by `anon`, and `authenticated` still holds every
 *      RPC it held before.
 *
 * The baseline artifact is a gitignored environment snapshot, so the suite reports itself as SKIPPED
 * where it is absent rather than dying on ENOENT. A check that did not run is reported as skipped,
 * never as passed.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXPECTED_PHASE, isDataStatement, phaseReader } from '../../scripts/lib/baseline.mjs';
import { splitStatementsWithOffsets } from '../../scripts/lib/sql-statements.mjs';

const ROOT = process.cwd();
const CLOSURE = 'supabase/migrations/0215_a_write_rpc_is_not_for_an_unauthenticated_caller.sql';
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/baseline/production-baseline.json'), 'utf8'));
const artifactPath = path.resolve(ROOT, baseline.artifact);
const haveArtifact = fs.existsSync(artifactPath);

if (!haveArtifact) {
  console.warn(
    `[writeRpcAnonGuard] SKIPPED: ${baseline.artifact} is not present (it is a gitignored environment ` +
      'snapshot). Run this where the artifact exists; the live guard in rbacInvariants still runs against QA.',
  );
}

/** The write surface, spelled exactly as `rbacInvariants.test.ts` spells it. */
const WRITE_SURFACE =
  '^(create_|update_|delete_|record_|process_|void_|adjust_|archive_|restore_|deactivate_|activate_|approve_|reject_|upsert_|insert_)';

/** The same pre-session allow-list, so the file and the live guard cannot drift apart quietly. */
const PRE_SESSION_WRITES = [
  'insert_shop_request',
  'record_attempt',
  'record_incident',
  'record_memory',
  'record_resolution',
];

const db = new PGlite();
const suite = haveArtifact ? describe : describe.skip;

/**
 * Every public RPC on the write surface that `role` can execute, asked the way PostgreSQL asks.
 *
 * Trigger functions are excluded on purpose: they are not RPCs, a trigger does not check EXECUTE when
 * it fires, and `0215` closes them to every API role (asserted separately below). Counting them here
 * would make "every RPC the signed-in role held" a claim about something that was never callable.
 */
async function reachable(role: 'anon' | 'authenticated'): Promise<string[]> {
  const rows = await db.query<{ proname: string }>(
    `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and p.prorettype <> 'trigger'::regtype
        and p.proname ~ $1
        and not (p.proname = any ($2::text[]))
        and has_function_privilege($3, p.oid, 'EXECUTE')
      order by 1`,
    [WRITE_SURFACE, PRE_SESSION_WRITES, role],
  );
  return rows.rows.map((r) => r.proname);
}

/** Trigger functions the API roles can still invoke directly. */
async function exposedTriggers(): Promise<string[]> {
  const rows = await db.query<{ proname: string }>(
    `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and p.prorettype = 'trigger'::regtype
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      order by 1`,
  );
  return rows.rows.map((r) => r.proname);
}

/** A named function's reachability, by any of its signatures. */
async function canExecute(role: 'anon' | 'authenticated', name: string): Promise<boolean> {
  const rows = await db.query<{ ok: boolean }>(
    `select coalesce(bool_or(has_function_privilege($1, p.oid, 'EXECUTE')), false) as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $2`,
    [role, name],
  );
  return Boolean(rows.rows[0]?.ok);
}

let before: string[] = [];
let authenticatedBefore: string[] = [];
let after: string[] = [];

beforeAll(async () => {
  if (!haveArtifact) return;

  // The same Supabase scaffolding `branchIdentityBoundary` uses. The baseline is schema-only and
  // carries no GRANTs, so every function starts on PostgreSQL's PUBLIC default — which is precisely
  // the state production is in (all 37 functions executable by `anon`, measured 2026-10-17).
  await db.exec(`
    CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA storage; CREATE SCHEMA cron;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
    CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(), bucket_id text, name text,
      owner uuid, path_tokens text[], metadata jsonb);
    CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE PUBLICATION supabase_realtime;
  `);

  const source = fs.readFileSync(artifactPath, 'utf8');
  const phase = phaseReader(source);
  for (const entry of splitStatementsWithOffsets(source)) {
    if (isDataStatement(entry.text)) continue;
    try {
      await db.exec(entry.text);
    } catch (error) {
      if (phase(entry.offset) !== EXPECTED_PHASE) throw error;
    }
  }

  before = await reachable('anon');
  authenticatedBefore = await reachable('authenticated');

  await db.exec(fs.readFileSync(path.join(ROOT, CLOSURE), 'utf8'));
  after = await reachable('anon');
});

afterAll(async () => {
  await db.close();
});

suite('the pre-apply guard is not vacuous on production’s own baseline', () => {
  it('finds the write surface reachable by anon BEFORE the closing file', () => {
    expect(before.length, 'no write RPC was reachable, so the assertion below proves nothing').toBeGreaterThan(0);
    // A named measurement, so this cannot pass on some other environment that merely has one offender.
    expect(before).toEqual(expect.arrayContaining(['create_sale', 'void_sale', 'record_customer_payment']));
  });

  it('leaves nothing on the surface reachable by anon AFTER it', () => {
    expect(after).toEqual([]);
  });
});

suite('0215 closes the surface and nothing else', () => {
  it('keeps the pre-auth read the sign-in screen needs', async () => {
    expect(await canExecute('anon', 'lookup_user_by_phone')).toBe(true);
  });

  it('keeps every RPC the signed-in role held', async () => {
    // What the closure must not do is lose an RPC the app calls — that is an outage it would be
    // blamed for. (The trigger functions it does close are asserted separately.)
    expect(authenticatedBefore.length).toBeGreaterThan(0);
    const stillThere = await reachable('authenticated');
    expect(stillThere.sort()).toEqual(authenticatedBefore.sort());
  });

  it('closes the trigger functions nobody chose to expose', async () => {
    expect(await exposedTriggers()).toEqual([]);
  });

  it('closes the file with an assertion of its own', () => {
    const sql = fs.readFileSync(path.join(ROOT, CLOSURE), 'utf8');
    expect(sql, 'the file must prove its own effect rather than assume it').toMatch(
      /raise exception '0215: still executable by an API role/,
    );
    expect(sql, 'a forward file may only narrow').not.toMatch(/grant execute[^;]*to anon/i);
  });
});

/**
 * The closure's own defect, and the tie that keeps its correction honest.
 *
 * `0215` narrowed `anon` exactly as intended and, in the same statement, GRANTED `authenticated`
 * EXECUTE on the whole write surface — a widening, which is the one thing a forward file may not do.
 * Two live guards caught it on QA (`saleIdempotency` 4, `tenantResolverReplay` "the chain is
 * internal"): the ledger retires fifteen functions from the client, and seven of them are on the write
 * surface, so `0215` handed back exactly the bypass those tests exist to prevent.
 *
 * `0217` is the correction, and its list is not hand-maintained: this test reads the ledger's own
 * server-only set and fails if the file stops naming it — in either direction, so a function retired
 * later cannot be missed and a name that is no longer retired cannot sit in the file looking decided.
 */
const RETIRED = 'supabase/migrations/0217_a_retired_function_is_not_for_the_client.sql';

function ledgerServerOnly(): string[] {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/lib/rpc-contract.mjs')], { encoding: 'utf8' });
  expect(result.status, `the ledger reader failed:\n${result.stdout}${result.stderr}`).toBe(0);
  const match = /functions revoked from authenticated \(server-only\): ([^\n]+)/.exec(result.stdout);
  expect(match, 'the ledger no longer prints its server-only set, so this guard is blind').toBeTruthy();
  return match![1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

// Deliberately `describe`, not `suite`: this half reads the repository, not the baseline artifact, so it
// must run everywhere — including CI, where the gitignored snapshot is absent and the PGlite half skips.
describe('the correction names exactly what the ledger retires', () => {
  it('matches the ledger’s server-only set, in both directions', () => {
    const sql = fs.readFileSync(path.join(ROOT, RETIRED), 'utf8');
    const block = /v_server_only constant text\[\] := array\[([\s\S]*?)\];/.exec(sql);
    expect(block, 'the array this test reads has moved — point the guard at its new shape').toBeTruthy();
    const unique = [...new Set([...block![1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]))].sort();
    expect(unique.length, 'the file must name the server-only set, not a subset').toBeGreaterThan(0);
    expect(unique).toEqual(ledgerServerOnly());
  });

  it('revokes from both API roles rather than from `anon` alone', () => {
    const sql = fs.readFileSync(path.join(ROOT, RETIRED), 'utf8');
    expect(sql, 'the widening was to `authenticated`, so the correction must name it')
      .toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(sql, 'and it must prove the result rather than assume it')
      .toMatch(/raise exception '0217: a retired function is still reachable/);
  });
});
