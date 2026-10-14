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
  assertSafeId,
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
import { randomUUID } from 'node:crypto';
import { ISOLATED_IDENTITIES, ISOLATED_TENANT_ID } from '../../scripts/dev/qa-tenant.mjs';

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

/**
 * ── THE DEDICATED WRITE TENANT ─────────────────────────────────────────────────────────────────
 *
 * WHY A SECOND TENANT EXISTS AT ALL. Two lanes need a shop they can EMPTY: `setupCompletion` reads
 * "the shop has nothing in it, so the checklist reads 0/3" and `dependencyContinuity` reads "the
 * catalogue is empty, so the sale screen has nothing to sell". That premise is the ABSENCE of rows
 * nobody created — which no amount of ownership registration can give them on the shared QA shop, and
 * which the shared shop no longer even has (hand-entered QA data lives in it). Before this tenant,
 * both lanes established the premise by deleting the shared shop's entire business content; that is the
 * wipe the ownership work removed, and the reason both lanes were BLOCKED rather than fixed in place.
 *
 * So the tenant, not the lane, is what makes the premise a fact:
 *   · it was created through the app's own registration flow, so it has a default branch and its
 *     built-in roles — the two things 0188/0190 need before an employee can open a screen at all;
 *   · it holds ZERO business rows, and the gate now ASSERTS that (`isolatedTenant.mustBeEmpty` in
 *     `scripts/dev/qa-baseline.json`), because a hand run could fill it and quietly invalidate both
 *     lanes' premise;
 *   · it is written by exactly one script (`scripts/dev/qa-tenant.mjs`), whose rules are held by
 *     `tests/unit/qaTenantFixture.test.ts`: the QA project only, this tenant only, INSERT-only, and
 *     never the shared shop.
 *
 * The ids come from that script rather than being repeated here, so the fixture the lanes sign in with
 * and the fixture the guard checks cannot drift apart.
 */
export const WRITE_TENANT = {
  id: ISOLATED_TENANT_ID,
  owner: ISOLATED_IDENTITIES.find((i) => i.membershipRole === 'owner')!,
  employee: ISOLATED_IDENTITIES.find((i) => i.membershipRole === 'employee')!,
} as const;

/**
 * The tables whose emptiness is the two write lanes' premise, in the order a lane creates them.
 * A count here answers "is the premise still true" rather than "did cleanup tidy up".
 */
export const WRITE_TENANT_BUSINESS_TABLES = ['companies', 'products', 'customers', 'sales'] as const;

export type WriteTenantCounts = Record<(typeof WRITE_TENANT_BUSINESS_TABLES)[number], number>;

/** How many rows the dedicated tenant holds, per business table. Read-only. */
export async function writeTenantCounts(tenantId: string = WRITE_TENANT.id): Promise<WriteTenantCounts> {
  const select = WRITE_TENANT_BUSINESS_TABLES.map(
    (table) => `(SELECT count(*) FROM ${table} WHERE shop_id = '${tenantId}')::int AS ${table}`,
  ).join(', ');
  const [row] = await execSql(`SELECT ${select}`);
  const counts = {} as WriteTenantCounts;
  for (const table of WRITE_TENANT_BUSINESS_TABLES) counts[table] = Number(row?.[table] ?? 0);
  return counts;
}

/** The total, for a message that names what is left rather than a bare number. */
export function writeTenantTotal(counts: WriteTenantCounts): number {
  return WRITE_TENANT_BUSINESS_TABLES.reduce((n, table) => n + counts[table], 0);
}

/**
 * Create one row inside the dedicated tenant, PROVE it exists, and register it as this run's own.
 *
 * WHY THE STEPS ARE ONE CALL. Every residue class this repository has had to clean up by hand came from
 * the same slip: a lane created a row and left registering it to a later line that a failing assertion
 * never reached. So creation, proof and ownership are one call — the id is generated here, the insert
 * is given it explicitly, the row is read back, and only then is it owned.
 *
 * WHY NOT `RETURNING id`. These statements run through the `run_sql` RPC, which answers a write the way
 * it answers a statement that returns nothing — so a lane that trusted `RETURNING` could not tell a
 * created row from a refused one and would register an id that never existed. The read-back is the
 * proof, and a missing row fails HERE, naming the statement, instead of surfacing as an app assertion
 * about a shop that never got the data.
 *
 * `table` is also the ownership bucket, so the delete cleanup builds is `DELETE FROM <table> WHERE id
 * IN (...)`. The caller writes the tenant predicate into the insert; the unit guard on `cleanupOwnership`
 * is what guarantees no statement cleanup emits is ever table-wide.
 */
