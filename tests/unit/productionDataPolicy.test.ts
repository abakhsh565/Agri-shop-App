/**
 * productionDataPolicy — the rule from docs/PRODUCTION_DATA_POLICY.md, as executable checks.
 *
 * WHY A SOURCE SCAN. The failure this prevents is a *configuration* failure, not a bug in a function:
 * a destructive script pointed at the wrong project, a fixture id copied into a migration, a workflow
 * step that gains a delete, a cleanup wired to production secrets. None of those can be caught by
 * executing the app — only by reading the repository, which is what this does.
 *
 * The rules:
 *   1. any script that can delete rows must refuse a target that is not the QA project;
 *   2. no CI step that deletes rows may carry `PROD_*` credentials;
 *   3. fixture identities may not appear on any surface that reaches production (src, migrations,
 *      baseline artifacts, workflows, utils) — and the one file that legitimately holds them,
 *      supabase/seed.sql, must stay referenced only by the local stack;
 *   4. no migration may contain an unscoped delete of a business table, and the reviewed allowlist of
 *      exceptions may only shrink;
 *   5. no workflow may gain a scheduled/ad-hoc deletion step;
 *   6. no source file may carry a credential literal;
 *   7. no migration may SEED a row under a demo/QA identity, and none may name the production project
 *      — the rule that would have caught 0018 before production held a shop called "Default Shop";
 *   8. the whole policy is machine-readable, because the 2026-10-13 by-hand check that cleared
 *      production passed with demo accounts in it (`scripts/audit-production-data.mjs`);
 *   9. schema moves by migrations, never by a hand-applied bundle pasted into a SQL editor;
 *  10. the cleanup runbook for production's demo rows is dry-run by default, scoped, guarded, and
 *      refuses to run against a database that holds a real shop.
 *
 * The describes below are in the order the rules arrived rather than in numeric order, so the
 * numbers jump; each title carries its own number.
 *
 * NON-VACUITY. Every scanner is a pure function, and each has a case that feeds it the bad input it
 * claims to catch — a guard whose failure modes are never exercised is not evidence.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { describe, expect, test } from 'vitest';
import { splitStatements } from '../../scripts/lib/sql-statements.mjs';
import {
  fixtureIdentitiesIn,
  reasonFor,
  SHIPPED_SURFACE_LABELS,
  ROW_IDENTITY_LABELS,
  DEMO_TENANT_ID,
} from '../../scripts/lib/fixture-identities.mjs';

const ROOT = process.cwd();
const QA_REF = 'bpybjrjenwccowvtrevu';
const PRODUCTION_REF = 'gkswcfljxlutkfdvvqng';

/** Customer/business data. Deleting these rows is what the policy protects. */
const BUSINESS_TABLES = [
  'customers', 'sales', 'sale_items', 'customer_payments', 'supplier_payments', 'payments',
  'companies', 'products', 'product_variants', 'purchases', 'purchase_items', 'returns',
  'return_items', 'voids', 'inventory_movements', 'stock_adjustments', 'notifications',
  'credit_limit_requests', 'customer_crops', 'shop_requests', 'users', 'memberships',
  'audit_events', 'activity_log', 'reminder_configs', 'reminder_logs', 'reminder_occurrences',
];

/**
 * The reviewed exceptions to rule 4, each with its reason. A ratchet: it may shrink, never grow.
 * `0046` dedupes customers before the phone-uniqueness constraint, scoped by a self-join.
 */
const REVIEWED_UNSCOPED_DELETES: Record<string, string> = {
  '0046_phone_uniqueness_constraint.sql':
    'one-time dedupe of duplicate customer rows before the phone uniqueness constraint; scoped by `USING customers b`',
};

/**
 * Migrations that SEED demo/QA rows, already applied and never replayed (`supabase/baseline`
 * records the policy: forward-only, replay history never). They are frozen history, recorded with a
 * reason rather than hidden: the rule they are checked against is that nothing NEW joins them, and
 * the list is a ratchet that may only shrink. The reason each one is not simply deleted is the same
 * for all four — editing an applied migration changes what a ledger row claims ran.
 */
export const FROZEN_SEED_MIGRATIONS: Record<string, string> = {
  '0009_complete_schema.sql':
    'creates the default tenant and backfills existing rows onto it; it is also the file that makes this directory a patch set on a provisioned database rather than a from-scratch baseline',
  '0018_seed_demo_users.sql':
    'seeds a demo admin and a demo employee on fixture phone numbers, and instructs the reader to run it in the production SQL editor — this is where production\'s demo accounts came from',
  '0026_fix_shop_and_product_rpc.sql':
    're-asserts the default tenant so the repaired RPCs have a shop to resolve on a database that only ever had the demo one',
  '0107_roles_rbac_model.sql':
    'creates the system role catalogue for the default tenant — configuration for the RBAC model, not a customer\'s row',
};

/**
 * Six `.sql` files sit at the repository root, tracked in git, from the era when a schema arrived by
 * pasting a file into the Supabase SQL editor. Two of them name the production project in their own
 * header and carry the 0009/0026 demo seed (`Default Shop`) — one plausible route by which production
 * got a demo shop. They are kept because SCHEMA_STRATEGY.md replays them as corpora; they are retired
 * as a path to any real project.
 */
export const FROZEN_HAND_APPLY_BUNDLES: Record<string, string> = {
  'ALL_MIGRATIONS_TO_RUN.sql':
    '0001-0017 concatenated for a SQL editor; its header names the production project and it carries the demo seed — kept as a replay corpus, retired as a release path',
  'COMPLETE_DATABASE_SETUP.sql':
    "the production project's own paste-and-run setup file, whose chain fails 54 statements from 0009 — kept as a corpus, retired as a release path",
  'SEED_DATA.sql':
    'the early demo seed for a fresh database, superseded by supabase/seed.sql for the local stack',
  'FIX_DEV_AUTH.sql': 'a one-off auth repair from the era of doing this by hand',
  'FIX_DEV_RLS.sql': 'a one-off RLS repair from the era of doing this by hand',
  'VERIFY_MIGRATIONS.sql':
    'a hand-run check for that era; scripts/migrate.mjs verify is the one that can refuse',
};

