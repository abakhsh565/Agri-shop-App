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
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');

const env = {};
for (const line of readFileSync('.env.qa', 'utf8').split('\n')) {
  if (!line.includes('=')) continue;
  const key = line.split('=')[0].trim();
  env[key] = line.split('=').slice(1).join('=').trim();
}

const url = (env.QA_SUPABASE_URL || '').replace(/^\[|\]$/g, '');
const serviceRole = (env.QA_SUPABASE_SERVICE_ROLE || '').replace(/^\[|\]$/g, '');
if (!url.includes('bpybjrjenwccowvtrevu')) {
  throw new Error(`Refusing to run outside the QA project (got ${url})`);
}

// Same derivation as the app: normalize local PK numbers to 92XXXXXXXXXX.
function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0')) return '92' + digits.slice(1);
  if (digits.startsWith('92')) return digits;
  return '92' + digits;
}
const credentialsFor = (phone) => {
  const e164 = normalizePhone(phone);
  return {
    e164,
    email: `user-${e164}@agrishop.auth.local`,
    password: `AgriShop-${e164}-2026!`,
  };
};

if ((env.QA_DB_USER || '').split('.')[1] !== 'bpybjrjenwccowvtrevu') {
  console.error('Refusing to run: target is not the QA project.');
  process.exit(1);
}

const pool = new pg.Pool({
  host: env.QA_DB_HOST, port: 6543, database: 'postgres',
  user: env.QA_DB_USER, password: env.QA_DB_PASS,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
const db = await pool.connect();
const { rows: users } = await db.query(
  `SELECT id, name, phone, shop_id FROM users WHERE phone IS NOT NULL ORDER BY created_at`
);
await db.release();
await pool.end();

const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, (env.QA_SUPABASE_ANON_KEY || '').replace(/^\[|\]$/g, ''));
const probe = createClient(url, (env.QA_SUPABASE_ANON_KEY || '').replace(/^\[|\]$/g, ''));

let created = 0, repaired = 0, ok = 0, failed = 0;

for (const user of users) {
  const { e164, email, password } = credentialsFor(user.phone);

  // Does the app's derivation already work?
  const attempt = await probe.auth.signInWithPassword({ email, password });
  if (!attempt.error) {
    await probe.auth.signOut();
    ok++;
    console.log(`OK        ${user.name} (${e164})`);
    continue;
  }

  if (dryRun) {
    console.log(`WOULD FIX ${user.name} (${e164}) — ${attempt.error.message}`);
    continue;
  }

  // Create the auth user if missing, otherwise reset it to the derived password.
  const existing = await admin.auth.admin.getUserById(user.id);
  if (existing.data?.user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      email,
      password,
      email_confirm: true,
      phone: e164,
    });
    if (error) {
      failed++;
      console.log(`FAILED    ${user.name} (${e164}) — ${error.message}`);
    } else {
      repaired++;
      console.log(`REPAIRED  ${user.name} (${e164})`);
    }
  } else {
    const { error } = await admin.auth.admin.createUser({
      id: user.id, email, password, email_confirm: true, phone: e164,
    });
    if (error) {
      failed++;
      console.log(`FAILED    ${user.name} (${e164}) — ${error.message}`);
    } else {
      created++;
      console.log(`CREATED   ${user.name} (${e164})`);
    }
  }
}

console.log(`\nsummary: ${ok} already valid, ${created} created, ${repaired} repaired, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
