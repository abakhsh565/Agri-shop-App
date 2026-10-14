/**
 * Vitest globalSetup — cleans QA database AFTER all tests complete.
 * 
 * The setup() function runs before all tests (no-op).
 * The teardown function runs after all tests — cleans ALL business/test data.
 */

import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Load .env.qa into process.env. QA credentials live in that untracked file
 * (and in CI secrets) — never in source, so this file must not carry a fallback.
 */
function loadQaEnv() {
  if (process.env.QA_DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.qa');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadQaEnv();

/** QA connection, built from environment (.env.qa or CI secrets) only. */
function qaDatabaseUrl(): string {
  const explicit = process.env.QA_DATABASE_URL;
  if (explicit) return explicit;
  const { QA_DB_USER, QA_DB_PASS, QA_DB_HOST } = process.env;
  if (!QA_DB_USER || !QA_DB_PASS || !QA_DB_HOST) return '';
  return `postgresql://${QA_DB_USER}:${QA_DB_PASS}@${QA_DB_HOST}:5432/postgres`;
}

// MUST match KEEP_PHONES in scripts/clean-test-data.mjs (the canonical list).
//
// WHY THIS IS NOT COSMETIC: a QA account's Supabase Auth credential lives in
// auth.users, and deleting the users row deletes the credential. The app cannot
// re-create it on its own (signUp yields no session until the email is confirmed),
// so the next sign-in fails with "could not start a secure session" — the QA admin
// and employee become unloginable by hand until some Playwright spec happens to
// re-seed them. This list held only 2 of the 4 fixture phones, so EVERY vitest run
// silently deleted QA Admin (923009999999) and QA Employee (923008888888).
// tests/unit/qaFixtureKeepList.test.ts now fails if the two lists ever drift apart
// again.
const KEEP_PHONES = ['923001234567', '923001122334', '923009999999', '923008888888'];

/** The only project this teardown may delete from. Must match environments.json / lib.mjs. */
const QA_PROJECT_REF = 'bpybjrjenwccowvtrevu';

export async function setup() {
  // No-op before tests
}

export async function teardown() {
  // ── Cleaning is OPT-IN, and that is the fix for a real complaint ────────────
  //
  // This used to wipe every business row in QA after every vitest run. Hand-built
  // test data — a shop with customers, a few sales to look at — was gone the next
  // time anyone ran a test file, so the work had to be entered again and again just
  // to look at a screen. Nobody asked for that: a test author wants the database
  // clean, a person poking at the app wants their data kept.
  //
  // So the default is now to leave QA exactly as it is found, and cleaning happens
  // only when it is asked for:
  //
  //     QA_CLEAN_AFTER_RUN=1 npx vitest run
  //     node scripts/clean-test-data.mjs        # or explicitly, on its own
  //
  // What is NOT optional is the line printed at the end. Silence was the other half
  // of this bug: a run must say plainly whether it deleted anything, so nobody has to
  // guess where their rows went.
  if (process.env.QA_CLEAN_AFTER_RUN !== '1') {
    console.log('[QA Cleanup] skipped — QA data left untouched. Set QA_CLEAN_AFTER_RUN=1 to delete test rows after the run.');
    return;
  }

  // Only clean if QA env is configured
  const databaseUrl = qaDatabaseUrl();
  if (!databaseUrl) {
    console.log('[QA Cleanup] skipped — QA database credentials are not configured');
    return;
  }

  // REFUSE ANY TARGET THAT IS NOT QA — the same refusal `scripts/clean-test-data.mjs` performs.
  //
  // This teardown deletes every row of 34 tables. It read its URL from the environment and checked
  // nothing about where that URL pointed, so a stray `QA_DATABASE_URL` (or a prod DB_HOST exported
  // into the shell) was one `QA_CLEAN_AFTER_RUN=1` away from emptying a hosted project. The sibling
  // script has refused a non-QA target for exactly this reason; a cleaner that cannot name its
  // target is the bug the targeting work was about.
  const targetRef = (() => {
    try {
      const user = decodeURIComponent(new URL(databaseUrl).username || '');
      // Supabase pooler users look like `postgres.<project-ref>`.
      return user.split('.')[1] ?? '';
    } catch {
      return '';
    }
  })();
  if (targetRef !== QA_PROJECT_REF) {
    throw new Error(
      `[QA Cleanup] refusing to run: the configured database is project "${targetRef || '(none)'}", ` +
        `not the QA project ${QA_PROJECT_REF}. Point QA_DATABASE_URL at QA, or clean it with ` +
        '`node scripts/clean-test-data.mjs` (which performs the same refusal).',
    );
  }

  /**
   * THE SECOND DOOR, CLOSED (2026-10-14).
   *
   * This teardown is the other implementation of the same destruction: `DELETE FROM <table>` over every
   * business table, plus every user outside the four keep-phones. Running the integration lane as
   * `QA_CLEAN_AFTER_RUN=1 npx vitest run tests/integration/` reached it, and it destroyed the reviewed
   * QA baseline — the hand-entered 2026-10-11/12 rows, the 2026-10-06 registration request, the
   * non-fixture accounts and most of `audit_events`. None of it was recoverable; the newest dump of this
   * project predates the schema this database has migrated past, and `scripts/dev/qa-baseline.json` had
   * to be re-reviewed against the fixture floor that remained.
   *
   * The declaration is the review that says which rows are real, so it decides here: while it expects
   * ANY rows, this teardown skips the destruction and says so. Erasing a reviewed baseline is a decision,
   * not a side effect of one environment variable — `QA_ALLOW_DESTROYING_BASELINE=1` makes it explicit.
   */
  function declarationExpectsRows(): string[] {
    if (process.env.QA_ALLOW_DESTROYING_BASELINE === '1') return [];
    try {
      const declaration = JSON.parse(fs.readFileSync('scripts/dev/qa-baseline.json', 'utf8'));
      return Object.entries(declaration.policies ?? {})
        .filter(([, rule]: [string, any]) => rule.policy === 'exact' && Number(rule.expected) > 0)
        .map(([table, rule]: [string, any]) => `${table} (declared ${rule.expected})`);
    } catch {
      return ['scripts/dev/qa-baseline.json could not be read, so what would be destroyed is unknown'];
    }
  }

  const expectedRows = declarationExpectsRows();
  if (expectedRows.length) {
    console.log(
      '[QA Cleanup] REFUSED — the reviewed declaration expects rows in: ' +
        expectedRows.join(', ') +
        '. Nothing was deleted. Review drift with `node scripts/dev/qa-prune-excess.mjs`, or set ' +
        'QA_ALLOW_DESTROYING_BASELINE=1 if erasing those rows is really intended.',
    );
    return;
  }

  try {
    const c = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await c.connect();
    
    // ORDER IS LOAD-BEARING — child tables first, and this list is the one that
    // used to be wrong. It deleted `sales` BEFORE `voids`/`returns`, which raises a
    // foreign-key error (voids.sale_id -> sales.id), and it omitted purchases,
    // supplier_payments, payments and drafts entirely. Every error was swallowed by
    // `catch {}` and the teardown then printed "Database cleaned after test run"
    // unconditionally — so a run finished "clean" while 11 customers and 7 sales
    // were still in QA, which is the data users kept seeing in a fresh install.
    // Keep this in the same order as scripts/clean-test-data.mjs.
    const tables = [
      'return_items', 'returns', 'sale_returns', 'voids',
      'sale_items', 'sales',
      'purchase_items', 'supplier_payments', 'purchases',
      'customer_payments', 'payments', 'credit_limit_requests', 'customer_crops',
      'inventory_movements', 'stock_adjustments',
      'product_variants', 'products',
      'companies', 'customers',
      'shop_requests',
      'cash_reconciliations', 'daily_cash_reconciliations',
      'activity_log', 'audit_events',
      'notifications',
      'reminder_logs', 'reminder_occurrences', 'reminder_configs',
      'price_history',
      'agent_tasks', 'agent_attempts',
      'incident_reports',
      'drafts',
    ];
    
    const failures: string[] = [];
    for (const table of tables) {
      try {
        await c.query(`DELETE FROM ${table}`);
      } catch (e: unknown) {
        // 42P01 = table does not exist. Anything else is a real gap (usually a
        // missing table holding a blocking FK) and must never be swallowed.
        const code = (e as { code?: string }).code;
        if (code !== '42P01') failures.push(`${table}: ${(e as Error).message}`);
      }
    }
    
    // Remove test users (keep seed accounts). Failures are COLLECTED, never swallowed: a user
    // deletion that silently failed leaves an account behind that the next run then trips over.
    try {
      await c.query(`DELETE FROM users WHERE phone NOT IN ('${KEEP_PHONES.join("','")}')`);
    } catch (e: unknown) {
      failures.push(`users (non-fixture): ${(e as Error).message}`);
    }
    
    // Remove orphaned auth.users
    try {
      const appUsers = await c.query('SELECT id FROM users');
      const keepIds = new Set(appUsers.rows.map(r => r.id));
      const authUsers = await c.query('SELECT id FROM auth.users');
      for (const au of authUsers.rows) {
        if (!keepIds.has(au.id)) {
          await c.query('DELETE FROM auth.users WHERE id = $1', [au.id]);
        }
      }
    } catch (e: unknown) {
      failures.push(`auth.users (orphans): ${(e as Error).message}`);
    }
    
    // Verify instead of assuming: report the true post-run state, and be loud when
    // business rows survived. A silent "cleaned" here is worse than a failing run,
    // because it hides real fixtures from the next person who looks at the app.
    const verifyTables = [
      'customers', 'products', 'companies', 'sales', 'sale_items',
      'purchases', 'purchase_items', 'supplier_payments',
      'customer_payments', 'inventory_movements', 'stock_adjustments', 'voids',
    ];
    const leftover: string[] = [];
    for (const t of verifyTables) {
      try {
        const r = await c.query(`SELECT count(*) AS n FROM ${t}`);
        const n = Number(r.rows[0].n);
        if (n > 0) leftover.push(`${t}=${n}`);
      } catch { /* missing table: nothing to verify */ }
    }

    await c.end();

    // Both halves fail the run. Printing a delete failure and carrying on was the other half of the
    // "cleaned" lie this file was fixed for: the rows that survived were exactly the ones whose
    // delete had failed.
    if (failures.length || leftover.length) {
      const parts = [
        failures.length ? `${failures.length} delete failure(s): ${failures.join('; ')}` : '',
        leftover.length ? `rows survived: ${leftover.join(', ')}` : '',
      ].filter(Boolean);
      throw new Error(`[QA Cleanup] QA is NOT clean after the run — ${parts.join(' | ')}`);
    }
    console.log('[QA Cleanup] Database cleaned after test run (verified: 0 business rows)');
  } catch (e) {
    // Rethrow: pretending the database is clean is what caused the phantom-data
    // reports in the first place.
    console.error('[QA Cleanup] Error:', (e as Error).message);
    throw e;
  }
}
