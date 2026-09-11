/**
 * QA Database Client
 *
 * Connects to the isolated QA Supabase project.
 * NEVER connects to production.
 * Credentials are loaded from .env.qa or environment variables.
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/** Load .env.qa into process.env if not already loaded */
function loadQaEnv() {
  if (process.env.QA_SUPABASE_URL) return;
  try {
    // Try multiple path resolution strategies
    const candidates = [
      path.resolve(process.cwd(), '.env.qa'),
      path.resolve(process.cwd(), '../../.env.qa'),
    ];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
        return;
      }
    }
  } catch { /* .env.qa not found — rely on environment */ }
}
loadQaEnv();

const QA_URL = process.env.QA_SUPABASE_URL || 'https://bpybjrjenwccowvtrevu.supabase.co';
const QA_ANON_KEY = process.env.QA_SUPABASE_ANON_KEY || '';
const QA_SERVICE_ROLE = process.env.QA_SUPABASE_SERVICE_ROLE || '';

/** Service-role client (bypasses RLS, for test setup/teardown) */
export const qaServiceClient = createClient(QA_URL, QA_SERVICE_ROLE);

/** Anon client (RLS-enforced, for testing RLS policies) */
export const qaAnonClient = createClient(QA_URL, QA_ANON_KEY);

/** Direct PostgreSQL client for SQL execution */
const QA_DB_HOST = process.env.QA_DB_HOST || '';
const QA_DB_USER = process.env.QA_DB_USER || '';
const QA_DB_PASS = process.env.QA_DB_PASS || '';

export function getDbClient() {
  return new pg.Client({
    connectionString: `postgresql://${QA_DB_USER}:${QA_DB_PASS}@${QA_DB_HOST}:6543/postgres`,
    ssl: { rejectUnauthorized: false },
  });
}

/** Execute raw SQL against the QA database */
export async function execSql(sql: string): Promise<pg.QueryResult> {
  const client = getDbClient();
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Execute multiple SQL statements (for migrations/setup) */
export async function execMultiSql(sql: string): Promise<void> {
  const client = getDbClient();
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
