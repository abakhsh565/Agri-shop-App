/**
 * backupTargeting — a backup or a restore can only reach the environment it was told to reach.
 *
 * The defect this guards is the reason Phase 2A exists: `.github/workflows/backup-database.yml`
 * was titled "Backup Production Database", ran with `QA_DB_*`, and produced a QA dump stamped
 * "Environment: QA". Nothing failed. Not one assertion, log line or check noticed that the only
 * production backup the project possessed was a backup of the test database.
 *
 * So the rules are asserted here in the shape that defect took:
 *
 *   - the credentials must NAME their project (`postgres.<ref>`), and that name must be the
 *     environment's project — this is what catches QA credentials under a PROD_ prefix;
 *   - the production credentials are read only from `PROD_*` and never fall back to `QA_*`;
 *   - a restore can only target a throwaway in-process database, never a Supabase project.
 *
 * Each rule is asserted twice: the wrong configuration must be refused, and the same
 * configuration with exactly one field corrected must be allowed. The second half is what makes
 * the first half mean something.
 *
 * The project refs are imported from environments.json rather than written out, so the map and its
 * guard cannot drift apart.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  ENVIRONMENT_NAMES,
  SAFE_RESTORE_TARGETS,
  assertCredentialsNameTarget,
  assertSafeRestoreTarget,
  environmentForProjectRef,
  expectedProjectRefFor,
  loadEnvironmentConfig,
  projectRefFromDbUser,
  resolveCredentials,
} from '../../scripts/lib/environments.mjs';

const ROOT = process.cwd();
const PRODUCTION_REF = expectedProjectRefFor('production') as string;
const STAGING_REF = expectedProjectRefFor('staging') as string;

const BACKUP_SCRIPT = join(ROOT, 'scripts/backup-database.mjs');
const RESTORE_SCRIPT = join(ROOT, 'scripts/restore-verify.mjs');

/** Credential variables for every environment, so a scenario only ever sets what it means to. */
const CREDENTIAL_KEYS = ENVIRONMENT_NAMES.flatMap((name) => {
  const prefix = (loadEnvironmentConfig().environments[name] as { envPrefix: string }).envPrefix;
  return [`${prefix}_DB_HOST`, `${prefix}_DB_USER`, `${prefix}_DB_PASS`];
});

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const key of CREDENTIAL_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of CREDENTIAL_KEYS) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

