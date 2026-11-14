/**
 * Ownership-scoped cleanup for the test suites — the decision half, with no database access.
 *
 * Three things live here, and each is the reason the other two are trustworthy:
 *
 *   · `planOwnedTransactionCleanup` turns an explicit scope into ordered statements and refuses
 *     anything it cannot prove is owned (see below);
 *   · `runCleanupStatements` executes a statement list and reports EVERY failure instead of the
 *     first — or none, which is what `.catch(() => undefined)` reported;
 *   · `runTeardownSteps` runs the teardown as an ordered sequence, attempts every step even when an
 *     earlier one failed, and reports each failure with its label.
 *
 * The executors are injected, so all three are tested without a database
 * (`tests/unit/integrationCleanupOwnership.test.ts`, `tests/unit/cleanupFailureVisibility.test.ts`)
 * and used by both sides: integration suites pass the admin connection, E2E lanes pass `execSql`.
 *
 * WHY THIS FILE EXISTS (Phase-3 exit criterion EC2)
 *   `tests/setup/fixtures.ts` used to expose `cleanupTestData()`, which deleted the transactions of
 *   the SHARED baseline customers (customerA/B/C) and the inventory movements of the shared products
 *   (productA/B). Every suite that called it therefore deleted rows it could not prove it created:
 *   another file's sale, payment, return or credit request on those identities was inside the blast
 *   radius, and a finishing suite could wipe a sibling's row mid-assertion. That is why the
 *   integration suite had to be forced serial (`vitest.integration.config.ts`), but seriality is a
 *   scheduling accident, not an ownership guarantee: with the sweep in place, "one file at a time"
 *   was the only thing standing between a cleanup and somebody else's data.
 *
 * THE RULE THIS FILE ENFORCES
 *   Cleanup takes the ids the caller OWNS, and deletes only rows reachable from those ids. It never
 *   derives an id from shared state, and it cannot be asked to:
 *
 *     · a shared baseline identity is refused outright — the eleven ids declared in `qa-fixtures.ts`
 *       are the one set cleanup must never name;
 *     · an empty scope is refused — a cleanup that owns nothing is either dead code or a sweep
 *       wearing a scope's clothes;
 *     · every id must be a bare uuid — the signature is `readonly string[]`, so nothing else can be
 *       smuggled through an interpolation (`'${table}'`, `"x' OR '1'='1"`, `''`, `'%'` all refuse).
 *
 * WHY THE PLAN IS SEPARATE FROM THE EXECUTION
 *   `planOwnedTransactionCleanup` is pure: it validates, then returns the ordered SQL. That makes the
 *   ownership boundary testable without a database — `tests/unit/integrationCleanupOwnership.test.ts`
 *   drives it directly, and the scan in that file proves no test file issues a delete for a shared
 *   identity at all. The executor lives in `./fixtures` and does nothing but run these statements.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not delete identity rows (the customer, product, variant, company or user the suite
 *   inserted). Those belong to the suite that inserted them, and its own afterAll already removes
 *   them by name. This helper removes the transactions and movements that hang off an owned id —
 *   the rows a suite creates indirectly, through an RPC, and cannot list by id afterwards.
 */

import { QA_FIXTURE_IDS } from './qa-fixtures';

/** What a suite owns: the customers and products whose rows it is allowed to remove. */
export interface OwnedTransactionScope {
  /** Customer ids this suite created — their sales, returns, voids, payments and credit requests go. */
  customerIds?: readonly string[];
  /** Product ids this suite created — the movements written against them go. */
  productIds?: readonly string[];
}

/**
 * The eleven shared baseline identities (`qa-fixtures.ts`), as values.
 *
 * These are the rows every environment seeds and every suite borrows; they are also the ids the old
 * sweep was keyed to. Cleanup must never target one, which is why this list is the refusal input
 * rather than something a caller can pass in.
 */
export const SHARED_BASELINE_IDS: readonly string[] = Object.freeze(Object.values(QA_FIXTURE_IDS));

/** A bare uuid — the only shape an id may have to reach a statement. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this id one of the shared baseline identities that cleanup must never name? */
export function isSharedBaselineId(id: string): boolean {
  return SHARED_BASELINE_IDS.includes(id);
}

/**
 * Validate one owned-id list and return it deduplicated.
 *
 * Order matters here: the shared-baseline refusal runs before the uuid check so that a shared id is
 * reported as what it is (the baseline) rather than as a formatting problem.
 */
