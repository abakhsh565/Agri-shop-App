/**
 * environments.mjs — resolve ONE environment, or refuse.
 *
 * This is the fix for the defect that made Phase 2A necessary: `.github/workflows/
 * backup-database.yml` was named "Backup Production Database" and ran with `QA_DB_*`. Nothing
 * complained, because the workflow never checked that the database it reached was the database it
 * claimed to be backing up. A name is not a check.
 *
 * The rules, in order — all of them fail closed:
 *
 *   1. The caller must name the environment explicitly. There is no default.
 *   2. The environment must exist in environments.json and have a project ref.
 *      (development has none, so every tool refuses it rather than guessing.)
 *   3. That environment's credentials must be present under ITS OWN prefix: production reads
 *      PROD_*, staging reads QA_*. A production run therefore cannot pick up staging credentials,
 *      because it never looks at QA_*.
 *   4. The credentials must NAME the project they claim to reach: `postgres.<ref>`. A production run
 *      handed QA's credentials is caught here, because the user string says which project it is.
 *      This is checked before a connection is opened, so nothing is even contacted.
 *   5. After connecting, the caller passes what it actually reached to `assertReached()`. The
 *      cluster fingerprint is compared against the one enrolled in environments.json.
 *
 * WHY RULE 5 CANNOT USE `current_user` (measured, 2026-10-01)
 *   Supabase's Supavisor pooler authenticates the client as `postgres.<ref>` and then rewrites the
 *   session to the real role. A probe against staging's pooler returned `current_user = 'postgres'`,
 *   with no project ref in it, and `current_setting('supabase.project_ref')` = NULL. So a check that
 *   read the ref out of `current_user` would have failed on every pooled connection — and a check
 *   that *trusted* `current_user` when it did contain a ref would still be reading a value the
 *   pooler controls, not one bound to the credential. The ref is therefore read from the credential
 *   we authenticated with, and corroborated by a measurement that only the real cluster can produce
 *   (`pg_control_system().system_identifier`).
 *
 * TOFU AND WHY IT IS ACCEPTABLE HERE
 *   `clusterId` is enrolled on first successful run. That is trust-on-first-use, which is weak on
 *   its own — but it is the *second* check. Rule 4 already fails deterministically when the wrong
 *   environment's credentials are supplied, which is the failure this repository actually suffered.
 *   The fingerprint exists to catch a credential that misnames its own project, and it is recorded
 *   in every manifest so two runs can be compared after the fact.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, derived from this file's location so cwd cannot change the answer. */
export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONFIG_PATH = path.join(ROOT, 'environments.json');

export const ENVIRONMENT_NAMES = ['development', 'staging', 'production'];

/** `docker` on Windows can be a shell shim with no extension; prefer the real executable. */
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';

/** Hostnames that can only ever be this machine, so a connection to one cannot be a hosted project. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

let cached = null;

export function loadEnvironmentConfig() {
  if (cached) return cached;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `[TARGETING] environments.json is missing from ${ROOT}. Every environment check depends on ` +
        `it, so nothing will run without it.`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!parsed?.environments || typeof parsed.environments !== 'object') {
    throw new Error('[TARGETING] environments.json has no "environments" object.');
  }
  cached = parsed;
  return parsed;
}

export function environmentConfig(name) {
  const { environments } = loadEnvironmentConfig();
  const entry = environments[name];
  if (!entry) {
    throw new Error(
      `[TARGETING] Unknown environment "${name}". Known: ${Object.keys(environments).join(', ')}.`,
    );
  }
  return entry;
}

/** The project ref a name must correspond to, or null when the project does not exist yet. */
export function expectedProjectRefFor(name) {
  return environmentConfig(name).projectRef ?? null;
}

/** Which environment a project ref belongs to, or null. The reverse lookup used by every refusal. */
export function environmentForProjectRef(ref) {
  if (!ref) return null;
  const { environments } = loadEnvironmentConfig();
  for (const [name, entry] of Object.entries(environments)) {
    if (entry.projectRef === ref) return name;
  }
  return null;
}

/**
 * The project ref stated by the credential itself: `postgres.<project-ref>`.
 *
 * This is the value the backup actually authenticated with, which makes the *identity* of the
 * intended database readable from the credentials rather than from a variable's name. It is what
 * turns "the workflow is called production" into "the credentials say production".
 */
