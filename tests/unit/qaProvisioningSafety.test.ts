import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QA_FIXTURE_USERS, type QaFixtureRow } from '../setup/qa-fixtures';
import { ISOLATED_IDENTITIES } from '../../scripts/dev/qa-tenant.mjs';
import { PRODUCTION_PROJECT_ID } from '../../src/lib/environmentContract';
import {
  QA_DB_HOST,
  QA_DB_SSL,
  QA_DB_USER,
  QA_PROJECT_ORIGIN,
  QA_PROJECT_REF,
  QA_PROVISIONING_FIXTURES,
  assertNonEmptyAllowlist,
  assertUsersAllowed,
  validateQaDbHost,
  validateQaDbUser,
  validateQaProjectUrl,
} from '../../scripts/lib/qa-provisioning-policy.mjs';

const fixturePair = (row: QaFixtureRow) => ({
  id: String(row.id),
  phone: String(row.phone),
});

describe('QA auth provisioning safety', () => {
  it('allows exactly the stable CI fixture identities declared by the fixtures', () => {
    const declared = [
      ...QA_FIXTURE_USERS.map(fixturePair),
      ...ISOLATED_IDENTITIES.map((identity) => ({ id: identity.id, phone: identity.phone })),
    ];

    expect(QA_PROVISIONING_FIXTURES).toEqual(declared);
    expect(new Set(QA_PROVISIONING_FIXTURES.map((fixture) => fixture.id)).size).toBe(
      QA_PROVISIONING_FIXTURES.length,
    );
  });

  it('refuses an empty allowlist', () => {
    expect(() => assertNonEmptyAllowlist([])).toThrow(/allowlist is empty/i);
  });

  it('accepts only allowlisted users with their declared phone', () => {
    expect(
      assertUsersAllowed(
        QA_PROVISIONING_FIXTURES.map((fixture) => ({ id: fixture.id, phone: fixture.phone })),
      ),
    ).toHaveLength(QA_PROVISIONING_FIXTURES.length);
  });

  it('rejects an unexpected user without exposing the user identifier or phone', () => {
    const unexpected = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      phone: '923000000077',
    };

    try {
      assertUsersAllowed([unexpected]);
      throw new Error('expected rejection');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/unexpected user/i);
      expect(message).not.toContain(unexpected.id);
      expect(message).not.toContain(unexpected.phone);
    }
  });

  it('rejects an allowlisted id carrying a different phone', () => {
    const fixture = QA_PROVISIONING_FIXTURES[0];
    expect(() =>
      assertUsersAllowed([{ id: fixture.id, phone: '923000000077' }]),
    ).toThrow(/unexpected phone/i);
  });

  it('refuses to proceed when no allowlisted users are present', () => {
    expect(() => assertUsersAllowed([])).toThrow(/no allowlisted/i);
  });

  it('requires the exact HTTPS QA project URL', () => {
    expect(validateQaProjectUrl(QA_PROJECT_ORIGIN)).toBe(QA_PROJECT_ORIGIN);
    expect(validateQaProjectUrl(`${QA_PROJECT_ORIGIN}/`)).toBe(QA_PROJECT_ORIGIN);

    for (const bad of [
      `${QA_PROJECT_ORIGIN}.evil.example`,
      'https://evil.example/?bpybjrjenwccowvtrevu',
      `${QA_PROJECT_ORIGIN}/rest/v1`,
      `http://${QA_PROJECT_ORIGIN.slice('https://'.length)}`,
      `${QA_PROJECT_ORIGIN}?redirect=1`,
    ]) {
      expect(() => validateQaProjectUrl(bad)).toThrow(/exact QA Supabase project URL|valid URL/i);
    }
  });

  it('keeps TLS certificate verification enabled', () => {
    expect(QA_DB_SSL).toEqual({ rejectUnauthorized: true });
  });

  it('accepts the same allowlisted rows on every run', () => {
    const rows = QA_PROVISIONING_FIXTURES.map((fixture) => ({
      id: fixture.id,
      phone: fixture.phone,
    }));
    expect(assertUsersAllowed(rows)).toEqual(rows);
    expect(assertUsersAllowed(rows)).toEqual(rows);
  });

  it('keeps the provisioner scoped to the allowlist and free of disabled TLS', () => {
    const source = fs.readFileSync(
      path.resolve('scripts/provision-auth-sessions.mjs'),
      'utf8',
    );

    expect(source).toContain('QA_PROVISIONING_FIXTURES');
    expect(source).toContain('assertUsersAllowed');
    expect(source).toContain('WHERE id = ANY($1::uuid[])');
    expect(source).not.toContain('rejectUnauthorized: false');
    expect(source).not.toContain('user.name');

    const logLines = source
      .split('\n')
      .filter((line) => /console\.(log|error|warn)/.test(line))
      .join('\n');
    expect(logLines).not.toMatch(/user\.(name|phone|email)|e164/i);
  });
});

