/**
 * Every consequential RPC the ledger guards must be represented in the per-role security matrix.
 *
 * WHY THIS EXISTS. `tests/integration/securityMatrix.test.ts` proves who may pass each consequential
 * RPC's authorization guard — but nothing failed when a NEW consequential RPC reached the ledger, so
 * the matrix could silently stop describing the system it is the evidence for. That is the same class
 * of gap `rpcContractGuard` closes for the client/RPC contract, and it is closed the same way: derive
 * the list from the migration that owns it, and fail on a name the matrix does not carry.
 *
 * THE LIST IS DERIVED, NOT COPIED. `0192_consequential_records_guard_before_retry.sql` maps each
 * guarded RPC to the permission it is judged against inside `guard_operational_request`, and revokes
 * the compatibility endpoint it retires. Both facts are read back out of that file here, so adding an
 * eighth RPC to the guard — or retiring one — changes what this guard requires without anyone editing
 * a second list. A hand-maintained copy that drifts from the migration is worse than no copy.
 *
 * WHAT "REPRESENTED" MEANS, and why both halves are needed:
 *   * the RPC is CALLED by name in the matrix (`execRpcAsUser(<who>, '<rpc>'`), so a row exists;
 *   * the permission code its guard names appears in the matrix, so the row asserts the refusal with
 *     the code the guard actually raises rather than merely mentioning the RPC;
 *   * and the matrix asserts the guard's refusal text at all (`missing permission`), so "the code
 *     appears" cannot be satisfied by a comment.
 *
 * NON-VACUOUS BY CONSTRUCTION, and proven in this file: the check is a pure function of the parsed
 * lists, so a synthetic new RPC is reported missing in a test of its own (§3) — the guard fails when
 * it should without anyone having to edit a migration to see it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const LEDGER = path.resolve('supabase/migrations/0192_consequential_records_guard_before_retry.sql');
const MATRIX = path.resolve('tests/integration/securityMatrix.test.ts');

/** RPC → the permission code `guard_operational_request` judges it against. */
export function guardedOperations(sql: string): Map<string, string> {
  const marker = 'v_permission := CASE p_rpc WHEN';
  const start = sql.indexOf(marker);
  if (start === -1) throw new Error('0192 no longer contains the `v_permission := CASE p_rpc WHEN` mapping');
  const end = sql.indexOf('END;', start);
  const block = sql.slice(start, end === -1 ? undefined : end);

  const guarded = new Map<string, string>();
  for (const [, rpc, permission] of block.matchAll(/WHEN\s+'([^']+)'\s+THEN\s+'([^']+)'/g)) {
    guarded.set(rpc, permission);
  }
  return guarded;
}

/**
 * Endpoints the same migration retires for `authenticated`.
 *
 * `void_sale_v1` is in the CASE list above and is revoked in the same file: it is guarded *and*
 * unreachable, so requiring the matrix to exercise it would require it to exercise a call the
 * application cannot make. The `void_sale(uuid,text,uuid)` replacement is the reachable one and is
 * not revoked.
 */
export function retiredOperations(sql: string): Set<string> {
  const retired = new Set<string>();
  const re = /REVOKE ALL ON FUNCTION\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s*FROM[^;]*\bauthenticated\b/gi;
  for (const [, name] of sql.matchAll(re)) retired.add(name);
  return retired;
}

