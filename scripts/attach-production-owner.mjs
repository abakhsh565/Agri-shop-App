#!/usr/bin/env node
/**
 * attach-production-owner.mjs — give production's existing tenant its real owner.
 *
 * WHY THIS EXISTS
 *   On 2026-10-18 the seeded demo identities were removed from production, which left the shop with
 *   no people at all (`production-demo-identities-removed-2026-10-18.md`). Production's auth mode is
 *   `otp: sms`, so the owner's account can only be created by Supabase when they verify a code sent
 *   to their real phone — and the app's profile row must carry **that** auth id, because
 *   `lookup_user_by_phone` only returns the full profile when the session's `sub` equals
 *   `public.users.id`.
 *
 *   So the order is fixed: the owner signs in once (Supabase creates the identity), and this file
 *   then writes the profile, the owner membership, the active-shop row and `shops.owner_id` against
 *   the id Supabase created. It refuses to invent an identity, because a hand-written `auth.users`
 *   row on the SMS path is exactly the kind of shortcut that breaks the door it is meant to open.
 *
 * WHAT IT REFUSES
 *   · a target that is not production (the credential's own user string must end with the ref);
 *   · a tenant that is not the empty one this file was written for: exactly one shop, at least one
 *     active branch, zero `public.users` — a run against a populated shop stops;
 *   · a phone that has no Supabase login yet ("sign in with the code first"), or one that already
 *     has a profile;
 *   · `--apply` without the owner-authorized confirmation token;
 *   · `--simulate-first-signin` together with `--apply` (see below).
 *
 * `--simulate-first-signin` exists so the write path can be proven BEFORE the owner signs in: in a
 * rehearsal it creates a throwaway `auth.users` row in the same transaction (rolled back with
 * everything else) and runs the real statements against it. It is refused with `--apply`, because a
 * committed run must attach a login Supabase actually created.
 *
 * USAGE
 *   node scripts/run-with-production-credentials.mjs -- \
 *     node scripts/attach-production-owner.mjs --env production --phone 03069856575
 *        rehearses: one transaction, every check, then rolled back
 *   … --phone 03069856575 --name "Your Name" --apply --confirm ATTACH-PRODUCTION-OWNER
 *        the same statements and checks, committed
 *
 * PRODUCTION-OWNER-ATTACH-GUARDED. The confirmation is the decision; the rehearsal is the default.
 */

import pg from 'pg';
import { readCredentialsFile, defaultCredentialsPath } from './lib/credentials-file.mjs';
import { connectionStringFor, projectRefFromDbUser } from './lib/environments.mjs';

const PRODUCTION_REF = 'gkswcfljxlutkfdvvqng';
const CONFIRMATION = 'ATTACH-PRODUCTION-OWNER';
const APPLY = process.argv.includes('--apply');
const SIMULATE = process.argv.includes('--simulate-first-signin');
const flag = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : process.argv[process.argv.indexOf(hit) + 1] ?? null;
};

const env = flag('env');
if (env !== 'production') {
  console.error('Refusing to run: name the environment: --env production');
  process.exit(2);
}
if (APPLY && flag('confirm') !== CONFIRMATION) {
  console.error(`Refusing to apply without the owner-authorized confirmation.\n  re-run with: --apply --confirm ${CONFIRMATION}`);
  process.exit(2);
}
if (APPLY && SIMULATE) {
  console.error('Refusing to run: --simulate-first-signin is a rehearsal aid and cannot be applied. Attach the login Supabase created.');
  process.exit(2);
}

const rawPhone = (flag('phone') ?? '').replace(/\D/g, '');
if (rawPhone.length < 10) {
  console.error('Refusing to run: pass the owner\'s real number as --phone (at least 10 digits).');
  process.exit(2);
}
// The same canonical form `canonical_phone()` produces: 03069856575 → 923069856575.
const phone = rawPhone.startsWith('0') ? '92' + rawPhone.slice(1) : rawPhone;
const name = (flag('name') ?? 'Shop Owner').trim() || 'Shop Owner';

