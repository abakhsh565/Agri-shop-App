/**
 * onboardingScreensGuard — the screens the owner removed stay removed, on every environment.
 *
 * WHY THIS EXISTS. The owner's rule (2026-11-14): after the OTP code the person lands in their own
 * shop. No "Choose a business", no Agri ID, no recovery key — "we will add some other way to
 * recover the account". Those three screens were deleted from development, and the owner then saw
 * the Agri ID screen flash on staging, because staging was still serving the commit from before the
 * removal. The removal itself is not in doubt; what needed a guard is that a later branch — or a
 * deploy that builds a different ref than the branch it claims to serve — cannot bring them back.
 *
 * WHAT IS ASSERTED
 *   1. The page files are gone (a deleted screen cannot be re-mounted by accident).
 *   2. The router holds no path for them, and no import of them.
 *   3. No source file asks the identity RPCs for an Agri ID or a recovery key — the UI cannot grow
 *      the screens back through the helpers that used to feed them.
 *   4. The staging deploy builds the branch it serves: `deploy-staging.yml` may not check out `dev`,
 *      so "merged to staging" means "the code the owner verified is what runs there".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const src = (path: string) => readFileSync(join(ROOT, 'src', path), 'utf8');

const REMOVED_PAGES = [
  'pages/auth/BusinessSelectPage.tsx',
  'pages/auth/IdentityPage.tsx',
  'pages/auth/AccountRecoveryPage.tsx',
];

const REMOVED_ROUTES = ['/login/business', '/login/recover', '/identity'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, 'src', dir), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...sourceFiles(join(dir, entry.name)));
    else if (/\.tsx?$/.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

describe('the removed onboarding screens stay removed', () => {
  test('their page files do not exist', () => {
    const present = REMOVED_PAGES.filter((page) => existsSync(join(ROOT, 'src', page)));
    expect(present).toEqual([]);
  });

  test('the router has no path for them', () => {
    for (const route of REMOVED_ROUTES) {
      // A path only counts as a route when it is a `path:` property, not prose in a comment.
      expect(src('router/index.tsx')).not.toMatch(new RegExp(`path:\\s*["']${route}["']`));
    }
    expect(src('router/index.tsx')).not.toMatch(/BusinessSelectPage|IdentityPage|AccountRecoveryPage/);
  });

  test('no screen asks for an Agri ID or a recovery key', () => {
    // `lib/auth.ts` owns the RPCs and `types/index.ts` the shape they answer with; neither renders
    // anything. Any other file touching them is a screen growing back.
    const offenders = sourceFiles('.')
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => !file.startsWith('lib/auth.ts') && !file.startsWith('types/'))
      .filter((file) => /getMyIdentity|rotateMyRecoveryKey|hasRecoveryKey/.test(readFileSync(join(ROOT, 'src', file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('staging is built from the branch it serves, never from dev', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/deploy-staging.yml'), 'utf8');
    expect(workflow).not.toMatch(/ref:\s*dev\b/);
    expect(workflow).toMatch(/branches:\s*\[staging\]/);
  });
});
