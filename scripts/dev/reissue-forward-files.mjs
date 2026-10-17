#!/usr/bin/env node
/**
 * reissue-forward-files.mjs — the intent of 0177–0198, expressed in files numbered after 0208.
 *
 * WHY THIS EXISTS
 *   `docs/PRODUCTION_MIGRATION_PLAN.md` §4 measured why batches 3–4 cannot be scheduled: the
 *   verifier sorts a `--files` selection by version and the production gate refuses a non-ascending
 *   batch, so `0188` always precedes `0207` — and the objects `0188` needs are created by `0207`.
 *   On the real engine, in the order the gate refuses, those files apply cleanly; ascending, they
 *   cannot. The repository's own rule is the fix — an applied change is corrected by a new file,
 *   never by replaying history — applied to files that were written assuming a history production
 *   never had.
 *
 * WHAT IT PRODUCES (six files; the per-file selection is the PLAN table below)
 *   0209  the objects and columns no tracked file creates — extracted schema-only from the accepted
 *         staging baseline, plus the two functions 0168 defines (0168 is pre-position, so production
 *         never received them), each carrying the ledger's own EXECUTE contract.
 *   0210  the marketplace chain: 0184's surviving column, 0185's listing/view/search, 0187's
 *         corrections (2-argument writer, no branch radius). The intermediate states 0186/0187
 *         overwrote are NOT re-issued — only the state the range ends in.
 *   0211  branch identity and responsibility (0183, 0188, 0196).
 *   0212  the tenant-scoped policies (0178, 0180, 0182) and 0195's permission gates.
 *   0213  audit and access history (0189, 0192, 0193, 0194, 0197).
 *   0214  the definer's search_path (0177) and the sale/return bodies (0198).
 *
 * THE SHAPE, WHICH IS BATCH 2'S SHAPE. `tests/unit/forwardFilesAdditionality.test.ts` holds every
 * forward file to four rules, and one of them is that each create is guarded by a catalog test. So a
 * statement is emitted in exactly one of three ways, never bare unless batch 2 does the same:
 *   * `alter table … add column if not exists` and `create table/index if not exists` — bare; they
 *     are idempotent in PostgreSQL's own syntax, and batch 2 emits them bare too.
 *   * `create or replace function` — bare for the same reason, and only for a name batch 2 does not
 *     already create.
 *   * everything else — inside `do $guard$ … $guard$` with a real catalog test on the object it
 *     concerns (`pg_policies`, `pg_trigger`, `pg_class`, `pg_proc`, `pg_constraint`, `pg_attribute`),
 *     dropping the old definition in the same statement that replaces it.
 * `notify pgrst` is dropped: batch 2 does not emit it, the cache reload is not a schema change, and a
 * guarded `notify` would be guard-shaped noise.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   * It does not re-issue a function 0207/0208 already creates (batch 2 carries the ledger's last
 *     definition per name); the names are computed from those files at run time.
 *   * It does not replay a superseded intermediate state (0184's radius writer, 0186's branch read).
 *   * It does not invent a schema: every column and function is either in a tracked migration or
 *     extracted schema-only from the accepted staging baseline, and each one says which.
 *   * It never widens access, and it refuses rather than guesses: an unclassifiable statement, a skip
 *     that no longer matches the file it names, or a missing correction all stop the run.
 *
 * USAGE
 *   node scripts/dev/reissue-forward-files.mjs --check
 *   node scripts/dev/reissue-forward-files.mjs --write
 */

import fs from 'node:fs';
import path from 'node:path';

