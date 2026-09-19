/**
 * Print the tenant / authorization foundation evidence snapshot.
 *
 * Read-only. Every line is a measurable property of the deployed QA database, so
 * the state of the access-management foundation can be re-checked at any time
 * without reading migration files.
 */
import pg from 'pg';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.qa', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

if ((env.QA_DB_USER || '').split('.')[1] !== 'bpybjrjenwccowvtrevu') {
  console.error('Refusing to run: not the QA project.');
  process.exit(1);
}

const pool = new pg.Pool({
  host: env.QA_DB_HOST, port: 6543, database: 'postgres',
  user: env.QA_DB_USER, password: env.QA_DB_PASS,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
const one = async (sql) => (await pool.query(sql)).rows[0];
const all = async (sql) => (await pool.query(sql)).rows;

const GUARD = 'authorize_business_action|authorize_tenant_membership|has_effective_permission|has_permission|app_is_admin|is_trusted_context';
const WRITE = '^(create_|update_|delete_|record_|void_|adjust_|process_return|archive_|restore_|deactivate_|activate_|approve_|reject_)';

const writes = await one(`SELECT count(*)::int AS c FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname ~ '${WRITE}'`);
const guarded = await one(`SELECT count(*)::int AS c FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname ~ '${WRITE}'
    AND pg_get_functiondef(p.oid) ~ '${GUARD}'`);
const anonWrites = await all(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND array_to_string(p.proacl, ',') LIKE '%anon=X%'
    AND p.proname ~ '^(create_|update_|delete_|void_|adjust_|archive_|restore_|deactivate_|activate_|approve_|reject_|upsert_|process_|insert_)'
  ORDER BY p.proname`);
const zeroPolicy = await all(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
  ORDER BY c.relname`);
const internal = ['agent_attempts','agent_tasks','engineering_memory','frontend_dependency_graph','impact_analyses','impact_mappings','incident_rate_limits','incident_signatures','incidents','known_resolutions','resolution_regression_tests','activity_log','daily_cash_reconciliations','payments','shop_requests'];
const appZeroPolicy = zeroPolicy.map((r) => r.relname).filter((t) => !internal.includes(t));

const branchTables = await one(`SELECT count(*)::int AS c FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'branch_id'`);
const branchTriggers = await one(`SELECT count(*)::int AS c FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND t.tgname = 'enforce_branch_scope_trg' AND NOT t.tgisinternal`);
const branchless = await one(`SELECT (SELECT count(*) FROM sales WHERE branch_id IS NULL)
  + (SELECT count(*) FROM purchases WHERE branch_id IS NULL)
  + (SELECT count(*) FROM inventory_movements WHERE branch_id IS NULL)
  + (SELECT count(*) FROM customer_payments WHERE branch_id IS NULL)
  + (SELECT count(*) FROM supplier_payments WHERE branch_id IS NULL)
  + (SELECT count(*) FROM returns WHERE branch_id IS NULL)
  + (SELECT count(*) FROM stock_adjustments WHERE branch_id IS NULL) AS c`);

const access = await one(`SELECT (SELECT count(*) FROM roles)::int AS roles,
  (SELECT count(*) FROM role_permissions)::int AS role_perms,
  (SELECT count(*) FROM permissions)::int AS permissions,
  (SELECT count(*) FROM business_areas)::int AS areas,
  (SELECT count(*) FROM user_permissions)::int AS overrides,
  (SELECT count(*) FROM memberships WHERE status = 'active')::int AS active_memberships`);
const orphans = await one(`SELECT count(*)::int AS c FROM users u WHERE u.shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)`);
const customRoles = await one(`SELECT count(*)::int AS c FROM roles WHERE is_system = false`);

console.log('TENANT / AUTHORIZATION FOUNDATION');
console.log(`  write RPCs                     ${writes.c}`);
console.log(`  ... carrying an auth guard     ${guarded.c}`);
console.log(`  anon-executable writes         ${anonWrites.length}${anonWrites.length ? ' → ' + anonWrites.map((r) => r.proname).join(', ') : ''}`);
console.log(`  app tables RLS w/ 0 policies   ${appZeroPolicy.length}${appZeroPolicy.length ? ' → ' + appZeroPolicy.join(', ') : ''}`);
console.log(`  tables with branch ownership   ${branchTables.c}`);
console.log(`  branch enforcement triggers    ${branchTriggers.c}`);
console.log(`  records without a branch       ${branchless.c}`);
console.log(`  users without a membership     ${orphans.c}`);
console.log(`  roles / role-perms / perms     ${access.roles} / ${access.role_perms} / ${access.permissions}`);
console.log(`  business areas / overrides     ${access.areas} / ${access.overrides}`);
console.log(`  active memberships             ${access.active_memberships}`);
console.log(`  custom roles (should be 0)     ${customRoles.c}`);

await pool.end();