export function projectRefFromDbUser(user) {
  if (typeof user !== 'string') return null;
  const match = user.trim().match(/^postgres\.([a-z0-9]{20})$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Load one environment's credentials from its own env file, without crossing prefixes.
 *
 * Only the file named in that environment's `localEnvFile` is read, and only keys carrying that
 * environment's own prefix are imported, so `.env.qa` can never supply `PROD_DB_*`. Production has
 * no `localEnvFile` on purpose: its credentials must arrive from the process environment (a CI
 * secret or an explicit export), which is why none of them are sitting in the checkout.
 *
 * Existing process.env values always win, so CI secrets are never overridden by a local file.
 */
export function hydrateCredentialsFromEnvFile(name) {
  const { envPrefix, localEnvFile } = environmentConfig(name);
  if (!localEnvFile) return { hydrated: [], file: null };

  const filePath = path.join(ROOT, localEnvFile);
  if (!fs.existsSync(filePath)) return { hydrated: [], file: null };

  const hydrated = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key.startsWith(`${envPrefix}_DB_`)) continue;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
    hydrated.push(key);
  }
  return { hydrated, file: localEnvFile };
}

/**
 * Read one environment's credentials.
 *
 * `requireCredentials: false` returns what is present and reports what is missing, which is how the
 * refusal paths are exercised without pretending to have credentials.
 */
export function resolveCredentials(name, { requireAll = true, allowEnvFile = true } = {}) {
  const { envPrefix, projectRef, status } = environmentConfig(name);

  if (status !== 'active' || !projectRef) {
    if (requireAll) {
      throw new Error(
        `[TARGETING] Refusing to run for "${name}": no project ref is recorded for it in ` +
          `environments.json (status: ${status}). A target that cannot be named cannot be ` +
          `verified, and an unverifiable target is what this check exists to stop.`,
      );
    }
  }

  if (allowEnvFile) hydrateCredentialsFromEnvFile(name);

  const names = [`${envPrefix}_DB_HOST`, `${envPrefix}_DB_USER`, `${envPrefix}_DB_PASS`];
  const values = {};
  const missing = [];
  for (const key of names) {
    const value = (process.env[key] || '').trim();
    if (value) values[key] = value;
    else missing.push(key);
  }

  if (missing.length && requireAll) {
    throw new Error(
      `[TARGETING] Refusing to run for "${name}": missing ${missing.join(', ')}. ` +
        `Environment variables are read only from this environment's own prefix (${envPrefix}_). ` +
        `It will not fall back to another environment's credentials.` +
        (requireAll && projectRef
          ? `\n  To run this for ${name}, export ${names.join(', ')} — for production these come ` +
            `from repository secrets, never from a file in the checkout.`
          : ''),
    );
  }

  const resolved = {
    environment: name,
    projectRef,
    envPrefix,
    values,
    missing,
    /** What the credential claims to be, checked before a connection is even opened. */
    declaredUser: values[`${envPrefix}_DB_USER`] ?? null,
  };

  // Checked here, not after connecting, so a mislabelled credential is refused before this process
  // talks to any database at all. That also makes the refusal provable without holding the
  // credentials for the environment being protected: a production *declaration* carrying QA's
  // user string is rejected on the string alone.
  if (requireAll && !missing.length) assertCredentialsNameTarget(resolved);

  return resolved;
}

/**
 * Check 1 and 2 of the identity rules, using only the credentials themselves.
 *
 * @throws when the credentials do not name a project, or name a different one than declared
 */
export function assertCredentialsNameTarget(creds) {
  const declaredRef = projectRefFromDbUser(creds.declaredUser);

  if (!declaredRef) {
    throw new Error(
      `[TARGETING] ABORTED. The ${creds.environment} credentials do not name a project ` +
        `(user: ${creds.declaredUser ?? 'missing'}). A Supabase pooler user must be ` +
        `"postgres.<project-ref>". Without a ref in the credential there is nothing to verify, ` +
        `and an unverifiable target must not be backed up or restored.`,
    );
  }

  if (declaredRef !== creds.projectRef) {
    const actually = environmentForProjectRef(declaredRef);
    throw new Error(
      `[TARGETING] ABORTED. This run declared "${creds.environment}" (project ${creds.projectRef}) ` +
        `but its credentials name project ${declaredRef}` +
        (actually ? `, which is "${actually}"` : '') +
        `. Nothing was read and nothing was written. Expected and reached must match exactly.`,
    );
  }

  return declaredRef;
}

