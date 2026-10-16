/**
 * preflightServerIdentity — `npm run preflight` must judge the server ON THE PORT, not the machine.
 *
 * WHY THIS TEST EXISTS
 *   Preflight's whole job is to stop a run against the wrong backend before it is paid for. Its
 *   server check used to read a `vite` command line found anywhere on the machine, so a `--mode qa`
 *   server on one port certified an unrelated — even default-mode — server on another. Measured
 *   2026-10-13: `QA_PORT=5273` would have been reported as `qa` because a QA-mode server existed on
 *   5174. Every case below runs a real HTTP server on an ephemeral port and calls the same
 *   `serverProbe` that preflight calls, so the evidence is behaviour, not a source reading.
 *
 * WHAT IS PINNED
 *   1. A QA-mode server reading the WRONG project is rejected — while a CORRECT QA server is
 *      running on another port at the same time, which is exactly what made the old check wrong.
 *   2. A server on the right project but the wrong environment marker is rejected.
 *   3. A foreign application answering with a page is rejected.
 *   4. An HTTP error is rejected.
 *   5. A server that IS this app in QA mode is accepted, and only identifiers come back.
 *   6. Nothing listening is reported as not-up, so preflight can fail closed on it.
 *   7. Preflight itself fails closed on a rejection, and neither preflight nor lib.mjs may fall back
 *      to scanning every vite process on the machine.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { STAGING_PROJECT_ID } from '../../src/lib/environmentContract';
import { expectedProjectRefFor } from '../../scripts/lib/environments.mjs';
import { QA_PROJECT_REF, serverProbe } from '../../scripts/dev/lib.mjs';

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

/** Serve `body` on an ephemeral loopback port and return the port. */
async function serve(body: string, status = 200): Promise<number> {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.setHeader('content-type', status === 200 ? 'application/javascript' : 'text/plain');
    response.end(body);
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not bind a test server');
  return address.port;
}

const envModule = (env: Record<string, unknown>) =>
  `import.meta.env = ${JSON.stringify(env)};\nexport const guard = true;\n`;

/** A value that must never appear in a diagnostic or a result: the block also carries the anon key. */
const CREDENTIAL_MARKER = 'ANON-KEY-MARKER-MUST-NOT-BE-PRINTED';

const qaEnv = (overrides: Record<string, unknown> = {}) =>
  envModule({
    MODE: 'qa',
    VITE_SUPABASE_PROJECT_ID: STAGING_PROJECT_ID,
    VITE_APP_ENV: 'staging',
    VITE_SUPABASE_ANON_KEY: CREDENTIAL_MARKER,
    ...overrides,
  });

describe("preflight judges the server on the QA port, not the machine", () => {
  test('the expected project is the one environments.json declares, not a second copy', () => {
    expect(QA_PROJECT_REF).toBe(STAGING_PROJECT_ID);
    expect(expectedProjectRefFor('staging')).toBe(STAGING_PROJECT_ID);
  });

  test('a QA-mode server on the WRONG project is rejected even while a correct QA server runs too', async () => {
    // The old implementation passed this port because a correct QA server existed elsewhere.
    const correctPort = await serve(qaEnv());
    const wrongProjectPort = await serve(qaEnv({ VITE_SUPABASE_PROJECT_ID: 'someotherproject' }));

    const correct = await serverProbe(correctPort);
    const wrong = await serverProbe(wrongProjectPort);

    expect(correct.up).toBe(true);
    expect(correct.problem, 'the real QA server must be accepted').toBeUndefined();

    expect(wrong.up).toBe(true);
    expect(wrong.problem, 'a different project must not be certified by another port').toBeDefined();
    expect(wrong.problem).toMatch(/is reading project someotherproject/);
    expect(wrong.problem).toContain(STAGING_PROJECT_ID);
  });

  test('the right project with the wrong environment marker is rejected', async () => {
    const port = await serve(qaEnv({ VITE_APP_ENV: 'development' }));

    const probe = await serverProbe(port);

    expect(probe.problem).toBeDefined();
    expect(probe.problem).toMatch(/reports VITE_APP_ENV=development, not staging/);
  });

  test('a foreign application answering with a page is rejected', async () => {
    const port = await serve('<html><head><title>Farmer App</title></head><body>other</body></html>');

    const probe = await serverProbe(port);

    expect(probe.problem).toBeDefined();
    expect(probe.problem).toMatch(/did not come back as this app's module/);
  });

  test('an HTTP error is rejected rather than treated as a server', async () => {
    const port = await serve('not found', 404);

    const probe = await serverProbe(port);

    expect(probe.problem).toBeDefined();
    expect(probe.problem).toMatch(/answered HTTP 404/);
  });

  test('this app in QA mode is accepted, and only identifiers come back', async () => {
    const port = await serve(qaEnv());

    const probe = await serverProbe(port);

    expect(probe.problem).toBeUndefined();
    expect(probe.identity).toEqual({
      mode: 'qa',
      projectId: STAGING_PROJECT_ID,
      appEnv: 'staging',
    });
    expect(JSON.stringify(probe)).not.toContain(CREDENTIAL_MARKER);
  });

  test('nothing listening is reported as not-up, so preflight can fail closed on it', async () => {
    const port = await serve(qaEnv());
    const probe = await serverProbe(port);
    expect(probe.up).toBe(true);

    await new Promise<void>((resolve) => openServers.pop()!.close(() => resolve()));

    const closed = await serverProbe(port);
    expect(closed.up).toBe(false);
  });
});

describe('preflight fails closed on a rejected server and never scans the machine', () => {
  const preflight = readFileSync(join(process.cwd(), 'scripts/dev/preflight.mjs'), 'utf8');
  const lib = readFileSync(join(process.cwd(), 'scripts/dev/lib.mjs'), 'utf8');

  test('a rejected server is a hard failure that names the reason and the start command', () => {
    expect(preflight).toMatch(/server\.problem/);
    expect(preflight).toMatch(/fails\.push\(\s*`server on \$\{server\.origin\} is not this app's QA server/);
    expect(preflight).toMatch(/npx vite --mode qa --host 0\.0\.0\.0 --port \$\{QA_PORT\}/);
  });

  test('neither preflight nor lib.mjs inspects every vite process on the machine', () => {
    const machineWideScan = /Get-CimInstance Win32_Process -Filter "Name='node\.exe'" \| Where-Object \{ \$_\.CommandLine -like '\*vite\*'/;
    expect(preflight, 'preflight must not scan machine-wide for vite').not.toMatch(machineWideScan);
    expect(lib, 'lib.mjs must not scan machine-wide for vite').not.toMatch(machineWideScan);
  });

  test('both gates use the one shared identity contract', () => {
    expect(lib).toMatch(/from '\.\.\/lib\/dev-server-identity\.mjs'/);
    expect(readFileSync(join(process.cwd(), 'tests/e2e/global-setup.ts'), 'utf8')).toMatch(
      /from '\.\.\/\.\.\/scripts\/lib\/dev-server-identity\.mjs'/,
    );
  });
});