/** The RPC names the matrix calls, taken from the calls themselves. */
export function namedRpcCalls(matrix: string): Set<string> {
  const names = new Set<string>();
  for (const [, rpc] of matrix.matchAll(/execRpcAsUser\(\s*[A-Za-z_$][\w$]*\s*,\s*'([a-z0-9_]+)'/g)) {
    names.add(rpc);
  }
  return names;
}

/** Every quoted token in the matrix, for the permission-code half of the check. */
export function quotedTokens(matrix: string): Set<string> {
  const tokens = new Set<string>();
  for (const [, token] of matrix.matchAll(/'([a-z][a-z0-9_.]*)'/g)) tokens.add(token);
  return tokens;
}

/**
 * The guarded, still-reachable RPCs the matrix does not carry — by name or by permission code.
 * Pure, so a test can hand it a synthetic addition and watch it be reported.
 */
export function missingFromMatrix(
  guarded: Map<string, string>,
  retired: Set<string>,
  calledNames: Set<string>,
  tokens: Set<string>
): string[] {
  const missing: string[] = [];
  for (const [rpc, permission] of guarded) {
    if (retired.has(rpc)) continue;
    if (!calledNames.has(rpc)) missing.push(`${rpc} (never called in the matrix)`);
    else if (!tokens.has(permission)) missing.push(`${rpc} (its permission \`${permission}\` is not asserted)`);
  }
  return missing;
}

const ledgerSql = readFileSync(LEDGER, 'utf8');
const matrixSql = readFileSync(MATRIX, 'utf8');

describe('the guard list is read out of the migration that owns it', () => {
  it('parses a real mapping, not an empty scan', () => {
    const guarded = guardedOperations(ledgerSql);
    expect(guarded.size, 'the CASE mapping parsed no operations').toBeGreaterThanOrEqual(7);
    expect(guarded.get('create_sale')).toBe('sales.create');
    expect(guarded.get('adjust_stock')).toBe('inventory.adjust');
    expect(guarded.get('record_supplier_payment')).toBe('payments.supplier');
  });

  it('sees the endpoint the same migration retires, and only that one', () => {
    const retired = retiredOperations(ledgerSql);
    expect(retired.has('void_sale_v1'), 'the retired compatibility endpoint is no longer recognised').toBe(true);
    expect(retired.has('void_sale'), 'the canonical void_sale must NOT be treated as retired').toBe(false);
  });
});

describe('every reachable consequential RPC is represented in the security matrix', () => {
  it('holds for all of them, by name and by the permission its guard raises', () => {
    const guarded = guardedOperations(ledgerSql);
    const retired = retiredOperations(ledgerSql);
    const missing = missingFromMatrix(guarded, retired, namedRpcCalls(matrixSql), quotedTokens(matrixSql));
    expect(
      missing,
      `these consequential RPCs are guarded by the ledger but the per-role matrix carries no row for them: ${missing.join(', ')}. ` +
        'Add a row to tests/integration/securityMatrix.test.ts (and refresh its record in feature-registry.json).',
    ).toEqual([]);
  });

  it('is checking a real matrix: the refusal text the rows assert is present', () => {
    expect(
      matrixSql.includes('missing permission'),
      'the matrix no longer asserts the guard’s refusal text, so "the permission appears" would mean nothing',
    ).toBe(true);
    expect(namedRpcCalls(matrixSql).size, 'the matrix names no RPC at all').toBeGreaterThanOrEqual(7);
  });
});

describe('the guard fails when it should', () => {
  it('reports a consequential RPC the matrix has never seen', () => {
    const guarded = guardedOperations(ledgerSql);
    guarded.set('qa_new_consequential_rpc', 'qa.new');
    const missing = missingFromMatrix(
      guarded,
      retiredOperations(ledgerSql),
      namedRpcCalls(matrixSql),
      quotedTokens(matrixSql),
    );
    expect(missing).toContain('qa_new_consequential_rpc (never called in the matrix)');
  });

  it('reports an RPC that is called but whose permission is never asserted', () => {
    const guarded = new Map([['create_sale', 'qa.unasserted_permission']]);
    const missing = missingFromMatrix(guarded, new Set(), namedRpcCalls(matrixSql), quotedTokens(matrixSql));
    expect(missing).toEqual(['create_sale (its permission `qa.unasserted_permission` is not asserted)']);
  });

  it('does not require a retired endpoint to be exercised', () => {
    const guarded = new Map([['void_sale_v1', 'sales.void']]);
    const missing = missingFromMatrix(guarded, new Set(['void_sale_v1']), new Set(), new Set());
    expect(missing).toEqual([]);
  });
});