/** A connection string from resolved credentials. Port 6543 is the transaction pooler. */
export function connectionStringFor(creds, { port = 6543, database = 'postgres' } = {}) {
  const host = creds.values[`${creds.envPrefix}_DB_HOST`];
  const user = creds.values[`${creds.envPrefix}_DB_USER`];
  const pass = creds.values[`${creds.envPrefix}_DB_PASS`];
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${database}`;
}

/** Credentials without the secret, for log lines and manifests. */
export function describeTarget(creds) {
  return {
    environment: creds.environment,
    projectRef: creds.projectRef,
    host: creds.values[`${creds.envPrefix}_DB_HOST`] ?? null,
    user: creds.values[`${creds.envPrefix}_DB_USER`] ?? null,
  };
}

/**
 * Ask the live connection what it actually is.
 *
 * `serverUser` is recorded but is NOT an identity check: the pooler rewrites it to `postgres`, so it
 * cannot name a project on a pooled connection. `clusterId` is the Postgres cluster fingerprint,
 * which the pooler cannot rewrite.
 */
export async function identifyConnection(client, creds) {
  const serverUser = (await client.query('select current_user as u')).rows[0]?.u ?? null;

  let clusterId = null;
  let clusterIdError = null;
  try {
    clusterId = (await client.query('select system_identifier::text as id from pg_control_system()'))
      .rows[0]?.id ?? null;
  } catch (error) {
    clusterIdError = error.message;
  }

  return {
    configuredUser: creds?.declaredUser ?? creds?.values?.[`${creds?.envPrefix}_DB_USER`] ?? null,
    serverUser,
    clusterId,
    clusterIdError,
  };
}

/**
 * The check that would have caught the original defect.
 *
 * @param creds    resolved credentials for the environment that was NAMED
 * @param observed result of identifyConnection(), or a plain user string
 * @throws when the credentials name a different project than the environment declared
 */
export function assertReached(creds, observed) {
  const configuredUser =
    typeof observed === 'string'
      ? observed
      : observed?.configuredUser ?? creds?.declaredUser ?? creds?.values?.[`${creds?.envPrefix}_DB_USER`];
  const serverUser = typeof observed === 'string' ? null : observed?.serverUser ?? null;
  const clusterId = typeof observed === 'string' ? null : observed?.clusterId ?? null;

  // ── Checks 1 and 2, repeated after connecting so the rules hold for every caller ──────────
  const declaredRef = assertCredentialsNameTarget({ ...creds, declaredUser: configuredUser });

  // ── Check 3: if a direct (non-pooled) connection reveals a server-side ref, it must agree ──
  const serverRef = projectRefFromDbUser(serverUser);
  if (serverRef && serverRef !== creds.projectRef) {
    throw new Error(
      `[TARGETING] ABORTED. Credentials name project ${declaredRef} but the server reports ` +
        `current_user = "${serverUser}", i.e. project ${serverRef}. No backup or restore was written.`,
    );
  }

  // ── Check 4: the physical cluster must be the one enrolled for this environment ───────────
  const enrolled = environmentConfig(creds.environment).clusterId ?? null;
  if (enrolled && clusterId && enrolled !== clusterId) {
    throw new Error(
      `[TARGETING] ABORTED. Credentials name project ${creds.projectRef}, but the server reached is ` +
        `cluster ${clusterId}, not the cluster enrolled for "${creds.environment}" (${enrolled}). ` +
        `No backup or restore was written. If the project was migrated to a new instance, re-enroll ` +
        `the clusterId in environments.json deliberately.`,
    );
  }

  return { projectRef: declaredRef, clusterId, clusterIdEnrolled: Boolean(enrolled && clusterId) };
}

/** Parse `--env <name>` (also `--env=<name>`), with no default. */
export function parseEnvFlag(argv) {
  const index = argv.findIndex((a) => a === '--env' || a.startsWith('--env='));
  if (index === -1) return null;
  const token = argv[index];
  const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : argv[index + 1];
  return value && !value.startsWith('--') ? value.trim() : null;
}

/**
 * Resolve the environment or exit non-zero with a message that says what to supply.
 * Used by the CLI entry points so every refusal is an exit code, not a warning.
 */
export function requireEnvironmentOrExit(argv, { command }) {
  const requested = parseEnvFlag(argv);

  if (!requested) {
    console.error(
      `[TARGETING] ${command} requires an explicit target and has no default.\n` +
        `  Usage: node scripts/${command}.mjs --env <${ENVIRONMENT_NAMES.join('|')}>\n` +
        `  Backing up the wrong database quietly is the failure this refuses to repeat.`,
    );
    process.exit(2);
  }

  try {
    return resolveCredentials(requested);
  } catch (error) {
    console.error(String(error.message));
    process.exit(2);
  }
}

// ── Local environments: the Supabase CLI stack on this machine ────────────────────────────────
//
// A local environment is the one kind of target that is not a hosted project, so it is described by
// different facts: which container is running, on which loopback port, and which project id a build
// for it must resolve to. Those live in environments.json (`kind`, `localProjectId`, `localStack`)
// so that the app's contract, this tooling and the runbook all read one description.
//
// The isolation rule is enforced here rather than assumed: the DB_URL the stack reports must be a
// LOOPBACK address. A `.env.local` (or a `supabase status`) that points somewhere else is refused
// before a socket is opened, so "development" can never become a quiet alias for a hosted project.

/** Is this environment the local stack rather than a hosted project? */
export function isLocalEnvironment(name) {
  return environmentConfig(name).kind === 'local';
}

/** The project id a build for this environment must resolve to, or null when it has none. */
export function localProjectIdFor(name) {
  return environmentConfig(name).localProjectId ?? null;
}

/** True only for an address that can only be this machine. */
export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host ?? '').trim().toLowerCase());
}

/** The Supabase CLI shipped as a dependency, so no global install is required. */
export function supabaseCliPath() {
  const base = path.join(ROOT, 'node_modules/@supabase');
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base)) {
      if (!dir.startsWith('cli-')) continue;
      const binDir = path.join(base, dir, 'bin');
      if (!fs.existsSync(binDir)) continue;
      const file = fs.readdirSync(binDir).find((name) => /^supabase(\.exe)?$/.test(name));
      if (file) return path.join(binDir, file);
    }
  }
  const shim = path.join(ROOT, `node_modules/.bin/supabase${process.platform === 'win32' ? '.cmd' : ''}`);
  if (fs.existsSync(shim)) return shim;
  return null;
}

/**
 * Where the local stack says it is listening, straight from the CLI (`supabase status -o env`).
 *
 * Asking the CLI rather than hardcoding ports means the tooling follows a changed port instead of
 * connecting to whatever is on the old one.
 */
export function localStackStatusEnv() {
  const cli = supabaseCliPath();
  if (!cli) {
    throw new Error(
      '[TARGETING] The Supabase CLI is not installed in this checkout (node_modules/@supabase). ' +
        "Run `npm install`; the local stack's address is read from the CLI rather than guessed.",
    );
  }
  const result = spawnSync(cli, ['status', '-o', 'env'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `[TARGETING] The local Supabase stack is not running (\`supabase status\` exited ` +
        `${result.status ?? -1}). Start it with \`npm run local:db -- up\` — see ` +
        `docs/LOCAL_DEVELOPMENT.md.`,
    );
  }
  const values = {};
  for (const line of `${result.stdout}`.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) values[match[1]] = match[2].replace(/"$/, '');
  }
  return values;
}

