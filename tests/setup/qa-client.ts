/**
 * QA Database Client
 *
 * Connects to the isolated QA Supabase project.
 * NEVER connects to production.
 * Credentials are loaded from .env.qa or environment variables.
 *
 * The Supabase pooler (port 6543) in transaction pooling mode resets
 * session-level settings between transactions.
 *
 * getDbClient(): Returns a client that auto-wraps each query in a transaction
 * with SET LOCAL role = 'postgres'. This bypasses RLS and protect_* triggers.
 * Use for all direct SQL (INSERT/UPDATE/DELETE/SELECT on tables).
 *
 * getRawDbClient(): Returns an unmodified client. Use for RPC calls where
 * you need to set JWT claims and role = 'authenticated' yourself.
 *
 * execRpcAsUser(): Convenience wrapper that creates a fresh connection,
 * sets JWT claims + role = 'authenticated', and calls an RPC function.
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/** Load .env.qa into process.env if not already loaded */
function loadQaEnv() {
  if (process.env.QA_SUPABASE_URL) return;
  try {
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

/** Strip surrounding brackets that some tools add to URLs (e.g., [https://...]) */
function cleanUrl(url: string): string {
  return url.replace(/^\[|\]$/g, '').trim();
}

const QA_URL = cleanUrl(process.env.QA_SUPABASE_URL || 'https://bpybjrjenwccowvtrevu.supabase.co');
const QA_ANON_KEY = process.env.QA_SUPABASE_ANON_KEY || '';
const QA_SERVICE_ROLE = process.env.QA_SUPABASE_SERVICE_ROLE || '';

/** Service-role client (bypasses RLS, for test setup/teardown) */
export const qaServiceClient = createClient(QA_URL, QA_SERVICE_ROLE);

/** Anon client (RLS-enforced, for testing RLS policies) */
export const qaAnonClient = createClient(QA_URL, QA_ANON_KEY);

/** Direct PostgreSQL credentials */
const QA_DB_HOST = process.env.QA_DB_HOST || '';
const QA_DB_USER = process.env.QA_DB_USER || '';
const QA_DB_PASS = process.env.QA_DB_PASS || '';

/**
 * IPv4 is forced via two mechanisms:
 * 1. NODE_OPTIONS='--dns-result-order=ipv4first' (set in CI workflow and vitest.config.ts)
 * 2. family: 4 on pg.Client (forces IPv4 socket)
 * No custom DNS resolution needed — lookupSync fails in Vitest ESM context.
 */
function makeConnString(): string {
  return `postgresql://${QA_DB_USER}:${QA_DB_PASS}@${QA_DB_HOST}:6543/postgres`;
}

/**
 * Create a PostgreSQL client that auto-wraps each query in a transaction
 * with SET LOCAL role = 'postgres'. Bypasses RLS and protect_* triggers.
 *
 * IMPORTANT: Do NOT use this for RPC/function calls that need JWT claims
 * (e.g., archive_customer, void_sale, app_is_admin).
 * Use getRawDbClient() + execRpcAsUser() for those.
 */
export function getDbClient(): pg.Client {
  const client = new pg.Client({
    connectionString: makeConnString(),
    ssl: { rejectUnauthorized: false },
    family: 4,
  });

  const originalQuery = client.query.bind(client);

  client.query = async function interceptedQuery(
    this: pg.Client,
    ...args: any[]
  ): Promise<any> {
    const sql = typeof args[0] === 'string' ? args[0].trim().toUpperCase() : '';
    // Don't intercept transaction control statements
    if (
      sql.startsWith('BEGIN') ||
      sql.startsWith('COMMIT') ||
      sql.startsWith('ROLLBACK')
    ) {
      return originalQuery(...args);
    }

    // Wrap in its own transaction with postgres role
    await originalQuery('BEGIN');
    await originalQuery("SET LOCAL role = 'postgres'");
    try {
      const result = await originalQuery(...args);
      await originalQuery('COMMIT');
      return result;
    } catch (e) {
      await originalQuery('ROLLBACK').catch(() => {});
      throw e;
    }
  } as typeof client.query;

  return client;
}

/**
 * Create a raw PostgreSQL client without role interception.
 * Use for RPC calls where you need to set JWT claims + role = 'authenticated'.
 */
export function getRawDbClient(): pg.Client {
  return new pg.Client({
    connectionString: makeConnString(),
    ssl: { rejectUnauthorized: false },
    // Force IPv4 — GitHub Actions runners lack IPv6 support
    family: 4,
  });
}

/**
 * Execute an RPC as a specific user with JWT claims.
 * Creates a fresh connection, sets JWT claims + role = 'authenticated'.
 */
export async function execRpcAsUser(
  userId: string,
  rpcName: string,
  params: Record<string, any>
): Promise<{ data: any; error: string | null }> {
  // Look up user phone for JWT claims (get_authenticated_user_id needs it)
  let userPhone = '';
  try {
    const lookup = await execSqlAsAdmin(`SELECT phone FROM users WHERE id = '${userId}'`);
    if (lookup.rows[0]?.phone) userPhone = lookup.rows[0].phone;
  } catch { /* user may not exist */ }

  const client = getRawDbClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const jwtClaims = { sub: userId };
    if (userPhone) (jwtClaims as any).phone = userPhone;
    await client.query(`SELECT set_config('request.jwt.claims', '${JSON.stringify(jwtClaims)}', true)`);
    await client.query("SET LOCAL role = 'authenticated'");
    const paramStr = Object.entries(params)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k} := '${v}'`;
        if (v === null) return `${k} := NULL`;
        if (typeof v === 'object') return `${k} := '${JSON.stringify(v)}'::jsonb`;
        return `${k} := ${v}`;
      })
      .join(', ');
    const result = await client.query(`SELECT * FROM ${rpcName}(${paramStr})`);
    await client.query('COMMIT');
    // Unwrap single-column JSON results (common Supabase RPC pattern)
    const row = result.rows[0];
    if (row && typeof row === 'object') {
      const keys = Object.keys(row);
      if (keys.length === 1 && typeof row[keys[0]] === 'object' && row[keys[0]] !== null) {
        return { data: row[keys[0]], error: null };
      }
    }
    return { data: row, error: null };
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    return { data: null, error: e.message };
  } finally {
    await client.end();
  }
}

/**
 * Execute SQL in a fresh transaction as postgres (bypasses both triggers and RLS).
 */
export async function execSqlAsAdmin(sql: string): Promise<pg.QueryResult> {
  const client = getRawDbClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL role = 'postgres'");
    const result = await client.query(sql);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

/**
 * Execute SQL with role = 'authenticated' (RLS-enforced, no JWT).
 */
export async function execSql(sql: string): Promise<pg.QueryResult> {
  const client = getRawDbClient();
  await client.connect();
  try {
    await client.query("SET role = 'authenticated'");
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Execute multiple SQL statements with authenticated role.
 */
export async function execMultiSql(sql: string): Promise<void> {
  const client = getRawDbClient();
  await client.connect();
  try {
    await client.query("SET role = 'authenticated'");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Disable all triggers on all tables.
 */
export async function disableTriggers(_client?: pg.Client): Promise<void> {
  const client = getRawDbClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL role = 'postgres'");
    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    for (const row of tables.rows) {
      try {
        await client.query(`ALTER TABLE ${row.tablename} DISABLE TRIGGER ALL`);
      } catch { /* some tables may not have triggers */ }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

/**
 * Re-enable all triggers on all tables.
 */
export async function enableTriggers(_client?: pg.Client): Promise<void> {
  const client = getRawDbClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL role = 'postgres'");
    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    for (const row of tables.rows) {
      try {
        await client.query(`ALTER TABLE ${row.tablename} ENABLE TRIGGER ALL`);
      } catch { /* some tables may not have triggers */ }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

/**
 * No-op alias for backward compatibility.
 */
export async function asPostgres(_client?: pg.Client): Promise<void> {}

/**
 * Set role to authenticated on a client.
 */
export async function asAuthenticated(client: pg.Client): Promise<void> {
  try { await client.query("SET role = 'authenticated'"); } catch { /* best effort */ }
}
