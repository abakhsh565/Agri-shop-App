/**
 * The active shop has exactly one owner, and the chain that decides it is not exposed.
 *
 * FINDING (audit, measured against the live QA database before migration 0149):
 *   Eight functions each re-derived "which shop am I in" by taking the caller's FIRST
 *   membership — `ORDER BY m.created_at ASC LIMIT 1`:
 *     current_shop_id, resolve_tenant_for_user, get_current_tenant_id, get_current_membership,
 *     authorize_business_action, authorize_tenant_membership, get_effective_permissions,
 *     current_branch_scope
 *   so the active shop was an accident of row age, RBAC answered for a shop the person was
 *   not working in, and a second membership could never be selected. The live body of
 *   `current_shop_id()` was not in the repository at all (0009 and both bundled schema files
 *   still carried a `users.shop_id`-only version), so replaying the repo could not reproduce
 *   the database the app runs on.
 *
 * This suite is the permanent guard for the fix, because every one of these five rules can be
 * silently broken by a later migration that redefines one function:
 *   1. Exactly ONE function decides the active shop: `resolve_active_shop`.
 *   2. Every authority resolver reads that chain.
 *   3. The chain is internal — no anon/authenticated EXECUTE on `resolve_active_shop`,
 *      `membership_in_active_shop` or `create_shop_internal`. The audit measured an anon
 *      caller resolving any account's tenant through `resolve_tenant_for_user`; that class of
 *      oracle must not come back through the new functions.
 *   4. Switching is authenticated-only, and refuses a shop the caller does not belong to.
 *   5. The selection itself is server-owned: RLS enabled, the caller may read only their
 *      own row, and no client may write it at all. Migration 0153 changed this from
 *      "RLS on with zero policies", which is not locked down — it is silently empty.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbClient, asPostgres, execRpcAsUser } from '../setup/qa-client';

let client: any;

/** The functions that answer "which shop am I in / what may I do there". */
const RESOLVERS = [
  'current_shop_id',
  'membership_in_active_shop',
  'get_current_tenant_id',
  'get_current_membership',
  'current_branch_scope',
  'get_effective_permissions',
  'app_is_admin',
  'authorize_business_action',
  'authorize_tenant_membership',
  'resolve_tenant_for_user',
  'lookup_user_by_phone',
];

const CANONICAL = ['resolve_active_shop', 'membership_in_active_shop', 'current_shop_id'];
/**
 * Functions that read the chain one step further out. `current_branch_id()` (0188) resolves the
 * branch inside `current_shop_id()`, and `current_branch_scope()` is defined as
 * `ARRAY[current_branch_id()]` — so it reads the chain transitively.
 *
 * The rule this file enforces is "nobody re-derives the active shop from row age"; a direct textual
 * reference to one of three names was too narrow a proxy for that, and it flagged a function that
 * reads the chain by calling the branch resolver. The dangerous shape is still caught below, by the
 * caller-scoped-fallback test, which looks for the actual re-derivation shape — the oldest
 * membership deciding the shop — and for the chain only being consulted after it.
 */
const CHAIN_READS = [...CANONICAL, 'current_branch_id'];

// Included so the branch resolver is itself checked for reading the chain, rather than being the one
// function exempt from the rule.
const BRANCH_RESOLVER = ['current_branch_id'];
const INTERNAL = ['resolve_active_shop', 'membership_in_active_shop', 'create_shop_internal'];
const AUTHENTICATED_ONLY = ['set_active_shop', 'create_shop_for_me', 'get_my_shops'];

async function bodies(names: string[]): Promise<Record<string, string>> {
  const list = names.map((n) => `'${n}'`).join(', ');
  const { rows } = await client.query(
    `SELECT p.proname, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname IN (${list})`,
  );
  return Object.fromEntries(rows.map((r: any) => [r.proname, String(r.def)]));
}

async function rights(names: string[]): Promise<Record<string, { anon: boolean; authenticated: boolean }>> {
  const list = names.map((n) => `'${n}'`).join(', ');
  const { rows } = await client.query(
    `SELECT proname,
            has_function_privilege('anon', oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated
       FROM pg_proc WHERE proname IN (${list})`,
  );
  return Object.fromEntries(rows.map((r: any) => [r.proname, { anon: r.anon, authenticated: r.authenticated }]));
}

beforeAll(async () => {
  client = getDbClient();
  await client.connect();
  await asPostgres(client);
});

afterAll(async () => {
  await client?.end();
});

