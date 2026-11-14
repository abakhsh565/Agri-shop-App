/**
 * EC3 / EC6 guard — a shared row that is written must be put back, and a cleanup that failed must say so.
 *
 * WHY THIS FILE EXISTS (Phase-3 exit criteria EC3 and EC6)
 *   Two defects wore the same costume: a guarantee whose failure was invisible.
 *
 *   EC3 — a lane that mutates a SHARED baseline row and restores it as the last line of the test body
 *   leaves the row modified exactly when the run is red. Measured today, before this guard existed:
 *   `voidSaleSafety` decremented QA Variant A's stock and let the void put it back, so a failing
 *   assertion above the void left 98 for every lane that followed; `retryAfterTimeout` and
 *   `doubleTapSafety` moved QA Customer A's money columns and QA Supplier A's payable and never
 *   restored them; `actionCenter` restored QA Customer C's credit limit as the final statement of the
 *   test, which the failure of an earlier signal assertion skips.
 *
 *   EC6 — a cleanup that swallows its error reports clean while dirty. `.catch(() => undefined)` and
 *   `try { … } catch {}` around a DELETE or UPDATE turn "the row survived" into "nothing to see", and
 *   the next run then reads this lane's leftovers as the fixture. The named teardown paths in
 *   `destructiveSafety`, `createOnceSafety`, `duplicateActionSafety`, `creditRequest` and
 *   `sessionRefresh` all did this.
 *
 * WHAT IS ASSERTED HERE
 *   1. the two runners behave: `runCleanupStatements` attempts every statement, keeps every failure
 *      and names each one; `runTeardownSteps` runs every step in order, attempts the later ones after a
 *      failure, and reports each failure with its step label;
 *   2. no failure of a statement that names a shared identity is discarded anywhere in
 *      `tests/e2e` or `tests/integration` — no exceptions: the two remaining offenders this guard
 *      found on its first run (`marketplaceListing`'s shop/branch reset and `roleInUseDeletion`'s
 *      role restore) were converted rather than exempted;
 *   3. no E2E lane UPDATEs a shared fixture row without capturing it first (`captureSharedCells`), so
 *      a lane that starts writing a shared cell has to say where its original value came from;
 *   4. the nine audited files still hold the fix: the four converted lanes capture and restore through
 *      the teardown, `sessionRefresh` restores its captured row and reads its branch deletion back,
 *      and the five teardown paths go through `runCleanupStatements`;
 *   5. each detector is shown to fire on the shape it exists to catch — a passing run cannot be an
 *      empty scan.
 *
 * WHAT IS NOT CLAIMED
 *   Static evidence only: nothing here runs a browser or a database. Files outside `tests/`
 *   (`scripts/`, workflows) are not in scope, and the integration lane's own reseeding
 *   (`setupAllFixtures`) is a *restore by declaration*, not a captured restore — the two are
 *   deliberately different mechanisms and this guard pins only the second.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runCleanupStatements, runTeardownSteps } from '../setup/ownedCleanup';
import { QA_FIXTURE_IDS } from '../setup/qa-fixtures';

// ── the detectors ────────────────────────────────────────────────────────────────────────────────

/** Comments explain old defects in prose; a sentence cannot write a row or swallow an error. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\*.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

/** The shared identities as a file names them: the constant, or the uuid inlined. */
const SHARED_TOKENS: readonly string[] = [
  ...Object.keys(QA_FIXTURE_IDS).map((name) => `QA_IDS.${name}`),
  ...Object.keys(QA_FIXTURE_IDS).map((name) => `QA_FIXTURE_IDS.${name}`),
  ...Object.values(QA_FIXTURE_IDS),
];

/** The two ways a failure is discarded without a word: an arrow that returns nothing, or `catch {}`. */
const SWALLOWED_ARROW =
  /\.catch\s*\(\s*\(\s*[A-Za-z_]*\s*\)\s*=>\s*(?:undefined|null|void\s+0|\{\s*\}|''|""|false|\[\])\s*\)/g;
