/**
 * qa-connection.mjs — the only connection options a destructive or administrative script may use.
 *
 * WHY THIS EXISTS
 *   Four one-off scripts (`deploy-0105.mjs`, `deploy-0105-pg.mjs`, `deploy-0108-0109.mjs`,
 *   `fix-create-employee.mjs`) each built their own `pg` Pool with a **hardcoded credential** — a QA
 *   database password in three of them, and a service-role key for an older project in the fourth —
 *   and no check on which project they were pointed at. Those literals are in git history now and must
 *   be rotated; what this module fixes is the class: a script gets its connection from here, so
 *   credentials come from the environment and the target is verified before a connection is opened.
 *
 * THE RULES
 *   • Credentials are read from the environment, or from `.env.qa` when the environment is silent
 *     (the same precedence `scripts/provision-auth-sessions.mjs` uses). No literal ever sits in code.
 *   • The resolved project ref must be the QA project. Anything else refuses and exits — including
 *     production, and including the old project the removed key belonged to.
 *   • The refusal happens BEFORE a connection is created, so a wrong target is never dialled.
 *
 * Used by the four scripts above; `tests/unit/productionDataPolicy.test.ts` fails if a script builds
 * its own Pool with a credential literal again.
 */
import fs from 'node:fs';
import path from 'node:path';

export const QA_PROJECT_REF = 'bpybjrjenwccowvtrevu';

/** Fill `process.env` from `.env.qa` for names the environment did not already provide. */
export function loadQaEnvFile(file = '.env.qa') {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0 || line.trim().startsWith('#')) continue;
    const key = line.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^\[|\]$/g, '');
  }
}

/**
 * Connection options for the QA project, or a refusal.
 * `statementTimeout` is a parameter because the two migration deployers legitimately need longer.
 */
export function qaPoolOptions({ statementTimeout = 60000 } = {}) {
  loadQaEnvFile();
  const strip = (v) => String(v ?? '').replace(/^\[|\]$/g, '');
  const user = strip(process.env.QA_DB_USER);
  const password = strip(process.env.QA_DB_PASS);
  const host = strip(process.env.QA_DB_HOST);
  const hostRef = host.includes('.') ? host.split('.')[0] : ''; // pooler hosts carry no ref; user does
  const ref = user.includes('.') ? user.split('.')[1] : hostRef;

  if (!user || !password || !host) {
    console.error(
      'Refusing to run: no QA database configuration. Set QA_DB_USER, QA_DB_PASS and QA_DB_HOST (or use a local .env.qa).',
    );
    process.exit(1);
  }
  if (ref !== QA_PROJECT_REF) {
    console.error(
      `Refusing to run: the configured target is "${ref || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}). ` +
        'This script writes to the database and is not meant for any other project.',
    );
    process.exit(1);
  }
  return {
    host,
    port: 6543,
    database: 'postgres',
    user,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: statementTimeout,
  };
}