describe('the active shop has exactly one owner', () => {
  /**
   * The property, not a snapshot of the function list.
   *
   * This test used to assert the exact list of functions whose body contains
   * `ORDER BY m.created_at ASC` and expect `['resolve_active_shop']`. That list is not the rule:
   * the rule is *who owns the decision*. Measured against QA, three functions contain the shape,
   * and two of them are legitimate:
   *
   *   resolve_active_shop      the owner — selection, then oldest membership, then users.shop_id.
   *   authorize_business_action reads current_shop_id() first (line before the fallback) and only
   *                            falls back to the oldest membership when there is no usable active
   *                            shop. The chain still decides; the fallback is the pre-0149
   *                            behaviour for memberships with no selection.
   *   resolve_invite           asks a different question entirely — the first membership of an
   *                            INVITED PHONE in a given shop (`m.tenant_id = p_shop_id` plus a phone
   *                            match), not the caller's own shop. Its query is not caller-scoped.
   *
   * So the assertion is: the shape must still exist and belong to `resolve_active_shop`, and any
   * CALLER-SCOPED function that contains it must consult the chain *before* it falls back. A
   * function that derives the caller's shop from the oldest membership without asking the chain
   * first is the regression this guards (that is what 0165 reintroduced), and it fails here.
   *
   * The limit is stated rather than implied: presence and order are checked, semantics are not. A
   * function that consults the chain and then overrides its answer would still pass.
   */
  it('only resolve_active_shop owns the active-shop derivation', async () => {
    const { rows } = await client.query(
      `SELECT p.proname, pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
          -- ILIKE, not LIKE: the first version of this test searched case-sensitively, so a
          -- function that wrote the clause in lower case was invisible to it. Found by injecting
          -- exactly that and watching the check stay green.
          AND pg_get_functiondef(p.oid) ILIKE '%ORDER BY m.created_at ASC%'`,
    );
    const matching = rows.map((r: any) => String(r.proname));

    // Non-vacuity: the shape must still be there, and the owner must be one of the matches.
    expect(matching, 'no function derives anything from the oldest membership any more')
      .toContain('resolve_active_shop');

    const chainCall = /(current_shop_id|resolve_active_shop)\s*\(/;
    // Any identifier on the right of `m.user_id =` — not a list of the three names in use today.
    // Measured against QA: exactly two functions match this (resolve_active_shop and
    // authorize_business_action), and resolve_invite's reversed `u.id = m.user_id` join does not.
    const callerScopedFallback = /m\.user_id\s*=\s*[a-z_][\w.]*[\s\S]{0,400}?ORDER BY m\.created_at ASC/i;

    const problems: string[] = [];
    for (const row of rows) {
      const name = String(row.proname);
      if (name === 'resolve_active_shop') continue; // the owner, by definition
      const def = String(row.def);
      const fallback = callerScopedFallback.exec(def);
      if (!fallback) continue; // not a caller-scoped derivation of the active shop
      const chain = chainCall.exec(def);
      if (!chain) {
        problems.push(`${name}: derives the caller's shop from the oldest membership and never asks the chain`);
        continue;
      }
      if (chain.index > fallback.index) {
        problems.push(`${name}: asks the chain only AFTER falling back to the oldest membership`);
      }
    }

    expect(
      problems,
      'these functions let row age decide the active shop instead of the chain — read resolve_active_shop() first',
    ).toEqual([]);
  });

  it('every authority resolver reads the chain', async () => {
    const defs = await bodies([...RESOLVERS, ...BRANCH_RESOLVER]);
    const wrong: string[] = [];
    for (const name of [...RESOLVERS, ...BRANCH_RESOLVER]) {
      const def = defs[name];
      if (!def) { wrong.push(`${name}: missing`); continue; }
      const reads = CHAIN_READS.filter((c) => c !== name).some((c) => def.includes(c));
      if (!reads) wrong.push(name);
    }
    expect(wrong, 'these functions re-derive the active shop instead of reading the chain').toEqual([]);
  });
});

describe('the chain is internal', () => {
  it('anon and authenticated cannot execute the resolvers', async () => {
    const r = await rights(INTERNAL);
    const exposed = Object.entries(r)
      .filter(([, v]) => v.anon || v.authenticated)
      .map(([k]) => k);
    expect(exposed, 'a tenant resolver reachable straight from the client').toEqual([]);
  });

  it('the switcher surface is authenticated-only', async () => {
    const r = await rights(AUTHENTICATED_ONLY);
    for (const name of AUTHENTICATED_ONLY) {
      expect(r[name], `${name} is missing`).toBeTruthy();
      expect(r[name].anon, `${name} must not be callable anonymously`).toBe(false);
      expect(r[name].authenticated, `${name} must be callable by a signed-in member`).toBe(true);
    }
  });

  it('the selection table is client-invisible', async () => {
    const { rows: rls } = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'user_active_shops'`,
    );
    expect(rls[0]?.relrowsecurity).toBe(true);

    const { rows: policies } = await client.query(
      `SELECT policyname, cmd, roles::text AS roles, qual
         FROM pg_policies WHERE tablename = 'user_active_shops'`,
    );

    // Writes belong to set_active_shop / create_shop_for_me, both SECURITY DEFINER. A
    // INSERT/UPDATE/DELETE policy would let PostgREST move the active shop directly.
    const writable = policies
      .filter((p: any) => p.cmd !== 'SELECT')
      .map((p: any) => `${p.policyname} (${p.cmd})`);
    expect(writable, 'a policy would let the client write the selection').toEqual([]);

    // The read is the entitlement, and only that: the caller's own row. A policy that is
    // permissive, role-wide, or not keyed to the caller would expose other people's.
    expect(policies.map((p: any) => p.policyname)).toEqual(['user_active_shops_select_own']);
    const read = policies[0];
    expect(read.cmd, 'the selection may be read, never written').toBe('SELECT');
    expect(String(read.qual), 'the read must be keyed to the caller').toContain('app_current_user_id');
    expect(String(read.qual), 'a shop the caller is not in must not be readable').toContain('user_id');
  });
});

describe('switching refuses shops the caller does not belong to', () => {
  it('a shop that is not a membership is rejected', async () => {
    // Identity comes from the caller's own JWT inside the RPC; the target is a shop nobody
    // can be a member of, so this holds whatever fixtures the database happens to hold.
    const { error } = await execRpcAsUser('10000000-0000-0000-0000-000000000001', 'set_active_shop', {
      p_shop_id: '99999999-9999-4999-8999-999999999999',
    });
    expect(error ?? '').toMatch(/NOT_AUTHORIZED/);
  });
});
