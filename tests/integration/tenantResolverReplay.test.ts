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
  it('only resolve_active_shop derives the active shop from the first membership', async () => {
    const { rows } = await client.query(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
          AND pg_get_functiondef(p.oid) LIKE '%ORDER BY m.created_at ASC%'
        ORDER BY 1`,
    );
    expect(rows.map((r: any) => r.proname)).toEqual(['resolve_active_shop']);
  });

  it('every authority resolver reads the chain', async () => {
    const defs = await bodies(RESOLVERS);
    const wrong: string[] = [];
    for (const name of RESOLVERS) {
      const def = defs[name];
      if (!def) { wrong.push(`${name}: missing`); continue; }
      const reads = CANONICAL.filter((c) => c !== name).some((c) => def.includes(c));
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