function assertOwnedIds(ids: readonly string[] | undefined, label: string): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (isSharedBaselineId(id)) {
      throw new Error(
        `[QA CLEANUP] ${label} "${id}" is a shared baseline identity (tests/setup/qa-fixtures.ts). ` +
          'Cleanup must target the ids the suite created; the baseline is restored by reseeding, never deleted.',
      );
    }
    if (!UUID.test(id)) {
      throw new Error(
        `[QA CLEANUP] ${label} "${id}" is not a uuid, so it cannot be proved to be an owned row id. ` +
          'Refusing to interpolate it into cleanup SQL.',
      );
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** `('a', 'b')` for an IN clause, from ids that have already been validated. */
function inList(ids: readonly string[]): string {
  return `(${ids.map((id) => `'${id}'`).join(', ')})`;
}

/**
 * The statements that remove transactions belonging to the given owned ids, children before parents.
 *
 * The order is the one the removed sweep used — it is a measured order, not a guess: `voids` used to
 * be deleted after `sales` in an earlier version, so its sub-select matched nothing and every voided
 * row survived while the suite reported success. Each group below is child-first, and a parent is
 * removed only after the rows that reach it through a foreign key.
 *
 * @throws if the scope owns nothing, names a shared baseline identity, or carries a non-uuid value.
 */
export function planOwnedTransactionCleanup(scope: OwnedTransactionScope): string[] {
  const customerIds = assertOwnedIds(scope.customerIds, 'customerIds');
  const productIds = assertOwnedIds(scope.productIds, 'productIds');

  if (!customerIds.length && !productIds.length) {
    throw new Error(
      '[QA CLEANUP] refused: no owned ids were given. A cleanup with nothing of its own to remove is ' +
        'a whole-table sweep in disguise — pass the customer/product ids this suite created.',
    );
  }

  const statements: string[] = [];

  if (customerIds.length) {
    const customers = inList(customerIds);
    statements.push(
      // 1. a sale's own children, and the rows the void/return flows hang off them
      `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customers})`,
      `DELETE FROM inventory_movements WHERE reference_id IN (SELECT id FROM sales WHERE customer_id IN ${customers})`,
      `DELETE FROM inventory_movements WHERE reference_id IN (SELECT id FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customers}))`,
      `DELETE FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customers})`,
      // 2. a return's children
      `DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id IN ${customers})`,
      `DELETE FROM inventory_movements WHERE reference_id IN (SELECT id FROM returns WHERE customer_id IN ${customers})`,
      `DELETE FROM returns WHERE customer_id IN ${customers}`,
      // 3. the sales themselves, now that nothing reaches them
      `DELETE FROM sales WHERE customer_id IN ${customers}`,
      // 4. every NO ACTION key that would refuse the owning customer's own delete
      `DELETE FROM customer_payments WHERE customer_id IN ${customers}`,
      `DELETE FROM payments WHERE customer_id IN ${customers}`,
      `DELETE FROM credit_limit_requests WHERE customer_id IN ${customers}`,
      // 5. reminder rows, scoped to the same owned customers: an unscoped version of these wiped a
      //    parallel suite's reminder config and surfaced as an intermittent foreign-key failure in
      //    tenantIsolationOps.
      `DELETE FROM reminder_logs WHERE config_id IN (SELECT id FROM reminder_configs WHERE customer_id IN ${customers})`,
      `DELETE FROM reminder_occurrences WHERE customer_id IN ${customers}`,
      `DELETE FROM reminder_configs WHERE customer_id IN ${customers}`,
    );
  }

  if (productIds.length) {
    // 6. movements whose SUBJECT is an owned product, whichever flow wrote them
    statements.push(`DELETE FROM inventory_movements WHERE product_id IN ${inList(productIds)}`);
  }

  return statements;
}

/** A cleanup statement that failed, and what the database said about it. */
export interface CleanupFailure {
  /** The statement, which names the row or table the failure belongs to. */
  statement: string;
  error: string;
}

/**
 * Run cleanup statements and report EVERY failure, not the first one.
 *
 * WHY NOT `.catch(() => undefined)`. A cleanup that swallows its own errors is a run that reports
 * clean while dirty: the sibling suite that then fails on the residue is blamed instead, and the
 * fixture problem is misdiagnosed as a product bug for days. One swallowed statement is also worse
 * than it looks — a `DELETE` that fails because a child row remains leaves the parent behind, and
 * the next statement in a child-first list then fails for a different reason. So: run them all,
 * keep every failure, and throw one error that names each statement and its error.
 *
 * `run` is supplied by the caller (integration suites pass the admin connection, E2E lanes pass the
 * `run_sql` helper), which is what keeps this function testable without a database.
 */
export async function runCleanupStatements(
  run: (sql: string) => Promise<unknown>,
  statements: readonly string[],
  label: string,
): Promise<void> {
  const failures: CleanupFailure[] = [];

  for (const statement of statements) {
    try {
      await run(statement);
    } catch (e) {
      failures.push({ statement, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (failures.length) {
    const detail = failures
      .map((f) => `${f.statement.split(' WHERE ')[0]}: ${f.error}`)
      .join('; ');
    throw new Error(
      `[QA CLEANUP] ${label}: ${failures.length} of ${statements.length} statement(s) failed, so those ` +
        `rows are still in the database — ${detail}`,
    );
  }
}

/** One teardown step: a name for the report, and the work. */
export interface TeardownStep {
  label: string;
  run: () => Promise<void>;
}

/**
 * Run every teardown step, in order, and report all of them.
 *
 * WHY THE ORDER AND THE REPORT MATTER TOGETHER. A lane that mutates a shared row must put it back
 * BEFORE it removes rows the restored value points at (`user_active_shops.branch_id` references the
 * throwaway branch that is deleted next) — so the steps are a sequence, and a step that throws must
 * not cancel the ones after it: a restore that failed is exactly when the lane's own cleanup still
 * has to run. Each failure is labelled with its step, and every failure is reported, so a red hook
 * says which guarantee broke instead of just "teardown failed".
 */
export async function runTeardownSteps(steps: readonly TeardownStep[]): Promise<void> {
  const failures: string[] = [];

  for (const step of steps) {
    try {
      await step.run();
    } catch (e) {
      failures.push(`${step.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failures.length) {
    throw new Error(
      `[QA CLEANUP] ${failures.length} of ${steps.length} teardown step(s) failed — a shared row may ` +
        `still be modified or this lane's rows may still be there:\n  ${failures.join('\n  ')}`,
    );
  }
}