const { values } = readCredentialsFile(defaultCredentialsPath());
const connectionString = connectionStringFor({ environment: 'production', envPrefix: 'PROD', values });
if (!String(values.PROD_DB_USER ?? '').endsWith(PRODUCTION_REF) || projectRefFromDbUser(values.PROD_DB_USER) !== PRODUCTION_REF) {
  console.error(`Refusing to run: credentials do not name production (${PRODUCTION_REF}).`);
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const fail = (message) => {
  throw new Error(`REFUSED: ${message}`);
};
const one = async (sql, params) => (await client.query(sql, params)).rows[0];

console.log(`target: production ${PRODUCTION_REF}  phone: ${phone}  mode: ${APPLY ? 'APPLY (commits)' : 'REHEARSE (rolls back)'}`);

await client.query('begin');
let committed = false;
try {
  // ── 1. The tenant must be the empty one this file exists for ───────────────
  const shops = (await client.query('select id, name, owner_id from public.shops')).rows;
  if (shops.length !== 1) fail(`production holds ${shops.length} shops, expected the one tenant`);
  const shop = shops[0];
  if (shop.owner_id) fail(`shop ${shop.id} already has an owner (${shop.owner_id})`);
  const branches = (await client.query('select id from public.branches where tenant_id = $1 and is_active', [shop.id])).rows;
  if (!branches.length) fail(`shop ${shop.id} has no active branch`);
  const users = Number((await one('select count(*)::int n from public.users')).n);
  if (users !== 0) fail(`public.users holds ${users} row(s); this file only attaches the first owner of an empty tenant`);

  // ── 2. Supabase must already hold the login for this number ────────────────
  let login = await one(
    `select id, phone, phone_confirmed_at
       from auth.users
      where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') in ($1, '+$1')
      limit 1`,
    [phone],
  );
  if (!login && SIMULATE) {
    login = await one(
      `insert into auth.users (id, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values (gen_random_uuid(), $1, now(), '{"provider":"phone","providers":["phone"]}', '{}')
       returning id, phone, phone_confirmed_at`,
      [phone],
    );
    console.log(`  simulated first sign-in: throwaway auth row ${login.id} (rolled back)`);
  }
  if (!login) {
    console.error(
      `REFUSED: no Supabase login exists for ${phone}.\n` +
        `  Open the app, enter the number, request the code and verify it, then run this again.\n` +
        `  Nothing was written.`,
    );
    process.exitCode = 3;
    await client.query('rollback');
    await client.end();
    process.exit(process.exitCode);
  }
  const already = Number((await one('select count(*)::int n from public.users where id = $1', [login.id])).n);
  if (already) fail(`auth ${login.id} already has a profile`);

  // ── 3. The profile, the membership, the active shop, the shop's owner ──────
  await client.query(
    `insert into public.users (id, name, phone, role, is_original_owner, is_active, shop_id)
     values ($1, $2, $3, 'admin', true, true, $4)`,
    [login.id, name, phone, shop.id],
  );
  await client.query(
    `insert into public.memberships (user_id, tenant_id, role, status, branch_scope, role_id)
     values ($1, $2, 'owner', 'active', null, null)`,
    [login.id, shop.id],
  );
  await client.query(
    `insert into public.user_active_shops (user_id, shop_id, branch_id, updated_at)
     values ($1, $2, $3, now())
     on conflict (user_id) do update
       set shop_id = excluded.shop_id, branch_id = excluded.branch_id, updated_at = now()`,
    [login.id, shop.id, branches[0].id],
  );
  await client.query('update public.shops set owner_id = $1 where id = $2', [login.id, shop.id]);
  console.log(`  wrote profile ${login.id}, owner membership in ${shop.id}, active shop/branch, shops.owner_id`);

  // ── 4. Postconditions: the door and the access, not just the rows ──────────
  // As an unauthenticated caller the lookup must answer only the door question — no `id` — which is
  // the property that keeps a phone number from leaking a profile.
  const anon = await one(`select public.lookup_user_by_phone($1) as profile`, ['+' + phone]);
  if (!anon.profile) fail('lookup_user_by_phone returns nothing for the number that just signed in');
  if (anon.profile.id !== undefined && anon.profile.id !== null) fail('an unauthenticated lookup returned a full profile');

  // Now as the owner themselves: the same call must return the row the session's `sub` names.
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: login.id, role: 'authenticated' })]);
  const door = await one(`select public.lookup_user_by_phone($1) as profile`, ['+' + phone]);
  if (!door.profile) fail('lookup_user_by_phone returns nothing for the number that just signed in');
  if (door.profile.id !== login.id) fail(`lookup returned ${door.profile.id}, expected the auth id ${login.id}`);
  if (door.profile.is_original_owner !== true) fail('the profile is not marked as the original owner');

  const membership = await one('select role, status, branch_scope from public.memberships where user_id = $1', [login.id]);
  if (!membership || membership.role !== 'owner' || membership.status !== 'active') fail('the owner membership is missing or not active');
  if (membership.branch_scope !== null) fail('an owner membership must not be branch-scoped');

  const resolved = await one('select public.resolve_active_shop($1) as shop', [login.id]);
  if (resolved.shop !== shop.id) fail(`resolve_active_shop returned ${resolved.shop}, expected ${shop.id}`);

  const perms = (await client.query('select public.get_effective_permissions($1) as p', [login.id])).rows[0].p;
  const codes = Array.isArray(perms) ? perms.map((p) => (typeof p === 'string' ? p : p.code)) : [];
  if (!codes.includes('settings.edit') || !codes.includes('employees.manage')) {
    fail(`the owner is missing management permissions (got ${codes.length} codes)`);
  }
  console.log(`  lookup by phone → ${door.profile.name}, owner · active shop ${resolved.shop} · ${codes.length} permissions`);

  const shell = await one('select owner_id from public.shops where id = $1', [shop.id]);
  if (shell.owner_id !== login.id) fail('shops.owner_id was not set');

  // Leave no claim behind: the rollback would discard it, but the commit path must not carry it.
  await client.query(`select set_config('request.jwt.claims', '', true)`);

  if (APPLY) {
    await client.query('commit');
    committed = true;
    console.log('COMMITTED');
  } else {
    console.log('REHEARSAL PASSED — rolling back, nothing changed');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!committed) await client.query('rollback').catch(() => {});
  await client.end();
}
