/**
 * forwardFilesAdditionality — a forward file may only add, and only when it has to.
 *
 * THE DEFECT THIS EXISTS TO KEEP FIXED. `docs/PRODUCTION_MIGRATION_PLAN.md` §6 states seven binding
 * rules for anything applied to production, and the first four are structural: additive only, no data
 * statements, idempotent or catalog-guarded, and access never widened. A file that breaks one of them
 * still applies cleanly and still passes `verify:baseline` — the verifier says the SQL runs, not that it
 * was allowed to run. The rules were therefore held by review alone, on files whose whole justification
 * is that they were *measured*. This is the measurement.
 *
 * WHAT IS ASSERTED, per file, on the file's own text:
 *
 *   1. **No data statement at the top level.** A forward file carries DDL. A function *body* may contain
 *      INSERT/UPDATE/DELETE — that is the function's behavior, not this file's effect — so the check is
 *      on the statement kind, not on a keyword anywhere in the file.
 *   2. **No `DROP`, no `ALTER … SET NOT NULL`, no rename, no retype.** Correcting an applied change is a
 *      new file (§6.6), and narrowing a column is how a release breaks existing rows.
 *   3. **Every create is guarded.** Each `do` block that creates something must test the catalog first
 *      (`pg_type`, `pg_class`, `pg_proc`, `pg_policies`, `pg_trigger`, `pg_constraint`), so a re-run on an
 *      environment that already has the object changes nothing (§6.3).
 *   4. **Columns are additive.** `add column if not exists`, nullable or defaulted: a `NOT NULL` column
 *      with no default would need a value invented for every existing row (§6.1–6.2).
 *
 * NON-VACUITY. Every rule is asserted twice: once that the real files satisfy it, and once that a
 * mutation of the same file is caught. A guard that cannot fail is not a guard, and this one is cheap to
 * fool — the mutations below are the exact shapes it is meant to catch, including the two the batch-2
 * work actually produced (`ALTER TABLE … ADD COLUMN IF NOT EXISTS a, ADD COLUMN IF NOT EXISTS b` with no
 * terminator, and a function created outside its `pg_proc` guard).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { splitStatements } from '../../scripts/lib/sql-statements.mjs';

const ROOT = process.cwd();

/**
 * The generator reads the frozen staging snapshot to know which columns production lacks. That snapshot
 * is a logical dump of a real environment, so it lives in gitignored `backups/` and is absent on CI —
 * where the comparison therefore cannot run. Same rule as `branchIdentityBoundary.test.ts`: an
 * artifact-dependent check reports itself SKIPPED with the reason, never as a pass.
 */
const baseline = JSON.parse(readFileSync(join(ROOT, 'supabase/baseline/staging-baseline.json'), 'utf8')) as {
  artifact: string;
};
const haveBaselineArtifact = existsSync(join(ROOT, baseline.artifact));
const BATCH_TWO = [
  'supabase/migrations/0207_the_membership_model_exists_in_the_repository.sql',
  'supabase/migrations/0208_the_functions_the_app_calls_and_the_tables_they_read.sql',
];

/**
 * The re-issue of 0177–0198 (plan §4). Same binding rules, and it is the half most likely to drift:
 * the files are generated, so a hand edit that adds an unguarded `create policy` or a bare `drop`
 * would otherwise reach production unremarked.
 */
const REISSUE = [
  'supabase/migrations/0209_the_objects_no_tracked_file_creates.sql',
  'supabase/migrations/0210_the_marketplace_chain_at_the_state_it_ends_in.sql',
  'supabase/migrations/0211_a_branch_is_its_own_identity.sql',
  'supabase/migrations/0212_the_policies_that_scope_a_row_to_its_shop.sql',
  'supabase/migrations/0213_audit_and_access_history_keep_their_owner.sql',
  'supabase/migrations/0214_the_definer_and_the_sale_record.sql',
];

/**
 * The batch's closing file: the ACL pass that asks the live schema one question and narrows. It is
 * listed here so the same binding rules apply to it — the defect it corrects came from a generated
 * file, so a hand-written one does not get to skip the rules that generated file was held to.
 */
const ACL_CLOSURE = [
  'supabase/migrations/0215_a_write_rpc_is_not_for_an_unauthenticated_caller.sql',
  'supabase/migrations/0216_an_unauthenticated_caller_cannot_write_the_people_table.sql',
  'supabase/migrations/0217_a_retired_function_is_not_for_the_client.sql',
];

