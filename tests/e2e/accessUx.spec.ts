/**
 * E2E Test: Employee job & access UX (Add Employee, Employee Detail, Customize access)
 *
 * What this locks down:
 *   1. Adding an employee is three business decisions — who, what job, where — and
 *      the screens never expose RBAC vocabulary (permission, inherit, override,
 *      effective, scope, matrix). The owner sees business areas and actions only.
 *   2. The access shown for a role is NOT hardcoded copy: it is compared with the
 *      role's real `role_permissions` rows in the QA database.
 *   3. The simplified screen still writes the correct configuration: a created
 *      employee gets a users row plus a membership carrying the chosen role and
 *      branch scope, and "Customize access" stores employee-specific overrides
 *      that "Use role access only" removes again.
 *   4. The same screens render in Urdu with RTL and no English copy leaking.
 *
 * QA database only; every record this spec creates is deleted again.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSql } from './helpers';

const BASE = 'http://localhost:5173';
const OTP = '123456';
const PIN = '4321';

const OWNER_PHONE = '03001234567';    // Shop Owner  -> 923001234567 (owner membership)
const QA_EMPLOYEE_ID = '2603007e-696a-4836-84e5-694d7a9173df'; // Sales Employee, template "Sales Employee"

const NEW_NAME = 'UX Check Employee';
const NEW_PHONE_LOCAL = '03007770011';
const NEW_PHONE_DB = '923007770011';

/** RBAC vocabulary that must never reach the shop owner's screen. */
const JARGON = /permission|inherit|override|effective|branch scope|scope|matrix|granular/i;

async function login(page: Page, phone: string) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('e.g. 03001234567').fill(phone);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

  const boxes = page.locator('input[inputmode="numeric"]:not([tabindex="-1"])');
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < OTP.length; i++) await boxes.nth(i).fill(OTP[i]);

  await page.waitForURL(/pin-set|\/login\/pin|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });

  if (page.url().includes('pin-set')) {
    // First sign-in on this device: set the PIN, then confirm it.
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
  } else if (page.url().includes('/login/pin')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
  }
  await page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 });
  await page.waitForTimeout(1200); // let the stores hydrate
}

async function setLanguage(page: Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state || {};
    parsed.state.language = l;
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  }, lang);
  await page.reload();
  await page.waitForTimeout(1500);
  // Reloading re-locks the device behind the PIN gate.
  if (page.url().includes('/login/pin')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(1500);
  }
}

async function bodyText(page: Page): Promise<string> {
  return (await page.textContent('body')) || '';
}

/** Job areas a role grants, straight from role_permissions. */
async function dbAreasForRole(roleName: string): Promise<string[]> {
  const rows = await execSql(`
    SELECT DISTINCT p.module
      FROM roles r
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = '${roleName}'
     ORDER BY p.module`);
  return rows.map((r) => String(r.module).toLowerCase());
}

/** Business-area labels the screen lists under "Access from this role". */
async function shownAreas(page: Page): Promise<string[]> {
  const panel = page.locator('p').filter({ hasText: 'Access from this role' }).first();
  await expect(panel).toBeVisible();
  // Each row is <div><span>area</span><span>actions</span></div>
  const labels = await page
    .locator('xpath=//p[contains(text(),"Access from this role")]/following-sibling::div/span[1]')
    .allInnerTexts();
  return labels.map((l) => l.trim().toLowerCase()).filter(Boolean);
}