/** The bundles whose own header names production. Recorded so a third one cannot appear quietly. */
export const BUNDLES_NAMING_PRODUCTION = [
  'ALL_MIGRATIONS_TO_RUN.sql',
  'COMPLETE_DATABASE_SETUP.sql',
];

/**
 * The `.sql` files at the repository root that are not in the frozen bundle set. Pure, so its failure
 * mode is testable rather than asserted (rule 9).
 */
export function unexpectedRootSql(
  names: string[],
  frozen: Record<string, string> = FROZEN_HAND_APPLY_BUNDLES,
): string[] {
  return names.filter((n) => !(n in frozen)).sort();
}

/**
 * Every top-level `INSERT` in this SQL that puts a demo/QA identity in the row.
 *
 * Statement-level on purpose: a migration legitimately contains `INSERT INTO customers …` inside a
 * function body, and a function is not a seeded row. `splitStatements` keeps the body inside its
 * `CREATE FUNCTION` statement, so only a statement that STARTS with an insert can match.
 */
export function demoSeedsIn(sql: string): { table: string; labels: string[] }[] {
  const out: { table: string; labels: string[] }[] = [];
  for (const statement of splitStatements(sql)) {
    const m = statement.trim().match(/^insert\s+into\s+(?:public\.)?"?([a-z_]+)"?/i);
    if (!m) continue;
    const labels = fixtureIdentitiesIn(statement, ROW_IDENTITY_LABELS);
    if (labels.length) out.push({ table: m[1].toLowerCase(), labels });
  }
  return out;
}

/** Surfaces that reach production: shipped code, migrations, baseline artifacts, CI, config utils. */
const PRODUCTION_SURFACES = [
  'src',
  'supabase/migrations',
  'supabase/baseline',
  '.github/workflows',
  'utils',
];

