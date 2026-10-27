/**
 * rpc-guard-gap.mjs — WHICH write RPCs carry no recognised authorization guard, and what protects them?
 *
 * WHY. `scripts/rbac-evidence.mjs` reports the count (53 write RPCs, 44 guarded) but not the names of
 * the remainder, and a count cannot be audited: "9 unguarded" is only actionable once each one is named
 * with its ACL, its security mode and whether it resolves a tenant at all. This is that list, and it is
 * the DB-layer half of the "direct RPC bypass" control — the question is not what the UI calls but what
 * `authenticated` can call.
 *
 * READ-ONLY, and QA ONLY: `BEGIN READ ONLY` plus SELECTs, and a refusal for any target that is not the
 * QA project. It never writes and never touches production.
 *
 * USAGE: node device-evidence/tmp/rpc-guard-gap.mjs
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const QA_REF = 'bpybjrjenwccowvtrevu';

const env = Object.fromEntries(
  readFileSync('.env.qa', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

if ((env.QA_DB_USER || '').split('.')[1] !== QA_REF) {
  console.error(`Refusing to run: the configured target is not the QA project (${QA_REF}).`);
  process.exit(2);
}

const pool = new pg.Pool({
  host: env.QA_DB_HOST,
  port: 6543,
  database: 'postgres',
  user: env.QA_DB_USER,
  password: env.QA_DB_PASS,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

/** Same guard vocabulary and write-verb pattern `scripts/rbac-evidence.mjs` uses. */
const GUARD = 'authorize_business_action|authorize_tenant_membership|has_effective_permission|has_permission|app_is_admin|is_trusted_context|current_shop_id|app_current_user_id';
const WRITE = '^(create_|update_|delete_|record_|void_|adjust_|process_return|archive_|restore_|deactivate_|activate_|approve_|reject_|upsert_|process_|insert_)';

const { rows } = await pool.query(`
  SELECT p.proname,
         p.prosecdef                       AS security_definer,
         p.proacl::text                    AS acl,
         pg_get_function_arguments(p.oid)   AS args,
         (pg_get_functiondef(p.oid) ~ $1)   AS has_guard,
         (pg_get_functiondef(p.oid) ~ 'shop_id|tenant') AS mentions_tenant
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname ~ $2
   ORDER BY p.proname`, [GUARD, WRITE]);

const unguarded = rows.filter((r) => !r.has_guard);

console.log(`write RPCs: ${rows.length} · guarded: ${rows.length - unguarded.length} · UNGUARDED: ${unguarded.length}`);
console.log('\n── the UNGUARDED ones, with what else might protect them\n');
for (const r of unguarded) {
  const acl = (r.acl || '')
    .replace(/\{[^}]*\}/, (m) => m)
    .replace(/[a-z]+=X/g, (m) => m)
    .slice(0, 160);
  console.log(`• ${r.proname}`);
  console.log(`    security definer : ${r.security_definer}`);
  console.log(`    mentions tenant  : ${r.mentions_tenant}`);
  console.log(`    args             : ${r.args || '(none)'}`);
  console.log(`    acl              : ${acl}`);
}

await pool.end();
