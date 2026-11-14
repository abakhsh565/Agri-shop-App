/**
 * The sale gate and the shelf read one rule.
 *
 * WHY A GUARD. They are two database functions over the same ledger, and they disagreed in a way
 * no screen could show: the product screens answered 502 for `K plus · 28 KG` on the main branch
 * (`get_branch_variant_stock`, which 0244 taught that stock whose branch was archived is carried
 * by the main branch) while the write gate answered −1 (`branch_variant_qty`, which 0239 left
 * counting the branch's own rows only). Completing the sale then failed with INSUFFICIENT_STOCK —
 * which the app maps to "check the quantity", the one sentence that cannot be acted on, because
 * the quantity was never the problem. Nine of the fifteen packs in that shop were in the same
 * state on the main branch.
 *
 * The repair (0252) is not a second number that happens to match: it is ONE function. The shelf
 * shows the clamped form of it, the gate asks it with the pending movement added back, and the
 * guard's own opening-stock special case is gone because the general rule subsumes it. This file
 * pins that shape, because the failure mode is a future edit re-inlining a second formula in
 * either place — which typechecking, the app suite and every UI test would all pass through
 * silently, exactly as they did before.
 *
 * The checks are run against the PRE-FIX files too, so the test proves it can see the defect it
 * exists for rather than merely agreeing with whatever is on disk.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

const FIX = read('supabase/migrations/0252_the_sale_gate_reads_the_shelf_number.sql');
const PRE_FIX_GUARD = read('supabase/migrations/0239_a_branch_only_moves_its_own_stock.sql');
const PRE_FIX_READ = read('supabase/migrations/0244_the_card_and_the_team_agree.sql');

/** The body of a CREATE FUNCTION in a migration file, up to its terminating dollar quote. */
function bodyOf(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(marker);
  if (start === -1) return '';
  const rest = sql.slice(start);
  const ends = ['$function$;', '$$;']
    .map((closer) => rest.indexOf(closer))
    .filter((index) => index !== -1);
  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

/** Does the shelf read answer from the one rule instead of a formula of its own? */
const readAsksTheOneRule = (sql: string) =>
  bodyOf(sql, 'get_branch_variant_stock').includes('branch_variant_qty');

/** Does the gate ask for the pre-movement number — the shape a BEFORE INSERT trigger needs? */
const gateAsksForThePreMovementNumber = (sql: string) =>
  bodyOf(sql, 'guard_branch_stock_movement').includes(
    'branch_variant_qty(NEW.variant_id, NEW.branch_id, NEW.qty_change)',
  );

/** Does the gate still decide with an opening-stock special case of its own? */
const gateCarriesItsOwnSpecialCase = (sql: string) =>
  bodyOf(sql, 'guard_branch_stock_movement').includes('v_never');

describe('the branch shelf and the sale gate answer with one rule', () => {
  it('reads the shelf from the shared function', () => {
    expect(readAsksTheOneRule(FIX)).toBe(true);
  });

  it('asks for the pre-movement number, the way the trigger needs it', () => {
    expect(gateAsksForThePreMovementNumber(FIX)).toBe(true);
  });

  it('carries no opening-stock special case of its own', () => {
    expect(gateCarriesItsOwnSpecialCase(FIX)).toBe(false);
  });

  it('drops the 2-argument overload, so an exact-arity call cannot keep the old rule', () => {
    expect(FIX).toContain('DROP FUNCTION IF EXISTS public.branch_variant_qty(uuid, uuid);');
    // …and the new signature is the one that carries the pending change.
    expect(bodyOf(FIX, 'branch_variant_qty')).toContain('p_pending_change');
    expect(bodyOf(FIX, 'branch_variant_qty')).toContain('GREATEST');
  });

  it('asserts the same shape at apply time, where a live database can contradict it', () => {
    expect(FIX).toContain('position(\'branch_variant_qty\' IN v_def) = 0');
    expect(FIX).toContain('the shelf and the gate answer differently');
  });

  it('is not vacuous: the same checks flag the pre-fix files', () => {
    // 0239's guard was the refusal the report hit: its own v_never special case, and a two-argument
    // question that could not see the movement the caller had already written.
    expect(gateCarriesItsOwnSpecialCase(PRE_FIX_GUARD)).toBe(true);
    expect(gateAsksForThePreMovementNumber(PRE_FIX_GUARD)).toBe(false);
    // 0244's shelf read answered from its own inline formula (net + unclaimed remainder), which is
    // how the shelf and the gate came to hold two different numbers in the first place.
    expect(readAsksTheOneRule(PRE_FIX_READ)).toBe(false);
  });
});
