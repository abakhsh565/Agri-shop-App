/**
 * playwrightReuseGuard — Playwright must not drive a server that is not this app's QA server.
 *
 * WHY THIS IS BEHAVIOURAL, NOT A SOURCE SCAN
 *   The defect it guards against is an interaction: `reuseExistingServer: true` plus a port that
 *   answers. Measured on 2026-10-13, the separate Farmer-App project's vite held 5173 and the E2E
 *   configuration would have reused it silently. A scan cannot see that; real HTTP servers can, so
 *   every case below is served over a real socket on an ephemeral port and the guard is called
 *   exactly as the Playwright global setup calls it.
 *
 * WHAT IS PINNED
 *   1. A foreign application answering with a page is rejected, unverifiably.
 *   2. A vite-shaped server that reports a DIFFERENT project is rejected — and the credential in
 *      the environment block it served is never printed by the diagnostic.
 *   3. This app in the WRONG mode (the exact shape measured on port 5273 on 2026-10-13:
 *      MODE=development, project=localdev) is rejected for not being `--mode qa`.
 *   4. A 404 for the identity module is rejected as unverifiable.
 *   5. A server that IS this app in QA mode is accepted, and only identifiers are returned.
 *   6. Nothing listening is not a failure — Playwright then starts the server itself.
 *   7. Both Playwright configs wire this setup, so deleting the wiring or the reuse-guarded
 *      configuration turns this test red.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { STAGING_PROJECT_ID } from '../../src/lib/environmentContract';
import { SHARED_E2E_GLOBS } from '../../scripts/dev/lib.mjs';
import { assertReusedServerIsOurs, IDENTITY_MODULE_PATH } from '../e2e/global-setup';

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

/** Serve `body` on an ephemeral loopback port and return its origin. */
async function serve(body: string, status = 200): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.setHeader('content-type', status === 200 ? 'application/javascript' : 'text/plain');
    response.end(body);
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not bind a test server');
  return `http://127.0.0.1:${address.port}`;
}

const envModule = (env: Record<string, unknown>) =>
  `import.meta.env = ${JSON.stringify(env)};\nexport const guard = true;\n`;

/** A value that must never appear in a diagnostic: the block also carries the anon key. */
const CREDENTIAL_MARKER = 'ANON-KEY-MARKER-MUST-NOT-BE-PRINTED';

describe('the E2E run refuses to reuse a server it cannot identify', () => {
  test('a foreign application answering on the port is rejected with the fix in the message', async () => {
    const origin = await serve('<html><head><title>Farmer App</title></head><body>other product</body></html>');

    const error = await assertReusedServerIsOurs(origin).then(
      () => null,
      (thrown: Error) => thrown,
    );

    expect(error, 'a foreign page must not be accepted as the QA server').not.toBeNull();
    expect(error!.message).toMatch(/E2E refused to reuse the server/);
    expect(error!.message).toMatch(/did not come back as this app's module/);
    expect(error!.message).toMatch(/npx vite --mode qa/);
    expect(error!.message).toContain(origin);
  });

  test('a vite server reporting another project is rejected, and its credentials are never printed', async () => {
    const origin = await serve(
      envModule({
        MODE: 'qa',
        VITE_SUPABASE_PROJECT_ID: 'someotherproject',
        VITE_APP_ENV: 'staging',
        VITE_SUPABASE_ANON_KEY: CREDENTIAL_MARKER,
      }),
    );

    const error = await assertReusedServerIsOurs(origin).then(
      () => null,
      (thrown: Error) => thrown,
    );

    expect(error, 'a different project must not be accepted').not.toBeNull();
    expect(error!.message).toMatch(/reading project someotherproject/);
    expect(error!.message).toContain(STAGING_PROJECT_ID);
    expect(error!.message).not.toContain(CREDENTIAL_MARKER);
  });

  test('this app in the wrong mode is rejected — the exact shape measured on port 5273', async () => {
    const origin = await serve(
      envModule({
        MODE: 'development',
        VITE_SUPABASE_PROJECT_ID: 'localdev',
        VITE_APP_ENV: 'development',
        VITE_SUPABASE_ANON_KEY: CREDENTIAL_MARKER,
      }),
    );

    const error = await assertReusedServerIsOurs(origin).then(
      () => null,
      (thrown: Error) => thrown,
    );

    expect(error, 'a non-qa server must not be reused').not.toBeNull();
    expect(error!.message).toMatch(/not started with --mode qa/);
    expect(error!.message).toMatch(/MODE=development/);
    expect(error!.message).not.toContain(CREDENTIAL_MARKER);
  });

  test('a 404 for the identity module is rejected as unverifiable', async () => {
    const origin = await serve('not found', 404);

    await expect(assertReusedServerIsOurs(origin)).rejects.toThrow(/answered HTTP 404/);
  });

  test('a server that IS this app in QA mode is accepted, and only identifiers come back', async () => {
    const origin = await serve(
      envModule({
        MODE: 'qa',
        VITE_SUPABASE_PROJECT_ID: STAGING_PROJECT_ID,
        VITE_APP_ENV: 'staging',
        VITE_SUPABASE_ANON_KEY: CREDENTIAL_MARKER,
      }),
    );

    const identity = await assertReusedServerIsOurs(origin);

    expect(identity).not.toBeNull();
    expect(identity!.projectId).toBe(STAGING_PROJECT_ID);
    expect(identity!.mode).toBe('qa');
    expect(Object.keys(identity!).sort()).toEqual(['appEnv', 'mode', 'projectId']);
    expect(JSON.stringify(identity)).not.toContain(CREDENTIAL_MARKER);
  });

  test('nothing listening is not a failure — Playwright starts the server itself', async () => {
    await expect(assertReusedServerIsOurs('http://127.0.0.1:1')).resolves.toBeNull();
  });
});

describe('the guard is wired into the runs it protects', () => {
  const configs = ['playwright.config.ts', 'playwright.media.config.ts'];

  for (const file of configs) {
    test(`${file} declares the identity setup and still reuses a running server`, () => {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text, `${file} must run the identity guard before reuse`).toMatch(
        /globalSetup:\s*'\.\/tests\/e2e\/global-setup\.ts'/,
      );
      expect(text, `${file} is expected to reuse a running server — now conditioned on the guard`).toMatch(
        /reuseExistingServer:\s*true/,
      );
    });
  }

  test('the identity module the guard fetches is one this app actually serves', () => {
    // If the path ever stops existing, every run would fail closed for the wrong reason.
    expect(IDENTITY_MODULE_PATH).toBe('/src/lib/envGuard.ts');
    expect(readFileSync(join(process.cwd(), 'src/lib/envGuard.ts'), 'utf8').length).toBeGreaterThan(0);
  });
});

