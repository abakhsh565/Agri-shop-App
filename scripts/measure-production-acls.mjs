#!/usr/bin/env node
/**
 * measure-production-acls.mjs — read production's ACTUAL privileges, without changing anything.
 *
 * WHY THIS EXISTS
 *   Two different questions have been answered and only one of them had been measured:
 *
 *   * "Does our batch's own ACL intent survive?" — answered by `probe-rehearsal-intent.mjs` on a
 *     rehearsed database, which reads the privileges a batch leaves behind.
 *   * "What does production ALREADY hold?" — never answered. The frozen baseline artifact is a
 *     statement set captured without GRANTs (it carries none at all), so no rehearsal can say what
 *     the live project grants to `anon`, `authenticated` or `service_role`. A batch that is correct
 *     in isolation can still land on a project where a table is directly writable, or where a
 *     SECURITY DEFINER function is executable by `anon`.
 *
 *   This script closes that gap with the only thing that can: a read-only catalog query against the
 *   live project. It is deliberately one of the three commands `run-with-production-credentials.mjs`
 *   will launch, because the credential guard exists to stop an arbitrary command from receiving the
 *   production password — not to stop the owner from looking at their own privileges.
 *
 * WHAT IT READS (and therefore what it cannot affect)
 *   `pg_class`, `pg_policy`, `pg_proc`, `pg_namespace`, plus `has_table_privilege()` /
 *   `has_function_privilege()`. Every statement runs inside `BEGIN … SET TRANSACTION READ ONLY`, and
 *   the session's `default_transaction_read_only` is set first, so a write would fail rather than be
 *   reviewed. No DDL, no DML, no `set_config`, no temporary objects.
 *
 * USAGE (through the credential wrapper — this script cannot read its own credentials)
 *   node scripts/run-with-production-credentials.mjs -- \
 *     node scripts/measure-production-acls.mjs --env production [--json backups/<file>.json]
 *
 * Exit codes: 0 = measured, 1 = could not measure, 2 = refused before connecting.
 */
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import {
  ROOT,
  assertReached,
  connectionStringFor,
  identifyConnection,
  resolveCredentials,
} from './lib/environments.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1] ?? fallback;
};

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

const envName = flag('env');
if (!envName) refuse('name the environment this reads: --env production.');
if (!argv.includes('--env')) refuse('the environment must be passed as --env production, not positionally.');
if (envName !== 'production') {
  // QA has its own rehearsal-and-probe path, and the point of this file is the one project no
  // rehearsal can describe. Reading anything else through the production credential wrapper would
  // be a mistake in the invocation, and mistakes should not be silent.
  refuse(`this reads the live PRODUCTION catalog only; got --env ${envName}. Use probe-rehearsal-intent.mjs for a rehearsal database.`);
}

const jsonOut = flag('json');
const creds = (() => {
  try {
    return resolveCredentials('production', { requireAll: true, allowEnvFile: false });
  } catch (error) {
    refuse(`${error.message}\n  This script never reads a credentials file itself: run it through scripts/run-with-production-credentials.mjs.`);
  }
})();

const TABLES = [
  'sales', 'sale_items', 'purchases', 'purchase_items', 'returns', 'return_items',
  'customer_payments', 'supplier_payments', 'inventory_movements', 'stock_adjustments',
  'products', 'product_variants', 'customers', 'companies', 'users', 'audit_events',
  'branches', 'memberships', 'roles', 'role_permissions', 'permissions', 'user_permissions',
];

const FUNCTIONS_OF_INTEREST = [
  'create_sale', 'void_sale', 'process_return', 'adjust_stock', 'record_customer_payment',
  'get_my_branches', 'get_my_permissions', 'get_my_shops', 'set_active_shop', 'set_active_branch',
  'create_role', 'create_employee', 'update_employee_access', 'delete_role', 'my_shop_ids',
  'guard_operational_request', 'guard_employee_access_edit', 'delete_branch',
  'audit_operational_snapshot', 'current_shop_id', 'current_branch_scope', 'has_effective_permission',
];

