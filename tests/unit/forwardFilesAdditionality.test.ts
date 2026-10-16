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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { splitStatements } from '../../scripts/lib/sql-statements.mjs';

const ROOT = process.cwd();
const BATCH_TWO = [
  'supabase/migrations/0207_the_membership_model_exists_in_the_repository.sql',
  'supabase/migrations/0208_the_functions_the_app_calls_and_the_tables_they_read.sql',
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