const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[^*]*\*\/\s*|\/\/[^\n]*\s*)?\}/g;

/** The last statement verb before a swallow site — where the discarded mutation starts. */
const VERB = /(?:\bUPDATE\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b)/gi;

/**
 * Every mutating statement whose failure is discarded, as `{ statement }`, for the statements that
 * name a shared identity.
 *
 * The statement is taken from the last mutation verb before the swallow to the swallow itself: that is
 * the text whose table and WHERE clause decide whether a shared row is involved. A verb more than 260
 * characters earlier belongs to a different statement and is not this one.
 */
function swallowedSharedMutations(source: string): string[] {
  const stripped = stripComments(source);
  const found: string[] = [];

  for (const pattern of [SWALLOWED_ARROW, EMPTY_CATCH]) {
    for (const match of stripped.matchAll(pattern)) {
      const window = stripped.slice(Math.max(0, (match.index ?? 0) - 400), match.index);
      let last: RegExpMatchArray | null = null;
      for (const verb of window.matchAll(VERB)) last = verb;
      if (!last) continue;
      const statement = window.slice(last.index).replace(/\s+/g, ' ').trim();
      if (statement.length > 260) continue;
      if (SHARED_TOKENS.some((token) => statement.includes(token))) found.push(statement);
    }
  }
  return found;
}

