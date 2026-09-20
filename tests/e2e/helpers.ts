/**
 * E2E Test Helpers
 *
 * Provides auth injection, QA DB setup/teardown, and evidence collection
 * for Playwright browser tests.
 */

import { expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

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
const BASE_URL = 'http://localhost:5173';

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
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ result: data }];
  }
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
export async function loginViaUi(page: Page, phone: string) {
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
  await page.getByPlaceholder('e.g. 03001234567').fill(phone);
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

  await page.waitForURL(/pin-set|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });
  if (page.url().includes('pin-set')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
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
    pin: '1234',
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

/** Setup QA test fixtures via direct DB */
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

/** Cleanup all QA test data */
export async function cleanupFixtures() {
  const tables = [
    'reminder_logs', 'reminder_occurrences', 'reminder_configs',
    'credit_limit_requests', 'return_items', 'returns',
    'sale_items', 'sales', 'customer_payments', 'payments',
    'supplier_payments', 'inventory_movements', 'stock_adjustments',
    'purchase_items', 'purchases', 'audit_events', 'activity_log',
    'customer_crops', 'notifications', 'voids',
  ];

  for (const table of tables) {
    try { await execSql(`DELETE FROM ${table}`); } catch { /* skip */ }
  }

  try {
    await execSql(`DELETE FROM customers WHERE id IN ('${QA_IDS.customerA}', '${QA_IDS.customerB}', '${QA_IDS.customerC}')`);
    await execSql(`DELETE FROM product_variants WHERE product_id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`);
    await execSql(`DELETE FROM products WHERE id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`);
    await execSql(`DELETE FROM companies WHERE id IN ('${QA_IDS.companyA}')`);
    await execSql(`DELETE FROM users WHERE id IN ('${QA_IDS.admin}', '${QA_IDS.employee}')`);
  } catch { /* skip */ }
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
