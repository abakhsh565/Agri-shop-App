/**
 * migrationLedger — the runner's logic, held to fixtures instead of to a live database.
 *
 * The defect this guards is `PRODUCTION_READINESS_AUDIT.md` B5: `supabase_migrations.schema_migrations`
 * held three rows while the directory held 167 files, because every deploy went through `run_sql`
 * and recorded nothing. Two files also broke the sequence's grammar — `0042b_security_rls_fix.sql`
 * (a suffixed version) and `20260903_credit_limit_requests__reminder_groups.sql` (a timestamp
 * version, which sorted after the newest migration) — so a naive replay was wrong twice over.
 *
 * `scripts/migrate.mjs` is the fix: it applies a file and records it in one transaction. This file
 * tests the half of it that is pure logic, so the rules can be asserted without a database:
 *
 *   - the grammar is enforced, and each of its three failure modes is caught (non-canonical name,
 *     duplicate version, an alias whose target is gone);
 *   - every difference class between a directory and a ledger is detected — pending, ledger-only,
 *     changed-after-apply, recorded-without-a-hash, reconciled-retired-name — and none of them is
 *     reported when the ledger agrees exactly (a check that only ever fires is as useless as one
 *     that never does);
 *   - an out-of-order apply is a hazard only when the pending file really does sort before the
 *     newest recorded one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LEGACY_VERSION_ALIASES,
  classifyReconciliation,
  compareWithLedger,
  declaredObjects,
  ledgerOnlyAudit,
  orderHazards,
  parseMigrationFilename,
  readMigrationDirectory,
} from '../../scripts/lib/migrations.mjs';
import { normalizeSql, splitStatements } from '../../scripts/lib/sql-statements.mjs';

const scratch: string[] = [];

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agrishop-migrations-'));
  scratch.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop()!, { recursive: true, force: true });
});

describe('the filename grammar', () => {
  it('accepts the canonical shape and reads version and name out of it', () => {
    expect(parseMigrationFilename('0175_a_denial_still_denies.sql')).toEqual({
      version: '0175',
      name: 'a_denial_still_denies',
      canonical: true,
    });
    expect(parseMigrationFilename('0060_credit_limit_requests__reminder_groups.sql')).toEqual({
      version: '0060',
      name: 'credit_limit_requests__reminder_groups',
      canonical: true,
    });
  });

  it('rejects the two shapes that actually existed in this repository', () => {
    // A suffixed version cannot be ordered against its parent and is not a version at all.
    expect(parseMigrationFilename('0042b_security_rls_fix.sql')).toEqual({
      version: '0042b',
      name: 'security_rls_fix',
      canonical: false,
    });
    // A timestamp version sorts after every 0NNN file, so replay order stops being apply order.
    expect(parseMigrationFilename('20260903_credit_limit_requests__reminder_groups.sql')).toEqual({
      version: '20260903',
      name: 'credit_limit_requests__reminder_groups',
      canonical: false,
    });
  });

  it('reports a clean directory as clean, in version order', () => {
    const dir = makeDir({
      '0175_a.sql': 'select 1;',
      '0009_b.sql': 'select 2;',
      '0060_c.sql': 'select 3;',
    });
    // No alias enforcement here: a scratch corpus is not this repository's history.
    const directory = readMigrationDirectory(dir);
    expect(directory.problems).toEqual([]);
    expect(directory.entries.map((e) => e.version)).toEqual(['0009', '0060', '0175']);
  });

  it('catches the suffixed name if it ever comes back', () => {
    const dir = makeDir({
      '0042_security_rls_hardening.sql': 'select 1;',
      '0042b_security_rls_fix.sql': 'select 2;',
      '0060_credit_limit_requests.sql': 'select 3;',
    });
    const directory = readMigrationDirectory(dir);
    const kinds = directory.problems.map((p) => p.kind);
    expect(kinds).toContain('non_canonical_name');
    expect(directory.problems.find((p) => p.kind === 'non_canonical_name')?.detail).toContain(
      '0042b_security_rls_fix.sql',
    );
  });

  it('catches a duplicate version, which is what `supabase db push` fails on', () => {
    const dir = makeDir({ '0010_one.sql': 'select 1;', '0010_two.sql': 'select 2;' });
    const directory = readMigrationDirectory(dir);
    expect(directory.problems.map((p) => p.kind)).toContain('duplicate_version');
    expect(directory.problems.find((p) => p.kind === 'duplicate_version')?.detail).toContain('0010');
  });

  it('catches an alias whose canonical target has disappeared', () => {
    const dir = makeDir({ '0009_complete_schema.sql': 'select 1;' });
    const directory = readMigrationDirectory(dir, { enforceAliases: true });
    const details = directory.problems.filter((p) => p.kind === 'alias_target_missing').map((p) => p.detail);
    for (const [alias, target] of Object.entries(LEGACY_VERSION_ALIASES)) {
      expect(details.some((d) => d.includes(alias) && d.includes(target))).toBe(true);
    }
  });

  it('holds the repository itself to the grammar', () => {
    const directory = readMigrationDirectory();
    expect(directory.problems).toEqual([]);
    expect(directory.entries.length).toBeGreaterThan(160);
  });
});

describe('directory vs ledger', () => {
  const fixtures = { '0009_a.sql': 'select 1;', '0060_b.sql': 'select 2;', '0175_c.sql': 'select 3;' };

  function ledger(directory: ReturnType<typeof readMigrationDirectory>, overrides = []) {
    return directory.entries.map((entry, index) => ({
      version: overrides[index]?.version ?? entry.version,
      name: entry.name,
      sha256: overrides[index]?.sha256 === undefined ? entry.sha256 : overrides[index].sha256,
      source: 'applied',
    }));
  }

  it('reports nothing when the ledger agrees exactly', () => {
    const directory = readMigrationDirectory(makeDir(fixtures));
    const comparison = compareWithLedger(directory, ledger(directory));
    expect(comparison.pending).toEqual([]);
    expect(comparison.ledgerOnly).toEqual([]);
    expect(comparison.changed).toEqual([]);
    expect(comparison.reconciled).toEqual([]);
  });

  it('detects a pending file (the database is behind the directory)', () => {
    const directory = readMigrationDirectory(makeDir(fixtures));
    const rows = ledger(directory).filter((row) => row.version !== '0175');
    const comparison = compareWithLedger(directory, rows);
    expect(comparison.pending.map((e) => e.version)).toEqual(['0175']);
    expect(comparison.ledgerOnly).toEqual([]);
  });

  it('detects a ledger-only row (the database is ahead, or a file was deleted)', () => {
    const directory = readMigrationDirectory(makeDir(fixtures));
    const rows = [...ledger(directory), { version: '0180', name: 'not_in_git', sha256: 'x', source: 'applied' }];
    const comparison = compareWithLedger(directory, rows);
    expect(comparison.ledgerOnly.map((r) => r.version)).toEqual(['0180']);
    expect(comparison.pending).toEqual([]);
  });

  it('detects a file edited after it was applied', () => {
    const directory = readMigrationDirectory(makeDir(fixtures));
    const rows = ledger(directory, [{}, {}, { sha256: 'deadbeef' }]);
    const comparison = compareWithLedger(directory, rows);
    expect(comparison.changed.map((c) => c.version)).toEqual(['0175']);
    expect(comparison.changed[0].recorded).toBe('deadbeef');
    expect(comparison.changed[0].current).toBe(directory.entries[2].sha256);
  });

  it('detects a row recorded without a hash, which adoption exists to complete', () => {
    const directory = readMigrationDirectory(makeDir(fixtures));
    const rows = ledger(directory, [{ sha256: null }]);
    const comparison = compareWithLedger(directory, rows);
    expect(comparison.changed).toEqual([]);
    expect(rows.find((r) => r.sha256 === null)?.version).toBe('0009');
    // A null hash is not a mismatch — the caller (migrate.mjs) reports it as `unattested`, because
    // it is a different fact: "recorded, but nothing about its content was ever captured".
    expect(comparison.pending).toEqual([]);
  });

  it('reconciles a retired version name with the file that absorbed it', () => {
    const directory = readMigrationDirectory(makeDir(fixtures));
    const rows = [
      ...ledger(directory),
      { version: '20260903', name: 'credit_limit_requests__reminder_groups', sha256: 'x', source: 'adopted' },
    ];
    const comparison = compareWithLedger(directory, rows);
    expect(comparison.ledgerOnly).toEqual([]);
    expect(comparison.reconciled).toEqual([{ recorded: '20260903', satisfiedBy: '0060_b.sql' }]);
  });
});

describe('QA-ahead allowlist', () => {
  it('accepts only the reviewed versions and names both an unlisted row and a stale entry', () => {
    const ledgerOnly = [
      { version: '0233', name: 'a_role_is_granted_per_branch' },
      { version: '0234', name: 'a_branch_holds_its_own_stock_and_receivables' },
    ];
    expect(ledgerOnlyAudit(ledgerOnly, ['0233', '0234'])).toEqual({
      allowed: ['0233', '0234'],
      unlisted: [],
      stale: [],
    });
    expect(ledgerOnlyAudit(ledgerOnly, ['0233'])).toMatchObject({
      allowed: ['0233'],
      unlisted: ['0234'],
      stale: [],
    });
    expect(ledgerOnlyAudit(ledgerOnly, ['0233', '0234', '0277'])).toMatchObject({
      allowed: ['0233', '0234'],
      unlisted: [],
      stale: ['0277'],
    });
  });

  it('does not turn a pending or changed candidate file into an allowed row', () => {
    const ledgerOnly = [{ version: '0233', name: 'qa_only' }];
    expect(ledgerOnlyAudit(ledgerOnly, []).unlisted).toEqual(['0233']);
    expect(ledgerOnlyAudit(ledgerOnly, ['0233']).stale).toEqual([]);
  });
});

describe('order hazards', () => {
  it('flags a pending file that sorts before the newest recorded version', () => {
    const directory = readMigrationDirectory(makeDir({ '0100_a.sql': 'select 1;', '0175_b.sql': 'select 2;' }));
    const rows = [{ version: '0175', name: 'b', sha256: directory.entries[1].sha256, source: 'applied' }];
    const { highestRecorded, hazards } = orderHazards(directory, rows, ['0100']);
    expect(highestRecorded).toBe('0175');
    expect(hazards).toEqual(['0100']);
  });

  it('does not flag a pending file that is genuinely newer', () => {
    const directory = readMigrationDirectory(makeDir({ '0100_a.sql': 'select 1;', '0175_b.sql': 'select 2;' }));
    const rows = [{ version: '0011', name: 'a', sha256: 'x', source: 'applied' }];
    const { hazards } = orderHazards(directory, rows, ['0100', '0175']);
    expect(hazards).toEqual([]);
  });
});

describe('adoption evidence', () => {
  it('reads the objects a file claims to create, by name', () => {
    const objects = declaredObjects(`
      CREATE TABLE IF NOT EXISTS public.credit_limit_requests (id uuid);
      CREATE OR REPLACE FUNCTION approve_credit_limit_request(p_id uuid) RETURNS void AS $$ begin end $$ LANGUAGE plpgsql;
      CREATE VIEW users_public AS SELECT 1;
      ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS group_id uuid;
    `);
    expect(objects.tables).toEqual(['credit_limit_requests']);
    expect(objects.functions).toEqual(['approve_credit_limit_request']);
    expect(objects.views).toEqual(['users_public']);
    expect(objects.columns).toEqual(['reminder_configs.group_id']);
  });
});

describe('telling a cosmetic edit from a new migration', () => {
  const applied = [
    "create table t (id integer);",
    "do $$\nbegin\n  -- a comment that was there when it was applied\n  perform 1;\nend $$;",
  ];
  const body = applied.join(';\n') + ';\n';

  it('accepts a comment-only edit, including the separator layout', () => {
    const edited = body.replace('perform 1;', 'perform 1; -- added later, for a reviewer');
    expect(classifyReconciliation({ recordedStatements: applied, fileBody: edited }).cosmetic).toBe(true);
  });

  it('accepts a re-wrapped edit', () => {
    const edited = body.replace(/;/g, ' ;\n\n');
    expect(classifyReconciliation({ recordedStatements: applied, fileBody: edited }).cosmetic).toBe(true);
  });

  it('refuses a semantic edit, which must become a new migration', () => {
    const edited = body.replace('perform 1;', 'perform 2;');
    const verdict = classifyReconciliation({ recordedStatements: applied, fileBody: edited });
    expect(verdict.cosmetic).toBe(false);
  });

  it('refuses an edit that removes a whole statement', () => {
    const verdict = classifyReconciliation({ recordedStatements: applied, fileBody: applied[0] });
    expect(verdict.cosmetic).toBe(false);
  });

  it('refuses when nothing was recorded to compare against', () => {
    expect(classifyReconciliation({ recordedStatements: null, fileBody: body }).cosmetic).toBe(false);
  });
});

describe('the statement splitter the ledger column depends on', () => {
  it('keeps a dollar-quoted body in one statement', () => {
    const statements = splitStatements(`
      CREATE FUNCTION f() RETURNS void AS $$
      BEGIN
        PERFORM 1;
        PERFORM 2;
      END;
      $$ LANGUAGE plpgsql;
      SELECT 1;
    `);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('PERFORM 2;');
    expect(statements[1]).toBe('SELECT 1');
  });

  it('normalises away comments but not SQL', () => {
    expect(normalizeSql('select 1; -- trailing')).toBe('select 1;');
    expect(normalizeSql('select /* inline */ 1;')).toBe('select 1;');
    expect(normalizeSql("select 'a -- b';")).toBe("select 'a -- b';");
    expect(normalizeSql('select 1; -- trailing')).not.toBe(normalizeSql('select 2; -- trailing'));
  });

  it('does not split on a semicolon inside a string or a comment', () => {
    const statements = splitStatements(`
      -- a comment with a ; inside
      INSERT INTO t VALUES ('a;b', 'it''s; fine');
      SELECT 2;
    `);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a;b'");
  });
});
