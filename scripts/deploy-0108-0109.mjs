import pg from 'pg';
import fs from 'node:fs';
const { Pool } = pg;
const pool = new Pool({
  host: 'aws-0-ap-northeast-1.pooler.supabase.com', port: 6543, database: 'postgres',
  user: 'postgres.bpybjrjenwccowvtrevu', password: 'LptUWZQm4TZrRksv4nAtFUHk3YG6rO',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 120000,
});
const client = await pool.connect();
try {
  for (const file of ['supabase/migrations/0108_authoritative_access_and_business_areas.sql','supabase/migrations/0109_enforce_business_permissions.sql','supabase/migrations/0110_backfill_legacy_memberships.sql','supabase/migrations/0111_admin_management_defaults.sql']) {
    console.log(`Deploying ${file}`);
    await client.query(fs.readFileSync(file, 'utf8'));
    console.log('  OK');
  }
  const { rows } = await client.query(`
    select proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and proname in ('get_effective_permissions','authorize_business_action','get_employee_access','create_business_area','create_role','update_role','create_employee','create_sale','create_purchase')
    order by proname
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally { client.release(); await pool.end(); }
