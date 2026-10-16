/**
 * rpc-contract.mjs — the static contract between the client's `supabase.rpc(...)` calls and the
 * privileges the migration ledger actually leaves in place.
 *
 * WHY THIS EXISTS. A client can call an RPC the database refuses, and nothing fails until a user
 * hits that screen. That is not hypothetical here: `DeleteTargetSheet` called `delete_branch` long
 * after 0191 had revoked it from `authenticated`, so the flow could only ever fail closed — and the
 * release source shipped it (fixed in 77e5bc66, which is the commit this guard exists to keep fixed).
 * Reading migrations by hand is what missed it; this reads them the way PostgreSQL applies them.
 *
 * THE MODEL, and why each rule is what it is:
 *
 *   1. **Statements are folded in ledger order** (migrations sort by filename). A later REVOKE
 *      overrides an earlier GRANT — that is the whole point, since "migration changes that revoke a
 *      function still called by the application" is one of the defect classes being guarded.
 *   2. **`GRANT`/`REVOKE … TO/FROM` a role list counts for `authenticated` when the list names
 *      `authenticated` or `PUBLIC`.** Every role is implicitly a member of PUBLIC, so revoking from
 *      PUBLIC revokes from `authenticated` unless a later statement grants it back by name.
 *   3. **A function nobody ever mentions is still executable**, because PostgreSQL grants EXECUTE on
 *      functions to PUBLIC by default and this ledger's `ALTER DEFAULT PRIVILEGES` statements touch
 *      only TABLES and SEQUENCES (0091, 0097). So "unmentioned" is reported as its own state rather
 *      than being assumed safe — see `state` below.
 *   4. **`DROP FUNCTION` retires a name; a following `CREATE` restores PostgreSQL's default**
 *      (dropping discards the ACL). `CREATE OR REPLACE`, by contrast, keeps the existing ACL — the
 *      distinction is why a DROP+CREATE pair in a "fix" migration does not read as a retirement.
 *   5. **Overloads are folded by name, last statement wins.** These RPCs are single-signature in
 *      practice; the fold is deliberately conservative (any revocation of the name marks it
 *      revoked) and reports the statement that did it, so a future overload is visible rather than
 *      silently tolerated.
 *
 * What this file deliberately does NOT do: talk to a database. The deployed schema's own answer is
 * measured separately (`branchIdentityBoundary` runs the RPCs against real Postgres semantics), and
 * a guard that needed a live connection could not run on every commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** EXECUTE is granted to PUBLIC on new functions; nothing in this ledger changes that default. */
export const DEFAULT_EXECUTABLE = true;

/** Fold a name's privilege state through the ledger's statements. */
export const STATE = {
  /** Never mentioned after its last CREATE: executable through the PUBLIC default. */
  UNMENTIONED: 'unmentioned',
  GRANTED: 'granted',
  REVOKED: 'revoked',
  /** Dropped and never redefined. */
  UNDEFINED: 'undefined',
};

/** One capture group for the whole (optionally schema-qualified, optionally quoted) name. */
const QUALIFIED = '((?:"?[a-z0-9_]+"?\\.)?"?[a-z0-9_]+"?\\.?)';