/** Run a CLI and return its exit code, without letting a non-zero status throw. */
function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}): { code: number; output: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of CREDENTIAL_KEYS) {
    delete childEnv[key];
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  try {
    const output = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: childEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('a connection states which project it is, instead of trusting a variable name', () => {
  test('reads the project ref out of a Supabase pooler user', () => {
    expect(projectRefFromDbUser(`postgres.${STAGING_REF}`)).toBe(STAGING_REF);
    expect(projectRefFromDbUser(`postgres.${PRODUCTION_REF}`)).toBe(PRODUCTION_REF);
    // A pooled session reports `current_user = 'postgres'`, so a bare role name carries no project.
    expect(projectRefFromDbUser('postgres')).toBeNull();
    expect(projectRefFromDbUser('postgres.short')).toBeNull();
    expect(projectRefFromDbUser(`postgres.${STAGING_REF}x`)).toBeNull();
    expect(projectRefFromDbUser(undefined)).toBeNull();
  });

  test('the reverse lookup knows which environment a ref belongs to', () => {
    expect(environmentForProjectRef(PRODUCTION_REF)).toBe('production');
    expect(environmentForProjectRef(STAGING_REF)).toBe('staging');
    expect(environmentForProjectRef('someotherprojectref0')).toBeNull();
  });

  test('each environment reads credentials from its own prefix only', () => {
    const prefixes = ENVIRONMENT_NAMES.map(
      (name) => (loadEnvironmentConfig().environments[name] as { envPrefix: string }).envPrefix,
    );
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).toContain('PROD');
    expect(prefixes).toContain('QA');
  });

  test('production has no credential file in the checkout, by configuration', () => {
    // Not a convention: `localEnvFile` is null, so hydrateCredentialsFromEnvFile cannot load
    // PROD_* from anything, and the production credentials have to come from the environment.
    const production = loadEnvironmentConfig().environments.production as { localEnvFile: null };
    expect(production.localEnvFile).toBeNull();
  });
});

describe('missing credentials are a refusal, never a fallback', () => {
  test('a production run with only QA credentials present refuses', () => {
    process.env.QA_DB_HOST = 'pooler.example';
    process.env.QA_DB_USER = `postgres.${STAGING_REF}`;
    process.env.QA_DB_PASS = 'qa-password';

    expect(() => resolveCredentials('production')).toThrow(/PROD_DB_HOST/);
    expect(() => resolveCredentials('production')).toThrow(/will not fall back/i);
  });

  test('and the same run is accepted once the production credentials exist', () => {
    process.env.PROD_DB_HOST = 'pooler.example';
    process.env.PROD_DB_USER = `postgres.${PRODUCTION_REF}`;
    process.env.PROD_DB_PASS = 'production-password';

    const creds = resolveCredentials('production');
    expect(creds.projectRef).toBe(PRODUCTION_REF);
    expect(creds.declaredUser).toBe(`postgres.${PRODUCTION_REF}`);
  });
});

describe('the wrong environment’s credentials are refused — the original defect', () => {
  test('QA credentials named for staging cannot be used for a production run', () => {
    process.env.PROD_DB_HOST = 'pooler.example';
    process.env.PROD_DB_USER = `postgres.${STAGING_REF}`; // the QA project, under the PROD_ prefix
    process.env.PROD_DB_PASS = 'qa-password';

    expect(() => resolveCredentials('production')).toThrow(/ABORTED/);
    expect(() => resolveCredentials('production')).toThrow(new RegExp(STAGING_REF));
    expect(() => resolveCredentials('production')).toThrow(/which is "staging"/);
    expect(() => resolveCredentials('production')).toThrow(/Nothing was read and nothing was written/);
  });

  test('production credentials named for production cannot be used for a staging run', () => {
    process.env.QA_DB_HOST = 'pooler.example';
    process.env.QA_DB_USER = `postgres.${PRODUCTION_REF}`;
    process.env.QA_DB_PASS = 'production-password';

    expect(() => resolveCredentials('staging')).toThrow(/ABORTED/);
    expect(() => resolveCredentials('staging')).toThrow(/which is "production"/);
  });

  test('credentials that name no project at all are refused rather than assumed', () => {
    process.env.PROD_DB_HOST = 'pooler.example';
    process.env.PROD_DB_USER = 'postgres';
    process.env.PROD_DB_PASS = 'production-password';

    expect(() => resolveCredentials('production')).toThrow(/do not name a project/);
    expect(() => resolveCredentials('production')).toThrow(/postgres\.<project-ref>/);
  });

  test('each pairing is accepted, so the refusals above are about the pairing', () => {
    const correct = {
      staging: { host: 'pooler.example', user: `postgres.${STAGING_REF}`, pass: 'p' },
      production: { host: 'pooler.example', user: `postgres.${PRODUCTION_REF}`, pass: 'p' },
    };
    for (const [name, creds] of Object.entries(correct)) {
      const prefix = name === 'staging' ? 'QA' : 'PROD';
      process.env[`${prefix}_DB_HOST`] = creds.host;
      process.env[`${prefix}_DB_USER`] = creds.user;
      process.env[`${prefix}_DB_PASS`] = creds.pass;
      expect(assertCredentialsNameTarget(resolveCredentials(name))).toBe(creds.user.slice('postgres.'.length));
    }
  });
});

describe('development is targetable only once its OWN project is recorded', () => {
  test('no two environments claim one project ref — a shared ref IS the reported defect', () => {
    // "Development and Staging/QA point to the same Supabase project" is the gap this whole task
    // exists to close, so it is asserted as a rule rather than trusted: a ref may be claimed by
    // exactly one environment, and the reverse lookup must name that same one. It passes today
    // (development records no ref) and fails the moment development is wired to staging's or
    // production's ref — which is the wiring mistake that would silently un-fix the gap.
    const claimed = ENVIRONMENT_NAMES.map((name) => [name, expectedProjectRefFor(name)] as const).filter(
      (entry): entry is readonly [string, string] => Boolean(entry[1]),
    );
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    const refs = claimed.map(([, ref]) => ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const [name, ref] of claimed) expect(environmentForProjectRef(ref)).toBe(name);
  });

  test('development either has its own ref, or is refused before any connection', () => {
    const entry = loadEnvironmentConfig().environments.development as {
      projectRef: string | null;
      status: string;
      envPrefix: string;
      localEnvFile: string | null;
    };

    // Unconditional: development reads DEV_* and nothing else, from the file .env.example
    // documents for it. Neither of these is allowed to depend on whether the project exists yet.
    expect(entry.envPrefix).toBe('DEV');
    expect(entry.localEnvFile).toBe('.env.local');

    if (entry.status === 'active' && entry.projectRef) {
      // Provisioned. The two refs it may never be are the other environments' — and the reverse
      // lookup must agree that this ref is development's alone.
      expect(entry.projectRef).not.toBe(STAGING_REF);
      expect(entry.projectRef).not.toBe(PRODUCTION_REF);
      expect(expectedProjectRefFor('development')).toBe(entry.projectRef);
      expect(environmentForProjectRef(entry.projectRef)).toBe('development');

      // Isolation is symmetric, so the same pairing rule is asserted here as for staging and
      // production: credentials naming another environment's project are refused by name, before
      // a connection is opened. Then the control that makes that refusal mean something.
      process.env.DEV_DB_HOST = 'pooler.example';
      process.env.DEV_DB_USER = `postgres.${STAGING_REF}`;
      process.env.DEV_DB_PASS = 'dev-password';
      expect(() => resolveCredentials('development')).toThrow(/ABORTED/);
      expect(() => resolveCredentials('development')).toThrow(new RegExp(STAGING_REF));
      expect(() => resolveCredentials('development')).toThrow(/which is "staging"/);

      process.env.DEV_DB_USER = `postgres.${entry.projectRef}`;
      expect(assertCredentialsNameTarget(resolveCredentials('development'))).toBe(entry.projectRef);
    } else {
      // Not provisioned (the state today): there is no ref to verify against, so the environment
      // is refused outright rather than guessed at.
      expect(expectedProjectRefFor('development')).toBeNull();
      expect(() => resolveCredentials('development')).toThrow(/no project ref is recorded/);
    }
  });
});

describe('a restore can only write into a throwaway database', () => {
  test('the only accepted target is the in-process one', () => {
    expect(SAFE_RESTORE_TARGETS).toEqual(['pglite']);
    expect(assertSafeRestoreTarget('pglite')).toBe('pglite');
  });

  test('production is refused by name, by project ref, and as a connection string', () => {
    expect(() => assertSafeRestoreTarget('production')).toThrow(/RESTORE REFUSED/);
    expect(() => assertSafeRestoreTarget(PRODUCTION_REF)).toThrow(/is the production environment/);
    expect(() => assertSafeRestoreTarget(`postgresql://postgres:x@host:5432/postgres`)).toThrow(
      /connection string/,
    );
    expect(() => assertSafeRestoreTarget('staging')).toThrow(/is the staging environment/);
  });

  test('an unknown target is refused rather than guessed', () => {
    expect(() => assertSafeRestoreTarget('docker')).toThrow(/Unknown restore target/);
  });
});

describe('the command line refuses out loud, with an exit code', () => {
  test('a backup with no --env is refused', () => {
    const { code, output } = run(BACKUP_SCRIPT, []);
    expect(code).toBe(2);
    expect(output).toMatch(/requires an explicit target and has no default/);
  });

  test('a backup for development is refused, before any connection, in either state', () => {
    const entry = loadEnvironmentConfig().environments.development as {
      projectRef: string | null;
      status: string;
    };
    const provisioned = entry.status === 'active' && Boolean(entry.projectRef);

    // Two honest messages for one rule: with no project of its own there is nothing to verify
    // against, and once it has one its own credentials are still the only ones it may use. The
    // adversary below is production's identity under the DEV_ prefix — a *string*, so nothing is
    // contacted and the refusal is decided before a socket exists.
    const { code, output } = provisioned
      ? run(BACKUP_SCRIPT, ['--env', 'development'], {
          DEV_DB_HOST: '203.0.113.1',
          DEV_DB_USER: `postgres.${PRODUCTION_REF}`,
          DEV_DB_PASS: 'synthetic-not-a-credential',
        })
      : run(BACKUP_SCRIPT, ['--env', 'development']);

    expect(code).toBe(2);
    expect(output).toMatch(provisioned ? /ABORTED/ : /no project ref is recorded/);
  });

  test('a backup for production with no production credentials is refused', () => {
    const { code, output } = run(BACKUP_SCRIPT, ['--env', 'production'], {
      QA_DB_HOST: 'pooler.example',
      QA_DB_USER: `postgres.${STAGING_REF}`,
      QA_DB_PASS: 'qa-password',
    });
    expect(code).toBe(2);
    expect(output).toMatch(/PROD_DB_HOST/);
  });

  test('a backup for production given QA credentials is refused', () => {
    const { code, output } = run(BACKUP_SCRIPT, ['--env', 'production'], {
      PROD_DB_HOST: 'pooler.example',
      PROD_DB_USER: `postgres.${STAGING_REF}`,
      PROD_DB_PASS: 'qa-password',
    });
    expect(code).toBe(2);
    expect(output).toMatch(/ABORTED/);
    expect(output).toMatch(/which is "staging"/);
  });

  test('a restore aimed at production is refused before an artifact is even read', () => {
    const { code, output } = run(RESTORE_SCRIPT, ['--from', 'anything.sql', '--target', 'production']);
    expect(code).toBe(2);
    expect(output).toMatch(/is the production environment/);
  });

  test('a restore with no artifact is refused', () => {
    const { code, output } = run(RESTORE_SCRIPT, []);
    expect(code).toBe(2);
    expect(output).toMatch(/--from <artifact\|manifest> is required/);
  });
});