export async function createInWriteTenant(table: string, insertSql: string): Promise<string> {
  const id = randomUUID();
  await execSql(insertSql.replace(/__ID__/g, id));
  const rows = await execSql(`SELECT id FROM ${table} WHERE id = '${id}'`);
  if (!rows[0]?.id) {
    throw new Error(
      `[QA WRITE TENANT] createInWriteTenant('${table}') created no row — nothing carries id ${id} after: ${insertSql}`,
    );
  }
  trackOwned(runOwnership, table, id);
  return id;
}

/**
 * Claim the rows a PREVIOUS, FAILED run of the SAME lane left inside the dedicated tenant.
 *
 * WHY THIS IS NEEDED AT ALL. Playwright restarts the worker PROCESS after a failing test, and the
 * ownership registry lives in that process's memory. So a row the failed run created is owned by nobody
 * by the time the next test looks: cleanup can never remove it, the tenant stops being empty, and every
 * later run of the lane fails its own premise for a reason that has nothing to do with the app. That is
 * a real gap in "register what you create", and it is closed here rather than by weakening the premise.
 *
 * HOW IT STAYS SAFE. The claim is scoped by TWO facts at once — the dedicated tenant id AND the lane's
 * own `name` marker — so one lane can never claim, and therefore never delete, the other's rows, and
 * nothing outside the tenant is looked at. What it finds goes through `trackOwned` into the normal
 * registered-id plan: the statements cleanup then runs are still `WHERE id IN (...)`, never table-wide,
 * and the plan is PRINTED by the caller. Anything left that does not carry the marker is NOT claimed —
 * it fails the lane's premise assertion, by name, which is the whole point of having a tenant.
 */
