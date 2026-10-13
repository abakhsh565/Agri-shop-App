/**
 * E2E Test Helpers
 *
 * Provides auth injection, QA DB setup/teardown, and evidence collection
 * for Playwright browser tests.
 *
 * CLEANUP IS OWNERSHIP-BASED (2026-10-13). `cleanupFixtures()` used to delete 20 business tables
 * wholesale and swallow every error; eight lanes believed to be read-only ran it, and the shared QA
 * baseline lost the seven fixture rows it targets (measured: 3 customers + 2 products + 2 variants)
 * while the deletes that would have destroyed hundreds of rows failed silently. Cleanup now deletes
 * ONLY ids this run registered through `trackOwned`, in FK-safe order, and reports every failure.
 * The decision itself lives in `tests/e2e/cleanupOwnership.ts` (no I/O, fully unit-tested).
 */

import { expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  clearOwnership,
  createOwnership,
  deleteSql,
  ownedCount,
  planCleanup,
  trackOwned,
  trackOwnedObject,
  type OwnedObject,
  type Ownership,
} from './cleanupOwnership';

/**
 * Load .env.qa into process.env if not already loaded.
 * This runs in Node.js (not the browser), so it's safe for test-only credentials.
 */
function loadQaEnv() {
  if (process.env.QA_SUPABASE_URL) return; // already loaded
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env.qa'),
      path.resolve(process.cwd(), '../../.env.qa'),
    ];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
        return;
      }
    }
  } catch { /* .env.qa not found — rely on environment */ }
}
// Load BEFORE reading env vars
loadQaEnv();

/** Strip surrounding brackets that some tools add to URLs (e.g., [https://...]) */
function cleanUrl(url: string): string {
  return url.replace(/^\[|\]$/g, '').trim();
}

// QA DB credentials — read from environment variables (never hardcode)
const QA_URL = cleanUrl(process.env.QA_SUPABASE_URL || 'https://bpybjrjenwccowvtrevu.supabase.co');
const QA_SERVICE_ROLE = process.env.QA_SUPABASE_SERVICE_ROLE || '';
const QA_ANON_KEY = process.env.QA_SUPABASE_ANON_KEY || '';

// ── Environment Guard ────────────────────────────────────────
import { assertQaProject } from '../setup/env-guard';
assertQaProject(QA_URL);

import { createClient } from '@supabase/supabase-js';

const QA_DB_HOST = process.env.QA_DB_HOST || '';
const QA_DB_USER = process.env.QA_DB_USER || '';
const QA_DB_PASS = process.env.QA_DB_PASS || '';

/** The app under test (Playwright's baseURL) */
const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';

/** Local (dialable) form of the QA admin phone used by the real login flow */
const ADMIN_LOGIN_PHONE = '03009999999'; // 923009999999 -> 03009999999

/** Test user IDs */
export const QA_IDS = {
  shop: '00000000-0000-0000-0000-000000000001',
  admin: '10000000-0000-0000-0000-000000000001',
  employee: '10000000-0000-0000-0000-000000000002',
  customerA: '20000000-0000-0000-0000-000000000001',
  customerB: '20000000-0000-0000-0000-000000000002',
  customerC: '20000000-0000-0000-0000-000000000003',
  productA: '30000000-0000-0000-0000-000000000001',
  productB: '30000000-0000-0000-0000-000000000002',
  variantA: '40000000-0000-0000-0000-000000000001',
  variantB: '40000000-0000-0000-0000-000000000002',
  companyA: '50000000-0000-0000-0000-000000000001',
} as const;

const _svcClient = createClient(QA_URL, QA_SERVICE_ROLE);

/**
 * Execute raw SQL against the QA database via run_sql HTTP API.
 * Uses service-role to bypass RLS.
 */
export async function execSql(sql: string): Promise<any[]> {
  const { data, error } = await _svcClient.rpc('run_sql', { sql_query: sql });
  if (error) throw new Error(`execSql: ${error.message}`);
  if (!data || data === 'ok') return [];
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return [{ result: data }];
    }
  }
  // run_sql reports SQL errors IN BAND, as {error}. Handing that back as if it were a
  // row made a failed fixture write indistinguishable from "the row isn't there": a
  // spec then asserts against an empty table and blames the product. A 'cash' value in
  // the payment_type enum produced exactly that — a missing sale row, no error.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
    throw new Error(`execSql: ${String((parsed as { error: unknown }).error)}`);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Execute SQL via Supabase REST (anon client, respects RLS) */