const client = new pg.Client({
  connectionString: connectionStringFor(creds, { port: 6543 }),
  ssl: { rejectUnauthorized: false },
  application_name: 'measure-production-acls (read only)',
});

let report;
try {
  await client.connect();
  const reached = await identifyConnection(client, creds);
  assertReached(creds, reached);

  // The read-only contract, stated to the server rather than trusted to the queries below.
  await client.query('set default_transaction_read_only = on');
  await client.query('begin');
  await client.query('set transaction read only');
  const readOnly = (await client.query('show transaction_read_only')).rows[0]?.transaction_read_only;
  if (readOnly !== 'on') throw new Error(`refusing to measure: the server reports transaction_read_only = ${readOnly}`);

  const version = (await client.query('show server_version')).rows[0]?.server_version;

  const tablePrivileges = (
    await client.query(
      `select c.relname, c.relkind,
              has_table_privilege('anon', c.oid, 'SELECT')          as anon_select,
              has_table_privilege('anon', c.oid, 'INSERT')          as anon_insert,
              has_table_privilege('anon', c.oid, 'UPDATE')          as anon_update,
              has_table_privilege('anon', c.oid, 'DELETE')          as anon_delete,
              has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
              has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
              has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
              has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete,
              c.relrowsecurity as rls_enabled
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v')
          and c.relname = any ($1::text[])
        order by c.relname`,
      [TABLES],
    )
  ).rows;

  const functionPrivileges = (
    await client.query(
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as args,
              p.prosecdef as security_definer,
              p.prorettype = 'trigger'::regtype as is_trigger,
              has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_execute,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        order by p.proname, p.oid`,
    )
  ).rows;

  const policyFacts = (
    await client.query(
      `select c.relname,
              count(*)::int as policies,
              count(*) filter (where p.polpermissive)::int as permissive,
              count(*) filter (where not p.polpermissive)::int as restrictive,
              coalesce(string_agg(p.polname, ', ' order by p.polname) filter (
                where p.polpermissive
                  and coalesce(pg_get_expr(p.polqual, p.polrelid), '') = 'true'
                  and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true'), '') as permissive_true
         from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
        group by c.relname
        order by c.relname`,
    )
  ).rows;

  const presentRelations = (
    await client.query(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and relkind in ('r', 'v') and relname = any ($1::text[])`,
      [TABLES],
    )
  ).rows.map((row) => row.relname);

  const presentFunctions = new Set(functionPrivileges.map((row) => row.proname));

  report = {
    generatedAt: new Date().toISOString(),
    environment: 'production',
    projectRef: creds.projectRef,
    host: creds.values.PROD_DB_HOST ?? null,
    serverVersion: version,
    identity: { serverUser: reached.serverUser, clusterId: reached.clusterId },
    readOnly: { transactionReadOnly: readOnly, statements: 'select only, inside a read-only transaction' },
    tables: {
      measured: tablePrivileges,
      anon: {
        canSelect: tablePrivileges.filter((row) => row.anon_select).map((row) => row.relname),
        canInsert: tablePrivileges.filter((row) => row.anon_insert).map((row) => row.relname),
        canUpdate: tablePrivileges.filter((row) => row.anon_update).map((row) => row.relname),
        canDelete: tablePrivileges.filter((row) => row.anon_delete).map((row) => row.relname),
      },
      authenticated: {
        canSelect: tablePrivileges.filter((row) => row.auth_select).map((row) => row.relname),
        canInsert: tablePrivileges.filter((row) => row.auth_insert).map((row) => row.relname),
        canUpdate: tablePrivileges.filter((row) => row.auth_update).map((row) => row.relname),
        canDelete: tablePrivileges.filter((row) => row.auth_delete).map((row) => row.relname),
      },
    },
    functions: {
      total: functionPrivileges.length,
      executableByAnon: functionPrivileges.filter((row) => row.anon_execute).map((row) => row.proname),
      triggerExecutableByAnon: functionPrivileges.filter((row) => row.is_trigger && row.anon_execute).map((row) => row.proname),
      ofInterest: functionPrivileges.filter((row) => FUNCTIONS_OF_INTEREST.includes(row.proname)),
    },
    policies: {
      tables: policyFacts,
      permissiveAlwaysTrue: policyFacts
        .filter((row) => row.permissive_true)
        .map((row) => `${row.relname}: ${row.permissive_true}`),
      tablesWithoutRls: tablePrivileges.filter((row) => row.relkind === 'r' && !row.rls_enabled).map((row) => row.relname),
    },
    presence: {
      relationsMissing: TABLES.filter((name) => !presentRelations.includes(name)),
      functionsMissing: FUNCTIONS_OF_INTEREST.filter((name) => !presentFunctions.has(name)),
    },
  };

  await client.query('rollback');
} catch (error) {
  console.error(`[MEASURE] FAIL — ${error.message}`);
  try {
    await client.end();
  } catch {
    /* the connection is already gone */
  }
  process.exit(1);
}

await client.end();

const lines = [];
lines.push('');
lines.push('Production privileges — measured from the live catalog, read only');
lines.push(`  project     : ${report.projectRef} (Postgres ${report.serverVersion})`);
lines.push(`  identity    : cluster ${report.identity.clusterId ?? '(not readable through the pooler)'}`);
lines.push(`  read only   : transaction_read_only = ${report.readOnly.transactionReadOnly}`);
lines.push('');
lines.push(`  relations measured: ${report.tables.measured.length} · missing from production: ${report.presence.relationsMissing.length ? report.presence.relationsMissing.join(', ') : 'none'}`);
lines.push(`  anon          : SELECT ${report.tables.anon.canSelect.length} · INSERT ${report.tables.anon.canInsert.length} · UPDATE ${report.tables.anon.canUpdate.length} · DELETE ${report.tables.anon.canDelete.length}`);
lines.push(`  authenticated : SELECT ${report.tables.authenticated.canSelect.length} · INSERT ${report.tables.authenticated.canInsert.length} · UPDATE ${report.tables.authenticated.canUpdate.length} · DELETE ${report.tables.authenticated.canDelete.length}`);
lines.push('');
if (report.tables.authenticated.canInsert.length) {
  lines.push(`  authenticated can INSERT directly into: ${report.tables.authenticated.canInsert.join(', ')}`);
}
if (report.tables.anon.canInsert.length) {
  lines.push(`  anon can INSERT directly into: ${report.tables.anon.canInsert.join(', ')}`);
}
if (report.policies.permissiveAlwaysTrue.length) {
  lines.push(`  permissive policies that are always true: ${report.policies.permissiveAlwaysTrue.join(' | ')}`);
}
if (report.policies.tablesWithoutRls.length) {
  lines.push(`  tables without RLS: ${report.policies.tablesWithoutRls.join(', ')}`);
}
lines.push('');
lines.push(`  functions in public: ${report.functions.total} · executable by anon: ${report.functions.executableByAnon.length}`);
lines.push(`  trigger functions executable by anon: ${report.functions.triggerExecutableByAnon.length ? report.functions.triggerExecutableByAnon.join(', ') : 'none'}`);
for (const fn of report.functions.ofInterest) {
  if (!fn.security_definer && !fn.is_trigger) continue;
  lines.push(`    ${fn.proname}(${fn.args}) definer=${fn.security_definer} trigger=${fn.is_trigger} anon=${fn.anon_execute} authenticated=${fn.auth_execute}`);
}
lines.push('');
lines.push(`  functions the app calls that production lacks: ${report.presence.functionsMissing.length ? report.presence.functionsMissing.join(', ') : 'none'}`);
lines.push('');

console.log(lines.join('\n'));

if (jsonOut) {
  const target = path.resolve(ROOT, jsonOut);
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  Report: ${jsonOut}\n`);
}
