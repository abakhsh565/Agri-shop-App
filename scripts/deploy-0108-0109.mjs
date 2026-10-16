import pg from 'pg';
import fs from 'node:fs';
import { qaPoolOptions } from './lib/qa-connection.mjs';
const { Pool } = pg;
// Credentials come from the environment, and the target must be the QA project. The password literal
// that used to sit here is in git history and must be rotated — see docs/PRODUCTION_DATA_POLICY.md.
const pool = new Pool(qaPoolOptions({ statementTimeout: 120000 }));
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
