const { Client } = require('pg');
const fs = require('fs');

// Load .env.qa
const envContent = fs.readFileSync('.env.qa', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

async function main() {
  const client = new Client({
    host: env.QA_DB_HOST, port: 6543, user: env.QA_DB_USER,
    password: env.QA_DB_PASS, database: 'postgres',
    ssl: { rejectUnauthorized: false }, family: 4,
  });
  await client.connect();

  // Read raw SQL from file
  const sql = fs.readFileSync('tests/setup/create_run_sql.sql', 'utf8');
  
  // Send as simple query (pg uses simple protocol for string queries)
  await client.query(sql);
  console.log('Function deployed');

  await client.query('GRANT EXECUTE ON FUNCTION run_sql(text) TO authenticated');
  await client.query('GRANT EXECUTE ON FUNCTION run_sql(text) TO service_role');
  console.log('Permissions granted');

  // Verify
  const r = await client.query("SELECT run_sql('SELECT 1 as v') as result");
  console.log('Direct test:', r.rows[0].result);
  await client.end();

  // HTTP API test
  const { createClient } = require('@supabase/supabase-js');
  const qaClient = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE);

  const { data, error } = await qaClient.rpc('run_sql', { sql_query: 'SELECT 1 as http_test' });
  console.log('HTTP SELECT:', error ? 'FAIL: ' + error.message : 'PASS: ' + JSON.stringify(data));

  // Test INSERT
  const { error: e2 } = await qaClient.rpc('run_sql', {
    sql_query: "INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Test HTTP', '99999999999', 'employee', false, true, '00000000-0000-0000-0000-000000000001') ON CONFLICT (id) DO NOTHING"
  });
  console.log('HTTP INSERT:', e2 ? 'FAIL: ' + e2.message : 'PASS');

  // Verify
  const { data: d3, error: e3 } = await qaClient.rpc('run_sql', {
    sql_query: "SELECT name FROM users WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'"
  });
  console.log('HTTP VERIFY:', e3 ? 'FAIL: ' + e3.message : 'PASS: ' + JSON.stringify(d3));

  // DELETE
  const { error: e4 } = await qaClient.rpc('run_sql', {
    sql_query: "DELETE FROM users WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'"
  });
  console.log('HTTP DELETE:', e4 ? 'FAIL: ' + e4.message : 'PASS');

  // DDL
  const { error: e5 } = await qaClient.rpc('run_sql', { sql_query: 'CREATE TABLE IF NOT EXISTS _test_ci (id int)' });
  console.log('HTTP DDL CREATE:', e5 ? 'FAIL: ' + e5.message : 'PASS');
  const { error: e6 } = await qaClient.rpc('run_sql', { sql_query: 'DROP TABLE IF EXISTS _test_ci' });
  console.log('HTTP DDL DROP:', e6 ? 'FAIL: ' + e6.message : 'PASS');

  console.log('\nDeployment complete!');
}
main().catch(e => { console.error(e); process.exit(1); });
