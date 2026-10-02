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

  test('deleting the account runs the four-step sheet, and no unverified path deletes it', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const accountIntact = async () => {
      expect(
        await count(`SELECT count(*)::int AS n FROM users WHERE phone = '${ADMIN_ID_PHONE}'`),
        'the account row is gone — a delete happened that should not have',
      ).toBe(1);
    };

    await page.locator('[data-testid="settings-delete-account"]').click();

    // Step 1 names the account and what is lost, and will not move until it is acknowledged.
    await expect(page.locator('[data-testid="account-delete"]')).toBeVisible();
    await expect(page.getByText('Delete your account?')).toBeVisible();
    await expect(page.getByText('When you delete your account, you will lose:')).toBeVisible();
    const shouldContinue = page.locator('[data-testid="delete-continue"]');
    await expect(shouldContinue, 'the delete was available without acknowledging the loss').toBeDisabled();
    await page.locator('[data-testid="delete-understand"]').click();
    await expect(shouldContinue, 'the acknowledgement did not unlock the next step').toBeEnabled();
    await page.screenshot({ path: '.freebuff/interaction-shots/delete-account-step1-en.png' });

    // Backing out at step 1 deletes nothing.
    await page.locator('[data-testid="delete-back-1"]').click();
    await expect(page.locator('[data-testid="account-delete"]')).toBeHidden();
    await accountIntact();

    // Step 2 leads to the code — and a wrong code is refused before it ever reaches
    // the database, so the account survives it.
    await page.locator('[data-testid="settings-delete-account"]').click();
    await page.locator('[data-testid="delete-understand"]').click();
    await shouldContinue.click();
    await expect(page.locator('[data-testid="delete-step-2"]')).toBeVisible();
    await page.locator('[data-testid="delete-confirm"]').click();
    await expect(page.locator('[data-testid="delete-step-3"]'), 'the code step was never reached').toBeVisible({ timeout: 15000 });

    const boxes = page.locator('[data-testid^="otp-digit-"]');
    await boxes.first().click();
    await page.keyboard.type('000000');
    await page.locator('[data-testid="delete-verify"]').click();
    await expect(page.locator('[data-testid="delete-error"]'), 'a wrong code was not refused').toContainText('not right');
    await expect(page.locator('[data-testid="delete-step-3"]')).toBeVisible();
    await accountIntact();

    // Leaving the sheet without a verified code still changes nothing.
    await page.locator('[data-testid="delete-back-3"]').click();
    await page.locator('[data-testid="delete-back-2"]').click();
    await page.locator('[data-testid="delete-back-1"]').click();
    await expect(page.locator('[data-testid="account-delete"]')).toBeHidden();
    await accountIntact();
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
    await page.locator('[data-testid="settings-delete-account"]').click();

    // The same four steps, in Urdu: the step count, the title, and the gate.
    await expect(page.getByText('مرحلہ 1 از 4'), 'the Urdu step count is missing').toBeVisible();
    await expect(page.getByText('اپنا اکاؤنٹ حذف کر دیں؟'), 'the Urdu title is missing').toBeVisible();
    const shouldContinue = page.locator('[data-testid="delete-continue"]');
    await expect(shouldContinue, 'the Urdu delete was available without acknowledging the loss').toBeDisabled();
    await page.locator('[data-testid="delete-understand"]').click();
    await expect(shouldContinue, 'the Urdu acknowledgement did not unlock the next step').toBeEnabled();
    await page.screenshot({ path: '.freebuff/interaction-shots/delete-account-step1-ur.png' });

    const screen = await page.evaluate(() => document.body.innerText);
    expect(screen, 'English leaked into the Urdu sheet').not.toContain('Delete your account?');
    expect(screen, 'English leaked into the Urdu sheet').not.toContain('Continue to delete account');

    await page.locator('[data-testid="delete-back-1"]').click();
    expect(
      await count(`SELECT count(*)::int AS n FROM users WHERE phone = '${ADMIN_ID_PHONE}'`),
      'the account row is gone — a delete happened that should not have',
    ).toBe(1);
  });
});
