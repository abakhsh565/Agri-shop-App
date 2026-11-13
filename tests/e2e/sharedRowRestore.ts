/**
 * Put a SHARED fixture row back, whatever the test body did.
 *
 * WHY THIS EXISTS (measured 2026-10-18)
 *   Two lanes mutate rows every other lane reads — `adminFullAccess` renames QA Admin through the
 *   profile screen, `education` states "this account has never signed in". Both restored the previous
 *   value as the LAST LINE OF THE TEST BODY. A failing assertion, a navigation timeout, or an aborted
 *   step skips that line, so the shared row keeps the test's value and the next lane inherits it. That
 *   is the same class of defect the canonical baseline file fixed for seeding: a premise that depends
 *   on which lane ran last is not a premise.
 *
 * WHAT IT DOES, AND WHAT IT REFUSES TO DO
 *   It runs the body, then ALWAYS runs the restore, then reports. Three outcomes, and none of them is
 *   silent:
 *
 *     · body passed, restore passed   → the body's value is returned;
 *     · body failed, restore passed   → the ORIGINAL error is rethrown unchanged, so the reported
 *                                       failure is still the real one (its message and stack survive);
 *     · restore failed                → an error that names the restore AND, when the body had also
 *                                       failed, repeats the body's message. A restore failure must be
 *                                       visible, but it must never overwrite the reason the test
 *                                       failed — that is how a fixture problem gets misdiagnosed for
 *                                       days as a product bug, and the reverse.
 *
 * It performs no I/O: the caller supplies the restore, so this decision is testable without a
 * database (see `tests/unit/e2eSharedRowRestore.test.ts`).
 */

/** One cell of a shared fixture row: the table, the column, and the row's own id. */
export interface SharedCellRef {
  table: string;
  column: string;
  id: string;
}

/** A cell whose value was read BEFORE the lane mutated it. */
export interface CapturedSharedCell extends SharedCellRef {
  value: string | number | boolean | null;
}

const PLAIN_NAME = /^[a-z_][a-z0-9_]*$/;
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `customers.outstanding_balance for 20000000-…` — the phrase both the capture and the restore report. */
export function sharedCellLabel(cell: SharedCellRef): string {
  return `${cell.table}.${cell.column} for ${cell.id}`;
}

/** Table and column names come from the caller's own literals; anything else is refused. */
function assertCellRef(cell: SharedCellRef): void {
  for (const [field, value] of [
    ['table', cell.table],
    ['column', cell.column],
  ] as const) {
    if (!PLAIN_NAME.test(value)) {
      throw new Error(`[QA FIXTURE] refusing "${value}" as a ${field} name in a shared-row restore`);
    }
  }
  if (!ROW_ID.test(cell.id)) {
    throw new Error(
      `[QA FIXTURE] refusing "${cell.id}" as a row id: a shared cell is addressed by its own uuid, ` +
        'so nothing else can be interpolated into the capture or the restore',
    );
  }
}

/** A captured value as a SQL literal. */
function literal(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`[QA FIXTURE] refusing to restore the non-finite number ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Read the CURRENT value of every cell a lane is about to mutate.
 *
 * This is the half that makes a restore honest: without it, "restore" means "write some value that
 * looks right", and a lane that finds the row already off-baseline (another lane failed before it)
 * would bake that leftover in as if it were the fixture. The row must exist and the column must come
 * back — a capture that silently captured nothing would make the restore a no-op.
 *
 * @param read runs one SELECT and returns its rows; supplied by the caller so this is testable
 *             without a database.
 */
export async function captureSharedCells(
  read: (sql: string) => Promise<Array<Record<string, unknown>>>,
  cells: readonly SharedCellRef[],
): Promise<CapturedSharedCell[]> {
  const captured: CapturedSharedCell[] = [];
  for (const cell of cells) {
    assertCellRef(cell);
    const rows = await read(`SELECT ${cell.column} FROM ${cell.table} WHERE id = '${cell.id}'`);
    if (rows.length !== 1) {
      throw new Error(
        `[QA FIXTURE] ${sharedCellLabel(cell)}: expected exactly one shared row to capture, found ` +
          `${rows.length}. A restore cannot be captured from nothing — seed the fixture baseline first ` +
          '(`npm run qa:seed baseline`) instead of mutating a row that is not there.',
      );
    }
    if (!(cell.column in rows[0])) {
      throw new Error(`[QA FIXTURE] ${sharedCellLabel(cell)}: the read did not return the column`);
    }
    const value = rows[0][cell.column];
    captured.push({
      ...cell,
      value: (value ?? null) as CapturedSharedCell['value'],
    });
  }
  return captured;
}

/**
 * The statements that put every captured cell back, in capture order.
 *
 * One statement per cell, each addressed by the row's own id, so a restore cannot widen to a table,
 * a tenant or a lane. Values keep their type: a number is written bare, a string quoted with its
 * quotes escaped, NULL written as NULL — a restore that stringified everything would corrupt a
 * numeric column on the way back.
 */
export function restorationStatements(captured: readonly CapturedSharedCell[]): string[] {
  return captured.map((cell) => {
    assertCellRef(cell);
    return `UPDATE ${cell.table} SET ${cell.column} = ${literal(cell.value)} WHERE id = '${cell.id}'`;
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Run `body`, then `restore`, and report both failures if both fail.
 *
 * @param label what is being restored, phrased so a log line says which shared row was left dirty
 * @param restore the statement that puts the row back; may not be skipped
 * @param body the test's own steps
 */
export async function withSharedRowRestore<T>(
  label: string,
  restore: () => Promise<void>,
  body: () => Promise<T>,
): Promise<T> {
  let bodyFailed = false;
  let bodyError: unknown;
  let value: T | undefined;

  try {
    value = await body();
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }

  let restoreFailed = false;
  let restoreError: unknown;
  try {
    await restore();
  } catch (error) {
    restoreFailed = true;
    restoreError = error;
  }

  if (restoreFailed) {
    const both = bodyFailed
      ? `\n  the test had ALSO failed, and this restore error must not hide it:\n  test: ${messageOf(bodyError)}`
      : '';
    throw new Error(
      `[QA FIXTURE] ${label}: the restore failed, so the shared row is still modified — fix this ` +
        `before reading any failure as a product result.\n  restore: ${messageOf(restoreError)}${both}`,
    );
  }

  if (bodyFailed) {
    // Rethrow the original, not a wrapper: the failure a reader sees must be the failure that happened.
    throw bodyError;
  }

  return value as T;
}
