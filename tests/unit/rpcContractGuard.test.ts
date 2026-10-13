/**
 * The RPC permission contract, enforced statically.
 *
 * THE DEFECT THIS EXISTS TO KEEP FIXED. `DeleteTargetSheet` called `delete_branch` for as long as
 * the ledger had already retired it: 0168 created it, 0191 revoked it from `PUBLIC, anon,
 * authenticated` with the comment "The legacy endpoint erases a TENANT and accounts. It is not a
 * branch API." — and the release source shipped the call anyway (removed in 77e5bc66). Nothing
 * failed until a user tapped the button, because a call to a revoked RPC is not a compile error and
 * not a runtime error until it is made. The same class had already rotted once more, in a lane
 * fixture: `tests/integration/accountDeletion.test.ts` could not report anything about account
 * deletion while half of it was built on the retired endpoint.
 *
 * WHAT IS ASSERTED, and where each rule comes from:
 *
 *   1. Every statically named `supabase.rpc("…")` / `scopedRpc("…")` call in `src/` resolves to a
 *      function that `authenticated` can execute as the migration ledger leaves it.
 *   2. Every unresolved name (a variable, an expression) is accounted for in `DYNAMIC_ALLOWLIST`
 *      with the candidates it can hold; adding a second unresolved name to an exempted file fails
 *      until the exemption counts it, and every candidate is checked against the ledger too.
 *   3. Every lane call through `execRpcAsUser(…, "…")` / `supabase.rpc("…")` in `tests/` is held to
 *      the same contract, because a fixture built on a retired RPC measures nothing.
 *   4. A client call into a function the ledger never grants or revokes (the PostgreSQL PUBLIC
 *      default) is listed in `UNWRITTEN_ALLOWLIST` with where it is defined and why the default is
 *      acceptable — a new one fails, and a stale entry fails.
 *   5. A function the ledger does not create at all is a `LEDGER_GAPS` entry, accepted only while
 *      committed SQL in the named file would fail if the function did not exist. The list is empty
 *      now: `0200_the_pre_login_lookup_returns_only_what_the_screen_shows.sql` writes the CREATE and
 *      the two grants for the one entry this guard opened with, so the ledger is no longer silent
 *      about it. The rules that retire an entry are kept non-vacuous below rather than deleted.
 *   6. The RPCs the *unauthenticated* flow calls must stay executable by `anon`, because the sign-in
 *      gate asks before a session exists (`PRE_AUTH_RPCS`).
 *
 * Two more things this file pins down, both measured rather than assumed:
 *
 *   - **The fold reproduces the deployed catalogs.** A read-only catalog probe on 2026-10-13 measured
 *     `has_function_privilege` for six functions (`backups/get-my-shop-request-acl-2026-10-13.log`);
 *     all six now carry their own statements in the ledger, and the table below asserts the fold
 *     reaches the same per-role answer the deployment reports for every one of them — the sixth was
 *     a ledger gap until 0200 defined it, which is why it can be asserted like the other five.
 *   - **A statement that names several roles applies to all of them.** `REVOKE … FROM PUBLIC, anon,
 *     authenticated` (0191) clears three entries; treating the role list as first-match would leave
 *     PUBLIC in place and show `anon` a grant the deployed catalogs do not have.
 *
 * The fold itself (ledger order, `GRANT … TO authenticated` followed by `REVOKE … FROM PUBLIC`
 * keeping the explicit grant, DROP discarding the ACL while `CREATE OR REPLACE` keeps it) lives in
 * `scripts/lib/rpc-contract.mjs`, and `node scripts/lib/rpc-contract.mjs` prints the whole contract
 * — every client RPC, whether it is held by an explicit grant or the PUBLIC default, and the set
 * the ledger keeps server-only.
 *
 * WHAT THIS IS NOT. It reads the repository, not the deployed database: it proves the ledger and
 * the source agree, never that the ledger has been applied. The deployed-schema answer comes from
 * the QA lanes (`branchIdentityBoundary` against real Postgres semantics) and from a live QA window,
 * which stays BLOCKED until one is authorized.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ledgerFiles,
  clientFiles,
  testFiles,
  scanLedger,
  scanClientCalls,
  scanTestCalls,
  effectiveContract,
  executableByAuthenticated,
  executableByRole,
  checkRpcContract,
  checkUnwrittenContracts,
  checkPreAuthContract,
  checkTestCalls,
  STATE,
} from '../../scripts/lib/rpc-contract.mjs';

const scan = scanLedger(ledgerFiles());
const calls = scanClientCalls(clientFiles());
const { contract } = effectiveContract(scan);

const tempDirs: string[] = [];

/**
 * A file that exists only for one assertion, written outside the repository.
 *
 * Expected calls are assembled from pieces (`'delete' + '_branch'`) so this file does not itself
 * contain a literal call to a retired RPC: the guard scans every file under `tests/`, this one
 * included, and an example that looks like a call would have to be exempted from its own rule.
 */