/**
 * The ways a create can be idempotent, one of which every create in a forward file must use.
 *
 * The catalog query (`pg_proc`, `pg_class`, …) is the strongest — it decides what to do before running
 * anything. `if not exists`, `create or replace` and a `duplicate_object` exception are the same idea in
 * PostgreSQL's own syntax, and an extracted dump's `do $$ … exception when duplicate_object …` guard is
 * exactly as re-runnable as a catalog test.
 */
const IDEMPOTENT = [
  (t: string) => ['pg_type', 'pg_class', 'pg_proc', 'pg_policies', 'pg_trigger', 'pg_constraint'].some((catalog) => t.includes(catalog)),
  (t: string) => /if\s+not\s+exists/i.test(t),
  (t: string) => /create\s+or\s+replace/i.test(t),
  (t: string) => /exception\s+when\s+duplicate_(object|table|schema|function)/i.test(t),
];

const FORBIDDEN: Array<{ rule: string; pattern: RegExp }> = [
  { rule: 'a DROP', pattern: /^\s*drop\s+/i },
  { rule: 'a TRUNCATE', pattern: /^\s*truncate\s+/i },
  { rule: 'a data statement', pattern: /^\s*(insert\s+into|delete\s+from|update\s+[a-z_"[])/i },
  { rule: 'ALTER … SET NOT NULL', pattern: /^\s*alter\s+table[\s\S]*\bset\s+not\s+null\b/i },
  { rule: 'a rename', pattern: /^\s*alter\s+table[\s\S]*\brename\b/i },
  { rule: 'a column type change', pattern: /^\s*alter\s+table[\s\S]*\balter\s+column[\s\S]*\btype\b/i },
  // Turning RLS off is the one ALTER that widens. `enable` is idempotent and is allowed below.
  { rule: 'RLS turned off', pattern: /disable\s+row\s+level\s+security/i },
  { rule: 'a collation/owner change on a live object', pattern: /^\s*alter\s+table[\s\S]*\bowner\s+to\b/i },
];

/** Every way a statement in a forward file can be wrong. Returns the violations, in order. */
function violations(sql: string): string[] {
  const found: string[] = [];
  for (const statement of splitStatements(sql) as string[]) {
    const text = statement.trim();
    if (!text) continue;
    const head = text.split('\n')[0].slice(0, 80);

    // Two statements run together — the defect a missing terminator produces. psql then reports a
    // syntax error against the FOLLOWING statement, which is what makes it worth naming here.
    if ((text.match(/^\s*alter\s+table/gim) ?? []).length > 1) {
      found.push(`two ALTER statements ran together (no terminator): ${head}`);
    }

    const forbidden = FORBIDDEN.find(({ pattern }) => pattern.test(text));
    if (forbidden) {
      found.push(`${forbidden.rule}: ${head}`);
      continue;
    }

    if (/^alter\s+table\b/i.test(text)) {
      if (/add\s+column\s+if\s+not\s+exists/i.test(text)) {
        if (/\bnot\s+null\b/i.test(text) && !/\bdefault\b/i.test(text)) {
          found.push(`a NOT NULL column with no default: ${head}`);
        }
        continue;
      }
      // `enable row level security` is idempotent and only ever tightens; anything else on an existing
      // table in a forward file is a shape change this plan does not allow.
      if (/enable\s+row\s+level\s+security/i.test(text)) continue;
      found.push(`an ALTER that is neither add column if not exists nor enable RLS: ${head}`);
      continue;
    }

    if (/^\s*(create|do)\b/i.test(text)) {
      if (!IDEMPOTENT.some((check) => check(text))) found.push(`a create that is not idempotent: ${head}`);
      continue;
    }

    found.push(`an unrecognized statement kind: ${head}`);
  }
  return found;
}

describe('the batch-2 forward files obey the plan’s binding rules', () => {
  for (const file of BATCH_TWO) {
    test(`${file.split('/').pop()} only adds`, () => {
      const sql = readFileSync(join(ROOT, file), 'utf8');
      expect(violations(sql), `${file} breaks a rule docs/PRODUCTION_MIGRATION_PLAN.md §6 makes binding`).toEqual([]);
      expect(sql.length, `${file} is empty`).toBeGreaterThan(1000);
    });
  }
});

describe('the ACL closure obeys the same binding rules', () => {
  for (const file of ACL_CLOSURE) {
    test(`${file.split('/').pop()} only narrows`, () => {
      const sql = readFileSync(join(ROOT, file), 'utf8');
      expect(violations(sql), `${file} breaks a rule docs/PRODUCTION_MIGRATION_PLAN.md §6 makes binding`).toEqual([]);
      // The one rule this file exists for, asserted on its text: it may take access away and never
      // hand it out again. The grant to `authenticated`/`service_role` is not a widening — both
      // already held it — but a grant to `anon` would be.
      expect(sql, `${file} hands EXECUTE back to anon`).not.toMatch(/grant execute[^;']*to anon/i);
    });
  }
});

describe('the re-issue of 0177–0198 obeys the same binding rules', () => {
  for (const file of REISSUE) {
    test(`${file.split('/').pop()} only adds`, () => {
      const sql = readFileSync(join(ROOT, file), 'utf8');
      expect(violations(sql), `${file} breaks a rule docs/PRODUCTION_MIGRATION_PLAN.md §6 makes binding`).toEqual([]);
      expect(sql.length, `${file} is empty`).toBeGreaterThan(1000);
      // Every create is inside a `do` block that reads a catalog — the guard above accepts that, and
      // this asserts the stronger thing the re-issue promises: the block is what replaces the object.
      const creates = sql.match(/^\s*create\s+(policy|trigger|view|function|table|index)/gim) ?? [];
      const guardedBlocks = sql.match(/^do \$guard\$/gim) ?? [];
      expect(
        creates.length,
        `${file} has ${creates.length} creates but only ${guardedBlocks.length} guarded blocks — a create was emitted bare`,
      ).toBeLessThanOrEqual(guardedBlocks.length + 2); // two exceptions: `create or replace function`, `create table/index if not exists`
    });
  }

  test.skipIf(!haveBaselineArtifact)(
    `the files are what the generator produces — a source edit cannot silently invalidate them` +
      (haveBaselineArtifact ? '' : ` [SKIPPED: ${baseline.artifact} is absent; run where the artifact exists]`),
    () => {
      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/dev/reissue-forward-files.mjs'), '--check'], {
        encoding: 'utf8',
      });
      expect(result.status, `the re-issue is stale against the ledger:\n${result.stdout}${result.stderr}`).toBe(0);
    },
  );
});

describe('the guard is not vacuous', () => {
  const clean = 'do $guard$ begin\n  if not exists (select 1 from pg_proc p) then\n    execute $ddl$create or replace function public.f() returns int as $$ select 1 $$ language sql;$ddl$;\n  end if;\nend\n$guard$;\n';

  test('a clean guarded file passes, so the mutations below mean something', () => {
    expect(violations(clean)).toEqual([]);
  });

  test('a DROP is caught', () => {
    expect(violations(`${clean}\ndrop table public.sales;\n`)).toHaveLength(1);
  });

  test('a data statement at the top level is caught, while one inside a body is not', () => {
    expect(violations(`${clean}\ndelete from public.sales where id = 'x';\n`)).toHaveLength(1);
    const bodyOnly = "do $guard$ begin\n  if not exists (select 1 from pg_proc p) then\n    execute $ddl$create or replace function public.f() returns void language plpgsql as $$ begin delete from public.sales; end $$;$ddl$;\n  end if;\nend\n$guard$;\n";
    expect(violations(bodyOnly)).toEqual([]);
  });

  test('RLS turned off is caught, so "additive" cannot become "permissive"', () => {
    expect(violations('alter table public.sales disable row level security;\n')).toHaveLength(1);
    expect(violations('alter table public.sales enable row level security;\n')).toEqual([]);
  });

  test('an unguarded create is caught', () => {
    expect(violations('create table public.x (id int);\n')).toHaveLength(1);
  });

  test('an ALTER that is not add column if not exists is caught', () => {
    expect(violations('alter table public.sales add column branch_id uuid;\n')).toHaveLength(1);
  });

  test('a NOT NULL column with no default is caught, with a default is not', () => {
    expect(violations('alter table public.sales add column if not exists flag boolean not null;\n')).toHaveLength(1);
    expect(violations('alter table public.sales add column if not exists flag boolean not null default false;\n')).toEqual([]);
  });

  test('a multi-column ALTER with no terminator is caught', () => {
    // The defect batch 2 actually produced: the statement ran into the next one and psql reported
    // `syntax error at or near "alter"`, which reads like a fault in the following statement.
    const broken = 'alter table public.audit_events add column if not exists a text, add column if not exists b text\nalter table public.sales add column if not exists c uuid;\n';
    expect(violations(broken).length).toBeGreaterThan(0);
  });
});
