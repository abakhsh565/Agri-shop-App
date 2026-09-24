/**
 * lib.mjs — shared helpers for the Engineering OS speed tooling.
 *
 * Used by state.mjs (checkpoint), verify.mjs (tiered verification), preflight.mjs
 * and qa.mjs. Keep this file free of CLI behaviour so it stays importable.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';

export const ROOT = process.cwd();
export const STATE_FILE = 'ENGINEERING_OS_STATE.md';
export const CHECKPOINT_BEGIN = '<!-- ENGINEERING-OS-CHECKPOINT:BEGIN -->';
export const CHECKPOINT_END = '<!-- ENGINEERING-OS-CHECKPOINT:END -->';
export const QA_PROJECT_REF = 'bpybjrjenwccowvtrevu';
export const QA_PORT = 5173;
export const QA_FIXTURE_PHONES = ['923001234567', '923001122334', '923009999999', '923008888888'];

/** Paths that can never affect web/app verification (machine artifacts, mobile shells). */
export const EXCLUDED_PATHS = [
  /^\.freebuff\//, /^freebuff\//, /^dist\//, /^android\//, /^ios\//, /^node_modules\//,
  /\.log(\.|$)/, /^tests\/e2e\/results/, /\.apk$/,
];

/** Business tables the QA baseline must keep empty (schema, auth and fixtures stay). */
export const BUSINESS_TABLES = [
  'return_items', 'returns', 'voids',
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
];

// ── env ──────────────────────────────────────────────────────
export function loadQaEnv() {
  if (!fs.existsSync('.env.qa')) return;
  for (const line of fs.readFileSync('.env.qa', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^\[|\]$/g, '');
  }
}

export function qaDatabaseUrl() {
  loadQaEnv();
  const strip = (v) => (v || '').replace(/^\[|\]$/g, '');
  const direct = strip(process.env.QA_DATABASE_URL);
  if (direct) return direct;
  const user = strip(process.env.QA_DB_USER);
  const pass = strip(process.env.QA_DB_PASS);
  const host = strip(process.env.QA_DB_HOST);
  return user && pass && host ? `postgresql://${user}:${pass}@${host}:5432/postgres` : '';
}

export function isQaTarget() {
  return (process.env.QA_DB_USER || '').split('.')[1] === QA_PROJECT_REF;
}

// ── git (read-only; never mutates) ───────────────────────────
export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: ROOT, ...opts });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function gitLines(args, opts = {}) {
  const r = git(args, opts);
  return r.code === 0 && r.out ? r.out.split('\n').filter(Boolean) : [];
}

export function currentBranch() {
  return git(['branch', '--show-current']).out || '(detached)';
}

export function currentHead() {
  return git(['rev-parse', 'HEAD']).out;
}

export function upstream() {
  const r = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return r.code === 0 ? r.out : '';
}

/** Tracked files (repo-relative, forward slashes). */
export function trackedFiles() {
  return gitLines(['ls-files']);
}

/** Untracked, not ignored files. */
export function untrackedFiles() {
  return gitLines(['ls-files', '--others', '--exclude-standard']);
}

/** All working-tree files git knows about (tracked + untracked). */
export function workingFiles() {
  return [...new Set([...trackedFiles(), ...untrackedFiles()])];
}

export function dirtyFiles() {
  return gitLines(['status', '--porcelain']).map((l) => l.slice(3).trim()).filter(Boolean);
}

// ── hashing ──────────────────────────────────────────────────
export function fileHash(rel) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);
  } catch {
    return '<missing>';
  }
}

export function hashMap(files) {
  const map = {};
  for (const f of files.sort()) map[f] = fileHash(f);
  return map;
}

export function hashOf(map) {
  const keys = Object.keys(map).sort();
  const h = crypto.createHash('sha256');
  for (const k of keys) h.update(`${k}:${map[k]}\n`);
  return h.digest('hex').slice(0, 20);
}

/**
 * One hash for the whole verifiable tree. "Nothing changed since the last green
 * run" is then a single comparison, which is what makes a restart cheap.
 */
export function treeHash() {
  return hashOf(hashMap(workingFiles().filter((f) => !EXCLUDED_PATHS.some((re) => re.test(f)))));
}

// ── globs ────────────────────────────────────────────────────
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // '**' crosses directories
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // '**/' also matches zero directories
      } else {
        re += '[^/]*';
      }
    } else if (c === '/') re += '/';
    else re += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchAny(rel, globs) {
  for (const g of globs) {
    const re = globToRegex(g);
    if (re.test(rel)) return true;
    // A bare directory-ish pattern like "src/lib/auth.ts" is exact; "src/**" covers subtrees.
  }
  return false;
}

