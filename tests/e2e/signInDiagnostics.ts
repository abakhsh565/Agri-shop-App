/**
 * A sign-in that stalls must say WHY.
 *
 * `page.waitForURL` timing out on the sign-in path reports only that the page
 * did not move, and that one symptom cannot be told apart from at least three
 * different faults: the code was rejected, the Supabase session could not be
 * established (SESSION_SETUP_FAILED), or the app bounced back to /login.
 *
 * That last one is real and silent. `ProtectedRoute` and `PermissionGuard` both
 * redirect to /login when the auth store holds no user, and `OTPVerifyPage`
 * redirects there if it mounts without a pending phone — so "we ended up on
 * /login" can mean the flow never started rather than that it failed.
 *
 * This wrapper keeps the assertion exactly as strong (it still throws on a
 * timeout) and adds the evidence that identifies the cause: the URL it stopped
 * on, the page's own words, and any console/page errors.
 */
import type { ConsoleMessage, Page } from '@playwright/test';

export async function waitForSignedIn(
  page: Page,
  phone: string,
  target: string,
  wait: () => Promise<unknown>,
): Promise<void> {
  const problems: string[] = [];
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  };
  const onPageError = (e: Error) => problems.push(`pageerror: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await wait();
  } catch {
    const visible = (await page.locator('body').innerText().catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    const incomplete = await page.getByTestId('otp-incomplete').allInnerTexts().catch(() => []);
    const notices = await page
      .locator('[role="status"], [data-testid^="toast"]')
      .allInnerTexts()
      .catch(() => []);

    const lines = [
      `sign-in for ${phone} never reached ${target}`,
      `  url at failure: ${page.url()}`,
      `  visible text: ${visible || '(none)'}`,
      incomplete.length ? `  otp-incomplete: ${incomplete.join(' | ')}` : '',
      notices.length ? `  status/toast: ${notices.join(' | ')}` : '',
      problems.length ? '  page errors:' : '  page errors: (none)',
      ...problems.slice(-8).map((p) => `    ${p}`),
    ];

    throw new Error(lines.filter((l) => l !== '').join('\n'));
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}