function walk(dir: string, out: string[] = []): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full)) {
    const p = join(full, entry);
    if (statSync(p).isDirectory()) walk(relative(ROOT, p), out);
    else out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

// ── pure scanners (each has a non-vacuity case below) ────────────────────────────────

/** Does this file's text delete or truncate rows? */
export function deletesRows(text: string): boolean {
  return /\bdelete\s+from\b|\btruncate\b|\bDROP\s+TABLE\b/i.test(text);
}

/**
 * Does this file refuse a non-QA target? A destructive script must.
 *
 * The ref may be the literal, or the shared constant `QA_PROJECT_REF` imported from lib.mjs — both are
 * a check against the QA project; requiring the literal would call `qa-tenant.mjs` (which refuses
 * correctly, measured) unguarded, and a rule that fails on correct code teaches people to edit the
 * rule rather than the code.
 */
export function refusesNonQa(text: string): boolean {
  const refuses = /Refusing to run|console\.error\(|refuse\s*\(/i.test(text);
  return refuses && (text.includes(QA_REF) || /QA_PROJECT_REF/.test(text));
}

/**
 * The other legitimate refusal: a tool that only ever operates on the LOCAL Docker stack. Destroying
 * local data is the point of `dev/local-db.mjs`, so its safety property is not "is it QA?" but "can it
 * name anything but this machine's container?".
 */
export function refusesNonLocal(text: string): boolean {
  return /supabase_db_/.test(text) && /refuse\s*\(/.test(text) && /local stack/i.test(text);
}

/**
 * The third legitimate safety property: a tool whose database exists ONLY inside its own process.
 * `scripts/verify-cleanup-runbook.mjs` contains `delete from` statements — and must, because its job
 * is to execute the cleanup runbook — but it cannot name a database outside itself, so "does it
 * refuse a non-QA target?" is the wrong question. The right one is "can it name any target at all?",
 * and it answers that in code: it refuses to run where connection credentials exist.
 */
export function refusesAnyExternalTarget(text: string): boolean {
  return (
    /PGlite/.test(text) &&
    /refuse\s*\(/.test(text) &&
    /offline/i.test(text) &&
    /PROD_DB_PASS|DATABASE_URL/.test(text)
  );
}

/**
 * SQL comments explain; they do not execute. A fixture id quoted in a `--` line is documentation (the
 * COGS-integrity migration cites the sale it found), so the scan reads the executable text only.
 */
/**
 * Destructive scripts whose ONLY delete is scoped to a row the script itself created, with the marker
 * that proves it. A bare allowlist could hide a later, real delete; requiring the marker ties the
 * exemption to the behaviour, not to the filename.
 */
export const REVIEWED_SELF_SCOPED_DELETES: Record<string, { marker: RegExp; reason: string }> = {
  'scripts/verify-environment-isolation.mjs': {
    marker: /dev_isolation_canary/,
    reason:
      'writes one canary row and deletes exactly that row by token; its target comes from scripts/lib/environments.mjs, which asserts the project ref before connecting',
  },
};

/** Is this script exempt because its delete is provably scoped to its own canary? */
export function isSelfScopedDelete(text: string, marker: RegExp): boolean {
  if (!marker.test(text)) return false;
  return /delete\s+from[\s\S]{0,160}?\btoken\b/i.test(text);
}

export function stripSqlComments(sql: string): string {
  return sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
}

/**
 * Statement-level deletes in SQL text, with whether the statement scopes itself.
 * A statement runs to its `;`; a scope may be on a later line, which is why this does not look at
 * single lines.
 */
export function unscopedBusinessDeletes(sql: string): { table: string; statement: string }[] {
  const out: { table: string; statement: string }[] = [];
  const statements = stripSqlComments(sql).split(';');
  for (const raw of statements) {
    const statement = raw.trim();
    const m = statement.match(/DELETE\s+FROM\s+(?:public\.)?([a-z_]+)/i);
    if (!m) continue;
    const table = m[1].toLowerCase();
    if (!BUSINESS_TABLES.includes(table)) continue;
    // A scope is a WHERE (anywhere in the statement) or a USING self-join.
    if (/\bWHERE\b/i.test(statement) || /\bUSING\b/i.test(statement)) continue;
    out.push({ table, statement: statement.split('\n')[0] });
  }
  return out;
}

/**
 * Does a workflow step EMPTY QA's business data?
 *
 * A cleanup of the rows a run created is the suite's own business (tests/e2e/cleanupOwnership.ts).
 * A table-wide wipe of QA's customers, sales, payments, users and history is an owner action, and
 * a build must never be the reason it happened. Full-line YAML comments are stripped first, so
 * recording WHY such a step was removed never reads as running it.
 */
export function workflowWipesQaData(text: string): boolean {
  const steps = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  return /clean-test-data|qa\.mjs\s+clean|reset-qa-baseline/.test(steps);
}

/** A workflow step or file that deletes data must not carry production credentials. */
export function destructiveWorkflowUsesProductionCreds(text: string): boolean {
  const touchesData = deletesRows(text) || /clean-test-data|qa\.mjs\s+clean|reset-qa-baseline/.test(text);
  if (!touchesData) return false;
  return /\$\{\{\s*secrets\.PROD_/.test(text);
}

// ── rule 1: destructive scripts refuse a non-QA target ───────────────────────────────
describe('rule 1 — a script that can delete rows refuses a non-QA target', () => {
  const scripts = walk('scripts');

  test('every destructive script refuses either a non-QA target or a non-local one', () => {
    const destructive = scripts.filter((f) => /\.(mjs|cjs|js|ts)$/.test(f) && deletesRows(read(f)));
    // The rule is about existence as much as about content: if the scan finds nothing, it is broken.
    expect(destructive.length, 'no destructive script found — the scan is not looking at the right files').toBeGreaterThan(0);

    const offenders = destructive
      .filter((f) => {
        const text = read(f);
        if (refusesNonQa(text) || refusesNonLocal(text) || refusesAnyExternalTarget(text)) return false;
        const exception = REVIEWED_SELF_SCOPED_DELETES[rel(f)];
        // The exemption only holds while the delete is still scoped to the canary row by token.
        return !(exception && isSelfScopedDelete(text, exception.marker));
      })
      .map(rel);
    expect(offenders, `these scripts can delete rows without refusing a target they were not meant for: ${offenders.join(', ')}`).toEqual([]);
  });

  test('the self-scoped exceptions stay small, exist, and keep their marker', () => {
    const entries = Object.entries(REVIEWED_SELF_SCOPED_DELETES);
    expect(entries.length).toBeLessThanOrEqual(2);
    for (const [file, { marker, reason }] of entries) {
      expect(existsSync(join(ROOT, file)), `${file} is gone — remove its exemption`).toBe(true);
      expect(reason.length).toBeGreaterThan(40);
      expect(marker.test(read(join(ROOT, file))), `${file} no longer contains its canary marker`).toBe(true);
    }
    // Non-vacuous: the exemption stops applying the moment the delete is not token-scoped.
    expect(isSelfScopedDelete('const CANARY = 1; await q(`DELETE FROM t`);', /CANARY/)).toBe(false);
    expect(isSelfScopedDelete('const CANARY = 1; await q(`DELETE FROM t WHERE token = $1`);', /CANARY/)).toBe(true);
  });

  test('the QA tools named in the policy still exist and still refuse (not vacuous)', () => {
    for (const file of [
      'scripts/clean-test-data.mjs',
      'scripts/reset-qa-baseline.mjs',
      'scripts/dev/qa-tenant.mjs',
      'scripts/dev/qa-baseline.mjs',
      // Found by this guard on its first run: it TRUNCATEs fourteen business tables and its only
      // protection was reading `.env.qa`, which is not a check. The refusal is now in the script.
      'scripts/e2e-setup-data.mjs',
    ]) {
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true);
      expect(refusesNonQa(read(join(ROOT, file))), `${file} no longer refuses a non-QA target`).toBe(true);
    }
    // ...and the local-stack tool is held to its own form of the same rule.
    expect(refusesNonLocal(read(join(ROOT, 'scripts/dev/local-db.mjs'))), 'local-db.mjs stopped refusing non-local targets').toBe(true);
  });

  test('the scanner itself catches a script that deletes without refusing', () => {
    const bad = 'await client.query(`DELETE FROM customers`);';
    expect(deletesRows(bad)).toBe(true);
    expect(refusesNonQa(bad)).toBe(false);
    expect(refusesNonLocal(bad)).toBe(false);
    // A PGlite-only tool qualifies only if it also refuses to run where credentials exist — a bare
    // import must not become an exemption.
    expect(refusesAnyExternalTarget('import { PGlite } from ...; await db.exec(`delete from t`)')).toBe(false);
    expect(refusesAnyExternalTarget(read(join(ROOT, 'scripts/verify-cleanup-runbook.mjs')))).toBe(true);
  });
});

// ── rule 2: no CI deletion with production credentials ───────────────────────────────
describe('rule 2 — CI never deletes with production credentials', () => {
  const workflows = readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));

  test('no workflow that deletes data carries PROD_* secrets', () => {
    const offenders = workflows
      .filter((f) => destructiveWorkflowUsesProductionCreds(read(join(ROOT, '.github/workflows', f))))
      .map((f) => `.github/workflows/${f}`);
    expect(offenders).toEqual([]);
  });

  test('no workflow empties QA: losing history is not part of building an artifact', () => {
    // What this replaced: a rule that REQUIRED `scripts/clean-test-data.mjs` to run somewhere in
    // CI, with QA credentials. It was satisfied by `build-apk.yml`, whose step ran with
    // `if: always()` — so every APK build, passing or failing, issued table-wide DELETEs against
    // QA's business tables and deleted every user outside four seed phones. The rule made a build
    // the reason QA lost its data, and then treated that as compliance. The suites clean only what
    // they created, and a deliberate QA reset belongs to the owner (`npm run qa:clean`).
    const wipers = workflows
      .filter((f) => workflowWipesQaData(read(join(ROOT, '.github/workflows', f))))
      .map((f) => `.github/workflows/${f}`);
    expect(
      wipers,
      `these workflows delete QA business data instead of using their own fixtures: ${wipers.join(', ')}`,
    ).toEqual([]);
  });

  test('the scanner is not vacuous — it reads the step, not the story about the step', () => {
    expect(workflowWipesQaData('      - name: Clean QA Database\n        run: node scripts/clean-test-data.mjs')).toBe(true);
    expect(workflowWipesQaData('        run: node scripts/dev/qa.mjs clean')).toBe(true);
    expect(workflowWipesQaData('        run: node scripts/reset-qa-baseline.mjs')).toBe(true);
    expect(workflowWipesQaData('        run: npx vitest run tests/unit')).toBe(false);
    // The comment left behind in build-apk.yml explains the removal; it must not read as a run.
    expect(workflowWipesQaData('      # "Clean QA Database" ran `node scripts/clean-test-data.mjs`')).toBe(false);
  });

  test('the scanner catches a deletion step wired to production', () => {
    const bad = 'run: node scripts/clean-test-data.mjs\nenv:\n  QA_DATABASE_URL: ${{ secrets.PROD_DB_USER }}';
    expect(destructiveWorkflowUsesProductionCreds(bad)).toBe(true);
  });
});

// ── rule 3: test data may never reach production ─────────────────────────────────────
describe('rule 3 — fixture identities never appear on a production surface', () => {
  /** The two files allowed to name the seed, each for a reason that is not "it was already there". */
  const SEED_REFERENCES: Record<string, string> = {
    'scripts/dev/local-db.mjs': 'reads and applies it to the local Docker stack',
    'scripts/verify-environment-isolation.mjs': 'names it in the local-writer set that must hold no hosted URL',
  };

  /** The four frozen seed migrations are history this rule cannot edit; rule 7 checks them as seeds. */
  const isFrozenHistory = (file: string) =>
    Object.keys(FROZEN_SEED_MIGRATIONS).some((f) => rel(file) === `supabase/migrations/${f}`);

  test('no fixture id, QA phone or fixture name on any production surface', () => {
    const offenders: string[] = [];
    for (const surface of PRODUCTION_SURFACES) {
      for (const file of walk(surface)) {
        if (!/\.(ts|tsx|js|mjs|cjs|sql|json|yml|yaml)$/.test(file)) continue;
        if (isFrozenHistory(file)) continue;
        const raw = read(file);
        // Migrations are SQL: comments explain the finding that prompted them (0127 cites the sale it
        // investigated), and a comment cannot insert a row.
        const text = file.endsWith('.sql') ? stripSqlComments(raw) : raw;
        const labels = fixtureIdentitiesIn(text);
        if (labels.length) offenders.push(`${rel(file)} [${labels.join(', ')}]`);
      }
    }
    expect(
      offenders,
      `fixture identities reached a production surface (rule 7 explains the frozen exceptions): ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  test('the scan is not blind: it names the identities a shipped file must not carry', () => {
    // Non-vacuous in both directions — the labels that are evidence anywhere, and the two strings
    // that are legitimate as a MENTION (which is why they are row-only labels).
    expect(fixtureIdentitiesIn("VALUES ('20000000-0000-0000-0000-000000000001')")).toEqual([
      'fixture-uuid-family',
    ]);
    expect(fixtureIdentitiesIn("INSERT INTO shops (name) VALUES ('Default Shop')")).toEqual([
      'demo-shop-name',
    ]);
    expect(SHIPPED_SURFACE_LABELS).not.toContain('fixture-phone-demo');
    expect(ROW_IDENTITY_LABELS).toContain('fixture-phone-demo');
    expect(ROW_IDENTITY_LABELS).toContain('demo-tenant');
    // A shipped comment about phone normalisation names a demo number; that must not fail rule 3.
    expect(fixtureIdentitiesIn('// 03001234567 and 923001234567 are the same number')).toEqual([]);
  });

  test('supabase/seed.sql holds fixtures and is referenced only where the policy says', () => {
    const seed = read(join(ROOT, 'supabase/seed.sql'));
    expect(
      fixtureIdentitiesIn(seed, ROW_IDENTITY_LABELS).length > 0,
      'the seed file no longer holds the local fixtures — has this rule moved?',
    ).toBe(true);

    const referencedBy = walk('scripts')
      .concat(walk('.github/workflows'))
      .filter((f) => /\.(mjs|cjs|js|ts|yml|yaml)$/.test(f))
      .filter((f) => /seed\.sql/.test(read(f)))
      .map(rel)
      .sort();
    expect(referencedBy, `seed.sql is referenced somewhere the policy does not allow: ${referencedBy.join(', ')}`).toEqual(
      Object.keys(SEED_REFERENCES).sort(),
    );
    for (const [file, reason] of Object.entries(SEED_REFERENCES)) {
      expect(existsSync(join(ROOT, file)), `${file} is gone — remove its entry`).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
    // The seed must never be named by a workflow: CI migrates and backs up, it never seeds.
    expect(walk('.github/workflows').filter((f) => /seed\.sql/.test(read(f)))).toEqual([]);
  });

  test('no data-promotion path from QA to production exists', () => {
    // Line-bounded on purpose: with `[^;]` a stray sentence mentioning "copy ... from '" in prose or
    // media tooling matched, and a rule that fires on prose gets deleted rather than fixed.
    const promotion = /\bCOPY\b[^\n;]*FROM\s+'(?!stdin)|pg_dump[^\n]*\|\s*psql|psql[^\n]*<\s*[^\n]*\.sql/i;
    const offenders = walk('scripts')
      .filter((f) => /\.(mjs|cjs|js|ts)$/.test(f))
      .filter((f) => promotion.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('the scanner catches a fixture id copied into a migration (rule 7 owns migrations)', () => {
    expect(demoSeedsIn("INSERT INTO customers (id) VALUES ('20000000-0000-0000-0000-000000000001')")).toEqual([
      { table: 'customers', labels: ['fixture-uuid-family'] },
    ]);
  });
});

// ── rule 4: deletions are scoped, and the allowlist is a ratchet ─────────────────────
describe('rule 4 — no unscoped business delete in a migration', () => {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));

  test('every statement-level business delete is scoped, or reviewed', () => {
    const offenders: string[] = [];
    for (const file of migrations) {
      if (REVIEWED_UNSCOPED_DELETES[file]) continue;
      for (const { table, statement } of unscopedBusinessDeletes(read(join(ROOT, 'supabase/migrations', file)))) {
        offenders.push(`${file}: DELETE FROM ${table} (${statement})`);
      }
    }
    expect(offenders, `unscoped business deletes found:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('the reviewed-exception allowlist is a ratchet, and every entry still exists', () => {
    for (const [file, reason] of Object.entries(REVIEWED_UNSCOPED_DELETES)) {
      expect(existsSync(join(ROOT, 'supabase/migrations', file)), `allowlisted migration ${file} is gone — remove its entry`).toBe(true);
      expect(reason.length, `${file} is allowlisted without a reason`).toBeGreaterThan(20);
    }
    expect(Object.keys(REVIEWED_UNSCOPED_DELETES).length, 'the exception list grew').toBeLessThanOrEqual(1);
  });

  test('the scanner catches an unscoped delete and accepts a scoped one', () => {
    expect(unscopedBusinessDeletes('DELETE FROM sales;').map((d) => d.table)).toEqual(['sales']);
    // A comment cannot scope a delete, and it cannot scope one either: the scan reads both ways.
    expect(unscopedBusinessDeletes('DELETE FROM sales -- WHERE shop_id = x;').map((d) => d.table)).toEqual(['sales']);
    expect(unscopedBusinessDeletes('-- DELETE FROM sales\nSELECT 1;')).toEqual([]);
    expect(unscopedBusinessDeletes('DELETE FROM sales WHERE shop_id = p_shop_id;')).toEqual([]);
    expect(unscopedBusinessDeletes('DELETE FROM customers a USING customers b WHERE a.id > b.id;')).toEqual([]);
    // A scope on the next line still counts — the statement, not the line, is the unit.
    expect(unscopedBusinessDeletes('DELETE FROM public.reminder_configs\n WHERE id IN (SELECT 1);')).toEqual([]);
  });
});

// ── rule 5: deletion stays the owner's own action ────────────────────────────────────
describe('rule 5 — records are deleted by their owner\'s action, never on a schedule', () => {
  test('the shop/account deletion path is scoped by the shop it belongs to', () => {
    const file = 'supabase/migrations/0147_admin_full_access_and_account_deletion.sql';
    const sql = read(join(ROOT, file));
    // The deleting functions take the shop as a parameter and scope the history deletes by it, so a
    // caller cannot delete another shop's records, and no tool can delete "all" of anything.
    expect(sql).toMatch(/p_shop_id/);
    for (const table of ['sales', 'customers', 'companies']) {
      const scoped = new RegExp(`DELETE FROM ${table}[^;]*(shop_id|p_shop_id)`, 'i');
      expect(scoped.test(sql), `${table} is deleted without a shop scope in ${file}`).toBe(true);
    }
  });

  test('no workflow deletes rows on a schedule or ad hoc', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(join(ROOT, '.github/workflows'))) {
      if (!/\.ya?ml$/.test(f)) continue;
      const text = read(join(ROOT, '.github/workflows', f));
      const lines = text.split('\n').filter((l) => /\b(delete from|truncate|DROP TABLE)\b/i.test(l));
      for (const line of lines) offenders.push(`${f}: ${line.trim().slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });

  test('no repository code purges customers automatically', () => {
    // A scheduler/cron/purge that deletes customers would be a deletion nobody asked for.
    const purges = walk('src')
      .concat(walk('scripts'))
      .filter((f) => /\.(ts|tsx|mjs|cjs)$/.test(f))
      .filter((f) => /DELETE\s+FROM\s+(public\.)?customers/i.test(read(f)))
      .map(rel);
    // The only legitimate case is a test-cleanup/QA tool, which rule 1 already proves is QA-guarded.
    for (const file of purges) {
      expect(refusesNonQa(read(join(ROOT, file))), `${file} deletes customers and does not refuse a non-QA target`).toBe(true);
    }
  });
});

// ── rule 7: a migration seeds schema, never demo data ────────────────────────────────
describe('rule 7 — a migration seeds schema, never demo data', () => {
  const MIGRATIONS = 'supabase/migrations';
  const files = readdirSync(join(ROOT, MIGRATIONS)).filter((f) => f.endsWith('.sql'));

  test('no migration outside the frozen set inserts a row under a demo/QA identity', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (FROZEN_SEED_MIGRATIONS[file]) continue;
      for (const seed of demoSeedsIn(read(join(ROOT, MIGRATIONS, file)))) {
        offenders.push(
          `${file}: INSERT INTO ${seed.table} uses ${seed.labels.join(', ')} — ${seed.labels.map(reasonFor).join('; ')}`,
        );
      }
    }
    expect(
      offenders,
      `these migrations seed rows that are nobody's real data, so every environment they are applied to gets them — production included:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  test('the frozen set is a ratchet, and each entry is still the file it describes', () => {
    const frozen = Object.entries(FROZEN_SEED_MIGRATIONS);
    expect(frozen.length, 'a migration was added to the frozen history').toBeLessThanOrEqual(4);
    for (const [file, reason] of frozen) {
      const path = join(ROOT, MIGRATIONS, file);
      expect(existsSync(path), `${file} is gone — remove its entry`).toBe(true);
      expect(reason.length, `${file} is frozen without a reason`).toBeGreaterThan(60);
      expect(
        demoSeedsIn(read(path)).length,
        `${file} no longer seeds anything — remove its exemption instead of leaving a stale ` +
          'one that would hide a future seed behind a name nobody re-reads',
      ).toBeGreaterThan(0);
    }
  });

  test('no migration names the production project', () => {
    const naming = files.filter((f) => read(join(ROOT, MIGRATIONS, f)).includes(PRODUCTION_REF));
    expect(
      naming,
      'a migration names production — a migration cannot choose which project it runs on, and a ' +
        'header that tells the reader to run it in the production SQL editor is how 0018 did it',
    ).toEqual(['0018_seed_demo_users.sql']);
    expect(naming.every((f) => FROZEN_SEED_MIGRATIONS[f])).toBe(true);
  });

  test('the scanner is not vacuous, and a function body is not a seeded row', () => {
    expect(demoSeedsIn("INSERT INTO users (id, phone) VALUES ('x', '923001234567');").length).toBe(1);
    expect(
      demoSeedsIn(
        "INSERT INTO shops (id, name) VALUES ('" + DEMO_TENANT_ID + "', 'Default Shop');",
      ).length,
    ).toBe(1);
    // A comment cannot seed a row, and a real system role name is not an account identity.
    expect(demoSeedsIn('-- 03001234567 and 923001234567 are the same number\nSELECT 1;')).toEqual([]);
    expect(demoSeedsIn("INSERT INTO users (id, role) VALUES ('x', 'Sales Employee');")).toEqual([]);
    // And an INSERT inside a function body is a function, not a row on the way in.
    expect(
      demoSeedsIn(
        "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$\nBEGIN\n  INSERT INTO customers (id) VALUES ('20000000-0000-0000-0000-000000000001');\nEND;\n$$ LANGUAGE plpgsql;",
      ),
    ).toEqual([]);
  });
});

/**
 * The fenced ```sql blocks in a document, in order. A runbook is read by a human who pastes one
 * block at a time, so the block — not the file — is the unit that has to be safe.
 */
export function sqlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /```sql\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) blocks.push(m[1]);
  return blocks;
}

/**
 * The shape a destructive runbook must keep (rule 10). One message per violation:
 *
 *   1. a block that deletes or updates must END in `rollback;` — dry-run by default, so the file as
 *      committed cannot delete anything until a human changes one word on purpose;
 *   2. a `DELETE` with no scope is allowed ONLY in a block that also contains a `raise exception`
 *      precondition, i.e. the whole-tenant wipe that refuses to run against a database holding a
 *      real shop;
 *   3. `TRUNCATE` and `DROP TABLE` may never appear.
 */
export function cleanupRunbookViolations(markdown: string): string[] {
  const violations: string[] = [];
  sqlBlocks(markdown).forEach((block, index) => {
    const statements = splitStatements(block)
      .map((s) => s.trim())
      .filter(Boolean);
    const destructive = statements.some((s) => /^delete\s+from|^update\s/i.test(s));
    const hasPrecondition = /raise exception/i.test(block);

    for (const statement of statements) {
      const head = statement.split('\n')[0].slice(0, 70);
      if (/^truncate\b|^drop\s+table\b/i.test(statement)) {
        violations.push(`block ${index + 1} truncates or drops: ${head}`);
        continue;
      }
      if (/^delete\s+from/i.test(statement) && !/\bwhere\b|\busing\b/i.test(statement) && !hasPrecondition) {
        violations.push(
          `block ${index + 1} deletes without a scope and without a precondition: ${head}`,
        );
      }
    }

    if (destructive && statements[statements.length - 1] !== 'rollback') {
      violations.push(
        `block ${index + 1} deletes or updates and does not end in rollback: ${statements[statements.length - 1].slice(0, 40)}`,
      );
    }
  });
  return violations;
}

// ── rule 9: the schema moves by migrations, not by paste-into-the-SQL-editor ──────────
describe('rule 9 — no hand-applied bundle may be the way schema reaches a project', () => {
  const rootSql = readdirSync(ROOT).filter((f) => f.endsWith('.sql'));

  test('the only SQL at the repository root is the frozen set — a new bundle needs a decision', () => {
    expect(unexpectedRootSql(rootSql)).toEqual([]);
    for (const [file, reason] of Object.entries(FROZEN_HAND_APPLY_BUNDLES)) {
      expect(existsSync(join(ROOT, file)), `${file} is gone — remove its entry`).toBe(true);
      expect(reason.length, `${file} is frozen without a reason`).toBeGreaterThan(40);
    }
  });

  test('exactly the recorded two name production, and they still carry the demo seed', () => {
    const naming = rootSql.filter((f) => read(join(ROOT, f)).includes(PRODUCTION_REF)).sort();
    expect(
      naming,
      'a hand-applied bundle names production. A file that can be pasted into the production SQL ' +
        'editor cannot also decide which project it belongs to — the migration directory is the way.',
    ).toEqual([...BUNDLES_NAMING_PRODUCTION].sort());
    // The record stays tied to a measured fact: it can be deleted when the fact is no longer true.
    for (const f of BUNDLES_NAMING_PRODUCTION) {
      expect(fixtureIdentitiesIn(read(join(ROOT, f)), ['demo-shop-name']), `${f} no longer carries the demo seed — update this record`).toEqual(['demo-shop-name']);
    }
  });

  test('the directive itself is not presented as the release path any more', () => {
    // The header text is the instruction a human follows. It is quoted here so the file cannot be
    // re-blessed as current without this test noticing.
    const banner = read(join(ROOT, 'ALL_MIGRATIONS_TO_RUN.sql')).split('\n').slice(0, 5).join('\n');
    expect(banner).toContain('Supabase SQL Editor');
    const strategy = read(join(ROOT, 'SCHEMA_STRATEGY.md'));
    expect(strategy).toContain('ALL_MIGRATIONS_TO_RUN.sql');
    // The document that owns the schema strategy already says production is read-only and that a
    // release is the only thing that changes it, individually verified — so this rule and the
    // strategy agree rather than competing.
    expect(strategy).toMatch(/Production stays read-only/);
  });

  test('the scanner catches a new bundle (non-vacuous)', () => {
    expect(unexpectedRootSql(['ALL_MIGRATIONS_TO_RUN.sql', 'NEW_SETUP.sql'])).toEqual(['NEW_SETUP.sql']);
    expect(unexpectedRootSql(['ALL_MIGRATIONS_TO_RUN.sql'])).toEqual([]);
  });
});

// ── rule 10: a cleanup runbook is dry-run by default and refuses the wrong database ──
describe('rule 10 — the cleanup runbook may not delete anything as committed', () => {
  const RUNBOOK = 'docs/PRODUCTION_DEMO_DATA_CLEANUP.md';
  const doc = read(join(ROOT, RUNBOOK));

  test('it exists and names the things a person needs to run it', () => {
    const needles: [string, string][] = [
      ['PROD_DB_PASS', 'the backup precondition names the secret that is actually missing'],
      ['backup-database.yml', 'the backup is taken by the workflow, not improvised'],
      ['RECOVERY.md', 'there is a named path back to a previous state'],
      ['audit:production-data', 'the verdict before and after comes from the tool'],
      ['verify:cleanup-runbook', 'the delete order is executed offline before it is executed live'],
      ['deactivate', 'an account with history is deactivated, not deleted'],
      ['Plan A', 'both plans are present'],
      ['Plan B', 'both plans are present'],
    ];
    for (const [needle, why] of needles) expect(doc, `missing \`${needle}\` — ${why}`).toContain(needle);
  });

  test('every destructive block is dry-run by default, scoped, and never truncates', () => {
    expect(
      cleanupRunbookViolations(doc),
      'the runbook as committed could delete rows, or it deletes without a scope and without a precondition',
    ).toEqual([]);
  });

  test('both plans are one word away from running, and both refuse the wrong database', () => {
    const destructive = sqlBlocks(doc).filter((b) => /^delete\s+from|^update\s/im.test(b));
    expect(destructive.length, 'the runbook lost its destructive blocks — has it moved?').toBeGreaterThanOrEqual(2);
    for (const block of destructive) {
      const last = block.trimEnd().split('\n').pop()?.trim();
      expect(last, 'a destructive block no longer ends in rollback — it would delete on paste').toBe('rollback;');
      expect(block, 'a destructive block has no precondition').toMatch(/raise exception/);
    }
  });

  test('the offline verifier exists, is offline, and is wired to a command', () => {
    const verifier = read(join(ROOT, 'scripts/verify-cleanup-runbook.mjs'));
    // Offline by construction: no connection, no HTTP, no Supabase client.
    for (const forbidden of ['createClient', 'new Pool', "from 'pg'", 'fetch(']) {
      expect(verifier.includes(forbidden), `the verifier contains ${forbidden}`).toBe(false);
    }
    expect(verifier).toContain('PGlite');
    expect(verifier).toContain(RUNBOOK);
    // It must be able to say the runbook is wrong, not only that it is right.
    expect(verifier).toMatch(/problems\.length/);
    const pkg = JSON.parse(read(join(ROOT, 'package.json')));
    expect(pkg.scripts['verify:cleanup-runbook']).toContain('verify-cleanup-runbook.mjs');
  });

  test('the scanner is not vacuous', () => {
    const unscoped = ['```sql', 'begin;', 'delete from public.sales;', 'commit;', '```'].join('\n');
    const problems = cleanupRunbookViolations(unscoped);
    expect(problems.some((p) => p.includes('without a scope'))).toBe(true);
    expect(problems.some((p) => p.includes('does not end in rollback'))).toBe(true);

    const scoped = ['```sql', 'begin;', "delete from public.sales where shop_id = 'x';", 'rollback;', '```'].join('\n');
    expect(cleanupRunbookViolations(scoped)).toEqual([]);

    const truncating = ['```sql', 'begin;', 'truncate public.sales;', 'rollback;', '```'].join('\n');
    expect(cleanupRunbookViolations(truncating).length).toBe(1);
  });
});

// ── rule 8: the production verdict comes from a tool, not from a hand-run grep ────────
describe('rule 8 — the production verdict is measured, never asserted', () => {
  const AUDIT = 'scripts/audit-production-data.mjs';

  test('the auditor exists, is read-only, and reads the shared identities', () => {
    const audit = read(join(ROOT, AUDIT));
    expect(audit).toContain('READ ONLY');
    // Read-only by construction: no connection, no HTTP, no write of any kind.
    for (const forbidden of ['createClient', 'new Pool', 'writeFileSync', 'appendFileSync', 'fetch(']) {
      expect(audit.includes(forbidden), `${AUDIT} contains ${forbidden}`).toBe(false);
    }
    // The labels it looks for are shared with this guard, so the two cannot drift again.
    expect(audit).toContain("from './lib/fixture-identities.mjs'");
    expect(audit).toContain('splitStatements');
  });

  test('it refuses rather than reporting a verdict it did not earn', () => {
    const audit = read(join(ROOT, AUDIT));
    // Exit 2 with REFUSED when there is nothing to audit: an empty audit may never read as PASS.
    expect(audit).toMatch(/process\.exit\(2\)/);
    expect(audit).toContain('REFUSED');
    expect(audit).toMatch(/pass --from <artifact\.sql>/);
  });

  test('the command is wired into package.json and named by the policy document', () => {
    const pkg = JSON.parse(read(join(ROOT, 'package.json')));
    expect(pkg.scripts['audit:production-data']).toContain(AUDIT);
    const doc = read(join(ROOT, 'docs/PRODUCTION_DATA_POLICY.md'));
    expect(doc).toContain('audit:production-data');
  });
});

// ── rule 6: credentials are never literals in a script ────────────────────────────────
describe('rule 6 — no credential literals in scripts', () => {
  const CREDENTIAL_LITERALS = [
    /password\s*:\s*'[^']{8,}'/i,
    /password\s*=\s*['"][^'"]{8,}['"]/i,
    /\beyJhbGciOi[A-Za-z0-9._-]{20,}/,
    /service[_-]?role['"]?\s*[:=]\s*['"][^'"]{20,}['"]/i,
  ];

  /**
   * Source that legitimately contains a password-SHAPED string to test redaction or rejection. Each
   * entry names the assertion it feeds, so the exemption is about behaviour, not about a filename.
   */
  const REVIEWED_SYNTHETIC_CREDENTIALS: Record<string, string> = {
    'tests/integration/employeeInviteLifecycle.test.ts':
      'asserts the invite/credential redaction path with a synthetic password value',
    'tests/integration/incidentFoundation.test.ts':
      'asserts that a synthetic token is refused/redacted (the payload carries ref "test")',
    'tests/unit/productionDataPolicy.test.ts':
      'asserts this scanner with a synthetic value (never a real one — that mistake was caught here)',
  };

  test('no source file carries a database password or service-role key literal', () => {
    // Source files only, across the whole automated surface — the credential this rule was written for
    // sat in `scripts/`, but nothing about the rule is specific to that directory. JSON artifacts are
    // data, not source, and are reported separately.
    const sources = ['scripts', 'src', 'tests', 'utils']
      .flatMap((d) => walk(d))
      .filter((f) => /\.(mjs|cjs|js|ts|tsx)$/.test(f))
      .filter((f) => !REVIEWED_SYNTHETIC_CREDENTIALS[rel(f)]);
    const offenders = sources.filter((f) => CREDENTIAL_LITERALS.some((re) => re.test(read(f)))).map(rel);
    expect(offenders, `credential literals found in: ${offenders.join(', ')}`).toEqual([]);
  });

  test('the synthetic-credential exemptions stay tiny, exist, and still justify themselves', () => {
    const entries = Object.entries(REVIEWED_SYNTHETIC_CREDENTIALS);
    expect(entries.length).toBeLessThanOrEqual(3);
    for (const [file, reason] of entries) {
      expect(existsSync(join(ROOT, file)), `${file} is gone — remove its exemption`).toBe(true);
      expect(reason.length).toBeGreaterThan(40);
      // The file must actually contain such a literal; otherwise the exemption is dead weight hiding a
      // later, real one behind a name nobody re-reads.
      expect(CREDENTIAL_LITERALS.some((re) => re.test(read(join(ROOT, file)))), `${file} no longer contains a credential-shaped value`).toBe(true);
    }
  });

  test('no tracked test artifact is committed (reported, not silently ignored)', () => {
    // A Playwright JSON report is machine output that carries request payloads. `tests/e2e/results.json`
    // is tracked in this repository today; the guard pins the fact so it cannot spread to a second one.
    const tracked = ['tests/e2e/results.json'];
    expect(tracked.filter((f) => existsSync(join(ROOT, f))).length, 'results.json is gone — remove it from this list').toBe(tracked.length);
  });

  test('the four scripts that held literals now use the shared, refusing helper', () => {
    // Found by this guard on its first run: three scripts with a QA database password and one with a
    // service-role key for an older project, all committed. They now take their connection from
    // scripts/lib/qa-connection.mjs, which reads the environment and refuses a non-QA target.
    for (const file of [
      'scripts/deploy-0105.mjs',
      'scripts/deploy-0105-pg.mjs',
      'scripts/deploy-0108-0109.mjs',
      'scripts/fix-create-employee.mjs',
    ]) {
      const text = read(join(ROOT, file));
      expect(text, `${file} no longer uses the QA connection helper`).toContain("from './lib/qa-connection.mjs'");
      expect(text, `${file} builds its own Pool again`).not.toMatch(/new Pool\(\{/);
    }
  });

  test('the helper refuses a non-QA target and reads no literal', () => {
    const helper = read(join(ROOT, 'scripts/lib/qa-connection.mjs'));
    expect(refusesNonQa(helper), 'the helper no longer checks the QA project ref').toBe(true);
    expect(helper).toMatch(/process\.env\.QA_DB_PASS/);
    expect(CREDENTIAL_LITERALS.some((re) => re.test(helper))).toBe(false);
  });

  test('the scanner catches a literal (non-vacuous)', () => {
    // A synthetic value on purpose: the first draft of this line quoted the REAL leaked password to
    // prove the scanner catches it, which would have re-committed the credential in the guard written
    // to prevent exactly that. Any 8+ character literal is caught; the pattern is what is under test.
    expect(CREDENTIAL_LITERALS.some((re) => re.test("password: 'Synthetic-Not-A-Credential-1234'"))).toBe(true);
    expect(CREDENTIAL_LITERALS.some((re) => re.test('password: process.env.QA_DB_PASS'))).toBe(false);
  });
});

// ── the policy document itself ───────────────────────────────────────────────────────
describe('the policy document exists and states the rules', () => {
  const doc = read(join(ROOT, 'docs/PRODUCTION_DATA_POLICY.md'));

  test('it names both projects, the one-way rule and the owner-only deletion rule', () => {
    expect(doc).toContain('gkswcfljxlutkfdvvqng');
    expect(doc).toContain(QA_REF);
    expect(doc).toMatch(/DATA never moves up|never moves up/i);
    expect(doc).toMatch(/owner/i);
    expect(doc).toMatch(/trash|restore/i); // the deferred feature is recorded, not silently dropped
  });

  test('the guard file names a policy document that is actually there', () => {
    expect(existsSync(join(ROOT, 'docs/PRODUCTION_DATA_POLICY.md'))).toBe(true);
    expect(basename('docs/PRODUCTION_DATA_POLICY.md')).toBe('PRODUCTION_DATA_POLICY.md');
  });
});
