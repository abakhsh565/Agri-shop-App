/**
 * Provision/repair Supabase Auth credentials for app users.
 *
 * WHY: the app signs into Supabase Auth with a deterministic email+password
 * derived from the phone number (src/lib/auth.ts). If an auth user exists with a
 * different password, sign-in fails and the browser ends up WITHOUT a JWT — which
 * makes every RLS-protected read return 401 and every admin screen render empty.
 *
 * This script makes the stored credential match the derivation, idempotently, for
 * every app user that has a phone number. Run it after seeding users, or when a
 * user reports "logged in but the app shows nothing".
 *
 * Usage: node scripts/provision-auth-sessions.mjs [--dry-run]
 *
 * Only the stable CI-owned fixture identities in scripts/lib/qa-provisioning-policy.mjs are
 * eligible. Any unexpected user, phone mismatch, or empty allowlist aborts before an auth write.
 * The database host and user must both be the documented QA values; either mismatch aborts before
 * a connection is opened. Any unexpected row, ambiguous target, or auth failure aborts immediately
 * with a non-zero exit instead of continuing to the next fixture.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import {
  QA_DB_SSL,
  QA_PROVISIONING_FIXTURES,
  assertNonEmptyAllowlist,
  assertUsersAllowed,
  normalizePhone,
  validateQaDbHost,
  validateQaDbUser,
  validateQaProjectUrl,
} from './lib/qa-provisioning-policy.mjs';

const dryRun = process.argv.includes('--dry-run');

// Credentials come from the environment (CI supplies them as repository secrets) or, locally,
// from .env.qa. A CI checkout has no .env.qa at all, so reading it unconditionally made this
// step — the one that repairs the QA auth sessions the browser suite signs in with — fail with
// ENOENT before it could do anything. Read the file only to fill in what the environment did not
// already provide, and let the environment win when both exist.
const ENV_NAMES = [
  'QA_SUPABASE_URL',
  'QA_SUPABASE_ANON_KEY',
  'QA_SUPABASE_SERVICE_ROLE',
  'QA_DB_HOST',
  'QA_DB_USER',
  'QA_DB_PASS',
];
const env = {};
const fileEnv = {};
if (existsSync('.env.qa')) {
  for (const line of readFileSync('.env.qa', 'utf8').split('\n')) {
    if (!line.includes('=')) continue;
    const key = line.split('=')[0].trim();
    if (ENV_NAMES.includes(key)) {
      fileEnv[key] = line.split('=').slice(1).join('=').trim();
    }
  }
}
for (const key of ENV_NAMES) {
  const fromFile = fileEnv[key];
  const fromProcess = process.env[key];
  // Two different database targets configured at once is ambiguous, not a preference. This script
  // writes credentials, so refuse instead of silently choosing one; the message names no value.
  if (key === 'QA_DB_HOST' && fromFile && fromProcess && fromFile !== fromProcess.trim()) {
    throw new Error('Refusing to run: QA_DB_HOST is set twice with different values.');
  }
  if (fromProcess || fromFile) env[key] = fromProcess || fromFile;
}

const rawUrl = (env.QA_SUPABASE_URL || '').replace(/^\[|\]$/g, '');
// Target identity is established here, before anything can open a connection or touch auth state.
const url = validateQaProjectUrl(rawUrl);
const dbHost = validateQaDbHost(env.QA_DB_HOST);
const dbUser = validateQaDbUser(env.QA_DB_USER);
const serviceRole = (env.QA_SUPABASE_SERVICE_ROLE || '').replace(/^\[|\]$/g, '');
if (!serviceRole) {
  throw new Error('Refusing to run: the QA service role is missing.');
}
if (!env.QA_SUPABASE_ANON_KEY) {
  throw new Error('Refusing to run: the QA anon key is missing.');
}
if (!env.QA_DB_PASS) {
  throw new Error('Refusing to run: the QA database password is missing.');
}
const allowlistIds = assertNonEmptyAllowlist(QA_PROVISIONING_FIXTURES).map((fixture) => fixture.id);

const credentialsFor = (phone) => {
  const e164 = normalizePhone(phone);
  return {
    e164,
    email: `user-${e164}@agrishop.auth.local`,
    password: `AgriShop-${e164}-2026!`,
  };
};

const pool = new pg.Pool({
  host: dbHost, port: 6543, database: 'postgres',
  user: dbUser, password: env.QA_DB_PASS,
  ssl: QA_DB_SSL, connectionTimeoutMillis: 15000,
});
let users;
try {
  const db = await pool.connect();
  try {
    const result = await db.query(
      `SELECT id, phone FROM users WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [allowlistIds],
    );
    users = result.rows;
  } finally {
    db.release();
  }
} finally {
  await pool.end();
}
const allowedUsers = assertUsersAllowed(users, QA_PROVISIONING_FIXTURES);

const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, (env.QA_SUPABASE_ANON_KEY || '').replace(/^\[|\]$/g, ''));
const probe = createClient(url, (env.QA_SUPABASE_ANON_KEY || '').replace(/^\[|\]$/g, ''));

let created = 0, repaired = 0, ok = 0;

for (const [index, user] of allowedUsers.entries()) {
  const { e164, email, password } = credentialsFor(user.phone);

  // Does the app's derivation already work?
  const attempt = await probe.auth.signInWithPassword({ email, password });
  if (!attempt.error) {
    await probe.auth.signOut();
    ok++;
    console.log(`OK        fixture #${index + 1}`);
    continue;
  }

  // A 400 (or an explicit invalid-credentials code) is the API saying the derived credential is
  // wrong. Anything else — 429, 5xx, a network failure — says nothing about the credential, so
  // resetting it would be an unnecessary write. Abort instead.
  const credentialRejected =
    attempt.error.status === 400 || attempt.error.code === 'invalid_credentials';
  if (!credentialRejected) {
    throw new Error(
      `Refusing to continue: could not verify fixture #${index + 1} (status ${attempt.error.status ?? 'unknown'}).`,
    );
  }

  if (dryRun) {
    console.log(`WOULD FIX fixture #${index + 1}`);
    continue;
  }

  // Create the auth user if missing, otherwise reset it to the derived password.
  const existing = await admin.auth.admin.getUserById(user.id);
  if (existing.error && existing.error.status !== 404) {
    throw new Error(`Refusing to continue: auth lookup failed for fixture #${index + 1}.`);
  }
  if (existing.data?.user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      email,
      password,
      email_confirm: true,
      phone: e164,
    });
    if (error) {
      throw new Error(`Refusing to continue: auth repair failed for fixture #${index + 1}.`);
    }
    repaired++;
    console.log(`REPAIRED  fixture #${index + 1}`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      id: user.id, email, password, email_confirm: true, phone: e164,
    });
    if (error) {
      throw new Error(`Refusing to continue: auth creation failed for fixture #${index + 1}.`);
    }
    created++;
    console.log(`CREATED   fixture #${index + 1}`);
  }
}

console.log(`\nsummary: ${ok} already valid, ${created} created, ${repaired} repaired`);
