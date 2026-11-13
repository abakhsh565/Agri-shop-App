/**
 * productionReachGuard — nothing that runs automatically may reach production, or re-open the
 * demo-code bypass.
 *
 * This is a source scan rather than a behavioural test, because the defect it guards against is a
 * *configuration* defect: the previous production access was not a bug in any function, it was a
 * hardcoded default in `utils/supabase/info.tsx` plus a `VITE_OTP_DELIVERY` default that nobody
 * set. A behavioural test cannot see either one. This can.
 *
 * Three things are asserted:
 *
 *   1. Nothing on the automated surface (shipped code, CI, configs, scripts, the test suites)
 *      names the production Supabase URL or the production publishable key.
 *   2. `utils/supabase/info.tsx` — the file the fallback lived in — has no default at all.
 *   3. The demo code has exactly one definition and no literal comparison anywhere else, so a
 *      second acceptance path cannot be added quietly.
 *
 * The legacy top-level files under `tests/` (25 of them) are held to a separate, shrinking count.
 * They are ad-hoc manual harnesses that nothing references, and several of them write rows
 * (`tests/deploy-migration-0040.cjs` applies migrations; `tests/security-audit.cjs`,
 * `tests/dashboard-audit.cjs` and others create and delete data). They predate this phase and are
 * inventoried in PRODUCTION_READINESS_AUDIT.md for removal in Phase 2. The count may fall and must
 * never rise: a new file that hardcodes production fails this test.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();

const PRODUCTION_URL = 'gkswcfljxlutkfdvvqng.supabase.co';
const PRODUCTION_KEY = 'sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG';
const DEMO_CODE = '123456';

/**
 * Manual harnesses at the top level of `tests/` that predate this phase. The list is deliberately
 * a count and not a list of names: it is a ratchet, not an allowlist. Lower it when they are
 * deleted; never raise it.
 */
const LEGACY_MANUAL_HARNESSES_REFERENCING_PRODUCTION = 25;

/** The automated surface: what ships, what CI runs, and what a config file can invoke. */
const AUTOMATED_SURFACE = [
  'src',
  'utils',
  'scripts',
  'tests/unit',
  'tests/integration',
  'tests/e2e',
  'tests/setup',
  '.github/workflows',
];

const AUTOMATED_FILES = [
  'package.json',
  'vite.config.ts',
  'vitest.config.ts',
  // The integration suite's own config: it can invoke every file in tests/integration, so it is part
  // of the surface that must not name production.
  'vitest.integration.config.ts',
  'playwright.config.ts',
  'playwright.media.config.ts',
  'capacitor.config.ts',
  'index.html',
  '.env.example',
];

const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|html|yml|yaml|sql)$/;

/**
 * The scanners themselves. A scanner has to contain the literals it searches for, so it cannot
 * pass its own rule.
 *
 * Named file by file rather than "exclude test files", so that adding a third scanner means
 * editing this list on purpose — and so no ordinary source file can inherit the exemption.
 */