/**
 * `PHASE_2A_BACKUP_RESTORE.md` records this as `PROD_DB_USER`. Hardcoded on purpose: the test states
 * the production identity it defends against instead of deriving it from the code under test.
 */
// Read from the environment record instead of spelling a production project ref in a file CI
// executes: `tests/unit/productionReachGuard.test.ts` (rightly) refuses that literal, and a
// second copy of the ref is the drift `environments.json` exists to prevent.
const PRODUCTION_DB_USER = `postgres.${PRODUCTION_PROJECT_ID}`;
const readRepoFile = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), 'utf8');

describe('QA database target safety', () => {
  it('pins host and user to the repository configuration record, not a guess', () => {
    expect(QA_DB_HOST).toBe('aws-0-ap-northeast-1.pooler.supabase.com');
    expect(QA_DB_USER).toBe(`postgres.${QA_PROJECT_REF}`);
    expect(QA_PROJECT_ORIGIN).toBe(`https://${QA_PROJECT_REF}.supabase.co`);

    const branchFlow = readRepoFile('docs/BRANCH_FLOW_CORRECTIONS_VERIFICATION.md');
    expect(branchFlow).toContain(`QA_DB_HOST=${QA_DB_HOST}`);
    expect(branchFlow).toContain(`QA_DB_USER=${QA_DB_USER}`);

    expect(readRepoFile('ENGINEERING_OS_STATE.md')).toContain(QA_DB_HOST);
  });

  it('records why the host alone cannot exclude production', () => {
    const backupRestore = readRepoFile('PHASE_2A_BACKUP_RESTORE.md');
    expect(backupRestore).toContain(QA_DB_HOST);
    expect(backupRestore).toContain(PRODUCTION_DB_USER);
    expect(PRODUCTION_DB_USER).not.toBe(QA_DB_USER);
  });

  it('accepts exactly the documented QA host', () => {
    expect(validateQaDbHost(QA_DB_HOST)).toBe(QA_DB_HOST);
    expect(validateQaDbHost(`  ${QA_DB_HOST.toUpperCase()}  `)).toBe(QA_DB_HOST);
  });

  it('rejects every other host, including look-alikes and alternative endpoints', () => {
    const rejected = [
      undefined,
      null,
      '',
      '   ',
      'aws-0-ap-northeast-1.pooler.supabase.co',
      'aws-0-ap-northeast-1.pooler.supabase.com.evil.example',
      'evil-aws-0-ap-northeast-1.pooler.supabase.com',
      `${QA_DB_HOST}.`,
      `${QA_DB_HOST}:6543`,
      `postgres://${QA_DB_USER}@${QA_DB_HOST}:6543/postgres`,
      `${QA_DB_HOST}/postgres`,
      `db.${QA_PROJECT_REF}.supabase.co`,
      'aws-0-us-east-1.pooler.supabase.com',
      'localhost',
      '127.0.0.1',
    ];

    for (const host of rejected) {
      expect(() => validateQaDbHost(host)).toThrow(/QA_DB_HOST/);
    }
  });

  it('rejects without echoing the supplied host', () => {
    try {
      validateQaDbHost(`${QA_DB_HOST}.evil.example`);
      throw new Error('expected rejection');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/QA_DB_HOST/);
      expect(message).not.toContain('evil.example');
    }
  });

  it('accepts only the documented QA database user', () => {
    expect(validateQaDbUser(QA_DB_USER)).toBe(QA_DB_USER);
    expect(validateQaDbUser(` ${QA_DB_USER} `)).toBe(QA_DB_USER);
  });

  it('rejects the production database user and malformed users', () => {
    const rejected = [
      undefined,
      null,
      '',
      '   ',
      'postgres',
      'postgres.',
      QA_PROJECT_REF,
      PRODUCTION_DB_USER,
      `postgres.${QA_PROJECT_REF}x`,
      `postgres.x${QA_PROJECT_REF}`,
      QA_DB_USER.toUpperCase(),
    ];

    for (const user of rejected) {
      expect(() => validateQaDbUser(user)).toThrow(/QA_DB_USER/);
    }
  });

  it('rejects the production user even on the shared QA pooler host', () => {
    // Both projects share the pooler hostname; only the username carries the project ref.
    expect(() => validateQaDbUser(PRODUCTION_DB_USER)).toThrow(/QA_DB_USER/);
    expect(() => validateQaDbUser(`${PRODUCTION_DB_USER} `)).toThrow(/QA_DB_USER/);
  });

  it('validates the target before a connection or an auth admin write', () => {
    const source = readRepoFile('scripts/provision-auth-sessions.mjs');
    const at = (needle: string) => {
      const index = source.indexOf(needle);
      if (index < 0) throw new Error(`provisioner is missing: ${needle}`);
      return index;
    };

    const urlCheck = at('const url = validateQaProjectUrl(');
    const hostCheck = at('const dbHost = validateQaDbHost(');
    const userCheck = at('const dbUser = validateQaDbUser(');
    const poolCreated = at('new pg.Pool(');
    const poolConnected = at('await pool.connect(');
    const allowlistChecked = at('const allowedUsers = assertUsersAllowed(');
    const adminClient = at('createClient(url, serviceRole');
    const firstAdminWrite = at('admin.auth.admin');

    expect(urlCheck).toBeLessThan(poolCreated);
    expect(hostCheck).toBeLessThan(poolCreated);
    expect(userCheck).toBeLessThan(poolCreated);
    expect(poolConnected).toBeLessThan(allowlistChecked);
    expect(allowlistChecked).toBeLessThan(adminClient);
    expect(adminClient).toBeLessThan(firstAdminWrite);
    expect(userCheck).toBeLessThan(firstAdminWrite);
    expect(hostCheck).toBeLessThan(firstAdminWrite);

    // The host lives in the policy, not here, and the old substring ref check must not return.
    expect(source).toContain('validateQaDbHost');
    expect(source).toContain('validateQaDbUser');
    expect(source).not.toContain('aws-0-ap-northeast-1');
    expect(source).not.toMatch(/split\(['"]\.['"]\)/);
  });

  it('rejects the production API origin and mixed QA/production tuples', () => {
    const productionOrigin = `https://${PRODUCTION_PROJECT_ID}.supabase.co`;

    expect(() => validateQaProjectUrl(productionOrigin)).toThrow(/exact QA Supabase project URL/);
    expect(() => validateQaProjectUrl(`${productionOrigin}/`)).toThrow(
      /exact QA Supabase project URL/,
    );
    // The documented QA host is shared with production, so a mixed tuple must fail on a
    // ref-bearing value: a production user cannot accompany the QA URL.
    expect(() => validateQaDbUser(PRODUCTION_DB_USER)).toThrow(/QA_DB_USER/);
    expect(() => validateQaProjectUrl(productionOrigin)).toThrow(/QA_SUPABASE_URL/);
  });

  it('stops at the first auth failure instead of writing the remaining fixtures', () => {
    const source = readRepoFile('scripts/provision-auth-sessions.mjs');

    expect(source).not.toContain('FAILED    fixture');
    expect(source).not.toContain('process.exitCode');
    expect(source).toContain("attempt.error.code === 'invalid_credentials'");
    expect(source).toMatch(/Refusing to continue: auth (repair|creation) failed/);
    expect(source).toMatch(/Refusing to continue: auth lookup failed/);

    // Failure messages name only the fixture position and, for verification, a status code.
    const failureLines = source
      .split('\n')
      .filter((line) => line.includes('Refusing to continue'))
      .join('\n');
    expect(failureLines).not.toMatch(/user\.(name|phone|email)|e164|password/i);
  });
});
