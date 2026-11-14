/**
 * A reload must not throw the owner back to the start of sign-in.
 *
 * `pendingPhone` is the only thing that says "a sign-in is in progress for this
 * number". It lives in the zustand store, and the store persisted only `user` —
 * so the moment the code screen reloaded (slow connection, back-forward, the OS
 * reclaiming a backgrounded tab) `pendingPhone` was empty, `OTPVerifyPage`'s
 * mount guard fired, and the owner was silently returned to the phone-number
 * screen to begin again. That is the reported "login takes ages" friction.
 *
 * The guard is what makes the assertion below decisive: the code screen stays
 * on `/login/otp` *only* while a pending phone exists, so "the URL survived the
 * reload" is exactly "the flow survived the reload".
 *
 * It is deliberately scoped to one tab — a new tab must start clean.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';

const BASE = process.env.QA_APP_URL || 'http://localhost:5173';
const OWNER_PHONE = '03001234567';

async function reachCodeScreen(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('e.g. 03001234567').fill(OWNER_PHONE);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });
  await expect(page.locator('[data-testid^="otp-digit-"]')).toHaveCount(6);
}

test('a reload on the code screen keeps the sign-in in progress', async ({ page }) => {
  await reachCodeScreen(page);

  await page.reload();

  await expect(
    page.locator('[data-testid^="otp-digit-"]'),
    'the owner was sent back to the start of sign-in by a plain reload',
  ).toHaveCount(6, { timeout: 15000 });
  expect(page.url(), 'the code screen must still be the code screen').toContain('/login/otp');
});

test('a new tab does not inherit a half-finished sign-in', async ({ page, context }) => {
  await reachCodeScreen(page);

  // A second tab is a second session: nothing typed in the first tab belongs here.
  const other = await context.newPage();
  await other.goto(`${BASE}/login/otp`);
  await expect
    .poll(() => other.url(), { timeout: 15000, message: 'a new tab inherited the other tab’s flow' })
    .not.toContain('/login/otp');
  await other.close();
});