const SCANNER_SELF = new Set([
  'tests/unit/productionReachGuard.test.ts',
  'scripts/audit-production-readiness.mjs',
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEXT_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

function automatedSurfaceFiles(): string[] {
  const files = AUTOMATED_FILES.map((f) => join(ROOT, f));
  for (const dir of AUTOMATED_SURFACE) walk(join(ROOT, dir), files);
  return files.filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function rel(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/');
}

describe('the automated surface cannot name production', () => {
  test('no production Supabase URL, and no production publishable key', () => {
    const offenders: string[] = [];
    for (const file of automatedSurfaceFiles()) {
      if (SCANNER_SELF.has(rel(file))) continue;
      const text = read(file);
      if (text.includes(PRODUCTION_URL) || text.includes(PRODUCTION_KEY)) {
        offenders.push(rel(file));
      }
    }
    expect(
      offenders,
      'These files can be reached by CI, a build, or an automated run and they hardcode a ' +
        'production endpoint or key. Remove the literal and read the environment instead — the ' +
        'rules live in src/lib/environmentContract.ts. Offenders:',
    ).toEqual([]);
  });

  test('the production project id is never used as a default value', () => {
    // The exact shape of the original defect: `X || "<production ref>"`.
    const fallbackPattern = /\|\|\s*["'`]gkswcfljxlutkfdvvqng["'`]/;
    const offenders: string[] = [];
    for (const file of [
      ...automatedSurfaceFiles(),
      ...walk(join(ROOT, 'tests')).filter((f) => !/[/\\]tests[/\\][^/\\]+$/.test(f)),
    ]) {
      if (fallbackPattern.test(read(file))) offenders.push(rel(file));
    }
    expect(offenders, 'A production project id is being used as a fallback default:').toEqual([]);
  });
});

describe('the file the production fallback lived in has no fallback', () => {
  const info = read(join(ROOT, 'utils/supabase/info.tsx'));

  /** Only the executable lines — the file's own comment explains the defect it fixed. */
  const exportLines = info
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('export const'));

  test('neither export supplies a default', () => {
    expect(exportLines.length).toBe(2);
    for (const line of exportLines) expect(line).not.toContain('||');
  });

  test('no project ref, URL or key survives in it', () => {
    expect(info).not.toContain(PRODUCTION_URL);
    expect(info).not.toContain(PRODUCTION_KEY);
    expect(info).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/);
    expect(info).not.toMatch(/sb_publishable_[A-Za-z0-9_-]+/);
  });

  test('it still exports both names, so the app is not left without config', () => {
    expect(info).toMatch(/export const projectId/);
    expect(info).toMatch(/export const publicAnonKey/);
  });
});

describe('the demo code has one definition and one acceptance point', () => {
  test('the literal is defined only in authMode.ts', () => {
    const definitions = automatedSurfaceFiles().filter(
      (f) =>
        !SCANNER_SELF.has(rel(f)) && /DEMO_OTP_CODE\s*=\s*["'`]123456["'`]/.test(read(f)),
    );
    expect(definitions.map(rel)).toEqual(['src/lib/authMode.ts']);
  });

  test('nothing outside authMode.ts decides whether a code is the demo code', () => {
    // Scoped to shipped code, because the suites must be allowed to assert *about* the literal.
    // What is forbidden is shipped code that accepts it: an equality test, or a lookup that
    // would also answer "yes, that is the code".
    const acceptance = /([=!]==?\s*["'`]123456["'`]|\.(includes|indexOf)\(\s*["'`]123456["'`])/;
    const offenders = walk(join(ROOT, 'src'))
      .filter((f) => rel(f) !== 'src/lib/authMode.ts')
      .filter((f) => acceptance.test(read(f)))
      .map(rel);
    expect(
      offenders,
      'A file other than authMode.ts decides whether the shared code is correct:',
    ).toEqual([]);
  });

  test('the real OTP paths still exist (the scan is not passing because auth went missing)', () => {
    const auth = read(join(ROOT, 'src/lib/auth.ts'));
    expect(auth).toContain('signInWithOtp');
    expect(auth).toContain('verifyOtp');
    expect(auth).toContain('demoCodeAccepted');
  });
});

describe('legacy manual harnesses may only shrink', () => {
  test('the count of unprotected harnesses has not grown', () => {
    const legacy = readdirSync(join(ROOT, 'tests'))
      .filter((name) => /\.(mjs|cjs|mts|cts|ts)$/.test(name))
      .map((name) => join(ROOT, 'tests', name))
      .filter((file) => {
        try {
          return statSync(file).isFile();
        } catch {
          return false;
        }
      })
      .filter((file) => {
        const text = read(file);
        return text.includes(PRODUCTION_URL) || text.includes(PRODUCTION_KEY);
      });

    if (legacy.length > LEGACY_MANUAL_HARNESSES_REFERENCING_PRODUCTION) {
      throw new Error(
        `A file under tests/ now hardcodes production and nothing references it:\n` +
          legacy.map((f) => `  - ${rel(f)}`).join('\n') +
          `\n\n(point at a non-production target read from the environment, or delete it)`,
      );
    }

    // Shrinking is the goal — just lower the constant so the ratchet keeps its grip.
    expect(legacy.length).toBeLessThanOrEqual(LEGACY_MANUAL_HARNESSES_REFERENCING_PRODUCTION);
  });
});

describe('the phone-number examples in the UI are not mistaken for the demo code', () => {
  test('the placeholder digits that share a suffix with the code are not a bypass', () => {
    // `src/components/ui/OTPInput.tsx` discusses "123456" in a comment, and every phone
    // placeholder contains "3001234567". Neither accepts a login, and neither should make the
    // scan above fail — which is exactly why that scan looks for acceptance, not for the string.
    const otpInput = read(join(ROOT, 'src/components/ui/OTPInput.tsx'));
    expect(otpInput).toContain(DEMO_CODE);
    expect(otpInput).not.toMatch(/[=!]==?\s*["'`]123456["'`]/);
  });
});
