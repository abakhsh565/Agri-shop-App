import { test, expect, type Page } from '@playwright/test';
import { cleanupFixtures, ensureAuthSession, execSql, loginViaUi, setupFixtures } from './helpers';

const OWNER_PHONE = '03009999999';       // 923009999999
const ADMIN_ID_PHONE = '923009999999';   // the stored e164 form
const COMPANY_NAME = `Supplier ${Date.now()}`;

/** Language is a persisted preference, so set it the way the app does and reload. */
async function setLang(page: Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...(parsed.state ?? {}), language: l };
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  }, lang);
  await page.reload();
}

async function count(sql: string): Promise<number> {
  const rows = (await execSql(sql)) as Array<{ n: string | number }>;
  return Number(rows[0].n);
}

/**
 * The two things a shop owner reported: an admin could not add a company
 * ("permission denied"), and deleting an account needed a deliberate second step.
 *
 * Evidence is the database, not a success toast: the company row is counted, and the
 * account still exists after the dialog is cancelled.
 */
test.describe('admin full access + the account-deletion gate', () => {
  let startedAt = '';

  test.beforeAll(async () => {
    startedAt = new Date().toISOString();
    await setupFixtures();
    await ensureAuthSession(OWNER_PHONE);
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM companies WHERE name = '${COMPANY_NAME}'`);
    // Creating a company writes an audit event. History is immutable in production, so the
    // lane removes exactly the rows THIS run added (time-scoped) instead of truncating the
    // table — the independent row count at the end of a gate must see 0, and it did not.
    await execSql(`DELETE FROM audit_events WHERE created_at >= '${startedAt}'`);
    await cleanupFixtures();
  });

  test('an admin can create a company through the real form', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await page.goto('/admin/companies/new');
    await page.waitForLoadState('networkidle');

    // The name is the first field on the form; the phone field is the only tel input.
    await page.locator('input:not([type="file"])').first().fill(COMPANY_NAME);
    await page.locator('input[type="tel"]').fill('03001234567');

    // The form has exactly one primary action, so "the last button" is it without
    // hardcoding a label that the copy pass may change.
    await page.locator('button').last().click();

    await expect
      .poll(
        async () => count(`SELECT count(*)::int AS n FROM companies WHERE name = '${COMPANY_NAME}'`),
        { timeout: 15000, message: 'the company row was never written — the write failed' },
      )
      .toBe(1);
  });

  test('deleting the account needs the exact profile name — and cancelling deletes nothing', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    await page.getByText('Delete account', { exact: true }).first().click();

    const submit = page.locator('[data-testid="confirm-submit"]');
    const input = page.locator('[data-testid="confirm-typed-input"]');
    const shown = page.locator('[data-testid="confirm-typed-name"]');

    await expect(shown, 'the dialog does not show whose account is being deleted').toBeVisible();
    const name = (await shown.innerText()).trim();
    expect(name.length, 'the profile name shown to type is empty').toBeGreaterThan(1);

    // Nothing typed → the destructive action is not available.
    await expect(submit, 'the destructive action was available without typing anything').toBeDisabled();

    // Wrong text → still not available.
    await input.fill(`${name}x`);
    await expect(submit, 'a wrong name unlocked the delete').toBeDisabled();

    // Exact text → available.
    await input.fill(name);
    await expect(submit, 'the exact name did not unlock the delete').toBeEnabled();
    await page.screenshot({ path: '.freebuff/interaction-shots/delete-account-en.png' });

    // Cancel, and prove the account is untouched.
    await page.locator('[data-testid="confirm-cancel"]').click();
    await expect(submit).toBeHidden();
    expect(await count(`SELECT count(*)::int AS n FROM users WHERE phone = '${ADMIN_ID_PHONE}'`)).toBe(1);
  });

  test('a profile edit is written to the database and survives a reload', async ({ page }) => {
    // The reported bug: a profile edit looked saved and came back unchanged. The write is
    // proved against the database AND across a reload, which is where a silently filtered
    // UPDATE (204, no error) showed itself.
    const before = String((await execSql(`SELECT name FROM users WHERE phone = '${ADMIN_ID_PHONE}'`))[0].name);
    const temporary = `${before} Test`;

    await loginViaUi(page, OWNER_PHONE);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await page.locator('input:not([type="file"])').first().fill(temporary);
    await page.getByRole('button', { name: /^save$/i }).first().click();

    await expect
      .poll(
        async () => String((await execSql(`SELECT name FROM users WHERE phone = '${ADMIN_ID_PHONE}'`))[0].name),
        { timeout: 15000, message: 'the profile name was never written to the database' },
      )
      .toBe(temporary);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(temporary).first(), 'the saved name did not survive a reload').toBeVisible();

    // Leave the fixture exactly as it was found.
    await execSql(`UPDATE users SET name = '${before.replace(/'/g, "''")}' WHERE phone = '${ADMIN_ID_PHONE}'`);
  });

  test('the same gate speaks Urdu, in RTL', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await setLang(page, 'ur');
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByText('اکاؤنٹ حذف کریں', { exact: true }).first().click();

    const submit = page.locator('[data-testid="confirm-submit"]');
    const input = page.locator('[data-testid="confirm-typed-input"]');

    await expect(page.getByText('تصدیق کے لیے اپنا نام لکھیں'), 'the Urdu prompt is missing').toBeVisible();
    await expect(submit).toBeDisabled();

    const name = (await page.locator('[data-testid="confirm-typed-name"]').innerText()).trim();
    await input.fill(name);
    await expect(submit, 'the exact name did not unlock the Urdu dialog').toBeEnabled();
    await page.screenshot({ path: '.freebuff/interaction-shots/delete-account-ur.png' });

    const screen = await page.evaluate(() => document.body.innerText);
    expect(screen, 'English leaked into the Urdu dialog').not.toContain('Delete for good');

    await page.locator('[data-testid="confirm-cancel"]').click();
  });
});
