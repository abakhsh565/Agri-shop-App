/**
 * QA Database Client
 *
 * Connects to the isolated QA Supabase project.
 * NEVER connects to production.
 */

import { createClient } from '@supabase/supabase-js';

const QA_URL = 'https://bpybjrjenwccowvtrevu.supabase.co';
const QA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjY1NzIsImV4cCI6MjEwNDYwMjU3Mn0.nHzYWdjmZ_TEp_2mzqeinCNoXeLvVdvOETgvJXxldS0';
const QA_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTAyNjU3MiwiZXhwIjoyMTA0NjAyNTcyfQ.QHa62c7sOzuQCj3fiyIPDXNhk0C1wox-FVcBfA3SJnY';

/** Service-role client (bypasses RLS, for test setup/teardown) */
export const qaServiceClient = createClient(QA_URL, QA_SERVICE_ROLE);

/** Anon client (RLS-enforced, for testing RLS policies) */
export const qaAnonClient = createClient(QA_URL, QA_ANON_KEY);

/** Direct PostgreSQL client for SQL execution */
import pg from 'pg';

const QA_DB_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
const QA_DB_USER = 'postgres.bpybjrjenwccowvtrevu';
const QA_DB_PASS = 'LptUWZQm4TZrRksv4nAtFUHk3YG6rO';

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