/** Every `UPDATE <table> …` in a file whose statement names a shared identity. */
function sharedRowUpdates(source: string): string[] {
  const stripped = stripComments(source);
  const found: string[] = [];
  for (const match of stripped.matchAll(/UPDATE\s+([a-z_]+)/gi)) {
    const rest = stripped.slice(match.index ?? 0);
    const stop = rest.search(/[`;]/);
    const statement = rest.slice(0, stop === -1 ? 300 : stop);
    const token = SHARED_TOKENS.find((t) => statement.includes(t));
    if (token) found.push(`UPDATE ${match[1]} (${token})`);
  }
  return found;
}

/** Files whose failures of a RUNNER are discarded — the cleanup primitive must never be `.catch`-ed. */
function swallowedRunner(source: string): string[] {
  const stripped = stripComments(source);
  const found: string[] = [];
  for (const match of stripped.matchAll(/run(?:CleanupStatements|TeardownSteps)\s*\(/g)) {
    const after = stripped.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + 700);
    if (/\)\s*\.catch\s*\(/.test(after)) found.push(match[0].trim());
  }
  return found;
}

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

function filesIn(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `${dir}/${file}`);
}

const SCANNED = [...filesIn('tests/e2e'), ...filesIn('tests/integration')];

/**
 * E2E lanes that write a shared row without capturing it first, with the reviewed reason. The count
 * assertion below keeps this honest in both directions: an entry that stops writing must be deleted,
 * and a new writer must either capture or argue its case here.
 */
const REMAINING_UNCAPPED: Record<string, string> = {
  'tests/e2e/marketplaceListing.spec.ts':
    'resets the shared shop/branch marketplace state to the spec’s own declared contract instead of a capture',
  'tests/e2e/roleInUseDeletion.spec.ts':
    'restores captured roles in afterAll; it needs the runner, not the cell capture',
};

const AUDITED_LANES = [
  'tests/e2e/voidSaleSafety.spec.ts',
  'tests/e2e/retryAfterTimeout.spec.ts',
  'tests/e2e/doubleTapSafety.spec.ts',
  'tests/e2e/actionCenter.spec.ts',
];

/** The two files the scan found after the named paths were converted, now converted too. */
const CONVERTED_SCANS = ['tests/e2e/sessionRefresh.spec.ts', 'tests/e2e/marketplaceListing.spec.ts', 'tests/e2e/roleInUseDeletion.spec.ts'];

const AUDITED_TEARDOWNS = [
  'tests/integration/destructiveSafety.test.ts',
  'tests/integration/createOnceSafety.test.ts',
  'tests/integration/duplicateActionSafety.test.ts',
  'tests/integration/creditRequest.test.ts',
  'tests/integration/saleIdempotency.test.ts',
];

// ── the runners ──────────────────────────────────────────────────────────────────────────────────

describe('cleanup failures are collected and reported, not swallowed', () => {
  test('runs every statement, in order, and reports each failure by its statement', async () => {
    const ran: string[] = [];

    const thrown = await runCleanupStatements(
      async (sql) => {
        ran.push(sql);
        if (sql.includes('blocked')) throw new Error('update or delete violates foreign key constraint');
      },
      ['DELETE FROM a WHERE id = 1', 'DELETE FROM blocked WHERE id = 2', 'DELETE FROM c WHERE id = 3'],
      'unit-test cleanup',
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(ran, 'a failure must not cancel the statements after it').toEqual([
      'DELETE FROM a WHERE id = 1',
      'DELETE FROM blocked WHERE id = 2',
      'DELETE FROM c WHERE id = 3',
    ]);
    expect(thrown, 'a failed statement must fail the cleanup').not.toBeNull();
    expect(thrown!.message).toContain('unit-test cleanup');
    expect(thrown!.message, 'the count is the report').toContain('1 of 3 statement(s) failed');
    expect(thrown!.message, 'the affected record is named').toContain('DELETE FROM blocked');
    expect(thrown!.message).toContain('foreign key constraint');
  });

  test('reports EVERY failure, not just the first', async () => {
    const thrown = await runCleanupStatements(
      async (sql) => {
        throw new Error(`${sql} refused`);
      },
      ['DELETE FROM a WHERE id = 1', 'DELETE FROM b WHERE id = 2'],
      'unit-test cleanup',
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown!.message).toContain('2 of 2 statement(s) failed');
    expect(thrown!.message).toContain('DELETE FROM a');
    expect(thrown!.message).toContain('DELETE FROM b');
  });

  test('is silent when every statement succeeds — and that is the only silence', async () => {
    await expect(
      runCleanupStatements(async () => undefined, ['DELETE FROM a WHERE id = 1'], 'unit-test cleanup'),
    ).resolves.toBeUndefined();
    await expect(runCleanupStatements(async () => undefined, [], 'nothing to do')).resolves.toBeUndefined();
  });

  test('the swallowing version reports nothing — which is why the collector exists', async () => {
    const statements = ['DELETE FROM a WHERE id = 1', 'DELETE FROM b WHERE id = 2'];
    const swallow = async (run: (sql: string) => Promise<unknown>) => {
      for (const statement of statements) {
        try {
          await run(statement);
        } catch {
          /* the shape this guard forbids */
        }
      }
      return [];
    };

    const swallowed = await swallow(async () => {
      throw new Error('permission denied');
    });
    expect(swallowed, 'the old shape cannot report a failure').toEqual([]);

    const collected = await runCleanupStatements(
      async () => {
        throw new Error('permission denied');
      },
      statements,
      'unit-test cleanup',
    ).then(
      () => [],
      (error: unknown) => [(error as Error).message],
    );
    expect(collected, 'the same input through the collector is a report').toHaveLength(1);
    expect(collected[0]).toContain('2 of 2');
  });

  test('a teardown runs every step in order, and later steps survive an earlier failure', async () => {
    const order: string[] = [];
    const thrown = await runTeardownSteps([
      { label: 'restore the captured cells', run: async () => { order.push('restore'); } },
      { label: 'restore the failed one', run: async () => { order.push('broken'); throw new Error('permission denied'); } },
      { label: 'remove the rows this run owns', run: async () => { order.push('cleanup'); } },
    ]).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(order, 'a failed restore must not skip the lane’s own cleanup').toEqual([
      'restore',
      'broken',
      'cleanup',
    ]);
    expect(thrown!.message).toContain('1 of 3 teardown step(s) failed');
    expect(thrown!.message, 'the step is named').toContain('restore the failed one');
    expect(thrown!.message, 'the cause survives').toContain('permission denied');
  });

  test('a teardown with two failures reports both, each with its own step', async () => {
    const thrown = await runTeardownSteps([
      { label: 'restore', run: async () => { throw new Error('the row is gone'); } },
      { label: 'cleanup', run: async () => { throw new Error('fk violation'); } },
    ]).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown!.message).toContain('2 of 2 teardown step(s) failed');
    expect(thrown!.message).toContain('restore: the row is gone');
    expect(thrown!.message).toContain('cleanup: fk violation');
  });

  test('a teardown where every step succeeds says nothing', async () => {
    const done: string[] = [];
    await expect(
      runTeardownSteps([
        { label: 'restore', run: async () => { done.push('restore'); } },
        { label: 'cleanup', run: async () => { done.push('cleanup'); } },
      ]),
    ).resolves.toBeUndefined();
    expect(done).toEqual(['restore', 'cleanup']);
  });
});

// ── the static rules ─────────────────────────────────────────────────────────────────────────────

describe('no shared-row failure is discarded anywhere in the suites', () => {
  test('no statement naming a shared identity discards its failure', () => {
    const found: Record<string, string[]> = {};
    for (const file of SCANNED) {
      const hits = swallowedSharedMutations(read(file));
      if (hits.length) found[file] = hits;
    }

    expect(
      found,
      'a shared-row statement whose failure is discarded leaves the row modified with no report — ' +
        'pass the statements to `runCleanupStatements` instead, or restore through `runTeardownSteps`',
    ).toEqual({});
  });

  test('the eleven audited files swallow nothing at all', () => {
    for (const file of [...AUDITED_LANES, ...AUDITED_TEARDOWNS, ...CONVERTED_SCANS]) {
      expect(swallowedSharedMutations(read(file)), `${file} still discards a failure`).toEqual([]);
    }
  });

  test('a runner is never `.catch`-ed, in either suite', () => {
    for (const file of SCANNED) {
      expect(swallowedRunner(read(file)), `${file} discards the runner's own failure`).toEqual([]);
    }
    // Non-vacuity: the detector sees the shape it forbids.
    expect(swallowedRunner('await runCleanupStatements(execSql, [], "x").catch(() => undefined);')).toHaveLength(1);
  });

  test('the detector is not vacuous, and a scoped statement with a real report is not an offender', () => {
    const swallowed =
      'await execSql(`UPDATE customers SET total_paid = 0 WHERE id = \'${QA_IDS.customerA}\'`).catch(() => undefined);';
    expect(swallowedSharedMutations(swallowed)).toHaveLength(1);

    // An UPDATE, not a DELETE: this file must not contain a shared-identity delete sample, because
    // `integrationCleanupOwnership` scans for exactly that shape and would have to exempt this file.
    const empty = 'try { await admin(`UPDATE sales SET notes = null WHERE customer_id = \'${QA_IDS.customerA}\'`); } catch {}';
    expect(swallowedSharedMutations(empty)).toHaveLength(1);

    // …and the fixed shapes are not offenders: a collected statement, and a lane's own row.
    expect(
      swallowedSharedMutations(
        'await runCleanupStatements(execSql, [`UPDATE customers SET total_paid = 0 WHERE id = \'${QA_IDS.customerA}\'`], "restore");',
      ),
    ).toEqual([]);
    expect(
      swallowedSharedMutations(
        'await execSql(`UPDATE customers SET total_paid = 0 WHERE id = \'d9000000-0000-0000-0000-0000000000c1\'`).catch(() => undefined);',
      ),
    ).toEqual([]);
    // A comment quoting the old shape is not a statement.
    expect(
      swallowedSharedMutations("// it used to run `.catch(() => undefined)` on QA_IDS.customerA"),
    ).toEqual([]);
  });
});