export async function claimWriteTenantLeftovers(
  marker: string,
  tenantId: string = WRITE_TENANT.id,
): Promise<{ table: string; ids: string[] }[]> {
  const claimed: { table: string; ids: string[] }[] = [];
  // Children first, so the plan's own ordering has less to reshuffle; the plan is what decides.
  for (const table of ['products', 'product_variants', 'customers', 'companies'] as const) {
    const rows =
      table === 'product_variants'
        ? await execSql(
            `SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
              WHERE p.shop_id = '${tenantId}' AND p.name LIKE '${marker}%'`,
          )
        : await execSql(`SELECT id FROM ${table} WHERE shop_id = '${tenantId}' AND name LIKE '${marker}%'`);
    const ids = rows.map((row) => String(row?.id ?? '')).filter(Boolean);
    if (!ids.length) continue;
    trackOwned(runOwnership, table, ids);
    claimed.push({ table, ids });
  }
  return claimed;
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
 * Write a setup draft into the shop store instance the APP is rendering from.
 *
 * A Vite dev server serves an HMR-invalidated module at `/src/stores/shopStore.ts?t=<ms>`, and an
 * app booted after that invalidation loads THAT url. A bare `import('/src/stores/shopStore.ts')` is
 * then a second module with a second store: the write lands on a copy the UI cannot see, and a lane
 * that passed against a cold server fails hours later with the product untouched. Resolving the
 * url(s) the app actually loaded keeps the write on the app's own instance, and the caller's
 * `reached` check proves on the screen that it arrived before the lane trusts it.
 */
export async function seedShopDraft(
  page: Page,
  patch: {
    name?: string;
    place?: { lat: number; lng: number; label: string; address?: string; source: string; countryCode?: string } | null;
    requestId?: string | null;
  },
  reached: () => Promise<boolean>,
): Promise<void> {
  const loaded = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\/src\/stores\/shopStore\.ts(\?|$)/.test(name)),
  );
  // Newest first: the last url the app fetched is the one its module map answers with.
  const candidates = [...new Set(loaded)].reverse();
  candidates.push('/src/stores/shopStore.ts');

  for (const url of candidates) {
    await page.evaluate(async ({ url, patch }) => {
      const mod: any = await import(/* @vite-ignore */ url);
      mod.useShopStore.getState().setSetupDraft(patch);
    }, { url, patch });
    await page.waitForTimeout(200);
    if (await reached()) return;
  }

  throw new Error(
    `seedShopDraft never reached the store the app renders from. Tried: ${candidates.join(', ')}`,
  );
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

  // STOCK IS PART OF THE FLOOR, NOT ONLY OF THE FIRST INSERT.
  //
  // These two rows used to be restored by name alone (`DO UPDATE SET name`), so the numbers above
  // were read once at INSERT and never again. Measured 2026-10-14: `QA Product A`'s variant stood at
  // 99, and every lane that reasons about stock from these figures inherited a lane's leftover —
  // voidSaleSafety sold 2 off it and asserted the void put the fixture back at 100, which is what
  // the declaration says the fixture IS, and failed on 99 while the void had restored exactly what
  // it took. The premise of a lane must be the declared floor, not whichever lane ran last.
  await execSql(`
    INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
    VALUES
      ('${QA_IDS.productA}', 'QA Product A', '${QA_IDS.companyA}', 'seed', 100, '${QA_IDS.shop}'),
      ('${QA_IDS.productB}', 'QA Product B', '${QA_IDS.companyA}', 'fertilizer', 0, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, stock_qty = EXCLUDED.stock_qty;

    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
    VALUES
      ('${QA_IDS.variantA}', '${QA_IDS.productA}', '1kg', 500, 300, 1, 10, 100),
      ('${QA_IDS.variantB}', '${QA_IDS.productB}', '5kg', 2000, 1500, 5, 5, 0)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      selling_price = EXCLUDED.selling_price,
      cost_price = EXCLUDED.cost_price,
      unit_size = EXCLUDED.unit_size,
      low_stock_threshold = EXCLUDED.low_stock_threshold,
      -- 0 for QA Product B is a fixture with a job: the dashboard's "out of stock" alert exists
      -- because of it, so the floor has to restore that zero as deliberately as it restores the 100.
      stock_qty = EXCLUDED.stock_qty;
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

  // THE ONE STEP THAT MAY DECLINE. `users` is deleted under a guard
  // (`cleanupOwnership.USER_DELETE_GUARDS`): a fixture account the database still references — the
  // audit history it produced, a sale recorded as that employee — is PRESERVED with its membership
  // rather than deleted, because 0113's membership trigger only fires on INSERT and a
  // membership-less account is the orphan `rbacInvariants` fails on. Preserving it silently would be
  // the same defect wearing a quieter costume, so the survivors are read back and named.
  const preserved = await preservedUsers(ownership, exec);
  if (preserved.length) {
    console.log(
      `[QA CLEANUP] preserved ${preserved.length} fixture account(s) the database still references, ` +
        `with their memberships intact (not an orphan, and not silent): ${preserved.join(', ')}. ` +
        'Residue the drift report can see — remove the reference with the run that created it.',
    );
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

/**
 * Which of the registered fixture accounts are still there after the plan ran.
 * Read back through the same runner, so a lane in a browser context reports what happened in the
 * database rather than what it intended. A runner that cannot answer is a failure, not a shrug.
 */
async function preservedUsers(
  ownership: Ownership,
  exec: (sql: string) => Promise<unknown>,
): Promise<string[]> {
  const bucket = ownership.get('users');
  if (!bucket?.size) return [];
  const ids = [...bucket].sort();
  for (const id of ids) assertSafeId(id);
  const rows = (await exec(`SELECT id FROM users WHERE id IN (${ids.map((id) => `'${id}'`).join(', ')})`)) as
    | { id?: unknown }[]
    | undefined;
  return (Array.isArray(rows) ? rows : []).map((row) => String(row?.id ?? '')).filter(Boolean);
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