// ── checkpoint (single source of project state, inside ENGINEERING_OS_STATE.md) ──
export function readState() {
  const empty = {
    updatedAt: null,
    branch: null,
    head: null,
    nextCommand: null,
    note: null,
    server: null,
    verified: { head: null, at: null, files: {} },
    lanes: {},
    lastVerify: null,
    metrics: [],
  };
  try {
    const text = fs.readFileSync(STATE_FILE, 'utf8');
    const a = text.indexOf(CHECKPOINT_BEGIN);
    const b = text.indexOf(CHECKPOINT_END);
    if (a === -1 || b === -1) return empty;
    const block = text.slice(a + CHECKPOINT_BEGIN.length, b);
    const m = block.match(/```json\s*([\s\S]*?)```/);
    if (!m) return empty;
    return { ...empty, ...JSON.parse(m[1]) };
  } catch {
    return empty;
  }
}

export function writeState(next) {
  const text = fs.readFileSync(STATE_FILE, 'utf8');
  const block = `${CHECKPOINT_BEGIN}\n\`\`\`json\n${JSON.stringify(next, null, 2)}\n\`\`\`\n${CHECKPOINT_END}`;
  const a = text.indexOf(CHECKPOINT_BEGIN);
  const b = text.indexOf(CHECKPOINT_END);
  let out;
  if (a !== -1 && b !== -1) {
    out = text.slice(0, a) + block + text.slice(b + CHECKPOINT_END.length);
  } else {
    // First write: land the block just after the document intro, before the history.
    const sep = text.indexOf('\n---\n');
    const anchor = sep === -1 ? text.indexOf('## 1. Built + Verified') : sep;
    const insert = `\n## 0. Live checkpoint (machine-written — do not hand-edit)\n\n${block}\n`;
    out = anchor === -1 ? insert + text : text.slice(0, anchor) + insert + text.slice(anchor);
  }
  fs.writeFileSync(STATE_FILE, out);
}

export function updateState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  writeState(next);
  return next;
}

// ── server probe ─────────────────────────────────────────────
export function portOpen(port = QA_PORT, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (v) => { try { sock.destroy(); } catch {} resolve(v); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function serverMode() {
  // The dev server must be `--mode qa` (see .freebuff/run.md). Read the actual
  // command line of the process listening on the QA port; report UNKNOWN rather
  // than guessing when it cannot be read.
  if (process.platform !== 'win32') return 'unknown';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*vite*' } | Select-Object -ExpandProperty CommandLine`,
  ], { encoding: 'utf8', timeout: 8000 });
  const line = (r.stdout || '').trim();
  if (!line) return 'unknown';
  if (/--mode[= ]\s*qa\b/.test(line)) return 'qa';
  if (/--mode[= ]\s*(?!qa)\w+/.test(line)) return 'non-qa';
  return 'default (no --mode)';
}

export async function serverProbe(port = QA_PORT) {
  const up = await portOpen(port);
  if (!up) return { port, up: false, mode: null };
  return { port, up: true, mode: await serverMode() };
}

// ── independent QA row count (never trusts the cleaner's own output) ──
export async function qaRowCount() {
  const url = qaDatabaseUrl();
  if (!url) return { ok: false, error: 'no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS)' };
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows: existing } = await client.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`,
      [BUSINESS_TABLES],
    );
    const names = existing.map((r) => r.relname);
    if (!names.length) return { ok: true, total: 0, tables: {} };
    const sql = names.map((t) => `select '${t}' as t, count(*)::int as n from ${t}`).join(' union all ');
    const { rows } = await client.query(sql);
    const tables = {};
    let total = 0;
    for (const r of rows) { tables[r.t] = r.n; total += r.n; }
    return { ok: true, total, tables };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

export async function qaFixtureCount() {
  const url = qaDatabaseUrl();
  if (!url) return { ok: false, error: 'no QA database configuration' };
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query(
      `select count(*)::int as n from users where phone = any($1)`,
      [QA_FIXTURE_PHONES],
    );
    return { ok: true, count: rows[0].n };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

// ── misc ─────────────────────────────────────────────────────
export function seconds(n) {
  return `${Math.floor(n / 60)}m${String(Math.round(n % 60)).padStart(2, '0')}s`;
}

export function laneSpecPath(name) {
  return `tests/e2e/${name}.spec.ts`;
}

export function readLaneMap() {
  const p = path.join(ROOT, 'scripts/dev/lane-map.json');
  const map = JSON.parse(fs.readFileSync(p, 'utf8'));
  return map;
}
