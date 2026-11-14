/**
 * `withSharedRowRestore` — the failure paths, proved without a browser or a database.
 *
 * WHY THESE CASES. The defect it closes was not "no restore"; it was "restore only on the happy path".
 * A test that asserts before the restore line leaves a shared row modified exactly when the run is
 * already red — which is when nobody is looking at fixture hygiene. So the cases that matter are the
 * ones where the BODY fails, and they are asserted here by driving the helper directly.
 *
 * The second half is about not hiding the reason a run failed: a restore error must be reported, but
 * the original test error must survive it with its message and identity intact.
 */
import { describe, expect, test } from 'vitest';
import {
  captureSharedCells,
  restorationStatements,
  sharedCellLabel,
  withSharedRowRestore,
  type SharedCellRef,
} from '../e2e/sharedRowRestore';
import { QA_FIXTURE_IDS } from '../setup/qa-fixtures';

/** The shared cells the lanes under test mutate, by the fixture ids those lanes use. */
const VARIANT_CELL: SharedCellRef = {
  table: 'product_variants',
  column: 'stock_qty',
  id: QA_FIXTURE_IDS.variantA,
};
const CUSTOMER_CELL: SharedCellRef = {
  table: 'customers',
  column: 'outstanding_balance',
  id: QA_FIXTURE_IDS.customerA,
};

