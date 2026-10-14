/**
 * appStoreReachGuard — an E2E lane must reach the store the APP renders from, never a second copy.
 *
 * WHY THIS EXISTS (measured 2026-10-14, not hypothetical)
 *   tests/e2e/branchFlowCorrections and tests/e2e/branchResponsibility both seeded the branch
 *   setup flow with `import('/src/stores/shopStore.ts')` from page context. Against a cold dev
 *   server that URL IS the app's module, so the lanes passed. Once the Vite server had applied
 *   any HMR invalidation the app booted `/src/stores/shopStore.ts?t=<ms>`, and the identical call
 *   loaded a SECOND module with a SECOND store. The write landed on a copy the screen could not
 *   see: both lanes then hung for 10s clicking a disabled `setup-continue`, which reads exactly
 *   like a product regression while the product was untouched. Re-running them on the same warm
 *   server reproduced it, which is how the module-identity cause was identified.
 *
 * WHAT THE RULE COVERS, AND WHAT IT DELIBERATELY DOES NOT
 *   Only `/src/stores/**` is pinned by the scan, because a store IS the state: two copies mean two
 *   answers to the same question. A pure module is not pinned — `/src/lib/biometric.ts` is imported
 *   by literal path from three lanes in this suite, and that is sound: it holds no module-level
 *   mutable state (only `const` tables and functions keyed by userId, with the actual credential
 *   and enrolment living in the authenticator and in storage), so a second copy behaves identically.
 *   A scan that flagged those files too would be a false positive and would train people to ignore it.
 *
 *   The rule for seizing a draft is behavioural rather than textual: resolve the url the app
 *   actually loaded (`seedShopDraft` in tests/e2e/helpers.ts does this from the page's own resource
 *   timings, newest first) and verify ON THE SCREEN that the write arrived before trusting it.
 *
 * WHAT IS PINNED
 *   1. No file under tests/e2e imports a module from `/src/stores/` by a literal path.
 *   2. Every file that writes a setup draft goes through `seedShopDraft`, so it resolves the app's
 *      instance and checks that the write landed. The helper's own definition is the one exception.
 *   3. The detector is non-vacuous: the exact shape that failed is caught, and the sanctioned
 *      helper is not.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const E2E_DIR = join(process.cwd(), 'tests', 'e2e');

/** Every non-declaration file an E2E lane can be written in. */
function e2eSources(): string[] {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(E2E_DIR, name))
    .sort();
}

/** Prose must not be able to fail — or pass — a source rule. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * A literal import of a store, evaluated in the page.
 *
 * The app's modules are loaded by the dev server under urls this test cannot guess (HMR appends a
 * timestamp), so a literal path is a guess that silently creates a second store instance.
 */
export function bareStoreImportOffenders(source: string, file: string): string[] {
  const code = withoutComments(source);
  const offenders: string[] = [];
  const bareImport = /import\(\s*['"]\/src\/stores\/[^'"]*['"]\s*\)/g;
  for (const match of code.matchAll(bareImport)) {
    const line = code.slice(0, match.index ?? 0).split('\n').length;
    offenders.push(`${file}:${line} imports ${match[0]}`);
  }
  return offenders;
}

/** A file that writes the setup draft must do it through the helper that reaches the app's store. */
export function draftWriteOffenders(source: string, file: string): string[] {
  const code = withoutComments(source);
  if (!code.includes('setSetupDraft')) return [];
  // The helper's own body is the sanctioned implementation of this rule.
  if (code.includes('export async function seedShopDraft')) return [];
  if (code.includes("from './helpers'") && code.includes('seedShopDraft')) return [];
  return [`${file} writes setSetupDraft without seedShopDraft`];
}

describe('appStoreReachGuard', () => {
  // The shape that failed on 2026-10-14. If the detector stops catching this, the guard is dead.
  const measuredFailure = [
    '    await page.evaluate(async () => {',
    "      const { useShopStore } = await import('/src/stores/shopStore.ts');",
    '      useShopStore.getState().setSetupDraft({ place });',
    '    });',
  ].join('\n');

  test('catches the measured failure and clears the sanctioned helper', () => {
    expect(
      bareStoreImportOffenders(measuredFailure, 'lane.spec.ts'),
      'the bare literal import that produced two store instances must be caught',
    ).toHaveLength(1);
    // Prose about the failure is documentation, not a violation.
    expect(
      bareStoreImportOffenders(`// was: import('/src/stores/shopStore.ts')\n/* ditto */`, 'lane.spec.ts'),
      'a comment describing the old shape must not be an offence',
    ).toHaveLength(0);

    const sanctioned = [
      "import { seedShopDraft } from './helpers';",
      'await seedShopDraft(',
      '  page,',
      '  { place: fixturePlace },',
      "  () => page.getByTestId('setup-continue').isEnabled(),",
      ');',
    ].join('\n');
    expect(
      bareStoreImportOffenders(sanctioned, 'lane.spec.ts'),
      'resolving the url the app loaded is the fix, not an offence',
    ).toHaveLength(0);
    expect(draftWriteOffenders(sanctioned, 'lane.spec.ts')).toHaveLength(0);
    expect(
      draftWriteOffenders('useShopStore.getState().setSetupDraft({ place });', 'lane.spec.ts'),
      'a manual draft write that does not go through the helper is an offence',
    ).toHaveLength(1);
  });

  test('no E2E lane guesses a store url, and draft writes resolve the app instance', () => {
    const files = e2eSources();
    expect(files.length, 'the guard must be reading the E2E lanes').toBeGreaterThan(10);

    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const name = relative(process.cwd(), file).replace(/\\/g, '/');
      return [...bareStoreImportOffenders(source, name), ...draftWriteOffenders(source, name)];
    });

    expect(offenders, `reach the app's store through seedShopDraft — found: ${offenders.join('; ')}`).toEqual([]);
  });
});
