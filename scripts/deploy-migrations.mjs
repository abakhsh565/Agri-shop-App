/**
 * Apply one or more migration files to the QA database.
 *
 * Credentials come from .env.qa (gitignored) — never hardcoded here.
 * Usage: node scripts/deploy-migrations.mjs supabase/migrations/0NNN_name.sql
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
  console.error('Refusing to run: target is not the QA project.');
  process.exit(1);
}

const pool = new pg.Pool({
  host: env.QA_DB_HOST, port: 6543, database: 'postgres',
  user: env.QA_DB_USER, password: env.QA_DB_PASS,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 120000,
});

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/deploy-migrations.mjs <file...>');
  process.exit(1);
}

const client = await pool.connect();
try {
  for (const file of files) {
    console.log(`Deploying ${file}`);
    await client.query(fs.readFileSync(file, 'utf8'));
    console.log('  OK');
  }
} finally {
  client.release();
  await pool.end();
}