import { splitStatements } from '../lib/sql-statements.mjs';
import { stripSqlComments } from '../lib/rpc-contract.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/baseline/staging-baseline.json'), 'utf8'));
const PRODUCTION_ARTIFACT = 'backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-01T11-21-48.sql';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const check = !write;

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const refuse = (message) => {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
};
const q = (text) => String(text).replace(/'/g, "''");
const bare = (table) => String(table).replace(/^public\./i, '').replace(/"/g, '');
/** A name as the catalog keys it: the schema prefix removed, so `public.shops` and `shops` are one name. */
const unqualified = (name) => String(name ?? '').replace(/^public\./i, '').replace(/"/g, '').trim();
/** `public.shops.marketplace_listed` → `shops.marketplace_listed`; the last two dotted segments. */
const qualifiedColumn = (name) => unqualified(name).split('.').filter(Boolean).slice(-2).join('.');
/** The table a policy or trigger belongs to, read from the statement's own `on <table>` head. */
const tableOf = (statement) => {
  const m = /\bon\s+(?:table\s+)?(?:public\.)?"?([a-z_0-9.]+)"?/i.exec(statement);
  return unqualified(m?.[1] ?? '');
};
// `$$` becomes `$ddl$`, never the tag the wrapper uses: a `do $$ … $$;` statement is carried INTO
// `execute $stmt$…$stmt$`, and re-using one tag for both ends the outer literal at the inner `do`.
const ddl = (text) =>
  text.replace(/\$\$/g, '$ddl$').replace(/\$base\$|\$function\$|\$stmt\$/g, '$fn$');
const asStatement = (text) => (/;\s*$/.test(text.trim()) ? text.trim() : `${text.trim()};`);
const oneLine = (text) => text.trim().replace(/\s+/g, ' ');

const fileFor = (version) => {
  const name = fs.readdirSync(MIGRATIONS).find((f) => f.startsWith(version + '_'));
  if (!name) refuse(`no migration file for version ${version}`);
  return name;
};
const statementsOf = (version) => splitStatements(stripSqlComments(read(`supabase/migrations/${fileFor(version)}`)));

// ── What batch 2 already carries ───────────────────────────────────────────────────────────────
const BATCH_TWO = ['0207', '0208'];
const carriedFunctions = new Set();
const carriedColumns = new Set(); // `${table}.${column}`
for (const version of BATCH_TWO) {
  for (const statement of statementsOf(version)) {
    const fn = /create\s+(or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?/i.exec(statement);
    if (fn) carriedFunctions.add(fn[2].toLowerCase());
    for (const alter of statement.matchAll(/ALTER TABLE (?:public\.)?([a-z_0-9]+)([\s\S]*?)(?:;|$)/gi)) {
      for (const col of alter[2].matchAll(/ADD COLUMN IF NOT EXISTS\s+"?([a-z_0-9]+)"?/gi)) {
        carriedColumns.add(`${bare(alter[1])}.${col[1]}`);
      }
    }
  }
}

// ── The substrate: columns staging has, production lacks, the range references ─────────────────
/** Columns of one table, read from a logical backup's `create table if not exists public."x" (…)`. */
function tableColumns(file, table) {
  const text = read(file);
  const m = new RegExp(`create table if not exists public\\."${table}" \\(([\\s\\S]*?)\\n\\);`, 'i').exec(text);
  if (!m) return null;
  const out = new Map();
  for (const line of m[1].split('\n')) {
    if (/constraint|primary key|foreign key|unique|check/i.test(line)) continue;
    const c = /^\s+"([a-z_0-9]+)"\s+([a-z_0-9 ]+.*?),?$/i.exec(line);
    if (c) out.set(c[1], c[2].trim());
  }
  return out;
}

const RANGE = '0177,0178,0180,0182,0183,0184,0185,0186,0187,0188,0189,0191,0192,0193,0194,0195,0196,0197,0198'.split(',');

/**
 * A column belongs in the substrate when all four hold: staging has it, production does not, batch 2
 * does not add it, and a statement in this range mentions it **together with its table** — so
 * `status` is only carried for a table the range actually reads or writes `status` on.
 */
function substrateColumns() {
  const text = read(BASELINE.artifact);
  const tables = new Set();
  for (const m of text.matchAll(/create table if not exists public\."([a-z_0-9]+)"/gi)) tables.add(m[1]);

  const rangeStatements = [];
  for (const version of RANGE) for (const statement of statementsOf(version)) rangeStatements.push({ version, statement });

  const out = [];
  for (const table of [...tables].sort()) {
    const staging = tableColumns(BASELINE.artifact, table);
    const production = tableColumns(PRODUCTION_ARTIFACT, table);
    if (!staging || !production) continue;
    for (const [column, type] of staging) {
      if (production.has(column)) continue;
      if (carriedColumns.has(`${table}.${column}`)) continue;
      const cited = rangeStatements.filter(
        ({ statement }) =>
          new RegExp(`\\b${column}\\b`, 'i').test(statement) && new RegExp(`\\b${table}\\b`, 'i').test(statement),
      );
      if (!cited.length) continue;
      out.push({
        table,
        column,
        type: type.replace(/\s+$/, ''),
        citedIn: [...new Set(cited.map((c) => c.version))].sort(),
      });
    }
  }
  return out;
}

// ── Classification ──────────────────────────────────────────────────────────────────────────────
function classify(statement) {
  const s = statement.trim();
  const name = (re) => re.exec(s)?.[1];
  if (/^create\s+(or\s+replace\s+)?function/i.test(s))
    return { kind: 'function', name: name(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?/i) };
  if (/^create\s+(unique\s+)?index\s+if\s+not\s+exists/i.test(s)) return { kind: 'index' };
  if (/^create\s+table\s+if\s+not\s+exists/i.test(s)) return { kind: 'table' };
  if (/^create\s+constraint\s+trigger/i.test(s))
    return { kind: 'trigger', name: name(/trigger\s+"?([a-z_0-9]+)"?/i), table: name(/on\s+([a-z_0-9."]+)/i) };
  if (/^create\s+trigger/i.test(s))
    return { kind: 'trigger', name: name(/trigger\s+(?:if\s+not\s+exists\s+)?"?([a-z_0-9]+)"?/i), table: name(/on\s+([a-z_0-9."]+)/i) };
  if (/^create\s+policy/i.test(s))
    return {
      kind: 'policy',
      name: name(/^create\s+policy\s+"?([a-z_0-9]+)"?/i),
      table: name(/^create\s+policy\s+"?[a-z_0-9]+"?\s+on\s+(?:table\s+)?(?:public\.)?"?([a-z_0-9.]+)"?/i),
    };
  if (/^create\s+view/i.test(s))
    return { kind: 'view', name: name(/^create\s+view\s+(?:public\.)?"?([a-z_0-9]+)"?/i) };
  if (/^alter\s+table[\s\S]*add\s+column\s+if\s+not\s+exists/i.test(s)) return { kind: 'add-column' };
  if (/^alter\s+table[\s\S]*enable\s+row\s+level\s+security/i.test(s))
    return { kind: 'enable-rls', table: name(/^alter\s+table\s+([a-z_0-9."]+)/i) };
  if (/^alter\s+table[\s\S]*add\s+constraint/i.test(s))
    return {
      kind: 'add-constraint',
      name: name(/add\s+constraint\s+"?([a-z_0-9]+)"?/i),
      table: name(/^alter\s+table\s+([a-z_0-9."]+)/i),
    };
  if (/^alter\s+table[\s\S]*drop\s+constraint\s+if\s+exists/i.test(s))
    return {
      kind: 'drop-constraint',
      name: name(/drop\s+constraint\s+if\s+exists\s+"?([a-z_0-9]+)"?/i),
      table: name(/^alter\s+table\s+([a-z_0-9."]+)/i),
    };
  if (/^alter\s+table[\s\S]*drop\s+column\s+if\s+exists/i.test(s))
    return { kind: 'drop-column', table: name(/^alter\s+table\s+([a-z_0-9."]+)/i) };
  if (/^alter\s+function/i.test(s))
    return { kind: 'alter-function', name: name(/^alter\s+function\s+(?:public\.)?"?([a-z_0-9]+)"?/i) };
  if (/^drop\s+policy\s+if\s+exists/i.test(s))
    return { kind: 'drop-policy', name: name(/^drop\s+policy\s+if\s+exists\s+"?([a-z_0-9]+)"?/i) };
  if (/^drop\s+trigger\s+if\s+exists/i.test(s))
    // The table is part of the identity here: a trigger name is unique per table, not per schema, and
    // the guard needs the table to ask the catalog anything at all. Without it the guard compiled to
    // `relname = 'undefined'`, which is false everywhere — the drop of the superseded definition then
    // never ran anywhere (measured in the emitted 0213 before this was fixed).
    return {
      kind: 'drop-trigger',
      name: name(/^drop\s+trigger\s+if\s+exists\s+"?([a-z_0-9]+)"?/i),
      table: name(/^drop\s+trigger\s+if\s+exists\s+"?[a-z_0-9]+"?\s+on\s+(?:public\.)?"?([a-z_0-9."]+)"?/i),
    };
  if (/^drop\s+function\s+if\s+exists/i.test(s)) return { kind: 'drop-function' };
  if (/^drop\s+view\s+if\s+exists/i.test(s)) return { kind: 'drop-view' };
  if (/^comment\s+on\s+column\s+(?:public\.)?"?([a-z_0-9."]+)/i.test(s))
    return { kind: 'comment', table: name(/^comment\s+on\s+column\s+(?:public\.)?"?([a-z_0-9."]+)/i) };
  if (/^comment\s+on\s+function\s+(?:public\.)?"?([a-z_0-9]+)"?/i.test(s))
    return { kind: 'comment', function: name(/^comment\s+on\s+function\s+(?:public\.)?"?([a-z_0-9]+)"?/i) };
  if (/^comment\s+on\s+(view|policy)\s+(?:public\.)?"?([a-z_0-9.]+)"?/i.test(s)) {
    const m = /^comment\s+on\s+(view|policy)\s+(?:public\.)?"?([a-z_0-9.]+)"?/i.exec(s);
    return { kind: 'comment', on: m[1].toLowerCase(), name: m[2] };
  }
  if (/^comment\s+on\b/i.test(s)) return { kind: 'comment' };
  if (/^grant\b/i.test(s)) {
    const fn = name(/\bon\s+function\s+(?:public\.)?"?([a-z_0-9]+)"?/i);
    return fn ? { kind: 'acl', function: fn } : { kind: 'acl', table: name(/\bon\s+(?:table\s+)?(?:public\.)?"?([a-z_0-9]+)"?/i) };
  }
  if (/^revoke\b/i.test(s)) {
    const fn = name(/\bon\s+function\s+(?:public\.)?"?([a-z_0-9]+)"?/i);
    if (fn) return { kind: 'acl', function: fn };
    const table = name(/\bon\s+(?:table\s+)?(?:public\.)?"?([a-z_0-9]+)"?/i);
    return { kind: 'acl', table };
  }
  if (/^notify\s+pgrst/i.test(s)) return { kind: 'notify' };
  if (/^do\s+\$/i.test(s)) return { kind: 'do-block' };
  return { kind: 'other' };
}

// ── Guards ──────────────────────────────────────────────────────────────────────────────────────
/** The catalog test for one object, in the terms the object is keyed by. */
function subjectExists(subject) {
  const { kind } = subject;
  if (kind === 'policy')
    return `select 1 from pg_policies where schemaname = 'public' and policyname = '${q(subject.name)}'`;
  if (kind === 'trigger')
    return `select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = '${q(bare(subject.table))}' and t.tgname = '${q(subject.name)}'`;
  if (kind === 'view')
    return `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = '${q(subject.name)}' and c.relkind = 'v'`;
  if (kind === 'constraint')
    return `select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relname = '${q(bare(subject.table))}' and c.conname = '${q(subject.name)}'`;
  if (kind === 'function')
    return `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${q(subject.name)}'`;
  if (kind === 'column') {
    const [table, column] = String(subject.name).split('.');
    return `select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relname = '${q(bare(table))}' and a.attname = '${q(column)}' and a.attnum > 0`;
  }
  // A table, or anything else keyed by relation name.
  return `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = '${q(bare(subject.name))}'`;
}

/** The dependency names in a guard, for a statement's note. */
const questionView = (on) => (Array.isArray(on) ? on : [on]).map((subject) => subject.name).join(' and ');

/**
 * A view's dependency is DECLARED, not guessed. A view is the one object whose guard cannot be read
 * from the statement's own grammar (it names no table), and a view guarded on itself is never created
 * on the schema that needs it — which is what happened to `marketplace_listings`: production's own
 * baseline does not contain it, and 0210 skipped the create there because the guard asked whether the
 * view existed. The relations below are the ones the projection reads.
 */
const VIEW_DEPENDENCIES = {
  marketplace_listings: {
    on: [
      { kind: 'table', name: 'shops' },
      { kind: 'table', name: 'products' },
    ],
    note: 'marketplace_listings: the intended projection, created wherever its base relations are (0185 introduced it; production never had it)',
  },
};

/**
 * The DO blocks that read no catalog of their own, with the dependency each needs. They install
 * policies and triggers across a list of tables, or assert a contract — without a declared dependency
 * they run against whatever state they find. The emission refuses anything else of this shape, so a
 * new one cannot be added bare.
 */
const DO_BLOCK_GUARDS = {
  '0182/10': {
    on: { kind: 'table', name: 'app_settings' },
    mentions: 'app_settings',
    note: "0182's assertion — every remaining policy on app_settings has to constrain the row to its shop; run where the table it asserts about is",
  },
  '0185/19': {
    on: { kind: 'view', name: 'marketplace_listings' },
    mentions: 'marketplace_listings',
    note: "0185's contract assertion — run where the listing view it asserts about is",
  },
  '0188/19': {
    on: { kind: 'function', name: 'current_branch_scope' },
    mentions: 'current_branch_scope',
    note: "0188's branch-read policies — run where the scope function they call is (0211 creates it, one file earlier; this sweep is re-issued here, not there, because it is the range's last writer of these policies)",
  },
  '0195/2': {
    on: { kind: 'function', name: 'has_effective_permission' },
    mentions: 'has_effective_permission',
    note: "0195's permission gates — run where the permission function they call is (batch 2 creates it)",
  },
  '0192/13': {
    on: { kind: 'function', name: 'audit_operational_snapshot' },
    mentions: 'audit_operational_snapshot',
    note: "0192's snapshot triggers — run where the audit function they call is (created earlier in this file)",
  },
};

/**
 * THE SHAPE THAT WAS WRONG, AND WHY IT MATTERS BEYOND STYLE.
 *
 * The first version guarded every create on the OBJECT ITSELF — `if exists(<the policy>) then replace
 * it` — which reads cleanly on both baselines and, on production, does nothing at all: the object is
 * exactly what production lacks. `marketplace_listings` was never created there by 0210, and the two
 * `comment on` guards resolved their subject to `public` (`relname = 'public'`), so they could never run
 * anywhere. A re-issue that does nothing is not a re-issue — and a clean PGlite apply cannot tell the
 * two apart, because a block that skips reports no failure.
 *
 * So the guard now names the DEPENDENCY the statement needs: the table a policy or trigger belongs to,
 * the relation a view reads, the function a body calls. The statement runs wherever that dependency is,
 * and therefore CREATES what is missing instead of skipping it. Where even the dependency is absent there
 * is nothing to re-issue against, and skipping is deliberate rather than accidental. `drop` — the
 * superseded definition, which carries its own IF EXISTS — runs first inside the same guard.
 */
function guardedReplace({ on, drop, statement, note }) {
  // The note becomes a single `-- …` line above the block. A newline inside it would end the comment and
  // leave the rest of the sentence as SQL — which is how `my_shop_ids`'s revoke produced
  // `syntax error at or near "default"` on the real engine while the generator reported success.
  if (/[\r\n]/.test(note)) refuse(`a guard note spans lines, so its second line would run as SQL: ${oneLine(note).slice(0, 120)}`);
  const test = (Array.isArray(on) ? on : [on]).map((subject) => `exists (${subjectExists(subject)})`).join(' and ');
  const lines = [`-- ${note}`, 'do $guard$', 'begin', `  if ${test} then`];
  if (drop) lines.push(`    execute $stmt$${ddl(asStatement(drop))}$stmt$;`);
  lines.push(`    execute $stmt$${ddl(asStatement(statement))}$stmt$;`, '  end if;', 'end', '$guard$;');
  return lines.join('\n');
}

/** The statement, run only where `on` is: a removal, a comment, a grant, an assertion, a sweep. */
const runWhere = (on, statement, note) => guardedReplace({ on, statement, note });

/**
 * A definition whose SIGNATURE may change: the old one is dropped where it is, and the intended one is
 * created unconditionally. Guarding the create on the old function — as the object-shaped guard did —
 * leaves exactly the functions this range introduces (`search_marketplace`, `get_my_branches`)
 * uncreated on a schema that lacks them.
 */
function recreate({ object, drop, statement, note }) {
  const lines = [
    `-- ${note}`,
    'do $guard$',
    'begin',
    `  if exists (${subjectExists(object)}) then`,
    `    execute $stmt$${ddl(asStatement(drop))}$stmt$;`,
    '  end if;',
    `  execute $stmt$${ddl(asStatement(statement))}$stmt$;`,
    'end',
    '$guard$;',
  ];
  return lines.join('\n');
}

/**
 * The measured body-anchor corrections for the DO blocks that patch a live definition.
 *
 * ESCAPES ARE BUILT, NOT TYPED. `\r` and `\n` inside these patterns are backslash-r / backslash-n at
 * the SQL level, and writing them through a JavaScript literal is how a substitution silently stops
 * matching; the backslash comes from its code point so the pattern is exactly the SQL the source
 * file carries.
 */
const BACKSLASH = String.fromCharCode(92);
const SQL_LF = `${BACKSLASH}n`;
const SQL_CR = `${BACKSLASH}r`;

function patchTolerances(statement, version) {
  let text = statement;
  if (!text.includes('pg_get_functiondef')) return text; // not a patch block
  const before = text;

  // A body that differs only in line endings is the same body: normalise before patching. Production's
  // catalog stores `record_customer_payment` with CRLF (measured 2026-10-17); the anchors below are LF.
  const readDefinition = 'INTO v_definition;';
  if (!text.includes(readDefinition)) refuse(`${version}: the patch block no longer reads a definition.`);
  text = text.replace(
    readDefinition,
    `${readDefinition}\n  v_definition := replace(replace(v_definition, E'${SQL_CR}${SQL_LF}', E'${SQL_LF}'), E'${SQL_CR}', E'${SQL_LF}');`,
  );

  // A function the catalog does not have is skipped rather than fatal: the cast to `regprocedure` is
  // what made this block fail on a schema missing one of the names, and a patch block is not the place
  // to insist an unrelated object exists. The guard has to sit where its subject is known, and there are
  // exactly two shapes — measured, not assumed:
  //   * 0192 loops `FOREACH v_name IN ARRAY ARRAY[...] LOOP` and casts `v_signature::regprocedure` built
  //     from `v_name`. The test belongs INSIDE the loop, with `CONTINUE`, so one absent name is skipped
  //     and the rest are still patched. (Placed after `BEGIN`, as it first was, it is not a loop body at
  //     all: PostgreSQL refuses `CONTINUE cannot be used outside a loop` and the whole file fails.)
  //   * 0194 casts the literal `'public.update_employee_access(jsonb)'::regprocedure`, with no loop and
  //     no `v_name` declared. The test belongs at the top of the block, with `RETURN`, which a DO block
  //     may execute.
  const exists = (name) =>
    `IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ${name}) THEN`;
  const loop = /FOREACH\s+([a-z_0-9]+)\s+IN\s+ARRAY[\s\S]*?LOOP\n/.exec(text);
  const literals = [...text.matchAll(/'(?:public\.)?([a-z_0-9]+)\s*\([^']*\)'::regprocedure/gi)].map((m) => m[1]);
  if (loop) {
    if (!text.includes(`proname = ${loop[1]}`)) {
      text = text.replace(loop[0], `${loop[0]}    ${exists(loop[1])} CONTINUE; END IF;\n`);
    }
  } else {
    for (const name of [...new Set(literals)]) {
      if (text.includes(`proname = '${name}'`)) continue;
      text = text.replace('BEGIN\n', `BEGIN\n  ${exists(`'${q(name)}'`)} RETURN; END IF;\n`);
    }
  }

  // The anchor search accepts either newline and either case.
  const anchor = `v_begin := position(E'BEGIN${SQL_LF}' IN v_definition);`;
  if (text.includes('v_begin')) {
    if (!text.includes(anchor)) refuse(`${version}: the body-anchor statement moved.`);
    text = text
      .split(anchor)
      .join(`${anchor}\n  IF v_begin = 0 THEN v_begin := position(E'begin${SQL_LF}' IN v_definition); END IF;`);
  }

  // The retry-return sweep is global and case-insensitive for the same reason.
  const returnSweep = `replace(v_definition,'RETURN jsonb_build_object',v_guard||E'${SQL_LF} RETURN jsonb_build_object')`;
  if (text.includes(returnSweep)) {
    text = text
      .split(returnSweep)
      .join(`regexp_replace(v_definition,'RETURN jsonb_build_object',v_guard||E'${SQL_LF} RETURN jsonb_build_object','gi')`);
  }

  if (text === before) refuse(`${version}: the measured patch corrections did not apply — the DO block moved.`);
  return text;
}

// ── The per-file selection ──────────────────────────────────────────────────────────────────────
/**
 * `skip` entries name the statement position (1-based, as the plan's §5 inventory prints it). A skip
 * that no longer matches is refused, so a later edit to a source file cannot silently re-issue the
 * wrong statement.
 */
const PLAN = [
  {
    out: '0214',
    name: '0214_the_definer_and_the_sale_record.sql',
    title: "Definer search_path and the sale's own record",
    because:
      "0177 marks three SECURITY DEFINER functions, and on production two of its three ALTERs name functions\n" +
      'that never existed there (D-1 ×2, measured). 0198 rewrites the two bodies that write the sale, and\n' +
      "production's `process_return` still carries the pre-rename parameter (`p_payload`), so `create or\n" +
      'replace` is refused — the rename is a shape change, not an ordering one (D-3).',
    sources: [
      { version: '0177', skip: [] },
      { version: '0198', skip: [], note: 'process_return is handled below, not copied: its parameter was renamed.' },
    ],
  },
  {
    out: '0213',
    name: '0213_audit_and_access_history_keep_their_owner.sql',
    title: 'Audit and access history',
    because:
      '0189 gives audit rows an owner (tenant/branch/actor) and marks them, 0192 guards consequential\n' +
      'requests before any retry can answer them and attributes the finalized sale, 0193 makes the activity\n' +
      'read carry identity labels, 0194 stops an access edit from widening its editor, 0197 says which branch\n' +
      'a notification belongs to. The functions 0207/0208 already create are not repeated.',
    sources: [
      { version: '0189', skip: [6, 7, 12, 13, 14] },
      { version: '0192', skip: [5, 6, 7] },
      { version: '0193', skip: [7, 8] },
      { version: '0194', skip: [5, 6, 7] },
      { version: '0197', skip: [] },
    ],
    extras: [
      {
        note:
          "`public_all_notifications` — production's tenant-blind ALL policy on `notifications` (read from its own\n" +
          'catalog). 0197 rewrites all three notification policies to the shop and branch scope; leaving this one\n' +
          'in place would OR a blanket `true` back over them, so it is removed with the rewrite it would defeat.',
        sql: runWhere(
          { kind: 'policy', name: 'public_all_notifications' },
          'drop policy if exists public_all_notifications on public.notifications;',
          'the legacy production policy on notifications',
        ),
      },
      {
        note:
          '0181\u2019s two policies, in the form 0181\u2019s own note said belonged here. Batch 1 creates them with a\n' +
          'bare `create policy`, which is not re-runnable where they already exist — measured as the one batch-1\n' +
          'statement that fails against staging\u2019s baseline. This is the same intent, catalog-guarded, and it also\n' +
          'removes two legacy production names that would otherwise keep contributing (an ALL/using-true policy on\n' +
          '`audit_events` defeats the shop-scoped read even though the INSERT privilege already says no).',
        sql:
          [
            ['audit_events_insert', 'the permissive INSERT policy 0181 replaced'],
            ['public_all_audit_events', "production's legacy ALL policy"],
          ]
            .map(([name, what]) =>
              runWhere({ kind: 'policy', name }, `drop policy if exists ${name} on public.audit_events;`, what),
            )
            .join('\n\n') +
          '\n\n' +
          guardedReplace({
            on: { kind: 'table', name: 'audit_events' },
            drop: 'drop policy if exists audit_events_no_client_writes on public.audit_events;',
            statement: `create policy audit_events_no_client_writes on public.audit_events
  for insert to authenticated
  with check (false);`,
            note: '0181 \u00a71: the client cannot write history — re-established wherever audit_events is',
          }) +
          '\n\n' +
          guardedReplace({
            on: { kind: 'table', name: 'audit_events' },
            drop: 'drop policy if exists audit_events_select on public.audit_events;',
            statement: `create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    app_is_admin()
    and (
      user_id is null
      or exists (
        select 1 from public.users u
         where u.id = audit_events.user_id
           and u.shop_id = current_shop_id()
      )
    )
  );`,
            note: '0181 \u00a72: history is read per shop — re-established wherever audit_events is',
          }),
      },
    ],
  },
  {
    out: '0211',
    name: '0211_a_branch_is_its_own_identity.sql',
    title: 'Branch identity, branch scope and a responsible person',
    because:
      '0188 makes a branch its own tenant-scoped object rather than an alias for the shop, 0183 asserts that\n' +
      'deleting a role revokes what it granted, 0196 adds the operating branch\u2019s responsible person. The\n' +
      'functions and triggers 0207/0208 already install are not repeated.',
    sources: [
      { version: '0183', skip: [1] },
      // 0188's branch-read sweep (statement 19) is NOT here: 0180 re-creates one of the seven
      // policies it installs (`stock_adjustments_branch_select`) as a PERMISSIVE policy, and 0180's
      // re-issue lands in 0212 — after this file. Emitted here, the permissive form would be the
      // range's final state, and a permissive policy ORs with its neighbours instead of ANDing with
      // them. Measured on the rehearsal engine 2026-10-17: six of the seven were restrictive and
      // `stock_adjustments_branch_select` was not. The sweep is re-issued last instead, in 0212.
      { version: '0188', skip: [2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 19, 22, 23, 24, 25, 26, 27, 28] },
      { version: '0191', skip: [1, 2, 3, 4, 5, 6, 7, 9, 10] },
      { version: '0196', skip: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] },
    ],
  },
  {
    out: '0212',
    name: '0212_the_policies_that_scope_a_row_to_its_shop.sql',
    title: 'The tenant-scoped policies, and the permission gates',
    because:
      "0178, 0180 and 0182 each close a hole where an admin's session could reach another shop's row, and each\n" +
      'ends with an assertion that refuses to apply while a tenant-blind policy remains. On production the\n' +
      'legacy `public_all_*` (and `authenticated_select`) policies are still in place, so the assertion fires —\n' +
      'the re-issue removes them by name, which is the only thing that makes the assertion pass on a schema\n' +
      'that was set up out of band. 0195 then makes access a permission rather than navigation. 0188\u2019s\n' +
      'branch-read sweep closes the file, because it is the range\u2019s last writer of those seven policies and\n' +
      '0180 rewrites one of them permissively.',
    sources: [
      { version: '0178', skip: [] },
      { version: '0180', skip: [] },
      { version: '0182', skip: [] },
      { version: '0195', skip: [1] },
      {
        version: '0188',
        skip: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
        note:
          'the sweep is here on purpose: it is the range\u2019s LAST writer of the seven branch-read policies, and 0180 (above) re-creates one of them permissively. Applied in this order the final state is the one the range means: seven restrictive policies that AND with the shop-scoped ones.',
      },
    ],
    extras: [
      {
        note:
          "Production's catalog carries a tenant-blind `true` policy on each of these tables (read from the\n" +
          'production baseline; the assertion in each file names what it finds). Removing them by name is the\n' +
          'production-shaped half of the same fix: the scoped policies below are the ones that remain.',
        sql: [
          ['product_variants', 'public_all_product_variants'],
          ['stock_adjustments', 'authenticated_select'],
          ['stock_adjustments', 'stock_adjustments_select_anon'],
          ['cash_reconciliations', 'public_all_cash_reconciliations'],
          ['app_settings', 'public_all_app_settings'],
        ]
          .map(([table, name]) =>
            runWhere({ kind: 'policy', name }, `drop policy if exists ${name} on public.${table};`, `the legacy production policy on ${table}`),
          )
          .join('\n\n'),
      },
    ],
  },
  {
    out: '0210',
    name: '0210_the_marketplace_chain_at_the_state_it_ends_in.sql',
    title: 'The marketplace chain, at the state the range ends in',
    because:
      '0185 published the listing contract and 0187 corrected two things about it: the coverage radius belongs\n' +
      'to the farmer searching and not to the branch (so `shops.marketplace_radius_km` and its three-argument\n' +
      'writer go away), and the search is the farmer\u2019s. 0186\u2019s branch read is superseded by 0188\u2019s, which\n' +
      'batch 2 already carries. What is re-issued is the FINAL state, not the three intermediate ones.',
    sources: [
      { version: '0184', skip: [2, 3, 4, 6, 7, 8, 9, 10] },
      { version: '0185', skip: [14, 15, 16, 17, 18] },
      { version: '0186', skip: [1, 2, 3, 4, 5, 6] },
      { version: '0187', skip: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    ],
  },
];

// ── Emission ────────────────────────────────────────────────────────────────────────────────────
const report = [];

/**
 * An object emitted by two different FILES is a defect, not a redundancy.
 *
 * The re-issue is applied in version order, so when two files both define one policy or function, the
 * higher version decides the final state — which is a fact about the numbering, never about the
 * intent. That is how `stock_adjustments_branch_select` came out PERMISSIVE on the rehearsal engine
 * (0188's restrictive sweep in 0211, 0180's permissive rewrite in 0212): six of the seven branch-read
 * policies were restrictive and the seventh was not, and no count of SQL failures could see it.
 *
 * A duplicate inside ONE file is fine — that file's own order is the intent (a drop followed by a
 * create is emitted as one statement anyway). Across files, the plan has to say which file wins.
 */
const claims = new Map();

/**
 * The ACL statements the ledger makes, kept so they can be applied a second time at the END of the
 * batch — after every create.
 *
 * WHY A SECOND TIME. An ACL statement is re-issued at the position the ledger gives it, and a REVOKE
 * can precede the CREATE it concerns. The guard then correctly skips it (the object is not there
 * yet), the CREATE runs later in the same file, and PostgreSQL hands the new function its DEFAULT
 * EXECUTE to PUBLIC. Measured on the production-baseline rehearsal: `my_shop_ids`, created by 0209 on
 * a schema that never had it, came out executable by PUBLIC. The object is the ledger's; its access
 * should be too, and at the end of the batch it always exists wherever it will exist at all.
 */
const ledgerAcl = [];

/** The functions this batch creates, and whether each is a trigger — the trigger ones get no EXECUTE. */
const createdFunctions = new Map();

function claim(kind, name, out, where) {
  const key = `${kind}:${name}`;
  const seen = claims.get(key);
  if (seen && seen.file !== out) {
    refuse(
      `${where} emits ${kind} ${name}, which ${seen.where} already emitted in ${seen.file}.\n` +
        '  A version number would decide the final state by accident: move the definition into the file that should win.',
    );
  }
  if (!seen) claims.set(key, { file: out, where });
}

function header(out, plan, extraLines) {
  return `-- ═══════════════════════════════════════════════════════════════════════════════
-- ${out} — ${plan.title}
--
-- A RE-ISSUE, NOT A REPLAY. Files 0177–0198 express what production needs, but they cannot be
-- scheduled: the production gate refuses a batch that is not ascending, and ascending they precede
-- 0207/0208 — the files that create what they depend on. Measured 2026-10-17: batch 1 + batch 2 + the
-- fourteen candidates, ascending, still fail 101 statements, 86 of them on objects 0207/0208 create.
-- The repository's own rule is that an applied change is corrected by a new file, so the intent is
-- re-expressed here, after 0208, in the order it actually applies.
--
-- WHY IT IS SAFE TO APPLY WHERE THE STATE ALREADY EXISTS. Every rewrite is catalog-guarded: a policy,
-- trigger, view, constraint or function that is already present is dropped in the same statement that
-- replaces it, so re-running changes nothing. A function 0207 or 0208 already creates is NOT repeated
-- here — batch 2 carries the ledger's last definition per name, and the names are computed from those
-- files at generation time.
--
-- ${plan.because.split('\n').map((line) => `-- ${line}`).join('\n-- ')}
--
-- GENERATED BY scripts/dev/reissue-forward-files.mjs — edit the plan there, not this file.
-- ═══════════════════════════════════════════════════════════════════════════════
${extraLines ? `\n${extraLines}\n` : ''}`;
}

function emitSource(sourceVersion, out) {
  const { skip, note } = sourceVersion;
  const all = statementsOf(sourceVersion.version);
  for (const position of skip) {
    if (position < 1 || position > all.length) refuse(`${sourceVersion.version}: skip ${position} is out of range.`);
  }
  const kept = all
    .map((statement, index) => ({ statement, position: index + 1 }))
    .filter((entry) => !skip.includes(entry.position));

  const chunks = [];
  for (let i = 0; i < kept.length; i += 1) {
    const { statement, position } = kept[i];
    const kind = classify(statement);
    const next = kept[i + 1] ? classify(kept[i + 1].statement) : null;
    const foldsWithNext =
      next &&
      ((kind.kind === 'drop-policy' && next.kind === 'policy' && next.name === kind.name) ||
        (kind.kind === 'drop-trigger' && next.kind === 'trigger' && next.name === kind.name) ||
        (kind.kind === 'drop-view' && next.kind === 'view') ||
        (kind.kind === 'drop-function' && next.kind === 'function') ||
        (kind.kind === 'drop-constraint' && next.kind === 'add-constraint' && next.name === kind.name));
    const trace = (text) => `-- ${sourceVersion.version} statement ${position} — ${oneLine(statement).slice(0, 88)}…\n${text}`;

    switch (kind.kind) {
      case 'function': {
        if (carriedFunctions.has(kind.name)) {
          report.push(`   ${sourceVersion.version}/${position}: ${kind.name} — already carried by batch 2, not repeated`);
          break;
        }
        claim('function', kind.name, out, `${sourceVersion.version}/${position}`);
        createdFunctions.set(kind.name, {
          file: out,
          where: `${sourceVersion.version}/${position}`,
          returnsTrigger: /returns\s+trigger\b/i.test(statement),
        });
        if (kind.name === 'process_return') {
          chunks.push(
            trace(`-- The rename is the point. Production's function is \`process_return(p_payload jsonb)\`; the intended
-- definition names the parameter \`payload\`. PostgreSQL refuses \`create or replace\` across a parameter
-- rename, so the old signature is dropped first — inside the guard, and in the same statement, so a
-- half-applied file cannot leave the function missing.
do $guard$
declare
  v_signature text;
begin
  select p.oid::regprocedure::text into v_signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_return';

  if v_signature is not null and v_signature <> 'process_return(payload jsonb)' then
    execute 'drop function ' || v_signature;
  end if;

  execute $stmt$${ddl(asStatement(statement))}$stmt$;
end
$guard$;`),
          );
          break;
        }
        // `create or replace` is idempotent in PostgreSQL's own syntax, and batch 2 emits its
        // functions the same way; the additionality guard accepts either this or a catalog test.
        chunks.push(trace(asStatement(statement).replace(/^create\s+function/i, 'create or replace function')));
        break;
      }
      case 'policy': {
        if (foldsWithNext) break;
        claim('policy', kind.name, out, `${sourceVersion.version}/${position}`);
        const table = unqualified(kind.table ?? tableOf(statement));
        if (!table) refuse(`${sourceVersion.version} statement ${position}: a policy whose table could not be read: ${oneLine(statement).slice(0, 90)}`);
        chunks.push(
          trace(
            guardedReplace({
              on: { kind: 'table', name: table },
              drop: `drop policy if exists ${kind.name} on public.${table}`,
              statement: asStatement(statement),
              note: `${kind.name}: the shop-scoped definition, replaced wherever ${table} is — guarding on the policy itself would create nothing on a schema that lacks it`,
            }),
          ),
        );
        break;
      }
      case 'trigger': {
        claim('trigger', kind.name, out, `${sourceVersion.version}/${position}`);
        const table = unqualified(kind.table);
        chunks.push(
          trace(
            guardedReplace({
              on: { kind: 'table', name: table },
              drop: `drop trigger if exists ${kind.name} on public.${table}`,
              statement: asStatement(statement),
              note: `${kind.name}: the intended trigger, replaced wherever ${table} is`,
            }),
          ),
        );
        break;
      }
      case 'view': {
        claim('view', kind.name, out, `${sourceVersion.version}/${position}`);
        const dependency = VIEW_DEPENDENCIES[kind.name];
        if (!dependency) {
          refuse(`${sourceVersion.version} statement ${position}: view ${kind.name} has no declared dependency in VIEW_DEPENDENCIES. A view cannot be created without the relations it reads, and guessing them is how a guard comes to mean nothing.`);
        }
        for (const subject of dependency.on) {
          if (!statement.includes(subject.name)) {
            refuse(`${sourceVersion.version} statement ${position}: the declared dependency ${subject.name} of view ${kind.name} is not in the statement — the view moved.`);
          }
        }
        chunks.push(
          trace(
            guardedReplace({
              on: dependency.on,
              drop: `drop view if exists public.${kind.name}`,
              statement: asStatement(statement),
              note: dependency.note,
            }),
          ),
        );
        break;
      }
      case 'drop-policy':
      case 'drop-trigger':
      case 'drop-view':
      case 'drop-constraint': {
        if (foldsWithNext) {
          const create = kept[i + 1];
          const createKind = classify(create.statement);
          i += 1;
          if (createKind.kind === 'function' && carriedFunctions.has(createKind.name)) {
            report.push(
              `   ${sourceVersion.version}/${position}: the function it replaces (${createKind.name}) is carried by batch 2 — neither the drop nor the old definition is re-issued`,
            );
            break;
          }
          if (createKind.kind === 'function') {
            claim('function', createKind.name, out, `${sourceVersion.version}/${position}`);
            createdFunctions.set(createKind.name, {
              file: out,
              where: `${sourceVersion.version}/${position}`,
              returnsTrigger: /returns\s+trigger\b/i.test(create.statement),
            });
            chunks.push(
              trace(
                recreate({
                  object: { kind: 'function', name: createKind.name },
                  drop: asStatement(statement),
                  statement: asStatement(create.statement),
                  note: `${createKind.name}: the intended definition; the superseded signature is dropped only where it is`,
                }),
              ),
            );
            break;
          }
          claim(createKind.kind, createKind.name, out, `${sourceVersion.version}/${position}`);
          const table = unqualified(createKind.table ?? tableOf(create.statement));
          const on =
            createKind.kind === 'view' ? VIEW_DEPENDENCIES[createKind.name]?.on : table ? { kind: 'table', name: table } : null;
          if (!on) {
            refuse(`${sourceVersion.version} statement ${position}: the replacement of ${createKind.name} has no dependency to guard on.`);
          }
          if (createKind.kind === 'view') {
            for (const subject of on) {
              if (!create.statement.includes(subject.name)) {
                refuse(`${sourceVersion.version} statement ${position}: the declared dependency ${subject.name} of view ${createKind.name} is not in the statement — the view moved.`);
              }
            }
          }
          chunks.push(
            trace(
              guardedReplace({
                on,
                drop: asStatement(statement),
                statement: asStatement(create.statement),
                note: `${createKind.name}: replaced (drop + create in one guarded statement, run wherever ${table || questionView(on)} is)`,
              }),
            ),
          );
          break;
        }
        const subject =
          kind.kind === 'drop-policy'
            ? { kind: 'policy', name: kind.name }
            : kind.kind === 'drop-trigger'
              ? { kind: 'trigger', name: kind.name, table: kind.table }
              : { kind: 'view', name: kind.name };
        chunks.push(trace(runWhere(subject, asStatement(statement), `${oneLine(statement)} — the superseded definition, removed where it is`)));
        break;
      }
      case 'drop-column':
        chunks.push(
          trace(
            runWhere(
              { kind: 'table', name: unqualified(kind.table) },
              asStatement(statement),
              'the branch radius is not a branch setting (0187) — removed where batch 2 added it',
            ),
          ),
        );
        break;
      case 'alter-function': {
        const identity = /^alter\s+function\s+(?:public\.)?"?[a-z_0-9]+"?\s*\(([^)]*)\)/i.exec(statement)?.[1] ?? '';
        chunks.push(
          trace(`-- ${kind.name}(): pinned to one schema, but only where the function exists — production lacks two of the
-- three 0177 names (measured), and an ALTER on a function that is not there is not a no-op.
do $guard$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = '${q(kind.name)}'
                and pg_get_function_identity_arguments(p.oid) = '${q(identity.trim())}') then
    execute $stmt$${ddl(asStatement(statement))}$stmt$;
  end if;
end
$guard$;`),
        );
        break;
      }
      case 'add-constraint': {
        claim('constraint', kind.name, out, `${sourceVersion.version}/${position}`);
        const table = unqualified(kind.table);
        chunks.push(
          trace(
            guardedReplace({
              on: { kind: 'table', name: table },
              drop: `alter table public.${table} drop constraint if exists ${kind.name}`,
              statement: asStatement(statement),
              note: `${kind.name}: created wherever ${table} is, replaced where it already is`,
            }),
          ),
        );
        break;
      }
      case 'do-block': {
        const patched =
          sourceVersion.version === '0192' || sourceVersion.version === '0194'
            ? patchTolerances(statement, sourceVersion.version)
            : statement;
        // A DO block that reads no catalog runs against whatever state it finds, and the four below
        // did not read one: they install policies and triggers across a list of tables, or assert a
        // contract. A block like that needs a declared dependency, so the generator cannot emit one
        // bare by accident — the first version did, and its sweeps ran on production against objects
        // (a scope function, a permission function) that were not there yet.
        const stateAware = /pg_(type|class|proc|policies|trigger|constraint)\b|if\s+not\s+exists|create\s+or\s+replace|exception\s+when\s+duplicate/i.test(patched);
        const declared = DO_BLOCK_GUARDS[`${sourceVersion.version}/${position}`];
        if (!declared && !stateAware) {
          refuse(
            `${sourceVersion.version} statement ${position}: this do block reads no catalog and has no declared guard in DO_BLOCK_GUARDS.\n  ${oneLine(patched).slice(0, 140)}`,
          );
        }
        if (declared) {
          if (!patched.includes(declared.mentions)) {
            refuse(`${sourceVersion.version} statement ${position}: the declared guard subject ${declared.mentions} is not in the block — the block moved.`);
          }
          chunks.push(trace(runWhere(declared.on, asStatement(patched), declared.note)));
        } else {
          chunks.push(trace(asStatement(patched)));
        }
        break;
      }
      case 'drop-function': {
        const name = unqualified(/^drop\s+function\s+if\s+exists\s+(?:public\.)?"?([a-z_0-9]+)"?/i.exec(statement)?.[1] ?? '');
        if (!name) refuse(`${sourceVersion.version} statement ${position}: a drop function whose name could not be read.`);
        chunks.push(trace(runWhere({ kind: 'function', name }, asStatement(statement), `${oneLine(statement)} — the superseded signature, removed where it is`)));
        break;
      }
      case 'comment':
      case 'acl': {
        // The schema prefix has to come off before the name is used as a catalog key: the first version
        // captured `public` from `comment on view public.marketplace_listings`, so the guard tested
        // `relname = 'public'` and the statement never ran anywhere.
        const subject = kind.function
          ? { kind: 'function', name: unqualified(kind.function) }
          : kind.on === 'policy'
            ? { kind: 'policy', name: unqualified(kind.name) }
            : kind.on === 'view'
              ? { kind: 'view', name: unqualified(kind.name) }
              : /comment\s+on\s+column/i.test(statement)
                ? {
                    kind: 'column',
                    name: qualifiedColumn(kind.table ?? /^comment\s+on\s+column\s+(?:public\.)?"?([a-z_0-9."]+)/i.exec(statement)?.[1] ?? ''),
                  }
                : {
                    kind: 'table',
                    name: unqualified(kind.table ?? /\bon\s+(?:table\s+)?(?:public\.)?"?([a-z_0-9."]+)"?/i.exec(statement)?.[1] ?? ''),
                  };
        if (!subject.name || subject.name.split('.').some((part) => !part)) {
          refuse(`${sourceVersion.version} statement ${position}: no object could be resolved for this ${kind.kind}: ${oneLine(statement).slice(0, 90)}`);
        }
        // Kept for the end-of-batch pass below, not instead of this one: the in-place position is
        // readable against the ledger, and the late one is the one that cannot be skipped.
        if (kind.kind === 'acl') {
          ledgerAcl.push({ version: sourceVersion.version, position, statement: asStatement(statement), subject });
        }
        chunks.push(trace(runWhere(subject, asStatement(statement), `${oneLine(statement).slice(0, 70)} — applied only where the object is`)));
        break;
      }
      case 'index':
      case 'table':
      case 'add-column':
        chunks.push(trace(asStatement(statement)));
        break;
      case 'enable-rls': {
        const table = unqualified(kind.table);
        chunks.push(
          trace(
            runWhere({ kind: 'table', name: table }, asStatement(statement), `${table}: row level security, where the table is`),
          ),
        );
        break;
      }
      case 'notify':
        report.push(`   ${sourceVersion.version}/${position}: notify pgrst — not emitted (batch 2 does not emit it either)`);
        break;
      default:
        refuse(`${sourceVersion.version} statement ${position}: nothing in this file knows how to re-issue it: ${oneLine(statement).slice(0, 120)}`);
    }
  }
  if (note) chunks.push(`-- ${sourceVersion.version}: ${note}`);
  return chunks.join('\n\n');
}

// ── 0209: the substrate ─────────────────────────────────────────────────────────────────────────
function buildSubstrate(columns) {
  const plan = {
    title: 'The objects no tracked file creates',
    because:
      'Six relations and their helpers had this problem and batch 2 solved it by extraction; these are the\n' +
      'same class of object one layer down. Production\u2019s own baseline does not have them, the migration\n' +
      'directory never creates them, and the files that use them cannot run without them: the four `shops`\n' +
      'place columns the marketplace projection reads, the customer place columns, `sales.notes`,\n' +
      '`stock_adjustments.shop_id`, and the two functions 0168 defines. The columns are copied schema-only\n' +
      'from the accepted staging baseline; the functions are copied from 0168, a tracked file production\n' +
      'never replayed — which is exactly why its objects are missing there.',
  };
  const byTable = new Map();
  for (const column of columns) {
    if (!byTable.has(column.table)) byTable.set(column.table, []);
    byTable.get(column.table).push(column);
  }

  const parts = [];
  for (const [table, list] of byTable) {
    parts.push(
      `-- ── ${table} ────────────────────────────────────────────────────────────────\n` +
        list
          .map(
            (c) =>
              `-- ${c.table}.${c.column} — referenced by ${c.citedIn.join(', ')}; absent from production's catalog and\n` +
              `-- from every tracked CREATE TABLE. Type from the accepted staging baseline.\n` +
              `alter table public.${c.table} add column if not exists "${c.column}" ${c.type};`,
          )
          .join('\n\n'),
    );
  }

  const source = statementsOf('0168');
  const deleteBranch = source.find((s) => /create\s+(or\s+replace\s+)?function\s+public\.delete_branch/i.test(s));
  const myShopIds = source.find((s) => /create\s+(or\s+replace\s+)?function\s+public\.my_shop_ids/i.test(s));
  if (!deleteBranch || !myShopIds) refuse('0168 no longer defines delete_branch / my_shop_ids — the substrate changed.');

  const revoke = statementsOf('0191').find((s) => /revoke\s+all\s+on\s+function\s+public\.delete_branch/i.test(s));
  if (!revoke) refuse('0191 no longer revokes delete_branch — the ACL contract changed.');

  parts.push(
    `-- ── the two functions 0168 defines, and the one grant 0168 records ───────────\n` +
      `-- delete_branch(uuid, text, text): production never had it (0191's REVOKE needs it to exist), and it is\n` +
      `-- defined by 0168 — a pre-position file that will never be replayed. Copied from 0168 verbatim.\n` +
      `${asStatement(deleteBranch)}\n\n` +
      `${runWhere({ kind: 'function', name: 'delete_branch' }, asStatement(revoke), "0191 statement 8 — the ledger's own EXECUTE contract for delete_branch")}\n\n` +
      `-- my_shop_ids(): the membership read the notification policies scope through. Also 0168's.\n` +
      `${asStatement(myShopIds)}\n\n` +
      `${runWhere(
        { kind: 'function', name: 'my_shop_ids' },
        'revoke all on function public.my_shop_ids() from public, anon;',
        '0168 records the grant and never the revoke: on a schema that has to CREATE this function, the default PUBLIC EXECUTE would be access this batch handed out and no ledger statement ever did. 0209 creates it on production, so 0209 completes the contract; authenticated keeps its grant.',
      )}\n\n` +
      `${runWhere(
        { kind: 'function', name: 'my_shop_ids' },
        'grant execute on function public.my_shop_ids() to authenticated;',
        "0168's grant, re-applied only where the function is",
      )}`,
  );

  const proof = [];
  for (const [table, list] of byTable) {
    for (const c of list) {
      proof.push(
        `  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${c.column}') then\n` +
          `    raise exception '0209: public.${table}.${c.column} is still missing';\n  end if;`,
      );
    }
  }
  parts.push(
    `-- ── proof, in the migration itself ──────────────────────────────────────────\n` +
      `-- The file refuses to apply if any object it just created is still absent: an extraction that quietly\n` +
      `-- skipped a column would otherwise pass every check downstream.\n` +
      `do $$\nbegin\n${proof.join('\n')}\n\n` +
      `  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n` +
      `                  where n.nspname = 'public' and p.proname = 'delete_branch') then\n` +
      `    raise exception '0209: public.delete_branch is still missing';\n  end if;\n\n` +
      `  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n` +
      `                  where n.nspname = 'public' and p.proname = 'my_shop_ids') then\n` +
      `    raise exception '0209: public.my_shop_ids is still missing';\n  end if;\n\n` +
      `  raise notice '0209: the columns and functions production never had are in place';\nend $$;`,
  );

  const name = '0209_the_objects_no_tracked_file_creates.sql';
  return { name, text: `${header('0209', plan, `-- ${columns.length} column(s) and 2 function(s), all measured against production's baseline.`)}\n${parts.join('\n\n')}\n` };
}

// ── The ACL pass, which has to be last ─────────────────────────────────────────────────────────
/**
 * Every ACL statement the ledger makes, applied once more after every create in the batch — plus the one
 * EXECUTE contract the ledger leaves unstated for the trigger functions this batch creates.
 *
 * The in-place emission is kept (it reads against the ledger), but it cannot be the last word: a REVOKE
 * that precedes its CREATE is skipped by its own guard, and the CREATE then hands the function
 * PostgreSQL's default PUBLIC EXECUTE. Measured on the production-baseline rehearsal — `my_shop_ids` was
 * executable by PUBLIC because 0209 creates it there. This pass runs where the object is, after
 * everything that could create it, so the ledger decides access instead of the default.
 */
function finalAclPass() {
  const parts = [];
  parts.push(
    `-- ── the ACL pass — last, where every object it concerns exists ─────────────\n` +
      `-- The ledger's ACL statements are emitted at the position the ledger gives them, and a REVOKE can\n` +
      `-- precede the CREATE of the object it concerns. Its guard then skips it (the object is not there),\n` +
      `-- the CREATE runs later in the same batch, and PostgreSQL grants the new function PUBLIC EXECUTE.\n` +
      `-- That is not hypothetical: on the production-baseline rehearsal \`my_shop_ids\` came out executable\n` +
      `-- by PUBLIC, and 0209 is the file that creates it on a schema which never had it. So the same\n` +
      `-- statements are applied again here, at the end, where the object exists wherever it will exist at\n` +
      `-- all. Idempotent: re-running re-applies the same revokes to the same objects.`,
  );
  for (const acl of ledgerAcl) {
    parts.push(
      runWhere(
        acl.subject,
        acl.statement,
        `${acl.version}/${acl.position} — ${oneLine(acl.statement).slice(0, 70)} — the ledger's ACL, applied after every create`,
      ),
    );
  }

  const triggerFunctions = [...createdFunctions]
    .filter(([, info]) => info.returnsTrigger)
    .map(([name]) => name)
    .sort();
  if (triggerFunctions.length) {
    const list = triggerFunctions.map((name) => `'${name}'`).join(', ');
    parts.push(
      `-- AND THE CONTRACT THE LEDGER DOES NOT STATE. A trigger-returning function the batch creates\n` +
        `-- arrives with PUBLIC EXECUTE, because that is PostgreSQL's default for every new function. It\n` +
        `-- cannot be called directly (the engine refuses), so this is not a reachable hole — but it is the\n` +
        `-- same default that produced the defect above, and a function that returns \`trigger\` has exactly\n` +
        `-- one legitimate caller: the trigger. Its EXECUTE contract is \"no role\". This narrows access; it\n` +
        `-- grants nothing, and triggers do not consult EXECUTE when they fire.\n` +
        `do $acl$\n` +
        `declare\n  v_signature text;\nbegin\n` +
        `  for v_signature in\n` +
        `    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n` +
        `     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype\n` +
        `       and p.proname = any (array[${list}])\n` +
        // `loop` is kept on the execute's line: a bare `loop` alone at the end of a line is one of the
        // shapes the replayability guard reads as a split identifier, and it is right to flag it.
        `  loop execute format('revoke all on function %s from public, anon, authenticated', v_signature); end loop;\n` +
        `end\n$acl$;`,
    );
    report.push(`   ACL pass: ${triggerFunctions.length} trigger function(s) closed to every role (${triggerFunctions.join(', ')})`);
  }
  report.push(`   ACL pass: ${ledgerAcl.length} ledger ACL statement(s) re-applied after the last create`);
  return parts.join('\n\n');
}

// ── Build, compare, write ───────────────────────────────────────────────────────────────────────
const columns = substrateColumns();
const outputs = [buildSubstrate(columns)];

for (const plan of PLAN) {
  const body = plan.sources.map((source) => emitSource(source, plan.out)).join('\n\n');
  const extras = (plan.extras ?? []).map((extra) => `-- ${extra.note.split('\n').join('\n-- ')}\n\n${extra.sql}`).join('\n\n');
  const text = `${header(plan.out, plan, `-- Re-issued from: ${plan.sources.map((s) => s.version).join(', ')}.`)}\n${extras ? `${extras}\n\n` : ''}${body}\n`;
  outputs.push({ name: plan.name, text });
}

// The ACL pass belongs to the LAST file: it has to run after every create in the batch, including the
// ones 0207/0208 carry (which precede the re-issue) and the ones 0209..0213 emit. Putting it at the end
// of 0214 is what makes "applied after every create" true by construction rather than by ordering care —
// the PLAN array is not in version order, so the file is selected by name, not by position.
{
  const last = outputs.find((output) => output.name.startsWith('0214_'));
  if (!last) refuse('0214 is not among the outputs — the ACL pass has nowhere to run last.');
  last.text = `${last.text.trimEnd()}\n\n${finalAclPass()}\n`;
}

// A version number is an identity: two files numbered 0211 apply in an order nothing defines, and the
// second one's intent is silently the first one's. A stale name from an earlier plan is refused, not
// written over, because the file it replaced may still be the one a human is reading.
const expected = new Set(outputs.map((output) => output.name));
for (const file of fs.readdirSync(MIGRATIONS)) {
  const version = /^(\d{4})_/.exec(file)?.[1];
  if (!version || !outputs.some((output) => output.name.startsWith(`${version}_`))) continue;
  if (!expected.has(file)) refuse(`supabase/migrations/${file} is a stale re-issue at a version this run also emits — remove the file it duplicates`);
}

let changed = 0;
for (const output of outputs) {
  const target = path.join(MIGRATIONS, output.name);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const same = current !== null && current.replace(/\r\n/g, '\n') === output.text.replace(/\r\n/g, '\n');
  if (!same) changed += 1;
  if (write) {
    if (!same) fs.writeFileSync(target, output.text);
    console.log(`${current === null ? 'created' : same ? 'unchanged' : 'updated'}  supabase/migrations/${output.name}`);
  } else {
    console.log(`${same ? 'current' : current === null ? 'MISSING' : 'STALE'}    supabase/migrations/${output.name}`);
  }
}

console.log('\nre-issue plan');
console.log(`  batch 2 carries ${carriedFunctions.size} functions and ${carriedColumns.size} columns; those are never repeated`);
console.log(`  substrate: ${columns.length} column(s) + delete_branch + my_shop_ids`);
for (const line of report) console.log(line);
if (check && changed) {
  console.log(`\n${changed} file(s) are not current. Run: node scripts/dev/reissue-forward-files.mjs --write`);
  process.exit(1);
}
console.log('\nOK');