/**
 * The guard above protects the CONFIGURED origin. A spec that navigates to a hardcoded one walks
 * around it entirely — which is not hypothetical: measured on 2026-10-13, 21 specs hardcoded
 * `http://localhost:5173`, and with the separate Farmer-App project holding that port a run drove
 * the foreign application through this suite's selectors (the page snapshot showed its vite
 * overlay). The port is therefore configurable, and every spec must read the same variable.
 */
const OVERRIDABLE = /process\.env\.QA_APP_URL|envValue\('QA_APP_URL'\)/;

/** Both spellings measured in the suite: the loopback host and the IP literal (`fingerprintUnlock`
 * navigates by IP on purpose — WebAuthn refuses a ceremony there — but it must still be OUR port). */
const FIXED_PORT = /(localhost|127\.0\.0\.1):5173/;

/** One line of an E2E file: is its navigation target the verified origin, or a fixed port? */
function isOverridableOrigin(line: string, file: string): boolean {
  if (!FIXED_PORT.test(line)) return true;
  if (OVERRIDABLE.test(line)) return true;
  // global-setup's constant is only the documented default; the config value overrides it.
  return file === 'global-setup.ts' && line.includes('QA_DEV_SERVER_ORIGIN');
}

describe('a spec cannot navigate past the verified origin', () => {
  test('the rule itself rejects the shapes that caused the incident', () => {
    expect(isOverridableOrigin("const BASE = 'http://localhost:5173';", 'otpResume.spec.ts')).toBe(false);
    // The measured failure: fingerprintUnlock navigated by IP literal to whatever held 5173.
    expect(isOverridableOrigin('await page.goto("http://127.0.0.1:5173/");', 'fingerprintUnlock.spec.ts')).toBe(false);
    expect(isOverridableOrigin('const BASE = process.env.QA_APP_URL || \'http://localhost:5173\';', 'otpResume.spec.ts')).toBe(true);
    expect(
      isOverridableOrigin('const BASE_URL = process.env.QA_APP_URL || "http://localhost:5173";', 'fingerprintUnlock.spec.ts'),
    ).toBe(true);
  });

  test('every E2E origin is overridable by QA_APP_URL', () => {
    const dir = join(process.cwd(), 'tests/e2e');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!isOverridableOrigin(line, file)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, 'a hardcoded origin drives whatever holds that port').toEqual([]);
  });

  test('the Playwright configs read the same variable the specs do', () => {
    for (const file of ['playwright.config.ts', 'playwright.media.config.ts']) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text, `${file} must resolve its base URL the way the specs do`).toMatch(
        /process\.env\.QA_APP_URL/,
      );
    }
  });
});

describe('a change to the shared E2E harness invalidates lane evidence', () => {
  const shared = [
    'tests/e2e/global-setup.ts',
    'tests/e2e/helpers.ts',
    'playwright.config.ts',
    'playwright.media.config.ts',
  ];

  test('every lane depends on the shared harness files', () => {
    expect([...SHARED_E2E_GLOBS].sort()).toEqual([...shared].sort());
  });

  test('verify.mjs joins them onto every lane, not just the unmapped ones', () => {
    const text = readFileSync(join(process.cwd(), 'scripts/dev/verify.mjs'), 'utf8');
    expect(text).toMatch(/return \[\.\.\.own, \.\.\.SHARED_E2E_GLOBS\];/);
  });
});