export async function supabaseAnon(sql: string): Promise<any> {
  const resp = await fetch(`${QA_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': QA_ANON_KEY,
      'Authorization': `Bearer ${QA_ANON_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  return resp.json();
}

/** Same derivation the app uses: local PK number -> 92XXXXXXXXXX */
function normalizePhone(input: string): string {
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0')) return '92' + digits.slice(1);
  if (digits.startsWith('92')) return digits;
  return '92' + digits;
}

/**
 * Guarantee a QA app user has a usable Supabase Auth credential.
 *
 * WHY: the app signs in with email+password derived from the phone and falls back
 * to signUp when that fails. signUp requires an email confirmation and is
 * rate-limited, so a fixture user that exists in `users` but has no credential
 * can NEVER sign in from a clean database — every spec then fails for an
 * infrastructure reason that has nothing to do with the feature under test.
 * QA provisions credentials out-of-band with `email_confirm: true`
 * (scripts/provision-auth-sessions.mjs); the harness does the same here.
 */
const _ensuredPhones = new Set<string>();

export async function ensureAuthSession(phone: string): Promise<void> {
  const e164 = normalizePhone(phone);
  // Once per phone per worker. Every spec logs in, so probing the auth endpoint on
  // each login would multiply requests (and invite provider rate limiting) for no
  // extra information.
  if (_ensuredPhones.has(e164)) return;

  const email = `user-${e164}@agrishop.auth.local`;
  const password = `AgriShop-${e164}-2026!`;

  const probe = createClient(QA_URL, QA_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const attempt = await probe.auth.signInWithPassword({ email, password });
  if (!attempt.error) {
    await probe.auth.signOut().catch(() => undefined);
    _ensuredPhones.add(e164);
    return;
  }

  const rows = await execSql(`SELECT id FROM users WHERE phone = '${e164}' LIMIT 1`);
  const id = rows[0]?.id as string | undefined;
  if (!id) throw new Error(`ensureAuthSession: no users row for ${e164}`);

  const admin = createClient(QA_URL, QA_SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const existing = await admin.auth.admin.getUserById(id);
  if (existing.data?.user) {
    const { error } = await admin.auth.admin.updateUserById(id, { email, password, email_confirm: true, phone: e164 });
    if (error) throw new Error(`ensureAuthSession (update ${e164}): ${error.message}`);
  } else {
    const { error } = await admin.auth.admin.createUser({ id, email, password, email_confirm: true, phone: e164 });
    if (error) throw new Error(`ensureAuthSession (create ${e164}): ${error.message}`);
  }

  _ensuredPhones.add(e164);
}

/**
 * Establish a REAL Supabase Auth session by driving the app's own login flow
 * (phone -> dev OTP -> set/confirm PIN).
 *
 * WHY THIS EXISTS: the backend now derives the acting user from the JWT and
 * enforces permissions, RLS and branch scope. Injecting localStorage alone (the
 * old approach) leaves the page with NO session, so every RLS-protected read
 * returns 401 and every tenant-owned write is refused — the screens then render
 * empty and RPC-based assertions fail for reasons unrelated to the feature under
 * test. Verified cause of the previously failing E2E specs.
 */
export async function loginViaUi(
  page: Page,
  phone: string,
  side: 'owner' | 'employee' = 'owner',
  /** Which shop the invited number belongs to; defaults to the QA fixture shop. */
  shopCode: string = QA_IDS.shop,
) {
  const OTP = '123456';
  const PIN = '4321';

  // The credential must exist before the UI can sign in (see ensureAuthSession).
  await ensureAuthSession(phone);

  // Start clean so a re-entry during a test re-runs the flow instead of being
  // redirected away from /login by the authenticated route guard.
  await page.goto(`${BASE_URL}/login`).catch(() => undefined);
  await page.evaluate(() => {
    localStorage.removeItem('agri_auth');
    for (const k of Object.keys(localStorage)) {
      if (/^sb-/.test(k)) localStorage.removeItem(k);
    }
  }).catch(() => undefined);

  await page.goto(`${BASE_URL}/login`);
  // One phone, one door: the login page asks which door this number belongs at and
  // refuses a number that answers the other one, so the tab is part of the flow.
  if (side === 'employee') await page.getByTestId('auth-tab-employee').click();
  // The field takes the local 03… form. A 92… constant is re-read by the field's own
  // paste rule as a country code and becomes a 10-digit number the validator refuses,
  // so the caller's constant is normalised here rather than in every spec.
  await page.getByPlaceholder('e.g. 03001234567').fill(/^92\d{10}$/.test(phone) ? `0${phone.slice(2)}` : phone);
  // The employee door is TWO answers: a number on its own does not say which shop invited it,
  // so `Send Code` refuses to spend a code until the shop is named. The fixture shops all have
  // a stable id, which the field accepts as readily as the six-character code read out loud.
  if (side === 'employee') await page.getByTestId('shop-id-input').fill(shopCode);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

  // The digit boxes, addressed by role rather than position: the OTP field also
  // contains an off-screen autofill input, and a partly-typed code produces NO
  // error at all (submission waits for the sixth digit), so an entry that lands
  // one box off looks exactly like a frozen screen.
  const boxes = page.locator('[data-testid^="otp-digit-"]');
  await expect(boxes).toHaveCount(6);
  // Type it the way a person does: six keystrokes, focus advancing on its own.
  // Filling each box by index raced with that auto-advance (a fill could land on
  // a box the component had already moved past, leaving the code one digit short
  // — which submits nothing and reports nothing).
  await boxes.first().click();
  await page.keyboard.type(OTP);
  // Assert what actually landed before trusting the navigation: "the page did not
  // move" must never be the only symptom of a mis-entered code.
  for (let i = 0; i < OTP.length; i++) {
    await expect(boxes.nth(i), `OTP digit ${i + 1} is not the one that was typed`).toHaveValue(OTP[i]);
  }

  // A brand-new account is told it is ready before it is ever asked for a PIN, so the code can
  // land on three different screens. Follow whichever one actually appeared rather than
  // assuming the keypad: a wrong assumption here reads as "sign-in never reached the dashboard".
  await page.waitForURL(/account-ready|pin-set|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });

  if (page.url().includes('account-ready')) {
    await page.getByTestId('account-ready-pin').click();
    await page.waitForURL(/pin-set/, { timeout: 30000 });
  }

  if (page.url().includes('pin-set')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(600);
    // Standing a PIN up for the first time ends on a success screen; a like-for-like swap from
    // Settings goes straight back. Both are real, so follow whichever one appeared.
    const open = page.getByTestId('pin-done-open');
    if (await open.count()) await open.click();
    await page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 });
  }
  await page.waitForTimeout(1200); // let stores hydrate from Supabase
}

/** Inject admin auth state into the page's localStorage */
export async function injectAdminAuth(page: Page) {
  // The QA admin's REAL membership in the QA database is owner/active, and the
  // admin routes are gated by PermissionGuard, which reads membershipRole and
  // permissions from this persisted user. Omitting them makes deep /admin/*
  // navigation silently redirect to the dashboard (guards deny), so the fixture
  // must mirror the authoritative membership row rather than a legacy role only.
  const adminUser = {
    id: QA_IDS.admin,
    name: 'QA Admin',
    phone: '923009999999',
    role: 'admin',
    tenantId: QA_IDS.shop,
    membershipRole: 'owner',
    permissions: ['*'],
    isOriginalOwner: true,
    isActive: true,
    firstLoginAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    deactivatedAt: null,
    deactivatedBy: null,
    createdAt: new Date().toISOString(),
    createdBy: null,
  };

  // A real session is required before the injected identity is useful, because
  // the backend authorizes from the JWT rather than from client state.
  await loginViaUi(page, ADMIN_LOGIN_PHONE);

  await page.evaluate((user) => {
    // Set Zustand persist auth state
    localStorage.setItem('agri_auth', JSON.stringify({
      state: { user },
      version: 0,
    }));
    // Clear any signal suppression state
    localStorage.removeItem('signal_suppression');
    localStorage.removeItem('signal_reviewed');
  }, adminUser);
}

/**
 * Setup QA test fixtures via direct DB.
 *
 * These rows are the SHARED baseline (see tests/setup/fixtures.ts: several suites seed and rely on
 * them between runs), so they are deliberately NOT registered as run-owned: cleanup must not delete
 * a fixture another lane is still using. What a lane creates on top of them, it registers itself.
 */
export async function setupFixtures() {
  await execSql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', true, true, '${QA_IDS.shop}'),
      ('${QA_IDS.employee}', 'QA Employee', '923008888888', 'employee', false, true, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;
  `);

  await execSql(`
    INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
    VALUES ('${QA_IDS.companyA}', 'QA Supplier A', 15000, 50000, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);

  await execSql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES
      ('${QA_IDS.customerA}', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerB}', 'QA Customer B', '923002222222', 25000, 26000, 40000, 14000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerC}', 'QA Customer C', '923003333333', 10000, 0, 15000, 15000, '${QA_IDS.shop}', 'QA')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);

  await execSql(`
    INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
    VALUES
      ('${QA_IDS.productA}', 'QA Product A', '${QA_IDS.companyA}', 'seed', 100, '${QA_IDS.shop}'),
      ('${QA_IDS.productB}', 'QA Product B', '${QA_IDS.companyA}', 'fertilizer', 0, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
    VALUES
      ('${QA_IDS.variantA}', '${QA_IDS.productA}', '1kg', 500, 300, 1, 10, 100),
      ('${QA_IDS.variantB}', '${QA_IDS.productB}', '5kg', 2000, 1500, 5, 5, 0)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);
}

// ── Run-scoped ownership ─────────────────────────────────────
/**
 * What THIS run created. Every lane that writes to QA registers its own ids here
 * (`trackOwned(ownership(), 'sales', saleId)`); cleanup then deletes exactly those, and nothing else.
 * Kept in-process: a row that is not registered is a row this run does not own, whether or not it
 * shares a table with one that is.
 */
const runOwnership: Ownership = createOwnership();
const runObjects: OwnedObject[] = [];

export function ownership(): Ownership {
  return runOwnership;
}

/** Storage objects this run uploaded (image lanes): removed by name, never by bucket sweep. */
export function ownedObjects(): OwnedObject[] {
  return runObjects;
}

export { trackOwned, trackOwnedObject, ownedCount };

async function removeStorageObject(object: OwnedObject): Promise<void> {
  const { error } = await _svcClient.storage.from(object.bucket).remove([object.path]);
  if (error) throw new Error(error.message);
}

/**
 * Register the rows THIS lane just created, discovered through the lane's own marker.
 *
 * WHY A QUERY IS ALLOWED HERE. Discovery of a row we created moments ago (by the phone number, name
 * or sale number the lane itself chose) is not the anti-pattern this file was fixed for. The
 * anti-pattern was DELETING by a prefix or by a shared fixture — "every company whose name starts
 * with QA Microcopy", "every payment of QA Customer A". Here the marker only finds our own rows
 * once, immediately after creation; what cleanup later deletes is the explicit id.
 *
 * Fails loudly when the claim matched nothing: a lane that cannot name what it created is a lane
 * whose cleanup would silently do nothing, which is how leftovers accumulate unnoticed.
 *
 * @param sql a SELECT returning a column (default `id`) that carries the row ids to own
 */
export async function claimOwned(
  kind: string,
  sql: string,
  options: { column?: string; exec?: (statement: string) => Promise<any[]> } = {},
): Promise<string[]> {
  const rows = await (options.exec ?? execSql)(sql);
  const column = options.column ?? 'id';
  const ids = rows.map((row) => String(row?.[column] ?? '')).filter(Boolean);
  if (!ids.length) {
    throw new Error(
      `[QA CLEANUP] claimOwned('${kind}') matched no rows — this lane cannot prove what it created, ` +
        `so its cleanup would be a no-op: ${sql}`,
    );
  }
  return trackOwned(runOwnership, kind, ids);
}

/**
 * Track a Storage object this lane uploaded, given the URL the app stored for it.
 *
 * Only ever call this with a URL that came from a real upload (a preview src or a value read back
 * after a save). A URL a test writes into the database itself addresses no object, so tracking it
 * would make cleanup try to delete something that never existed.
 *
 * @returns true when the URL named a storage object and was tracked
 */
export function trackUploadedObject(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const match = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/.exec(url);
  if (!match) return false;
  trackOwnedObject(runObjects, match[1], match[2]);
  return true;
}

/**
 * Read the ids a query currently matches, so a lane can diff before/after its own action.
 * Read-only: it selects, it never registers and never deletes.
 */
export async function snapshotIds(
  sql: string,
  options: { column?: string; exec?: (statement: string) => Promise<any[]> } = {},
): Promise<string[]> {
  const rows = await (options.exec ?? execSql)(sql);
  const column = options.column ?? 'id';
  return rows.map((row) => String(row?.[column] ?? '')).filter(Boolean);
}

/**
 * Register exactly the ids that appeared since `snapshot` — the rows this lane's own action created.
 *
 * WHY NOT A TIMESTAMP. "Created in the last five minutes" would claim another lane's row that
 * happened to land in the same window; a diff against a snapshot taken immediately before the
 * action claims only what changed. The shared fixture is never claimed by this: only the new rows
 * are, so a shared customer can still be sold to without the customer being owned.
 */
export async function claimNew(
  kind: string,
  sql: string,
  snapshot: readonly string[],
  options: { column?: string; exec?: (statement: string) => Promise<any[]> } = {},
): Promise<string[]> {
  const seen = new Set(snapshot);
  const ids = (await snapshotIds(sql, options)).filter((id) => !seen.has(id));
  if (!ids.length) {
    throw new Error(
      `[QA CLEANUP] claimNew('${kind}') found no new row — the action did not create what this lane ` +
        `believes it created, so its cleanup would be a no-op: ${sql}`,
    );
  }
  return trackOwned(runOwnership, kind, ids);
}

export interface CleanupOptions {
  /** Statement runner. Injectable so the ownership behaviour can be tested without touching QA. */
  exec?: (sql: string) => Promise<unknown>;
  /** Storage-object remover. Injectable for the same reason. */
  removeObject?: (object: OwnedObject) => Promise<void>;
  /** Registry to clean. Defaults to this run's. */
  ownership?: Ownership;
  /** Storage objects to remove. Defaults to this run's. */
  objects?: OwnedObject[];
}

/**
 * Delete the records THIS run created, and only those.
 *
 * Guarantees:
 *   * every statement is scoped by an owned id — no table-wide delete can be produced;
 *   * protected fixtures (the four keep-list accounts, `companyA`) are skipped and reported;
 *   * an empty registry means an empty plan (the safe direction), and says so;
 *   * every failure is collected and thrown, naming the table, the column and the operation, so a
 *     failed cleanup fails the run instead of being absorbed by a `catch`;
 *   * repeating it is a no-op: the registry is cleared only after a fully successful pass.
 */
export async function cleanupFixtures(options: CleanupOptions = {}): Promise<void> {
  const exec = options.exec ?? execSql;
  const ownership = options.ownership ?? runOwnership;
  const objects = options.objects ?? runObjects;
  const removeObject = options.removeObject ?? removeStorageObject;

  const { steps, protectedSkipped } = planCleanup(ownership);

  if (protectedSkipped.length) {
    console.log(
      `[QA CLEANUP] preserved ${protectedSkipped.length} protected id(s) — fixture accounts / companyA: ${protectedSkipped.join(', ')}`,
    );
  }
  if (!steps.length && !objects.length) {
    console.log(
      '[QA CLEANUP] nothing owned by this run — no deletes issued. A lane that creates QA rows must register them with trackOwned(...).',
    );
    return;
  }

  const failures: string[] = [];
  for (const step of steps) {
    try {
      await exec(deleteSql(step));
    } catch (error) {
      failures.push(`${step.table}.${step.column} (${step.ids.length} id(s)): ${errorMessage(error)}`);
    }
  }

  for (const object of [...objects]) {
    try {
      await removeObject(object);
      objects.splice(objects.indexOf(object), 1);
    } catch (error) {
      failures.push(`storage ${object.bucket}/${object.path}: ${errorMessage(error)}`);
    }
  }

  if (failures.length) {
    throw new Error(
      `[QA CLEANUP] ${failures.length} operation(s) failed — this run is NOT clean:\n  - ${failures.join('\n  - ')}`,
    );
  }
  clearOwnership(ownership);
  console.log(`[QA CLEANUP] removed everything this run owned (${steps.length} statement(s)).`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Record a test result for the evidence report */
export interface TestEvidence {
  name: string;
  expected: string;
  actual: string;
  result: 'PASS' | 'FAIL' | 'UNTESTED';
  source: string;
  timestamp: string;
}

export function recordEvidence(name: string, expected: string, actual: string, result: 'PASS' | 'FAIL' | 'UNTESTED', source: string): TestEvidence {
  return { name, expected, actual, result, source, timestamp: new Date().toISOString() };
}

/** Write evidence report */
export function writeEvidenceReport(evidence: TestEvidence[], testInfo: TestInfo) {
  const passed = evidence.filter(e => e.result === 'PASS').length;
  const failed = evidence.filter(e => e.result === 'FAIL').length;
  const untested = evidence.filter(e => e.result === 'UNTESTED').length;

  const report = `
=== E2E TEST EVIDENCE REPORT ===
Test: ${testInfo.title}
File: ${testInfo.file}
Duration: ${testInfo.duration}ms
Environment: QA Database (bpybjrjenwccowvtrevu)
Timestamp: ${new Date().toISOString()}

Results: ${passed} PASS, ${failed} FAIL, ${untested} UNTESTED (of ${evidence.length})

${evidence.map(e => `[${e.result}] ${e.name}\n  Expected: ${e.expected}\n  Actual:   ${e.actual}\n  Source:   ${e.source}`).join('\n\n')}
`;

  console.log(report);
}