describe('a shared fixture row is restored whatever the test body did', () => {
  test('restores after a passing body and returns its value', async () => {
    const steps: string[] = [];

    const value = await withSharedRowRestore(
      'users.name',
      async () => {
        steps.push('restore');
      },
      async () => {
        steps.push('body');
        return { ok: true };
      },
    );

    expect(value).toEqual({ ok: true });
    expect(steps, 'the restore must run after the body, not instead of it').toEqual(['body', 'restore']);
  });

  test('restores when the body throws, and rethrows the original error unchanged', async () => {
    let restored = false;
    const failure = new Error('the saved name did not survive a reload');

    const thrown = await withSharedRowRestore(
      'users.name for 923009999999',
      async () => {
        restored = true;
      },
      async () => {
        throw failure;
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(restored, 'a failing assertion must not skip the restore').toBe(true);
    expect(
      thrown,
      'the reported failure must be the one that happened, not a wrapper about it',
    ).toBe(failure);
  });

  test('reports a failed restore even though the body passed — the row is still modified', async () => {
    const thrown = await withSharedRowRestore(
      'users.name for 923009999999',
      async () => {
        throw new Error('connection terminated unexpectedly');
      },
      async () => undefined,
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown, 'a restore that failed must fail the test').not.toBeNull();
    expect(thrown!.message).toMatch(/\[QA FIXTURE\]/);
    expect(thrown!.message).toContain('users.name for 923009999999');
    expect(thrown!.message).toContain('connection terminated unexpectedly');
    expect(thrown!.message, 'a passing test must not be blamed for the restore').not.toMatch(/ALSO failed/);
  });

  test('keeps BOTH failures when the body and the restore fail', async () => {
    const thrown = await withSharedRowRestore(
      'users.name for 923009999999',
      async () => {
        throw new Error('permission denied for table users');
      },
      async () => {
        throw new Error('the saved name did not survive a reload');
      },
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('permission denied for table users');
    expect(
      thrown!.message,
      'the original failure must still be readable — otherwise a fixture problem is misdiagnosed as a product bug',
    ).toContain('the saved name did not survive a reload');
    expect(thrown!.message).toMatch(/must not hide it/);
  });

  test('a restore built from an EMPTY capture writes nothing, not a default', () => {
    // The state a lane is in when its `beforeAll` failed before the capture line: there is no captured
    // value, so there is nothing to put back — and an empty statement list is how that is expressed.
    // The dangerous alternative is a restore that "repairs" the row to a hard-coded number, which
    // would overwrite the fixture with this lane's idea of it: the defect the capture exists to stop.
    expect(restorationStatements([])).toEqual([]);
  });

  test('attempts no restore when the body is never reached? — it always is', async () => {
    // Documents the contract rather than a branch: the helper calls the body first, unconditionally,
    // and there is no path where the restore is skipped. A body that throws synchronously lands in the
    // same catch as one that rejects.
    let restored = false;
    const thrown = await withSharedRowRestore(
      'users.first_login_at',
      async () => {
        restored = true;
      },
      async () => {
        throw new Error('sync throw');
      },
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown!.message).toBe('sync throw');
    expect(restored).toBe(true);
  });
});

describe('a shared cell is captured before it is written, and restored from the capture', () => {
  test('reads the current value of each cell, addressed by the row own id', async () => {
    const asked: string[] = [];
    const rows = [{ stock_qty: 97, outstanding_balance: 12000 }];
    const captured = await captureSharedCells(
      async (sql) => {
        asked.push(sql);
        return rows;
      },
      [VARIANT_CELL, CUSTOMER_CELL],
    );

    expect(asked, 'one read per cell, keyed on the row own id').toEqual([
      `SELECT stock_qty FROM product_variants WHERE id = '${QA_FIXTURE_IDS.variantA}'`,
      `SELECT outstanding_balance FROM customers WHERE id = '${QA_FIXTURE_IDS.customerA}'`,
    ]);
    expect(captured).toEqual([
      { ...VARIANT_CELL, value: 97 },
      { ...CUSTOMER_CELL, value: 12000 },
    ]);
    // What the restore writes is a function of the capture, not of a constant in the spec.
    expect(restorationStatements(captured).join('\n')).toContain('stock_qty = 97');
  });

  test('refuses to capture from a row that is not there, instead of capturing nothing', async () => {
    await expect(captureSharedCells(async () => [], [VARIANT_CELL])).rejects.toThrow(
      /expected exactly one shared row to capture, found 0/,
    );
    await expect(captureSharedCells(async () => [{}, {}], [VARIANT_CELL])).rejects.toThrow(/found 2/);
  });

  test('refuses a read that did not return the column', async () => {
    await expect(captureSharedCells(async () => [{ n: 1 }], [VARIANT_CELL])).rejects.toThrow(
      /did not return the column/,
    );
  });

  test('refuses a table, column or id it cannot prove is a plain reference', async () => {
    const notRefs: SharedCellRef[] = [
      { ...VARIANT_CELL, table: '${table}' },
      { ...VARIANT_CELL, column: 'stock_qty = 1, note' },
      { ...VARIANT_CELL, column: 'stock_qty; DELETE FROM sales' },
      { ...VARIANT_CELL, id: '${rowIds}' },
      { ...VARIANT_CELL, id: "x' OR '1'='1" },
      { ...VARIANT_CELL, id: 'all' },
    ];
    for (const cell of notRefs) {
      await expect(
        captureSharedCells(async () => [{}], [cell]),
        JSON.stringify(cell),
      ).rejects.toThrow(/refusing/);
      // …and the restore builder refuses the same reference, so a hand-built capture cannot slip past.
      expect(() => restorationStatements([{ ...cell, value: 1 }])).toThrow(/refusing/);
    }
  });

  test('restores the captured value with its type intact, escaped where it is text', () => {
    const statements = restorationStatements([
      { table: 'customers', column: 'outstanding_balance', id: QA_FIXTURE_IDS.customerA, value: 30000 },
      { table: 'users', column: 'name', id: QA_FIXTURE_IDS.admin, value: "QA Admin's" },
      { table: 'products', column: 'deleted_at', id: QA_FIXTURE_IDS.productA, value: null },
      { table: 'products', column: 'is_active', id: QA_FIXTURE_IDS.productA, value: false },
    ]);

    expect(statements).toEqual([
      `UPDATE customers SET outstanding_balance = 30000 WHERE id = '${QA_FIXTURE_IDS.customerA}'`,
      `UPDATE users SET name = 'QA Admin''s' WHERE id = '${QA_FIXTURE_IDS.admin}'`,
      `UPDATE products SET deleted_at = NULL WHERE id = '${QA_FIXTURE_IDS.productA}'`,
      `UPDATE products SET is_active = FALSE WHERE id = '${QA_FIXTURE_IDS.productA}'`,
    ]);
    // Non-vacuity for the escaping: the same value written unescaped would end the literal early.
    const single = restorationStatements([
      { table: 'users', column: 'name', id: QA_FIXTURE_IDS.admin, value: "a'b" },
    ]);
    expect(single[0]).not.toContain("= 'a'b'");
  });

  test('names the cell it is about, which is what a failure report has to say', () => {
    expect(sharedCellLabel(VARIANT_CELL)).toBe(
      `product_variants.stock_qty for ${QA_FIXTURE_IDS.variantA}`,
    );
  });

  test('a failing body is still reported as itself when the restore from a capture also fails', async () => {
    const captured = await captureSharedCells(async () => [{ stock_qty: 100 }], [VARIANT_CELL]);
    const statements = restorationStatements(captured);
    expect(statements).toHaveLength(1);

    const thrown = await withSharedRowRestore(
      sharedCellLabel(VARIANT_CELL),
      async () => {
        throw new Error(`execSql: ${statements[0]} failed`);
      },
      async () => {
        throw new Error('the void button did not appear');
      },
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown!.message, 'the reason the test failed must survive a restore failure').toContain(
      'the void button did not appear',
    );
    expect(thrown!.message).toContain(sharedCellLabel(VARIANT_CELL));
    expect(thrown!.message).toContain('must not hide it');
  });
});
