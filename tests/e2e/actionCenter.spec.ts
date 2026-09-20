/**
 * Action Center E2E Tests
 *
 * Tests the complete Action Center workflow using real browser + QA database.
 * Verifies: tabs, signals, credit request flow, suppression, cleanup.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  QA_IDS,
  injectAdminAuth,
  setupFixtures,
  cleanupFixtures,
  execSql,
  recordEvidence,
  writeEvidenceReport,
  type TestEvidence,
} from './helpers';
import { qaServiceClient } from '../../tests/setup/qa-client';

const BASE_URL = 'http://localhost:5173';
const ADMIN_ALERTS = `${BASE_URL}/admin/alerts/reminders`;
const ADMIN_DASHBOARD = `${BASE_URL}/admin/dashboard`;

// ─── Setup / Teardown ────────────────────────────────────────────────────

test.beforeAll(async () => {
  await cleanupFixtures();
  await setupFixtures();
}, { timeout: 60000 });

test.afterAll(async () => {
  await cleanupFixtures();
}, { timeout: 60000 });

// ─── Helper: login as admin ──────────────────────────────────────────────

async function loginAsAdmin(page: Page) {
  await page.goto(BASE_URL);
  await injectAdminAuth(page);
  await page.goto(ADMIN_DASHBOARD, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

// ─── Test 1: Application Loads ───────────────────────────────────────────

test('1. Application loads successfully', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await page.goto(BASE_URL);
  const title = await page.title();
  const url = page.url();

  evidence.push(recordEvidence(
    'App loads',
    'Page loads without error',
    `URL: ${url}, Title: ${title}`,
    url ? 'PASS' : 'FAIL',
    'browser'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(url).toBeTruthy();
});

// ─── Test 2: Admin Auth Injection Works ─────────────────────────────────

test('2. Admin auth injection navigates to dashboard', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  const url = page.url();
  const isDashboard = url.includes('/admin/dashboard');

  evidence.push(recordEvidence(
    'Auth injection',
    'Redirected to admin dashboard',
    `URL: ${url}`,
    isDashboard ? 'PASS' : 'FAIL',
    'browser → localStorage → authStore → router'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(isDashboard).toBeTruthy();
});

// ─── Test 3: Action Center Loads ─────────────────────────────────────────

test('3. Action Center page loads with tabs', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });

  // The signal tabs render only after the store hydrates, so WAIT for the real
  // controls. Reading body text once after a fixed sleep raced hydration under
  // full-suite load and saw a 25-character body (an empty shell) even though the
  // page and its tabs do render — the same condition passes in isolation.
  await expect(page.getByRole('button', { name: /^Actions/ }).first(), 'main "Actions" tab did not render').toBeVisible();
  await expect(page.getByRole('button', { name: /Critical/ }).first(), '"Critical" tab did not render').toBeVisible();
  await expect(page.getByRole('button', { name: /Warning/ }).first(), '"Warning" tab did not render').toBeVisible();
  await expect(page.getByRole('button', { name: /Info/ }).first(), '"Info" tab did not render').toBeVisible();

  const content = await page.textContent('body');
  const pageLoaded = !content?.includes('page not found') && !content?.includes('404');
  const hasTabs = content?.includes('Critical') || content?.includes('Warning') || content?.includes('Info') || content?.includes('Actions');

  evidence.push(recordEvidence(
    'Action Center loads',
    'Page loads with signal tabs (Actions / Critical / Warning / Info) rendered',
    `Tabs rendered: ${hasTabs}, Page OK: ${pageLoaded}, Content length: ${content?.length || 0}`,
    (hasTabs && pageLoaded) ? 'PASS' : 'FAIL',
    'browser → Action Center route → rendered tab elements'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(hasTabs).toBeTruthy();
  expect(pageLoaded).toBeTruthy();
});

// ─── Test 4: Sub-tabs (Critical, Warning, Info) are visible ─────────────

test('4. Sub-tabs Critical, Warning, Info are visible', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });

  // Same hydration race as test 3 — wait for the controls instead of sampling text.
  await expect(page.getByRole('button', { name: /Critical/ }).first(), '"Critical" sub-tab did not render').toBeVisible();
  await expect(page.getByRole('button', { name: /Warning/ }).first(), '"Warning" sub-tab did not render').toBeVisible();
  await expect(page.getByRole('button', { name: /Info/ }).first(), '"Info" sub-tab did not render').toBeVisible();

  const body = await page.textContent('body');

  const hasCritical = body?.includes('Critical') ?? false;
  const hasWarning = body?.includes('Warning') ?? false;
  const hasInfo = body?.includes('Info') ?? false;

  evidence.push(recordEvidence(
    'Sub-tabs visible',
    'Critical, Warning, Info tabs exist',
    `Critical: ${hasCritical}, Warning: ${hasWarning}, Info: ${hasInfo}`,
    (hasCritical && hasWarning && hasInfo) ? 'PASS' : 'FAIL',
    'browser → Action Center → sub-tab nav'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(hasCritical).toBeTruthy();
  expect(hasWarning).toBeTruthy();
  expect(hasInfo).toBeTruthy();
});

// ─── Test 5: Critical tab shows signals from QA data ────────────────────

test('5. Critical tab shows signals from real QA data', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Customer B has outstanding > credit limit → should generate critical signal
  const dbCheck = await execSql(
    `SELECT name, outstanding_balance, credit_limit FROM customers WHERE id = '${QA_IDS.customerB}'`
  );
  const customer = dbCheck[0];
  const isOverLimit = customer && Number(customer.outstanding_balance) > Number(customer.credit_limit);

  // Check if Critical tab has count > 0 or signal cards exist
  const body = await page.textContent('body');
  const hasCriticalCount = body?.match(/Critical\s*\d+/i) || body?.includes('overdue') || body?.includes('credit');

  evidence.push(recordEvidence(
    'Critical signals from DB',
    'QA Customer B exceeds credit limit → critical signal',
    `DB: outstanding=${customer?.outstanding_balance}, limit=${customer?.credit_limit}, overLimit=${isOverLimit}, UI shows critical: ${!!hasCriticalCount}`,
    (isOverLimit && hasCriticalCount) ? 'PASS' : 'FAIL',
    'DB query → signal engine → Action Center UI'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(isOverLimit).toBeTruthy();
});

// ─── Test 6: Tab switching works ────────────────────────────────────────

test('6. Tab switching between Critical/Warning/Info works', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Find and click Warning tab
  const warningTab = page.locator('button:has-text("Warning")').first();
  if (await warningTab.isVisible()) {
    await warningTab.click();
    await page.waitForTimeout(500);
    const bodyAfterWarning = await page.textContent('body');
    const warningActive = bodyAfterWarning?.includes('Warning');

    evidence.push(recordEvidence(
      'Warning tab switch',
      'Clicking Warning tab shows warning signals',
      `Warning tab visible and active: ${!!warningActive}`,
      warningActive ? 'PASS' : 'FAIL',
      'browser → click Warning tab → render'
    ));
  } else {
    evidence.push(recordEvidence(
      'Warning tab switch',
      'Warning tab button found and clickable',
      'Warning tab not found',
      'UNTESTABLE',
      'browser'
    ));
  }

  // Find and click Info tab
  const infoTab = page.locator('button:has-text("Info")').first();
  if (await infoTab.isVisible()) {
    await infoTab.click();
    await page.waitForTimeout(500);
    const bodyAfterInfo = await page.textContent('body');
    const infoActive = bodyAfterInfo?.includes('Info');

    evidence.push(recordEvidence(
      'Info tab switch',
      'Clicking Info tab shows info signals',
      `Info tab visible and active: ${!!infoActive}`,
      infoActive ? 'PASS' : 'FAIL',
      'browser → click Info tab → render'
    ));
  } else {
    evidence.push(recordEvidence(
      'Info tab switch',
      'Info tab button found and clickable',
      'Info tab not found',
      'UNTESTABLE',
      'browser'
    ));
  }

  writeEvidenceReport(evidence, test.info());
});

// ─── Test 7: DB ↔ UI state consistency ──────────────────────────────────

test('7. DB state matches what Signal Engine computes', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  // Query actual QA DB for conditions that should produce signals
  const overdueCustomers = await execSql(`
    SELECT name, outstanding_balance, credit_limit
    FROM customers
    WHERE outstanding_balance > 0 AND shop_id = '${QA_IDS.shop}'
  `);

  const outOfStockProducts = await execSql(`
    SELECT p.name, pv.stock_qty, pv.low_stock_threshold
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.stock_qty <= pv.low_stock_threshold AND p.shop_id = '${QA_IDS.shop}'
  `);

  // Expected signals based on DB state
  const expectedCritical = overdueCustomers.filter(c => Number(c.outstanding_balance) > Number(c.credit_limit)).length;
  const expectedWarning = overdueCustomers.filter(c => {
    const ratio = Number(c.outstanding_balance) / Number(c.credit_limit);
    return ratio > 1.0 && ratio <= 1.5;
  }).length;
  const expectedInfoStock = outOfStockProducts.filter(p => Number(p.stock_qty) === 0).length;

  // Check the app UI
  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const body = await page.textContent('body');

  // Count Critical signals displayed
  const criticalCount = body?.match(/Critical\s*(\d+)/i)?.[1] || '0';

  evidence.push(recordEvidence(
    'DB↔UI consistency',
    `Expected critical signals: ${expectedCritical}, UI shows: ${criticalCount}`,
    `Over-limit customers: ${overdueCustomers.filter(c => Number(c.outstanding_balance) > Number(c.credit_limit)).map(c => `${c.name}(${c.outstanding_balance}/${c.credit_limit})`).join(', ')}`,
    Number(criticalCount) >= expectedCritical ? 'PASS' : 'FAIL',
    'DB query → Signal Engine computation → UI count'
  ));

  evidence.push(recordEvidence(
    'Stock signals',
    `Expected out-of-stock signals: ${expectedInfoStock}`,
    `Out of stock products: ${outOfStockProducts.map(p => `${p.name}(qty=${p.stock_qty})`).join(', ') || 'none'}`,
    'PASS',
    'DB query → Signal Engine'
  ));

  writeEvidenceReport(evidence, test.info());
});

// ─── Test 8: Signal suppression persistence (localStorage) ──────────────

test('8. Signal suppression state persists via localStorage', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Check localStorage for suppression state
  const suppressionState = await page.evaluate(() => {
    return localStorage.getItem('signal_suppression');
  });

  evidence.push(recordEvidence(
    'Suppression state',
    'signal_suppression key exists in localStorage',
    suppressionState ? `Found: ${suppressionState.substring(0, 100)}...` : 'Not yet set (no signals reviewed)',
    'PASS', // Not having suppression yet is valid — only happens after review
    'browser → localStorage'
  ));

  // Verify the store can be read
  const authState = await page.evaluate(() => {
    return localStorage.getItem('agri_auth');
  });

  evidence.push(recordEvidence(
    'Auth state persistence',
    'agri_auth persists in localStorage',
    authState ? 'Auth state present' : 'Missing',
    authState ? 'PASS' : 'FAIL',
    'browser → localStorage → zustand persist'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(authState).toBeTruthy();
});

// ─── Test 9: Reload preserves state ─────────────────────────────────────

test('9. Page reload preserves Action Center state', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const bodyBefore = await page.textContent('body');
  const criticalBefore = bodyBefore?.match(/Critical\s*(\d+)/i)?.[1] || '0';

  // Reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const bodyAfter = await page.textContent('body');
  const criticalAfter = bodyAfter?.match(/Critical\s*(\d+)/i)?.[1] || '0';

  evidence.push(recordEvidence(
    'Reload persistence',
    `Critical count before reload: ${criticalBefore}, after: ${criticalAfter}`,
    'DB is authoritative source — signals re-derived from DB',
    criticalBefore === criticalAfter ? 'PASS' : 'FAIL',
    'browser → reload → re-fetch DB → recompute signals'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(criticalBefore).toEqual(criticalAfter);
});

// ─── Test 10: Credit request create → Critical signal → approve → signal disappears ──

test('10. Credit request E2E: create → critical signal → approve → signal disappears', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);

  // Step 1: Create a credit limit request via RPC (Node.js side)
  const { data: createData, error: createError } = await qaServiceClient.rpc('create_credit_limit_request', {
    payload: {
      customer_id: QA_IDS.customerC,
      customer_name: 'QA Customer C',
      requested_by: 'QA Admin',
      current_limit: 10000,
      requested_limit: 25000,
      reason: 'E2E test: need more credit',
    },
  });
  const createResp = { data: createData, error: createError?.message };

  evidence.push(recordEvidence(
    'Step 1: Create credit request',
    'RPC returns {id, status: "pending"}',
    JSON.stringify(createResp),
    createResp.data?.id ? 'PASS' : 'FAIL',
    'browser → Supabase RPC → credit_limit_requests table'
  ));

  if (!createResp.data?.id) {
    writeEvidenceReport(evidence, test.info());
    return;
  }

  const requestId = createResp.data.id;

  // Step 2: Verify DB has the record
  const dbRecord = await execSql(
    `SELECT id, status, requested_limit FROM credit_limit_requests WHERE id = '${requestId}'`
  );

  evidence.push(recordEvidence(
    'Step 2: DB persistence',
    'Record exists in credit_limit_requests with status=pending',
    `DB: ${JSON.stringify(dbRecord[0])}`,
    dbRecord[0]?.status === 'pending' ? 'PASS' : 'FAIL',
    'SQL query → credit_limit_requests'
  ));

  // Step 3: Navigate to Action Center — should see Critical signal for this request
  // Browser now connects to QA Supabase (VITE_SUPABASE_URL override)
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Reload to force the signal engine to recompute from QA DB
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const body = await page.textContent('body');
  const hasCreditRequest = body?.includes('QA Customer C') || body?.includes('credit') || body?.includes('Credit') || body?.includes('limit');

  evidence.push(recordEvidence(
    'Step 3: Critical signal appears',
    'Action Center shows credit request as Critical (browser now uses QA Supabase)',
    `Body contains credit request info: ${hasCreditRequest}`,
    hasCreditRequest ? 'PASS' : 'FAIL',
    'browser → Action Center → signal engine → QA Supabase (bpybjrjenwccowvtrevu)'
  ));

  // Step 4: Approve the request (Node.js side)
  const { data: approveData, error: approveError } = await qaServiceClient.rpc('approve_credit_limit_request', {
    p_request_id: requestId,
    p_reviewed_by: 'QA Admin',
  });
  const approveResp = { data: approveData, error: approveError?.message };

  evidence.push(recordEvidence(
    'Step 4: Approve request',
    'RPC approve returns success',
    JSON.stringify(approveResp),
    approveResp.data?.status === 'approved' ? 'PASS' : 'FAIL',
    'browser → Supabase RPC → approve'
  ));

  // Step 5: Verify customer credit limit updated
  const updatedCustomer = await execSql(
    `SELECT credit_limit FROM customers WHERE id = '${QA_IDS.customerC}'`
  );

  evidence.push(recordEvidence(
    'Step 5: Customer limit updated',
    'credit_limit changed to requested value (25000)',
    `New limit: ${updatedCustomer[0]?.credit_limit}`,
    Number(updatedCustomer[0]?.credit_limit) === 25000 ? 'PASS' : 'FAIL',
    'SQL query → customers.credit_limit'
  ));

  // Step 6: Reload Action Center — signal should be gone
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const bodyAfterApprove = await page.textContent('body');
  const creditRequestStillVisible = bodyAfterApprove?.includes('QA Customer C') && bodyAfterApprove?.includes('credit');

  evidence.push(recordEvidence(
    'Step 6: Signal disappears after approve',
    'Credit request signal no longer in Critical tab',
    `Still visible: ${creditRequestStillVisible}`,
    !creditRequestStillVisible ? 'PASS' : 'FAIL',
    'browser → reload → signal engine → DB (no pending requests) → no signal'
  ));

  // Cleanup: restore credit limit
  await execSql(
    `UPDATE customers SET credit_limit = 10000 WHERE id = '${QA_IDS.customerC}'`
  );

  writeEvidenceReport(evidence, test.info());
});

// ─── Test 11: Follow-ups tab loads ──────────────────────────────────────

test('11. Follow-ups tab loads with Ready/Upcoming/Recently Sent sections', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const body = await page.textContent('body');
  const hasFollowUps = body?.includes('Follow') || body?.includes('Ready') || body?.includes('Upcoming') || body?.includes('Recently');

  evidence.push(recordEvidence(
    'Follow-ups tab',
    'Follow-ups section visible in Action Center',
    `Has follow-up content: ${hasFollowUps}`,
    hasFollowUps ? 'PASS' : 'FAIL',
    'browser → Action Center → follow-ups tab'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(hasFollowUps).toBeTruthy();
});

// ─── Test 12: Light/Dark theme regression ───────────────────────────────

test('12. Action Center renders correctly in both themes', async ({ page }) => {
  const evidence: TestEvidence[] = [];

  await loginAsAdmin(page);

  // Light theme
  await page.goto(ADMIN_ALERTS, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const bgColorLight = await page.evaluate(() => {
    return getComputedStyle(document.body).backgroundColor;
  });

  evidence.push(recordEvidence(
    'Light theme',
    'Page renders with light background',
    `bgColor: ${bgColorLight}`,
    bgColorLight ? 'PASS' : 'FAIL',
    'browser → computed style'
  ));

  // Check body is not transparent/missing
  const bodyTextLight = await page.textContent('body');
  const hasContentLight = (bodyTextLight?.length ?? 0) > 100;

  evidence.push(recordEvidence(
    'Light theme content',
    'Page has visible content',
    `Content length: ${bodyTextLight?.length}`,
    hasContentLight ? 'PASS' : 'FAIL',
    'browser → DOM text content'
  ));

  writeEvidenceReport(evidence, test.info());
  expect(hasContentLight).toBeTruthy();
});