describe('a lane that writes a shared row captures it first', () => {
  test('every shared-row UPDATE is either captured or a reviewed residual', () => {
    const found: Record<string, string[]> = {};
    for (const file of filesIn('tests/e2e')) {
      const updates = sharedRowUpdates(read(file));
      if (updates.length && !read(file).includes('captureSharedCells(')) found[file] = updates;
    }

    expect(
      Object.keys(found).sort(),
      'a lane wrote a shared fixture row without capturing its previous value, so nothing can restore ' +
        'it: read the cell with `captureSharedCells` before the first write and restore it in afterAll',
    ).toEqual(Object.keys(REMAINING_UNCAPPED).sort());

    for (const file of Object.keys(REMAINING_UNCAPPED)) {
      expect(sharedRowUpdates(read(file)).length, `${file} no longer writes a shared row — drop its entry`).toBeGreaterThan(0);
    }
  });

  test('the detector is not vacuous', () => {
    const uncaptured = 'await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = \'${QA_IDS.variantA}\'`);';
    expect(sharedRowUpdates(uncaptured)).toEqual(['UPDATE product_variants (QA_IDS.variantA)']);

    const ownRow = 'await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = \'c4000000-0000-0000-0000-0000000000d2\'`);';
    expect(sharedRowUpdates(ownRow)).toEqual([]);
    // A shared id used as a FILTER for a lane's own rows is still a write to a shared row's table, so
    // it is reported: `WHERE shop_id = QA_IDS.shop` would rewrite other lanes' rows.
    expect(sharedRowUpdates('await execSql(`UPDATE notifications SET read = true WHERE shop_id = \'${QA_IDS.shop}\'`);')).toHaveLength(1);
  });

  test('the four converted lanes capture, restore, and report through the teardown', () => {
    for (const file of AUDITED_LANES) {
      const code = read(file);
      expect(code, `${file} must capture the cells it writes`).toContain('captureSharedCells(');
      expect(code, `${file} must restore from the capture`).toContain('restorationStatements(');
      expect(code, `${file} must run the restore in the guaranteed teardown`).toContain('runTeardownSteps(');
    }
  });

  test('adminFullAccess restores the shared admin’s name through the wrapper', () => {
    // This lane names the row by PHONE, not by a `QA_IDS` constant, so the token scan above cannot
    // see it: it is pinned here instead. The capture and the restore are one call, which is the
    // whole point — the row is the QA Admin every other lane signs in as.
    const code = read('tests/e2e/adminFullAccess.spec.ts');
    expect(code, 'the name edit must be captured and restored around the body').toContain('withSharedRowRestore(');
    expect(code, 'the captured value must be what is restored').toContain('${before.replace(');
  });

  test('the two residual lanes report their shared-row writes through the runners', () => {
    for (const file of ['tests/e2e/marketplaceListing.spec.ts', 'tests/e2e/roleInUseDeletion.spec.ts']) {
      const code = read(file);
      expect(code, `${file} must report its shared-row restore`).toContain('runCleanupStatements(');
    }
    expect(read('tests/e2e/marketplaceListing.spec.ts'), 'the reset still runs after the registry step').toContain(
      'runTeardownSteps(',
    );
  });

  test('sessionRefresh restores its captured row and reads its branch deletion back', () => {
    const code = read('tests/e2e/sessionRefresh.spec.ts');
    expect(code, 'the active branch is captured before the lane writes it').toContain('originalActiveBranch');
    expect(code, 'the restore goes through the reporting runner').toContain('sessionRefresh active-branch restore');
    expect(code, 'the branch delete is reported, not swallowed').toContain('sessionRefresh branch cleanup');
    expect(code, 'a leftover branch must fail the run').toMatch(/left branch \$\{extraBranchId\} behind/);
  });

  test('the teardown paths run their statements through the reporting runner', () => {
    for (const file of AUDITED_TEARDOWNS) {
      const code = read(file);
      expect(code, `${file} must report its cleanup failures`).toContain('runCleanupStatements(');
      expect(code, `${file} must not swallow a delete`).not.toMatch(
        /(?:DELETE|UPDATE)[\s\S]{0,400}?\)\s*\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\}|\s*)\s*\)/,
      );
    }
  });
});