/** `public.foo` / `"public"."foo"` / `foo` → schema and name, defaulting to public. */
function splitQualified(text) {
  const clean = text.trim().replace(/"/g, '').replace(/\.$/, '');
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? { schema: 'public', name: clean } : { schema: clean.slice(0, dot), name: clean.slice(dot + 1) };
}

/** Strip `--` line comments and block comments, keeping dollar-quoted bodies intact. */
export function stripSqlComments(sql) {
  let out = '';
  let dollar = null;
  for (let i = 0; i < sql.length; i++) {
    const rest = sql.slice(i);
    const dollarOpen = rest.match(/^\$[a-zA-Z_]*\$/);
    if (dollar) {
      if (dollarOpen && dollarOpen[0] === dollar) {
        out += dollarOpen[0];
        i += dollarOpen[0].length - 1;
        dollar = null;
        continue;
      }
      out += sql[i];
      continue;
    }
    if (dollarOpen) {
      dollar = dollarOpen[0];
      out += dollarOpen[0];
      i += dollarOpen[0].length - 1;
      continue;
    }
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end - 1;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    out += sql[i];
  }
  return out;
}

/** Line number of a byte offset, 1-based, for evidence that can be opened. */
function lineAt(sql, index) {
  let line = 1;
  for (let i = 0; i < index && i < sql.length; i++) if (sql[i] === '\n') line++;
  return line;
}

/** Every migration, in the order PostgreSQL would apply them: filename order. */
export function ledgerFiles(migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')) {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => path.join(migrationsDir, name));
}

/**
 * Every statement that changes a function's existence or its EXECUTE privilege, in ledger order.
 *
 * Returned as data rather than as a verdict so the same scan can be replayed against a mutated
 * copy — that is how the guard proves it is not vacuous.
 */
export function scanLedger(files) {
  const definitions = [];
  const privileges = [];
  const drops = [];
  const sweepers = [];

  for (const [order, file] of files.entries()) {
    const sql = stripSqlComments(fs.readFileSync(file, 'utf8'));

    const define = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+${QUALIFIED}\\s*\\(`, 'gi');
    for (const m of sql.matchAll(define)) {
      definitions.push({
        file: path.basename(file),
        order,
        line: lineAt(sql, m.index),
        ...splitQualified(m[2]),
        orReplace: Boolean(m[1]),
      });
    }

    const drop = new RegExp(`DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${QUALIFIED}\\s*\\(`, 'gi');
    for (const m of sql.matchAll(drop)) {
      drops.push({ file: path.basename(file), order, line: lineAt(sql, m.index), ...splitQualified(m[1]) });
    }

    const privilege = new RegExp(
      `(GRANT|REVOKE)\\s+(ALL|EXECUTE)(?:\\s+PRIVILEGES)?\\s+ON\\s+(?:ALL\\s+FUNCTIONS\\s+IN\\s+SCHEMA\\s+([a-z0-9_]+)|FUNCTION\\s+${QUALIFIED}\\s*\\([^)]*\\))\\s+(TO|FROM)\\s+([^;]*)`,
      'gi',
    );
    for (const m of sql.matchAll(privilege)) {
      const [, kind, scope, schemaWide, qualified, direction, tail] = m;
      const { schema, name } = schemaWide ? { schema: schemaWide, name: null } : splitQualified(qualified);
      const roles = tail
        .split(',')
        .map((role) => role.trim().replace(/^"|"$/g, '').toLowerCase())
        .filter(Boolean);
      const record = {
        file: path.basename(file),
        order,
        line: lineAt(sql, m.index),
        kind: kind.toUpperCase(),
        scope: scope.toUpperCase(),
        direction: direction.toUpperCase(),
        roles,
      };
      if (schemaWide) sweepers.push({ ...record, schema: schemaWide });
      else privileges.push({ ...record, schema, name });
    }
  }

  return { definitions, privileges, drops, sweepers };
}

/**
 * The ACL PostgreSQL actually keeps per role, which is two entries rather than one:
 *
 *   - `explicit` / `anonExplicit` — the role's own grant, created by `GRANT … TO authenticated` (or
 *     `anon`) and removed by `REVOKE … FROM` that same role.
 *   - `public` — the grant every role inherits, true by default, cleared by `REVOKE … FROM PUBLIC`.
 *
 * One statement can name all three (`REVOKE … FROM PUBLIC, anon, authenticated`, 0191), so every role
 * it names is applied — modelling them as alternatives would leave `public` true and hand `anon` a
 * grant the deployed catalogs do not have (measured: `delete_branch` carries no PUBLIC entry).
 *
 * Effective EXECUTE is `explicit || public`. Collapsing these into "the role list of the last
 * statement" is wrong in a way this ledger actually exercises: 0131 and 0163 both write
 * `GRANT … TO authenticated` immediately followed by `REVOKE … FROM PUBLIC, anon`, which KEEPS the
 * explicit grant (`update_employee_access`, `resolve_invite`) — while 0191's
 * `REVOKE … FROM PUBLIC, anon, authenticated` removes both entries and genuinely retires the
 * function (`delete_branch`, the defect this guard exists to keep fixed).
 */
const ACL = { explicit: false, anonExplicit: false, public: true };

/** Fold the scan into the effective EXECUTE contract per function name, with the evidence for it. */
export function effectiveContract(scan) {
  const contract = new Map();
  const timeline = [];

  for (const definition of scan.definitions) {
    if (definition.schema !== 'public') continue;
    timeline.push({ ...definition, entry: 'create' });
  }
  for (const drop of scan.drops) {
    if (drop.schema !== 'public') continue;
    timeline.push({ ...drop, entry: 'drop' });
  }
  for (const privilege of scan.privileges) {
    if (privilege.schema !== 'public') continue;
    timeline.push({ ...privilege, entry: 'privilege' });
  }

  // Ledger order: the order the migrations are applied in, then the order inside each file.
  timeline.sort((a, b) => a.order - b.order || a.line - b.line);

  for (const item of timeline) {
    const current = contract.get(item.name) ?? {
      name: item.name,
      state: STATE.UNDEFINED,
      evidence: '(no CREATE FUNCTION in the ledger)',
      defines: [],
      ...ACL,
    };

    if (item.entry === 'create') {
      current.defines.push(`${item.file}:${item.line}`);
      // A DROP discards the ACL, so a function that did not exist is back to PostgreSQL's default.
      // CREATE OR REPLACE on a function that still exists keeps whatever grants it already had.
      if (current.dropped) Object.assign(current, ACL);
      current.dropped = false;
      current.declaredAt = `${item.file}:${item.line}`;
    } else if (item.entry === 'drop') {
      current.dropped = true;
      current.evidence = `${item.file}:${item.line} drops it and nothing redefines it`;
    } else if (
      item.roles.includes('authenticated') ||
      item.roles.includes('anon') ||
      item.roles.includes('public')
    ) {
      // All three roles this contract is about, applied independently rather than first-match.
      if (item.roles.includes('authenticated')) current.explicit = item.kind === 'GRANT';
      if (item.roles.includes('anon')) current.anonExplicit = item.kind === 'GRANT';
      if (item.roles.includes('public')) current.public = item.kind === 'GRANT';
      current.evidence = `${item.file}:${item.line} ${item.kind} EXECUTE ${item.direction} ${item.roles.join(', ')}`;
    } else {
      // A statement about other roles only (`service_role`, `anon`) does not decide this question.
      current.notes = [...(current.notes ?? []), `${item.file}:${item.line} ${item.kind} ${item.direction} ${item.roles.join(', ')}`];
    }

    contract.set(item.name, current);
  }

  for (const entry of contract.values()) {
    if (entry.defines.length === 0 || entry.dropped) entry.state = STATE.UNDEFINED;
    else if (entry.explicit || entry.public) entry.state = entry.explicit ? STATE.GRANTED : STATE.UNMENTIONED;
    else entry.state = STATE.REVOKED;

    if (entry.state === STATE.UNDEFINED && entry.evidence === '(no CREATE FUNCTION in the ledger)') continue;
    const granted = (quote) =>
      quote ? 'own grant' : entry.public ? 'PUBLIC default' : 'nothing';
    const parts = [
      entry.defines.at(-1) ?? '(never defined)',
      entry.evidence,
      `authenticated: ${granted(entry.explicit)}`,
      `anon: ${granted(entry.anonExplicit)}`,
    ];
    entry.evidence = parts.filter(Boolean).join(' — ');
  }

  return { contract };
}

/**
 * Can `role` execute this function as the ledger leaves it?
 *
 * `role` is `authenticated` or `anon`. Both are members of PUBLIC, so the PUBLIC entry answers for a
 * role that has no entry of its own — which is exactly how PostgreSQL resolves `has_function_privilege`.
 */
export function executableByRole(entry, role) {
  // Two different absences, deliberately not one:
  //   `entry.dropped` (or an entry whose only news is a DROP) — the ledger says the function is gone.
  //   no entry at all — the ledger says NOTHING about the function, which is the adopted-baseline case
  //   `LEDGER_GAPS` records; existence there is the caller's question (`checkRpcContract` answers it),
  //   not this one, and reading silence as a REVOKE would contradict the deployed catalogs.
  if (!entry) return { ok: false, why: 'no CREATE FUNCTION in the migration ledger' };
  if (entry.state === STATE.UNDEFINED) return { ok: false, why: entry.evidence };

  const explicit = role === 'anon' ? entry.anonExplicit : entry.explicit;
  if (explicit) return { ok: true, why: `${role} holds its own grant — ${entry.evidence}` };

  if (entry.public) {
    // The PUBLIC default. Executable — which is why the caller decides whether an unstated contract
    // is acceptable rather than this function assuming it is not.
    return {
      ok: true,
      why: `no EXPLICIT grant to ${role} — PostgreSQL's PUBLIC default applies (${entry.evidence})`,
    };
  }

  return { ok: false, why: `neither an explicit ${role} grant nor the PUBLIC default remains — ${entry.evidence}` };
}

/** Can `authenticated` execute this function as the ledger leaves it? */
export function executableByAuthenticated(entry) {
  return executableByRole(entry, 'authenticated');
}

/** Strip comments from a TypeScript/TSX source, keeping strings intact. */
export function stripTsComments(source) {
  let out = '';
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

/** Every source file under src/, so the scan is over the whole client rather than a hand-list. */
export function clientFiles(root = path.resolve(process.cwd(), 'src')) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * The RPC calls the client makes.
 *
 * `passthrough` names the wrappers that forward a name they were given (`scopedRpc`), so their call
 * sites are scanned as if they called `supabase.rpc` directly — that is what keeps a wrapper from
 * becoming a hole in the scan. Anything the scan cannot resolve statically is returned as a dynamic
 * site, with any string-literal candidates on the statement, and the guard requires each one to be
 * accounted for.
 */
export function scanClientCalls(files, { passthrough = ['scopedRpc'] } = {}) {
  const staticCalls = [];
  const dynamic = [];
  // The call's first argument: either a quoted literal (group 1 opens the quote, group 2 is the
  // name, and the back reference stops the quotes from pairing across two different strings) or an
  // expression (group 3) that has to be accounted for below.
  const ARGUMENT = '(?:(["\'])([a-z0-9_]+)\\1|([^\\s,)]+))';
  const direct = new RegExp(`supabase\\s*\\.\\s*rpc\\s*\\(\\s*${ARGUMENT}`, 'gi');
  const wrapped = new RegExp(`\\b(?:${passthrough.join('|')})\\s*\\(\\s*${ARGUMENT}`, 'gi');

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const source = stripTsComments(fs.readFileSync(file, 'utf8'));
    const lines = source.split('\n');

    for (const matcher of [direct, wrapped]) {
      for (const m of source.matchAll(matcher)) {
        const line = source.slice(0, m.index).split('\n').length;
        if (m[2]) {
          staticCalls.push({ file: rel, abs: file, line, name: m[2], via: matcher === direct ? 'supabase.rpc' : 'wrapper' });
          continue;
        }
        // `async function scopedRpc(name: string, args)` is the wrapper being declared, not a call:
        // its parameters only look like an unquotable argument. The declaration is exempt; the body
        // it declares is where the unresolved name actually lives.
        const before = source.slice(Math.max(0, m.index - 60), m.index);
        if (matcher !== direct && /(?:^|[^a-z0-9_$])(?:async\s+)?function\s*$/.test(before)) continue;

        // A name held in a variable is usually decided a line or two above the call (`rpcName`'s
        // ternary), so the candidates are read from a small window rather than the call's own line.
        const window = lines.slice(Math.max(0, line - 4), line + 3).join('\n');
        const candidates = [...window.matchAll(/["'`]([a-z0-9_]{3,})["'`]/g)].map((c) => c[1]);
        dynamic.push({ file: rel, abs: file, line, expression: (m[3] ?? '').trim(), candidates: [...new Set(candidates)] });
      }
    }
  }

  return { staticCalls, dynamic };
}

/** Every test file, so the lanes are held to the same contract as the client. */
export function testFiles(root = path.resolve(process.cwd(), 'tests')) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/tests[\\/]setup[\\/]/.test(full)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * The RPCs the lanes call as an authenticated user.
 *
 * `execRpcAsUser(userId, 'name', args)` (tests/setup/qa-client) is the same role the client
 * contract is about, and a lane whose *fixture* calls a revoked RPC fails for a reason that has
 * nothing to do with what it means to prove — which is exactly what happened to
 * `tests/integration/accountDeletion.test.ts` after 0191 retired `delete_branch`.
 */
export function scanTestCalls(files) {
  const calls = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const source = stripTsComments(fs.readFileSync(file, 'utf8'));
    const lines = source.split('\n');
    const patterns = [
      /\bexecRpcAsUser\s*\(\s*[^,]+,\s*(["'])([a-z0-9_]+)\1/g,
      /supabase\s*\.\s*rpc\s*\(\s*(["'])([a-z0-9_]+)\1/g,
    ];
    for (const pattern of patterns) {
      for (const m of source.matchAll(pattern)) {
        calls.push({ file: rel, line: source.slice(0, m.index).split('\n').length, name: m[2] });
      }
    }
    void lines;
  }
  return calls;
}

/**
 * The guard's verdict. Returns problems rather than throwing, so a mutated input can be run through
 * it in the non-vacuity block and the diagnostics asserted.
 */
/**
 * The ledger's own gaps, verified rather than declared.
 *
 * This project's ledger was adopted onto an already-deployed schema (PHASE_2_MIGRATION_LEDGER.md;
 * `supabase/baseline/staging-baseline.json` records 163 functions in the frozen baseline), so a
 * function can exist, and be called by the client, without any `CREATE FUNCTION` in the ledger.
 * A gap entry is accepted only while committed SQL in the named file would FAIL if the function
 * were absent — today that is `alter function public.<name>(…) set search_path = public`, which is
 * strongest kind of proof the repository can carry for a function it does not create.
 */
function ledgerGapIsEvidenced(name, gap) {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), gap.declaredBy), 'utf8');
    return new RegExp(`alter\\s+function\\s+(?:public\\.)?"?${name}"?\\s*\\(`, 'i').test(text);
  } catch {
    return false;
  }
}

export function checkRpcContract({ scan, calls, dynamicAllowlist = {}, ledgerGaps = {} }) {
  const { contract } = effectiveContract(scan);
  const problems = [];

  if (scan.sweepers.length > 0) {
    const sweep = scan.sweepers[0];
    problems.push(
      `${sweep.file}:${sweep.line} is a schema-wide \`${sweep.kind}\` of functions in \`${sweep.schema}\`. ` +
        'This guard folds per-function statements only and will not guess what a sweep leaves behind — ' +
        'teach it the sweep (or drop it) before trusting a green result',
    );
    return problems;
  }

  const usedGaps = new Set();

  for (const call of calls.staticCalls) {
    const entry = contract.get(call.name);

    if (!entry) {
      const gap = ledgerGaps[call.name];
      if (!gap) {
        problems.push(
          `${call.file}:${call.line} calls \`${call.name}\`, which has no CREATE FUNCTION in the migration ledger — either the call is dead ` +
            'or the ledger is missing a definition the deployed schema has; record it in LEDGER_GAPS with the committed SQL that proves it exists',
        );
      } else if (!ledgerGapIsEvidenced(call.name, gap)) {
        problems.push(
          `LEDGER_GAPS[${call.name}] cites ${gap.declaredBy}, but no \`alter function ${call.name}(…)\` is in it — the gap is no longer evidenced`,
        );
      } else {
        usedGaps.add(call.name);
      }
      continue;
    }

    const verdict = executableByAuthenticated(entry);
    if (!verdict.ok) {
      problems.push(
        `${call.file}:${call.line} calls \`${call.name}\`, which \`authenticated\` cannot execute — ${verdict.why}. ` +
          'If the ledger is right, the call belongs on a server path; if the call is right, a migration has to grant it.',
      );
    }
  }

  const calledNames = new Set(calls.staticCalls.map((call) => call.name));
  for (const name of Object.keys(ledgerGaps)) {
    if (contract.has(name)) {
      problems.push(`LEDGER_GAPS lists \`${name}\`, but the ledger now defines it — remove the entry`);
    } else if (!calledNames.has(name)) {
      problems.push(`LEDGER_GAPS lists \`${name}\`, which nothing calls any more — remove the entry`);
    } else if (!usedGaps.has(name)) {
      problems.push(`LEDGER_GAPS lists \`${name}\` but its evidence did not check out, so no call site could use it`);
    }
  }

  const dynamicByFile = new Map();
  for (const site of calls.dynamic) dynamicByFile.set(site.file, [...(dynamicByFile.get(site.file) ?? []), site]);

  for (const [file, sites] of dynamicByFile) {
    const exemption = dynamicAllowlist[file];
    if (!exemption) {
      for (const site of sites) {
        problems.push(
          `${site.file}:${site.line} calls \`supabase.rpc(${site.expression})\`, whose name this guard cannot resolve — account for it ` +
            'in DYNAMIC_ALLOWLIST (the candidate names it can hold, and why that is safe)',
        );
      }
      continue;
    }

    // The exemption speaks for a whole file, so it has to say how many unresolved names live there:
    // a second one added later would otherwise inherit the first one's reasoning silently.
    const accounted = exemption.sites ?? 1;
    if (sites.length !== accounted) {
      problems.push(
        `${file} has ${sites.length} unresolved RPC name${sites.length === 1 ? '' : 's'} but its DYNAMIC_ALLOWLIST entry ` +
          `accounts for ${accounted} — account for the new one before it inherits an exemption it was never checked against`,
      );
    }

    for (const site of sites) {
      const key = `${site.file}:${site.line}`;

      if (exemption.kind === 'passthrough') {
        const source = fs.readFileSync(site.abs ?? path.resolve(process.cwd(), site.file), 'utf8');
        if (!new RegExp(`function\\s+\\w*${exemption.wrapper}\\w*\\s*\\(`).test(source)) {
          problems.push(`${key} is exempted as the \`${exemption.wrapper}\` wrapper, but ${site.file} does not declare it — the exemption is stale`);
        }
        const forwarded = calls.staticCalls.filter((call) => call.file === site.file && call.via === 'wrapper');
        if (forwarded.length === 0) {
          problems.push(
            `${key} is exempted as a passthrough wrapper, but no call site in ${site.file} passes a literal name through it — ` +
              'either the wrapper is dead or its callers stopped naming their RPC, and both need a look',
          );
        }
        continue;
      }

      const declared = exemption.candidates ?? [];
      const undeclared = site.candidates.filter((candidate) => !declared.includes(candidate));
      if (undeclared.length > 0) {
        problems.push(
          `${key} can hold ${undeclared.map((c) => `\`${c}\``).join(', ')}, which its exemption does not list — update DYNAMIC_ALLOWLIST`,
        );
      }
      for (const candidate of declared) {
        if (!site.candidates.includes(candidate)) {
          problems.push(`${key} declares candidate \`${candidate}\`, which no longer appears near the call — the exemption is stale`);
          continue;
        }
        const verdict = executableByAuthenticated(contract.get(candidate));
        if (!verdict.ok) problems.push(`${key} can call \`${candidate}\`, which \`authenticated\` cannot execute — ${verdict.why}`);
      }
    }
  }

  return problems;
}

/** The same contract applied to the lanes, which run as `authenticated` too. */
export function checkTestCalls({ scan, calls, ledgerGaps = {} }) {
  const { contract } = effectiveContract(scan);
  const problems = [];
  for (const call of calls) {
    if (!contract.has(call.name)) {
      const gap = ledgerGaps[call.name];
      if (gap && ledgerGapIsEvidenced(call.name, gap)) continue;
      problems.push(
        `${call.file}:${call.line} calls \`${call.name}\`, which has no CREATE FUNCTION in the migration ledger — a lane cannot measure an RPC the ledger does not define`,
      );
      continue;
    }
    const verdict = executableByAuthenticated(contract.get(call.name));
    if (!verdict.ok) {
      problems.push(
        `${call.file}:${call.line} calls \`${call.name}\` as a user, which \`authenticated\` cannot execute — ${verdict.why}. ` +
          'A fixture built on a retired RPC cannot report anything about the behaviour it is there to measure.',
      );
    }
  }
  return problems;
}

/**
 * The contract for the RPCs the unauthenticated flow calls.
 *
 * Registration and sign-in ask the database BEFORE any session exists: `checkPhoneRegistration` runs
 * "BEFORE a code is sent", and the register screens load the request they just submitted. For these
 * names the ledger must therefore leave EXECUTE with `anon` — either through the role's own entry or
 * through the PUBLIC default that no REVOKE has cleared — or the gate fails with `permission denied`
 * for exactly the users who have no account yet.
 *
 * This is the static half of the project's own rule: 0115 revokes `anon` only from functions whose body
 * provably needs a JWT, and says so in its comment ("so revoking anon cannot break a legitimate
 * unauthenticated path such as registration (insert_shop_request) or login (lookup_user_by_phone)").
 * The deployed catalogs were read once by hand — `backups/get-my-shop-request-acl-2026-10-13.log` — and
 * this keeps the ledger from quietly changing its mind about the same three functions.
 */
export function checkPreAuthContract({ scan, calls, preAuth = {}, ledgerGaps = {} }) {
  const { contract } = effectiveContract(scan);
  const problems = [];
  const called = new Set(calls.staticCalls.map((call) => call.name));

  for (const [name, entry] of Object.entries(preAuth)) {
    const site = calls.staticCalls.find((call) => call.name === name);
    if (!called.has(name)) {
      problems.push(`PRE_AUTH_RPCS lists \`${name}\`, which no client code calls any more — remove the entry`);
      continue;
    }

    const contractEntry = contract.get(name);
    if (!contractEntry) {
      // Silence in the ledger is not a grant: it is the gap case, which is only acceptable while the
      // entry's own evidence holds. A future statement about the name takes it out of this branch and
      // into the role check below, which is where a REVOKE would surface.
      const gap = ledgerGaps[name];
      if (!gap) {
        problems.push(
          `\`${name}\` is called before a session exists (${site ? `${site.file}:${site.line}` : entry.why}), but the ledger ` +
            'neither defines it nor records it as an evidenced gap, so nothing here proves `anon` may execute it',
        );
      } else if (!ledgerGapIsEvidenced(name, gap)) {
        problems.push(`\`${name}\` is in LEDGER_GAPS, but its evidence (${gap.declaredBy}) no longer holds`);
      }
      continue;
    }

    const verdict = executableByRole(contractEntry, 'anon');
    if (!verdict.ok) {
      problems.push(
        `\`${name}\` is called before a session exists (${site ? `${site.file}:${site.line}` : entry.why}), but \`anon\` cannot ` +
          `execute it — ${verdict.why}. A REVOKE that clears anon here fails the sign-in/registration gate for every user ` +
          'without an account yet, so either keep the grant or change this entry together with the flow it belongs to',
      );
    }
  }

  return problems;
}

/**
 * The ratchet for functions the ledger never grants or revokes.
 *
 * They are executable — that is PostgreSQL's PUBLIC default, and nothing in this project changes it
 * for functions — but "executable because nobody said otherwise" is not a contract anyone decided.
 * Each one is listed with where it is defined and why the default is acceptable there; a NEW call
 * into the default fails until somebody writes that down, and an entry that stops being true (the
 * call went away, or the ledger grew an explicit grant) fails as stale rather than sitting there
 * looking like a decision forever.
 */
export function checkUnwrittenContracts({ scan, calls, allowlist = {} }) {
  const { contract } = effectiveContract(scan);
  const problems = [];
  const called = [...new Set(calls.staticCalls.map((call) => call.name))];
  const unwritten = called.filter((name) => contract.get(name)?.state === STATE.UNMENTIONED);

  for (const name of unwritten) {
    if (!allowlist[name]) {
      const call = calls.staticCalls.find((c) => c.name === name);
      problems.push(
        `${call.file}:${call.line} calls \`${name}\`, which no migration grants or revokes — ${contract.get(name).evidence}. ` +
          'Write the grant (and the REVOKE from anon) in a migration, or add an entry to UNWRITTEN_ALLOWLIST saying why the default is fine',
      );
    }
  }

  for (const [name, entry] of Object.entries(allowlist)) {
    if (!called.includes(name)) {
      problems.push(`UNWRITTEN_ALLOWLIST lists \`${name}\`, which no client code calls any more — remove the entry`);
      continue;
    }
    const state = contract.get(name)?.state;
    if (state !== STATE.UNMENTIONED) {
      problems.push(`UNWRITTEN_ALLOWLIST lists \`${name}\`, which the ledger now ${state === STATE.GRANTED ? 'grants' : state} — remove the entry`);
      continue;
    }
    const defined = contract.get(name)?.defines.at(-1) ?? '(unknown)';
    if (!defined.startsWith(entry.definedIn)) {
      problems.push(
        `UNWRITTEN_ALLOWLIST says \`${name}\` is defined in ${entry.definedIn}, but the ledger defines it at ${defined} — re-read the rationale`,
      );
    }
  }

  return problems;
}

// CLI: `node scripts/lib/rpc-contract.mjs` prints the contract for every RPC the client calls.
// It is the debugging view of the same data the guard asserts on, including the functions the
// ledger keeps server-only — the category `delete_branch` fell into.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scan = scanLedger(ledgerFiles());
  const calls = scanClientCalls(clientFiles());
  const { contract } = effectiveContract(scan);

  const names = [...new Set(calls.staticCalls.map((call) => call.name))].sort();
  const width = Math.max(...names.map((name) => name.length), 12);
  for (const name of names) {
    const entry = contract.get(name);
    const verdict = executableByAuthenticated(entry);
    const anon = executableByRole(entry, 'anon');
    const note = !verdict.ok ? 'NOT EXECUTABLE' : entry.explicit ? 'explicit grant' : 'PUBLIC default';
    const anonNote = anon.ok ? (entry.anonExplicit ? 'anon: grant' : 'anon: PUBLIC') : 'anon: NO';
    console.log(`${verdict.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(width)}  ${note.padEnd(16)}  ${anonNote.padEnd(12)}  ${verdict.why}`);
  }

  const serverOnly = [...contract.values()].filter((entry) => entry.state === STATE.REVOKED).map((entry) => entry.name);
  const unwritten = names.filter((name) => contract.get(name)?.state === STATE.UNMENTIONED);
  console.log(`\n${names.length} static call names, ${calls.dynamic.length} dynamic site(s), ${contract.size} functions in the ledger`);
  console.log(`${serverOnly.length} functions revoked from authenticated (server-only): ${serverOnly.join(', ')}`);
  console.log(`${unwritten.length} of the client's calls rely on the PUBLIC default: ${unwritten.join(', ')}`);
}