function tempFile(name: string, contents: string): string {
  if (tempDirs.length === 0) tempDirs.push(fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-contract-guard-')));
  const full = path.join(tempDirs[0], name);
  fs.writeFileSync(full, contents, 'utf8');
  return full;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The two names this guard cannot read statically, each with the candidates it can hold and the
 * reason that list is complete.
 */
const DYNAMIC_ALLOWLIST = {
  'src/lib/db.ts': {
    kind: 'passthrough',
    wrapper: 'scopedRpc',
    reason:
      '`scopedRpc(name, args)` forwards the name its caller gave it, so the name is not a literal at ' +
      'the call inside the wrapper. Every call site passes a literal (`scopedRpc("create_sale", …)` ' +
      'and six more) and each one is checked by this guard as a static call, which is why the ' +
      'exemption is only accepted while those call sites still exist.',
  },
  'src/stores/employeesStore.ts': {
    kind: 'candidates',
    candidates: ['activate_employee_v1', 'deactivate_employee_v1'],
    reason:
      'The name is chosen by `active ? "activate_employee_v1" : "deactivate_employee_v1"` two lines ' +
      'above the call, and both branches are checked against the ledger like any literal.',
  },
};

/**
 * Client RPCs held only by PostgreSQL's PUBLIC default: no migration ever granted or revoked them.
 *
 * Each entry records where the function is defined, so the reason is anchored to SQL that can be
 * read, and each one is a `SECURITY DEFINER` function that resolves the caller itself
 * (`public.current_shop_id()` / `public.app_current_user_id()`, plus
 * `authorize_business_action('products.edit', …)` in the writers) — which is why the default is
 * survivable here rather than a hole. A call that reaches one of these with no identity fails the
 * function's own authorization, not the grant check.
 */
const UNWRITTEN_ALLOWLIST: Record<string, { definedIn: string; reason: string }> = {
  resolve_product_barcode: {
    definedIn: '0158_product_barcodes_and_create_product.sql',
    reason: 'Lookup of a code the caller is scanning: resolves the shop from the caller, refuses when it does not match.',
  },
  set_product_barcode: {
    definedIn: '0160_barcode_registry_and_history.sql',
    reason: 'A write, and gated as one: `authorize_business_action(\'products.edit\', v_shop)` inside the body.',
  },
  delete_product_barcode: {
    definedIn: '0160_barcode_registry_and_history.sql',
    reason: 'A write, and gated as one: `authorize_business_action(\'products.edit\', v_shop)` inside the body.',
  },
  preview_product_barcode: {
    definedIn: '0160_barcode_registry_and_history.sql',
    reason: 'Generates a candidate code for the shop the caller is working in; gated by `current_shop_id()`.',
  },
  product_barcodes_for: {
    definedIn: '0160_barcode_registry_and_history.sql',
    reason: 'Reads the codes of one product for the caller\'s own shop; returns nothing when the shop does not match.',
  },
};

/**
 * Functions the deployed schema has and this ledger does not create.
 *
 * EMPTY, and kept as a rule rather than deleted. It held one entry — `get_my_shop_request`, which
 * existed in the deployed schema (its definition was captured read-only as
 * `backups/def-get_my_shop_request.sql`, and 0177 pinned its search_path, so the committed ledger
 * itself assumed it) while the ledger was silent about its CREATE and its grant, both of which
 * predate the adopted ledger. The ACL was measured read-only on the deployed catalogs on 2026-10-13:
 * PUBLIC, `anon` and `authenticated` all hold EXECUTE. `0200` now writes the CREATE and the two grants
 * in the ledger, so the name has a contract of its own and the gap is closed. An entry here is still
 * accepted only while the named file contains `alter function <name>(…)`; and a name the ledger has
 * since begun to define is refused, so re-adding this entry fails instead of silently weakening the
 * checks below.
 */
const LEDGER_GAPS: Record<string, { declaredBy: string; reason: string }> = {};

/**
 * The RPCs the registration and sign-in flow calls BEFORE a session exists.
 *
 * `checkPhoneRegistration` asks the database before a code is sent and the register screens load the
 * request they just submitted, so these three have to be reachable as `anon`. `auth.ts` states it in
 * its own comment ("Both lookups are anon-callable SECURITY DEFINER RPCs"), 0115 deliberately leaves
 * them alone because their bodies carry no JWT guard, and the deployed catalogs confirm all three.
 */
const PRE_AUTH_RPCS: Record<string, { why: string }> = {
  get_my_shop_request: {
    why: 'the sign-in gate asks which stage a phone belongs at before a code is sent, and the register screens read the request they submitted',
  },
  lookup_user_by_phone: {
    why: 'the same gate, first lookup: is this number an account at all',
  },
  insert_shop_request: {
    why: 'the registration form submits the application before any account or session exists',
  },
};

/**
 * Functions whose per-role verdict the deployed catalogs report, so the ledger fold can be checked
 * against reality rather than against itself. Read-only probe, 2026-10-13
 * (`backups/get-my-shop-request-acl-2026-10-13.log`), which also measured `lookup_user_by_phone` and
 * `delete_branch` as controls — the ledger states their grants explicitly, and the probe reproduced
 * them, which is what makes it trustworthy for the rest.
 */
const DEPLOYED_CATALOGS: Array<{ name: string; anon: boolean; authenticated: boolean; ledgerSource: string }> = [
  { name: 'archive_operating_branch', anon: false, authenticated: true, ledgerSource: '0191: REVOKE ALL … FROM PUBLIC,anon; GRANT EXECUTE … TO authenticated' },
  { name: 'delete_branch', anon: false, authenticated: false, ledgerSource: '0191: REVOKE ALL … FROM PUBLIC,anon,authenticated' },
  { name: 'get_my_shop_request', anon: true, authenticated: true, ledgerSource: '0200: GRANT EXECUTE … TO anon, authenticated, PUBLIC default kept — the ACL the deployment reports' },
  { name: 'get_my_shops', anon: false, authenticated: true, ledgerSource: '0150: REVOKE EXECUTE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated' },
  { name: 'insert_shop_request', anon: true, authenticated: true, ledgerSource: '0172: GRANT EXECUTE … TO anon, authenticated' },
  { name: 'lookup_user_by_phone', anon: true, authenticated: true, ledgerSource: '0149: GRANT EXECUTE … TO anon, authenticated' },
];

describe('every RPC the client calls is one `authenticated` can execute', () => {
  it('holds across src/ as the migration ledger leaves the contract', () => {
    expect(checkRpcContract({ scan, calls, dynamicAllowlist: DYNAMIC_ALLOWLIST, ledgerGaps: LEDGER_GAPS })).toEqual([]);
  });

  it('holds across the lanes, which call as `authenticated` too', () => {
    expect(checkTestCalls({ scan, calls: scanTestCalls(testFiles()), ledgerGaps: LEDGER_GAPS })).toEqual([]);
  });

  it('accounts for every client call whose contract the ledger never wrote', () => {
    expect(checkUnwrittenContracts({ scan, calls, allowlist: UNWRITTEN_ALLOWLIST })).toEqual([]);
  });

  it('is looking at a real inventory, not an empty scan', () => {
    // A guard that passes because it found nothing to check is the failure mode this block prevents.
    expect(calls.staticCalls.length).toBeGreaterThan(50);
    expect(contract.size).toBeGreaterThan(150);
    expect(calls.dynamic.length).toBe(2);
    expect(calls.dynamic.map((site: { file: string }) => site.file).sort()).toEqual(['src/lib/db.ts', 'src/stores/employeesStore.ts']);
    expect(new Set(calls.staticCalls.map((call: { file: string }) => call.file)).size).toBeGreaterThan(15);
  });

  it('sees the ledger\'s own server-only decisions, including the one this guard was written for', () => {
    const serverOnly = [...contract.values()].filter((entry) => entry.state === STATE.REVOKED).map((entry) => entry.name);
    // The three the ledger keeps for server paths. A client call to any of them fails above.
    expect(serverOnly).toContain('delete_branch');
    expect(serverOnly).toContain('mint_barcode');
    expect(serverOnly).toContain('marketplace_distance_km');
  });

  it('keeps the gap list honest: three call sites, one evidenced gap', () => {
    expect(calls.staticCalls.filter((call: { name: string }) => call.name === 'get_my_shop_request').length).toBe(3);
    // Three call sites, no remaining gap: the entry that used to be here had a CREATE and a grant
    // that predated the adopted ledger, and 0200 writes both.
    expect(Object.keys(LEDGER_GAPS)).toEqual([]);
  });
});

describe('the RPCs the unauthenticated flow calls stay reachable by `anon`', () => {
  it('holds for the sign-in gate and the registration pair, and the ledger agrees with the deployment', () => {
    expect(checkPreAuthContract({ scan, calls, preAuth: PRE_AUTH_RPCS, ledgerGaps: LEDGER_GAPS })).toEqual([]);

    // The fold, checked against the deployed catalogs rather than against itself.
    for (const row of DEPLOYED_CATALOGS) {
      const entry = contract.get(row.name);
      expect(entry, `${row.name} must be in the ledger (${row.ledgerSource})`).toBeTruthy();
      expect(executableByRole(entry, 'anon').ok, `${row.name}: anon`).toBe(row.anon);
      expect(executableByRole(entry, 'authenticated').ok, `${row.name}: authenticated`).toBe(row.authenticated);
    }
  });

  it('has closed the gap this guard opened with: the ledger now defines and grants it, and the fold matches the deployment', () => {
    // The first version of this check reported a mismatch against a deployment that grants `anon`
    // explicitly, because it read the ledger's silence as a REVOKE. 0200 replaces that silence with
    // an actual contract, so the name is now checked like any other rather than exempted: it is in
    // the contract, `anon` and `authenticated` hold EXECUTE by the ledger's own statements, and the
    // PUBLIC default the deployment reports (`"=X/public"`) is still standing.
    const entry = contract.get('get_my_shop_request');
    expect(entry, 'the ledger must define it — 0200 writes the CREATE').toBeTruthy();
    expect(executableByRole(entry, 'anon').ok).toBe(true);
    expect(executableByRole(entry, 'authenticated').ok).toBe(true);
    expect(entry.public).toBe(true);
    expect(LEDGER_GAPS).toEqual({});
  });

  it('fails when a migration clears anon from one of them', () => {
    const revoke = tempFile(
      '9970_revoke_anon_preauth.sql',
      'REVOKE EXECUTE ON FUNCTION public.get_my_shop_request(text) FROM PUBLIC, anon;\n',
    );
    const problems = checkPreAuthContract({
      scan: scanLedger([...ledgerFiles(), revoke]),
      calls,
      preAuth: PRE_AUTH_RPCS,
      ledgerGaps: LEDGER_GAPS,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('get_my_shop_request');
    expect(problems[0]).toContain('9970_revoke_anon_preauth.sql');
    expect(problems[0]).toContain('`anon` cannot');
  });

  it('applies every role one statement names, not just the first one it matches', () => {
    const all = scanLedger([
      ...ledgerFiles(),
      tempFile('9969_all_three_roles.sql', 'REVOKE ALL ON FUNCTION public.get_my_shop_request(text) FROM PUBLIC, anon, authenticated;\n'),
    ]);
    const entry = effectiveContract(all).contract.get('get_my_shop_request');

    expect(executableByRole(entry, 'anon').ok).toBe(false);
    expect(executableByRole(entry, 'authenticated').ok).toBe(false);
    // The PUBLIC entry is the one an else-if chain loses, and with it left standing `anon` would look
    // granted — which is exactly what the deployed catalogs refute for delete_branch.
    expect(entry.public).toBe(false);
  });

  it('fails when the list names something nothing calls', () => {
    const problems = checkPreAuthContract({
      scan,
      calls,
      preAuth: { ...PRE_AUTH_RPCS, a_retired_lookup: { why: 'removed with the flow that used it' } },
      ledgerGaps: LEDGER_GAPS,
    });

    expect(problems.some((problem: string) => problem.includes('no client code calls'))).toBe(true);
  });
});

describe('the guard fails when it should', () => {
  it('catches the 77e5bc66 regression: a client call to a revoked RPC', () => {
    const retired = 'delete' + '_branch';
    const injected = tempFile(
      'DeleteTargetSheet.injected.tsx',
      `export async function remove(id: string) {\n  return await supabase.rpc("${retired}", { p_shop_id: id });\n}\n`,
    );
    const injectedCalls = scanClientCalls([injected]);
    expect(injectedCalls.staticCalls.map((call: { name: string }) => call.name)).toEqual(['delete_branch']);

    const problems = checkRpcContract({
      scan,
      calls: { ...calls, staticCalls: [...calls.staticCalls, ...injectedCalls.staticCalls] },
      dynamicAllowlist: DYNAMIC_ALLOWLIST,
      ledgerGaps: LEDGER_GAPS,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('delete_branch');
    expect(problems[0]).toContain('cannot execute');
    // The diagnostic names the statement that retired it, so the next reader does not have to search.
    expect(problems[0]).toContain('0191_operating_branches_preserve_the_business.sql');
  });

  it('catches a migration that revokes a function the client still calls', () => {
    const revoke = tempFile(
      '9999_injected_revoke.sql',
      'REVOKE ALL ON FUNCTION public.create_sale(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;\n',
    );
    const mutated = scanLedger([...ledgerFiles(), revoke]);

    const problems = checkRpcContract({ scan: mutated, calls, dynamicAllowlist: DYNAMIC_ALLOWLIST, ledgerGaps: LEDGER_GAPS });

    expect(problems.some((problem: string) => problem.includes('create_sale') && problem.includes('cannot execute'))).toBe(true);
    expect(problems.some((problem: string) => problem.includes('9999_injected_revoke.sql'))).toBe(true);
  });

  it('reads later migrations as overriding earlier ones, in both directions', () => {
    const revoke = tempFile('9990_later_revoke.sql', 'REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, text) FROM authenticated;\n');
    const grant = tempFile('9991_last_word_grant.sql', 'GRANT EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, text) TO authenticated;\n');
    const restored = scanLedger([...ledgerFiles(), revoke, grant]);

    const problems = checkRpcContract({ scan: restored, calls, dynamicAllowlist: DYNAMIC_ALLOWLIST, ledgerGaps: LEDGER_GAPS });
    expect(problems.filter((problem: string) => problem.includes('create_sale'))).toEqual([]);
  });

  it('keeps an explicit grant when a later REVOKE only reaches PUBLIC, and loses it when it names the role', () => {
    // 0131 and 0163 write exactly this pair; 0191 writes the other one. Reading them the same way is
    // what makes `delete_branch` fail here and `update_employee_access` pass.
    // Read against the real ledger, so the function has a CREATE and the two ACL statements are the
    // only thing the mutation changes.
    const keeps = scanLedger([
      ...ledgerFiles(),
      tempFile('9980_explicit_then_public.sql', 'GRANT EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, text) TO authenticated;\nREVOKE EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, text) FROM PUBLIC, anon;\n'),
    ]);
    expect(executableByAuthenticated(effectiveContract(keeps).contract.get('create_sale')).ok).toBe(true);

    const loses = scanLedger([
      ...ledgerFiles(),
      tempFile('9981_public_then_role.sql', 'REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;\n'),
    ]);
    const verdict = executableByAuthenticated(effectiveContract(loses).contract.get('create_sale'));
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain('REVOKE EXECUTE');
  });

  it('catches a lane built on a retired RPC', () => {
    const retired = 'delete' + '_branch';
    const injected = tempFile(
      'accountDeletion.injected.test.ts',
      `const result = await execRpcAsUser(ACTOR, "${retired}", { p_shop_id: SIDE });\n`,
    );
    const problems = checkTestCalls({ scan, calls: scanTestCalls([injected]), ledgerGaps: LEDGER_GAPS });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('delete_branch');
    expect(problems[0]).toContain('cannot execute');
  });

  it('refuses an unresolved RPC name, and an exemption that does not cover it', () => {
    const injected = tempFile(
      'unresolved.ts',
      'const rpcName = mode ? "create_sale" : "void_sale";\nawait supabase.rpc(rpcName, {});\n',
    );
    const injectedCalls = scanClientCalls([injected]);
    const site = injectedCalls.dynamic[0];
    expect(site.candidates).toEqual(['create_sale', 'void_sale']);

    const withoutExemption = checkRpcContract({ scan, calls: injectedCalls, dynamicAllowlist: {} });
    expect(withoutExemption.some((problem: string) => problem.includes('cannot resolve'))).toBe(true);

    const partial = checkRpcContract({
      scan,
      calls: injectedCalls,
      dynamicAllowlist: { [site.file]: { kind: 'candidates', candidates: ['create_sale'] } },
    });
    expect(partial.some((problem: string) => problem.includes('does not list') && problem.includes('void_sale'))).toBe(true);

    const complete = checkRpcContract({
      scan,
      calls: injectedCalls,
      dynamicAllowlist: { [site.file]: { kind: 'candidates', candidates: ['create_sale', 'void_sale'] } },
    });
    expect(complete).toEqual([]);

    const stale = checkRpcContract({
      scan,
      calls: injectedCalls,
      dynamicAllowlist: { [site.file]: { kind: 'candidates', candidates: ['create_sale', 'void_sale', 'archive_customer'] } },
    });
    expect(stale.some((problem: string) => problem.includes('no longer appears'))).toBe(true);
  });

  it('catches a second unresolved name hiding behind an existing exemption, and a sweep it cannot read', () => {
    const first = tempFile('two_sites.ts', 'await supabase.rpc(name, {});\nawait supabase.rpc(other, {});\n');
    const callsInFile = scanClientCalls([first]);
    const key = callsInFile.dynamic[0].file;
    const problems = checkRpcContract({
      scan,
      calls: callsInFile,
      dynamicAllowlist: { [key]: { kind: 'candidates', candidates: [] } },
    });
    expect(problems.some((problem: string) => problem.includes('accounts for 1'))).toBe(true);

    const sweep = scanLedger([tempFile('9970_sweep.sql', 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;\n')]);
    const swept = checkRpcContract({ scan: sweep, calls: { staticCalls: [], dynamic: [] } });
    expect(swept.some((problem: string) => problem.includes('schema-wide'))).toBe(true);
  });

  it('refuses a ledger gap whose evidence is gone, a gap the ledger has outgrown, and a client call the ledger never wrote', () => {
    // The evidence rule is only reached for a name a call site actually uses, so the call site is
    // injected alongside the gap. 0170 mentions this name in a comment only, which is exactly the
    // shape the rule must reject: a citation that no `alter function …(…)` backs.
    const inventedName = 'a_freshly' + '_invented_rpc';
    const injected = tempFile('brand_new.ts', `await supabase.rpc("${inventedName}", {});\n`);
    const injectedCalls = scanClientCalls([injected]).staticCalls;

    const unevidenced = checkRpcContract({
      scan,
      calls: { staticCalls: injectedCalls, dynamic: [] },
      dynamicAllowlist: {},
      ledgerGaps: { [inventedName]: { declaredBy: 'supabase/migrations/0170_deleting_a_number_leaves_nothing_behind.sql', reason: 'x' } },
    });
    expect(unevidenced.some((problem: string) => problem.includes('no longer evidenced'))).toBe(true);

    // The rule that retired the entry this guard opened with: once the ledger defines the name, an
    // exemption for it is not silence anymore, it is a weakened check — so re-adding it fails.
    const outgrown = checkRpcContract({
      scan,
      calls,
      dynamicAllowlist: DYNAMIC_ALLOWLIST,
      ledgerGaps: { get_my_shop_request: { declaredBy: 'supabase/migrations/0177_a_definer_knows_where_it_looks.sql', reason: 'x' } },
    });
    expect(outgrown.some((problem: string) => problem.includes('the ledger now defines it'))).toBe(true);

    const invented = checkRpcContract({
      scan,
      calls: { staticCalls: injectedCalls, dynamic: [] },
      dynamicAllowlist: {},
      ledgerGaps: LEDGER_GAPS,
    });
    expect(invented.some((problem: string) => problem.includes('no CREATE FUNCTION in the migration ledger'))).toBe(true);

    const unwritten = checkUnwrittenContracts({
      scan,
      calls: { staticCalls: [{ file: 'src/lib/x.ts', line: 1, name: Object.keys(UNWRITTEN_ALLOWLIST)[0] }], dynamic: [] },
      allowlist: {},
    });
    expect(unwritten.some((problem: string) => problem.includes('PUBLIC default'))).toBe(true);
  });
});
