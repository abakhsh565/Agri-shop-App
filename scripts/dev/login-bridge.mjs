/**
 * login-bridge.mjs — turn on the development login bridge and backfill what it should have made.
 *
 * WHY. A build with a real SMS provider creates `auth.users` for a phone the moment the person
 * verifies it, and `shop_request_provision` takes the account's id from there. The development
 * stack has no SMS provider: the demo code 123456 stands in for it and nothing creates the auth
 * user, so every approved request produced a profile on a random uuid with no login behind it and
 * the next sign-in answered LOGIN_NOT_READY ("this number is invited, but its sign-in is not ready
 * yet"). 0315 adds the bridge — off by default so production never runs it — and this script is the
 * only thing that turns it on.
 *
 *   node scripts/dev/login-bridge.mjs            # switch it on and repair existing accounts
 *   node scripts/dev/login-bridge.mjs status     # what the switch says, and coverage
 *   node scripts/dev/login-bridge.mjs repair     # repair without touching the switch
 *   node scripts/dev/login-bridge.mjs enable --remote staging
 *
 * WHERE IT RUNS. Everywhere the app signs in with the demo code rather than a delivered SMS —
 * development, and staging (`deploy-staging.yml` builds with `VITE_OTP_DELIVERY: demo`). Production
 * is a real SMS build: its sign-in already creates `auth.users`, so nothing there may run this, and
 * no migration switches the bridge on.
 *
 * Usage in development:
 *   npm run dev:login-bridge
 */
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function envFile(name) {
  const out = {};
  if (!existsSync(name)) return out;
  for (const line of readFileSync(name, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function connection() {
  const remoteFlag = process.argv.indexOf('--remote');
  const target = remoteFlag === -1 ? null : (process.argv[remoteFlag + 1] ?? '');

  if (target) {
    if (target !== 'staging' && target !== 'qa') {
      throw new Error(`--remote accepts staging (got "${target}")`);
    }
    // CI supplies these as repository secrets; locally they live in .env.qa.
    const env = { ...envFile('.env.qa'), ...process.env };
    for (const key of ['QA_DB_HOST', 'QA_DB_USER', 'QA_DB_PASS']) {
      if (!env[key]) throw new Error(`--remote ${target} needs ${key}`);
    }
    return {
      host: env.QA_DB_HOST,
      port: Number(env.QA_DB_PORT || 5432),
      user: env.QA_DB_USER,
      password: env.QA_DB_PASS,
      database: env.QA_DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false },
    };
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const local = envFile('.env.local').DATABASE_URL;
  return local || LOCAL_DB;
}

const command = process.argv[2] ?? 'enable';
const client = new pg.Client(typeof connection() === 'string'
  ? { connectionString: connection() }
  : connection());
await client.connect();

try {
  const bridge = await client.query(
    `select to_regclass('public.login_bridge') is not null as present,
            coalesce((select enabled from public.login_bridge where id), false) as enabled`,
  );
  if (!bridge.rows[0].present) {
    console.error('The login bridge table is missing — apply 0315 first (npx supabase migration up).');
    process.exit(1);
  }

  if (command === 'enable') {
    await client.query('update public.login_bridge set enabled = true, updated_at = now() where id and not enabled');
    console.log('Login bridge: ON for this database.');
  } else if (command === 'status') {
    const { rows } = await client.query(
      `select (select enabled from public.login_bridge where id) as enabled,
              count(*) filter (where a.id is null) as accounts_without_login,
              count(*) as accounts
         from public.users u
         left join auth.users a on a.id = u.id`,
    );
    console.log(`Login bridge: ${rows[0].enabled ? 'ON' : 'OFF'} · accounts ${rows[0].accounts} · without login ${rows[0].accounts_without_login}`);
    await client.end();
    process.exit(0);
  } else if (command !== 'repair') {
    console.error(`Unknown command "${command}" — use enable, repair or status.`);
    await client.end();
    process.exit(1);
  }

  // Backfill: every account that has no identity behind its id gets the one an SMS sign-in would
  // have created. Idempotent — an account whose identity already answers resolves to itself.
  const { rows: missing } = await client.query(
    `select u.id, u.phone
       from public.users u
       left join auth.users a on a.id = u.id
      where a.id is null
        and u.phone ~ '^[0-9]+$'
      order by u.created_at`,
  );

  let repaired = 0;
  let refused = 0;
  for (const row of missing) {
    const { rows } = await client.query('select public.dev_login_identity($1::text, $2::uuid) as id', [row.phone, row.id]);
    if (rows[0]?.id) repaired += 1;
    else refused += 1;
  }

  console.log(`Backfill: ${repaired} login(s) created, ${refused} account(s) still without one.`);

  // Only a real phone number can sign in at all. Synthetic fixture rows carry identifiers like
  // `92300DST0001` in the phone column; they have no derivation and no screen, so counting them
  // would fail a deploy over a row nobody can log in with.
  const { rows: left } = await client.query(
    `select count(*)::int as n
       from public.users u
       left join auth.users a on a.id = u.id
      where a.id is null
        and u.phone ~ '^[0-9]+$'`,
  );
  console.log(`Phone accounts without a login now: ${left[0].n}`);
  if (left[0].n > 0) {
    console.warn('Those accounts cannot sign in on a demo-OTP build until they have an identity.');
    process.exitCode = 2;
  }
} finally {
  await client.end().catch(() => {});
}