/** The local database containers on this machine, for the record. A hosted project is not one. */
export function localStackContainers(name) {
  const pattern = environmentConfig(name).localStack?.containerPattern ?? 'supabase_db_*';
  const filter = pattern.replace(/\*$/, '');
  const result = spawnSync(DOCKER, ['ps', '--filter', `name=${filter}`, '--format', '{{.Names}}'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return `${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Resolve a local environment's connection, or refuse.
 *
 * @throws when the environment is not local, when the stack is not running, or when the address it
 *         reports is not loopback — the last one is the check that stops ``.env.local`` from turning
 *         development into a pointer at a hosted project.
 */
export function localStackConnection(name) {
  const entry = environmentConfig(name);
  if (entry.kind !== 'local') {
    throw new Error(
      `[TARGETING] "${name}" is not a local environment (kind: ${entry.kind ?? 'hosted'}), so its ` +
        `connection comes from credentials, not from the local stack.`,
    );
  }

  const status = localStackStatusEnv();
  const dbUrl = (status.DB_URL || '').trim();
  if (!dbUrl) {
    throw new Error(
      "[TARGETING] The local stack reported no DB_URL, so there is nothing to verify. Start it " +
        'with `npm run local:db -- up`.',
    );
  }

  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error(`[TARGETING] The local stack reported an unparseable DB_URL (${dbUrl}).`);
  }

  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `[TARGETING] ABORTED. "${name}" is the local stack, but its database address is ` +
        `"${parsed.hostname}" — not this machine. Refusing: a local environment that reaches a ` +
        `hosted address is not local, and calling it development would hide exactly the ` +
        `cross-environment write this guard exists to prevent.`,
    );
  }

  return {
    environment: name,
    connectionString: dbUrl,
    host: parsed.hostname,
    port: parsed.port || null,
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    apiUrl: status.API_URL || entry.localStack?.apiUrl || null,
    projectId: entry.localProjectId ?? null,
    containers: localStackContainers(name),
    /** Loopback, so this is this machine by construction: no project ref is needed to know it. */
    loopback: true,
  };
}

/**
 * Confirm, from the connection itself, that it is a local Supabase stack on this machine.
 *
 * The address check above is the guarantee; this is the positive half — the database must actually
 * answer as the local stack, so "reached nothing" cannot be mistaken for "reached a stack".
 */
export async function identifyLocalStack(client, target) {
  const row = (
    await client.query(
      "select current_database() as db, current_user as u, " +
        "(select count(*)::int from pg_roles where rolname in ('anon','authenticated','service_role')) as api_roles, " +
        "current_setting('server_version') as version",
    )
  ).rows[0];

  return {
    environment: target.environment,
    host: target.host,
    port: target.port,
    database: row?.db ?? null,
    serverUser: row?.u ?? null,
    serverVersion: row?.version ?? null,
    apiRoles: row?.api_roles ?? 0,
    containers: target.containers,
    /** Supabase's own roles, which a plain Postgres does not have. */
    looksLikeSupabaseStack: (row?.api_roles ?? 0) === 3,
  };
}

/**
 * The restore targets this tooling is willing to write into.
 *
 * There is exactly one, and it is a throwaway database living inside the verification process. A
 * Supabase project is not on the list, and is not reachable through any code path here: restoring
 * is implemented by replaying the artifact into PGlite, so "restore into production" is not a
 * guarded option, it is an operation that does not exist. That is a stronger guarantee than a
 * confirmation prompt, which is why the guard reads as a whitelist of one.
 */
export const SAFE_RESTORE_TARGETS = ['pglite'];

export function assertSafeRestoreTarget(target, { artifact } = {}) {
  const normalized = String(target ?? '').trim().toLowerCase();
  const describe = artifact ? ` for ${artifact}` : '';

  if (SAFE_RESTORE_TARGETS.includes(normalized)) return normalized;

  // Name the specific reason, so the refusal is informative rather than merely loud.
  if (/[:@]\/\/|@/.test(normalized) || normalized.includes('://')) {
    throw new Error(
      `[RESTORE REFUSED] "${target}" looks like a database connection string. This tool restores ` +
        `only into ${SAFE_RESTORE_TARGETS.join(', ')}${describe}. Pointing a restore at a live ` +
        `database is how a recovery drill becomes an outage.`,
    );
  }

  for (const name of ENVIRONMENT_NAMES) {
    const entry = environmentConfig(name);
    if (name === normalized || (entry.projectRef && entry.projectRef === normalized)) {
      throw new Error(
        `[RESTORE REFUSED] "${target}" is the ${name} environment (project ${entry.projectRef ?? 'none'}). ` +
          `Production is never a restore target, and neither is staging: overwriting the source ` +
          `with its own backup proves nothing and destroys whatever changed since. ` +
          `Supported targets: ${SAFE_RESTORE_TARGETS.join(', ')}${describe}.`,
      );
    }
  }

  throw new Error(
    `[RESTORE REFUSED] Unknown restore target "${target}". Supported targets: ` +
      `${SAFE_RESTORE_TARGETS.join(', ')}${describe}. Refusing to guess where to write.`,
  );
}
