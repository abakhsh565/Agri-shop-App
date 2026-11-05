import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
  cleanupFixtures,
  claimOwned,
  ensureAuthSession,
  execSql,
  loginViaUi,
  ownership,
  setupFixtures,
  snapshotIds,
  trackOwned,
} from './helpers';
import { withSharedRowRestore } from './sharedRowRestore';

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
  test.beforeAll(async () => {
    await setupFixtures();
    await ensureAuthSession(OWNER_PHONE);
  });

  test.afterAll(async () => {
    // CLEANUP IS OWNERSHIP-BASED NOW.
    //
    // The company row and the audit row that its creation writes are registered by id the moment
    // they exist (see the test below). What used to run here instead:
    //   * `DELETE FROM companies WHERE name = '${COMPANY_NAME}'` — a name-scoped delete, which the
    //     ownership work replaced with the claimed id;
    //   * `DELETE FROM audit_events WHERE created_at >= '${startedAt}'` — a TIME WINDOW, which is
    //     the shape the fix exists to remove: another lane's audit row written in the same window
    //     is not this lane's to delete. History is claimed through the entity that caused it.
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

    // OWNED, immediately after creation: the company is claimed by the unique name this run
    // typed, and the audit row the creation wrote is claimed through that exact entity id.
    const [companyId] = await claimOwned(
      'companies',
      `SELECT id FROM companies WHERE name = '${COMPANY_NAME}'`,
    );
    await trackOwned(
      ownership(),
      'audit_events',
      await snapshotIds(`SELECT id FROM audit_events WHERE entity_id = '${companyId}'`),
    );
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

    // THE FIXTURE IS RESTORED IN `finally`-SEMANTICS, NOT AS THE LAST LINE.
    //
    // This name belongs to the shared QA Admin every lane signs in as. When the restore was the final
    // statement of the body, any failing assertion above it skipped the restore — so a red run left
    // QA Admin called "QA Admin Test" for every lane that followed, and the next run's `before` read
    // that leftover as the fixture. `withSharedRowRestore` runs the restore whether the body passed or
    // failed, and if the restore itself fails it says so instead of letting the row stay dirty.
    await withSharedRowRestore(
      `users.name for ${ADMIN_ID_PHONE} (profile edit)`,
      async () => {
        await execSql(`UPDATE users SET name = '${before.replace(/'/g, "''")}' WHERE phone = '${ADMIN_ID_PHONE}'`);
      },
      async () => {
        await loginViaUi(page, OWNER_PHONE);
        await page.goto('/admin/settings');
        await page.waitForLoadState('networkidle');

        // The profile card is a row on Settings: it carries a chevron and opens the profile screen.
        // The edit itself is still a sheet — two fields, so a sheet — opened by that screen's own
        // Edit button next to the name and number.
        await page.locator('[data-testid="settings-open-profile"]').click();
        await expect(page).toHaveURL(/\/admin\/settings\/profile$/, { timeout: 8000 });
        await page.locator('[data-testid="settings-edit-profile"]').click();
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
      },
    );
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
