/**
 * The class-wide guard for the 0178 → 0182 family.
 *
 * Every leak in that family was one shape: a policy whose predicate is the literal `true`
 * on a table whose boundary is a `shop_id` column, reachable by an authenticated session
 * through PostgREST. It happened four times (`product_variants` 0178, `stock_adjustments` and
 * `cash_reconciliations` 0180, `app_settings` 0182) — each found by hand, months apart. A
 * fifth should be found by this file on the next `npx vitest run`, not by another audit.
 *
 * Two assertions, both on the live catalog:
 *
 *   1. no policy with a literal-`true` predicate sits on a table that has a `shop_id`
 *      column. `permissions` (global reference data, no `shop_id`) is correctly exempt;
 *      `app_settings` and every business table are not.
 *   2. no INSERT policy anywhere is permissive-`true` — the `audit_events` shape closed by
 *      0181. History and configuration must be written by trusted logic, never accepted
 *      verbatim from whatever the caller sends.
 *
 * A policy that is merely *listed* is not the same as one that is reachable: the row must
 * also carry a table privilege for a client role. The guard checks policies, because a
 * policy that says yes is the thing that silently waits for a `grant` (that is exactly why
 * 0181 closed `audit_events` although no client could insert). If a policy is narrow, both
 * gates must say no.
 */

import { describe, it, expect } from 'vitest';
import { execSqlAsAdmin } from '../setup/qa-client';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

describe('shop-scoped policies never say true', () => {
  it('no table with a shop_id column carries a permissive-true policy', async () => {
    const rows = await sql(`
      SELECT c.relname AS tbl, p.polname, p.polcmd,
             EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public'
                        AND col.table_name = c.relname
                        AND col.column_name = 'shop_id') AS has_shop_id
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relnamespace = 'public'::regnamespace
         AND p.polpermissive
         AND coalesce(pg_get_expr(p.polqual, p.polrelid),
                      pg_get_expr(p.polwithcheck, p.polrelid)) = 'true'
    `);
    const scoped = rows.rows.filter((r: any) => r.has_shop_id);
    expect(
      scoped.map((r: any) => `${r.tbl}.${r.polname}(${r.polcmd})`),
      'a policy with no shop predicate sits on a table whose boundary is shop_id',
    ).toEqual([]);
  });

  it('no INSERT policy anywhere accepts anything the caller sends', async () => {
    const rows = await sql(`
      SELECT c.relname AS tbl, p.polname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relnamespace = 'public'::regnamespace
         AND p.polcmd = 'a'
         AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true'
    `);
    expect(
      rows.rows.map((r: any) => `${r.tbl}.${r.polname}`),
      'an INSERT policy accepts whatever the caller sends (the audit_events shape, 0181)',
    ).toEqual([]);
  });
});