async function deleteEmployeeByPhone(phone: string) {
  const [user] = await execSql(`SELECT id FROM users WHERE phone = '${phone}'`);
  if (!user) return;
  await execSql(`DELETE FROM user_permissions WHERE user_id = '${user.id}'`).catch(() => undefined);
  await execSql(`DELETE FROM memberships WHERE user_id = '${user.id}'`);
  await execSql(`DELETE FROM users WHERE id = '${user.id}'`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Employee job & access — simple for the owner, exact underneath', () => {
  test.afterAll(async () => {
    await deleteEmployeeByPhone(NEW_PHONE_DB);
    // never leave the QA employee with employee-specific access
    await execSql(`DELETE FROM user_permissions WHERE user_id = '${QA_EMPLOYEE_ID}' AND is_override = true`).catch(() => undefined);
  });

  test('1. Adding an employee asks only who / what job / where, with no RBAC jargon', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1000);

    const step1 = await bodyText(page);
    expect(step1).toContain('Add Employee');
    expect(step1).toContain('Full name');
    expect(step1).toContain('Phone number');
    expect(step1).toContain('Job title (optional)');
    expect(step1, 'step 1 exposes RBAC vocabulary').not.toMatch(JARGON);

    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(NEW_NAME);
    await page.getByPlaceholder('03001234567').fill(NEW_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Step 2: the job, its access, and where they work — all in business words.
    const step2 = await bodyText(page);
    expect(step2).toContain('What does UX do?');
    expect(step2).toContain('Access from this role');
    expect(step2).toContain('Where can UX work?');
    expect(step2, 'step 2 exposes RBAC vocabulary').not.toMatch(JARGON);

    // The role's access on screen must equal the role's rows in the database.
    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    await page.waitForTimeout(800);
    const [shown, fromDb] = [await shownAreas(page), await dbAreasForRole('Sales Manager')];
    expect(shown.length, 'no areas rendered for the selected role').toBeGreaterThan(0);
    expect(shown.sort()).toEqual(fromDb.sort());

    await page.getByRole('button', { name: 'Review' }).click();
    await page.waitForTimeout(800);
    const step3 = await bodyText(page);
    for (const label of ['Check the details', 'Name', 'Phone', 'Role', 'Branch', 'Access']) {
      expect(step3, `review step is missing "${label}"`).toContain(label);
    }
    expect(step3).toContain('Create Employee');
    expect(step3, 'review step exposes RBAC vocabulary').not.toMatch(JARGON);
  });

  test('2. Creating from the simplified screen writes the right membership, then the list shows it', async ({ page }) => {
    await deleteEmployeeByPhone(NEW_PHONE_DB);

    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1000);
    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(NEW_NAME);
    await page.getByPlaceholder('03001234567').fill(NEW_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    await page.waitForTimeout(600);

    // Choose one branch (the QA shop has two, so this is a real decision).
    const [branch] = await execSql(`SELECT id, name FROM branches WHERE is_active ORDER BY name LIMIT 1`);
    await page.getByRole('button', { name: new RegExp(branch.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
    await page.getByRole('button', { name: 'Review' }).click();
    await page.waitForTimeout(800);

    const review = await bodyText(page);
    expect(review).toContain('Sales Manager');
    expect(review, 'review does not show the chosen branch').toContain(branch.name);

    await page.getByRole('button', { name: 'Create Employee' }).click();
    await page.waitForURL(/\/admin\/employees$/, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // ── Database is the judge ──
    const [created] = await execSql(`SELECT id, name, phone FROM users WHERE phone = '${NEW_PHONE_DB}'`);
    expect(created, 'employee row was not created').toBeTruthy();
    expect(created.name).toBe(NEW_NAME);

    const [membership] = await execSql(`
      SELECT m.role, m.status, m.tenant_id, r.name AS template, m.branch_scope
        FROM memberships m LEFT JOIN roles r ON r.id = m.role_id
       WHERE m.user_id = '${created.id}'`);
    expect(membership, 'membership row was not created').toBeTruthy();
    expect(membership.template).toBe('Sales Manager');
    expect(membership.status).toBe('active');
    expect(membership.tenant_id).toBe('00000000-0000-0000-0000-000000000001');
    expect(String(membership.branch_scope)).toContain(branch.id);

    // Reload: the list must show the new employee.
    await page.reload();
    await page.waitForTimeout(1500);
    expect(await bodyText(page)).toContain(NEW_NAME);
  });

  test('3. The same flow in Urdu: RTL, translated, no English copy leaking', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await setLanguage(page, 'ur');
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1200);

    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const step1 = await bodyText(page);
    expect(step1).toContain('ملازم شامل کریں');
    expect(step1).toContain('پورا نام');
    expect(step1).toContain('فون نمبر');
    expect(step1).toContain('آگے');
    for (const english of ['Add Employee', 'Full name', 'Phone number', 'Job title (optional)', 'Next']) {
      expect(step1, `English copy "${english}" leaked into the Urdu flow`).not.toContain(english);
    }

    await page.getByPlaceholder('مثلاً بلال احمد').fill('بلال احمد');
    await page.getByPlaceholder('03001234567').fill('03007770022');
    await page.getByRole('button', { name: 'آگے' }).click();
    await page.waitForTimeout(900);

    const step2 = await bodyText(page);
    expect(step2).toContain('بلال کیا کام کرتا ہے؟');
    expect(step2).toContain('اس کردار سے ملنے والی رسائی');
    expect(step2).toContain('بلال کہاں کام کر سکتا ہے؟');
    expect(step2).not.toContain('Access from this role');
    expect(step2).not.toContain('Where can');

    const overflow = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(overflow, 'horizontal overflow in the Urdu add-employee flow').toBe(false);
  });

  test('4. Employee detail explains role, place and access without RBAC vocabulary', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/${QA_EMPLOYEE_ID}`);
    await page.waitForTimeout(1600);

    const body = await bodyText(page);
    for (const label of ['Job & access', 'Role', 'Can work at', 'Access', 'Customize access']) {
      expect(body, `employee detail is missing "${label}"`).toContain(label);
    }
    expect(body, 'employee detail exposes RBAC vocabulary').not.toMatch(JARGON);

    // The access line must equal the employee's role in the database.
    const [row] = await execSql(`
      SELECT r.name AS template
        FROM memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.user_id = '${QA_EMPLOYEE_ID}'`);
    const dbAreas = await dbAreasForRole(row.template);
    const accessRow = page.getByText('Access', { exact: true }).first().locator('xpath=..');
    const accessValue = (await accessRow.innerText()).toLowerCase();
    for (const area of dbAreas) {
      expect(accessValue, `detail does not list the role's area "${area}"`).toContain(area);
    }
  });

  test('5. Customize access saves an override in the DB, and "use role access only" removes it', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/${QA_EMPLOYEE_ID}`);
    await page.waitForTimeout(1600);

    await page.getByRole('button', { name: 'Customize access' }).click();
    await page.waitForTimeout(900);

    // Suppliers is not part of this employee's role, so turning it on is a real override.
    const suppliersRow = page.locator('button').filter({ hasText: /^🏭\s*Suppliers/ }).first();
    await expect(suppliersRow).toBeVisible();
    await suppliersRow.click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);

    const overrides = await execSql(`
      SELECT p.code, up.is_granted
        FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = '${QA_EMPLOYEE_ID}' AND up.is_override = true AND p.module = 'companies'`);
    expect(overrides.length, 'no override row was stored for the customized area').toBeGreaterThan(0);
    expect(overrides.every((o) => o.is_granted === true)).toBe(true);

    // The screen must now say the access differs from the role, and reset must clear it.
    await page.waitForTimeout(1000);
    expect(await bodyText(page)).toContain('changed for Sales Employee');
    await page.getByRole('button', { name: 'Customize access' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Use role access only' }).click();
    await page.waitForTimeout(2000);

    const [left] = await execSql(`
      SELECT count(*)::text AS n FROM user_permissions
       WHERE user_id = '${QA_EMPLOYEE_ID}' AND is_override = true`);
    expect(Number(left.n), 'reset did not remove the employee-specific access').toBe(0);
  });
});
