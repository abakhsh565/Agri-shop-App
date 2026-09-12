/**
 * QA Database Client
 *
 * Uses the Supabase HTTP API (run_sql RPC) for all SQL operations.
 * This avoids the IPv6 DNS issue on GitHub Actions where the Supabase
 * pooler hostname only has AAAA records.
 *
 * Provides a pg.Client-compatible interface so existing tests work unchanged.
 * Credentials are loaded from .env.qa or environment variables.
 * NEVER connects to production.
 */

import { createClient } from '@supabase/supabase-js';
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

/** Strip surrounding brackets that some tools add to URLs */
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

/**
 * Whether the JWT secret is available for creating user-context tokens.
 * Required for execRpcAsUser — tests that need user-context RPCs skip without it.
 */
export const HAS_JWT_SECRET = !!(process.env.SUPABASE_JWT_SECRET || process.env.QA_JWT_SECRET);

// ─── HTTP API execution layer ───────────────────────────────────────

/**
 * Execute SQL via the run_sql SECURITY DEFINER function over HTTP API.
 */
async function runSqlHttp(sql: string): Promise<any[]> {
  const { data, error } = await qaServiceClient.rpc('run_sql', { sql_query: sql });
  if (error) throw new Error(`run_sql: ${error.message}`);
  if (!data || data === 'ok') return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ result: data }];
  }
}

/**
 * Execute SQL and return a pg.QueryResult-compatible object.
 */
async function execSqlResult(sql: string): Promise<{ rows: any[]; rowCount: number; command: string }> {
  const rows = await runSqlHttp(sql);
  return { rows, rowCount: rows.length, command: sql.trim().split(/\s/)[0].toUpperCase() };
}

/**
 * Parse a pg-style SQL template with backtick interpolation.
 * Handles: INSERT INTO ... VALUES (...) ON CONFLICT ...
 * The pg library accepts SQL strings directly.
 */
function rawSql(strings: TemplateStringsArray, ...values: any[]): string {
  return strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''), '');
}

// ─── pg.Client-compatible wrapper ───────────────────────────────────

/**
 * Creates a pg.Client-compatible object that uses the HTTP API.
 * Supports .connect(), .end(), .query() — all backed by run_sql RPC.
 * Intercepts SET LOCAL role to use run_sql_as_user for role-context queries.
 */
function createHttpClient(defaultRole?: string): any {
  let connected = false;
  let currentRole: string | null = null;
  let currentUserId: string | null = null;

  const client = {
    connect: async () => { connected = true; },
    end: async () => { connected = false; currentRole = null; currentUserId = null; },
    query: async (sqlOrConfig: any, params?: any[]): Promise<any> => {
      let sql: string;
      if (typeof sqlOrConfig === 'string') {
        sql = sqlOrConfig;
      } else if (sqlOrConfig && sqlOrConfig.text) {
        sql = sqlOrConfig.text;
      } else {
        throw new Error('Invalid query argument');
      }

      const upper = sql.trim().toUpperCase();

      // Intercept SET LOCAL role = 'authenticated' -> store role for subsequent queries
      const roleMatch = sql.match(/SET\s+(?:LOCAL\s+)?role\s*=\s*'([^']+)'/i);
      if (roleMatch) {
        currentRole = roleMatch[1];
        // Also set JWT claims if the role is authenticated
        if (currentRole === 'authenticated') {
          // Default to admin user for authenticated queries
          if (!currentUserId) currentUserId = '10000000-0000-0000-0000-000000000001';
          return { rows: [], rowCount: 0, command: 'SET' };
        }
        return { rows: [], rowCount: 0, command: 'SET' };
      }

      // Intercept RESET role
      if (upper.startsWith('RESET ROLE') || upper.startsWith('RESET "ROLE"')) {
        currentRole = null;
        return { rows: [], rowCount: 0, command: 'RESET' };
      }

      // Intercept set_config for JWT claims
      const claimsMatch = sql.match(/set_config\(\s*'request\.jwt\.claims'\s*,\s*'([^']+)'/i);
      if (claimsMatch) {
        try {
          const claims = JSON.parse(claimsMatch[1]);
          if (claims.sub) currentUserId = claims.sub;
        } catch { /* ignore */ }
        return { rows: [], rowCount: 0, command: 'SELECT' };
      }

      // For authenticated role queries, use run_sql_as_user
      if (currentRole === 'authenticated' && currentUserId) {
        try {
          const rows = await runSqlHttp(
            `SELECT * FROM run_sql_as_user('${currentUserId}', ${sqlAsLiteral(sql)})`
          );
          return { rows, rowCount: rows.length, command: upper.split(/\s/)[0] };
        } catch (e: any) {
          throw new Error(`run_sql_as_user: ${e.message}`);
        }
      }

      // Default: use run_sql as postgres
      return execSqlResult(sql);
    },
    on: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
    once: () => {},
    connected: true,
  };

  // If a default role is set, configure it
  if (defaultRole && defaultRole !== 'postgres') {
    currentRole = defaultRole;
  }

  return client;
}

/** Escape a SQL string for use as a literal in a query */
function sqlAsLiteral(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

// ─── Exported functions (backward compatible) ───────────────────────

/**
 * Create a PostgreSQL client that uses the HTTP API internally.
 * Queries run as postgres (bypasses RLS and protect_* triggers).
 */
export function getDbClient(): any {
  return createHttpClient('postgres');
}

/**
 * Create a raw client (no role interception) using HTTP API.
 */
export function getRawDbClient(): any {
  return createHttpClient();
}

/**
 * Execute SQL as postgres (bypasses RLS and triggers) via HTTP API.
 */
export async function execSqlAsAdmin(sql: string): Promise<{ rows: any[]; rowCount: number; command: string }> {
  return execSqlResult(sql);
}

/**
 * Execute SQL (same as execSqlAsAdmin — both use service-role key).
 */
export async function execSql(sql: string): Promise<{ rows: any[]; rowCount: number; command: string }> {
  return execSqlResult(sql);
}

/**
 * Execute multiple SQL statements (semicolon-separated).
 */
export async function execMultiSql(sql: string): Promise<void> {
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await runSqlHttp(stmt);
  }
}

/**
 * Execute an RPC as a specific user with JWT claims.
 * Sets JWT claims via set_config and calls the RPC in a SINGLE SQL statement
 * to avoid the Supabase pooler resetting claims between function calls.
 */
export async function execRpcAsUser(
  userId: string,
  rpcName: string,
  params: Record<string, any>
): Promise<{ data: any; error: string | null }> {
  // Look up user phone for JWT claims
  let userPhone = '';
  try {
    const rows = await runSqlHttp(`SELECT phone FROM users WHERE id = '${userId}'`);
    if (rows[0]?.phone) userPhone = rows[0].phone;
  } catch { /* user may not exist */ }

  const jwtClaims: Record<string, any> = { sub: userId };
    if (userPhone) jwtClaims.phone = userPhone;
    const claimsStr = JSON.stringify(jwtClaims).replace(/'/g, "''");

  const paramStr = Object.entries(params)
    .map(([k, v]) => {
      if (typeof v === 'string') return `${k} := '${v.replace(/'/g, "''")}'`;
      if (v === null) return `${k} := NULL`;
      if (typeof v === 'object') return `${k} := '${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
      return `${k} := ${v}`;
    })
    .join(', ');

  // Set JWT claims AND call RPC in a single DO block to avoid pooler claim reset
  const sql = `DO $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '${claimsStr}', false);
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) INTO r
    FROM (SELECT * FROM ${rpcName}(${paramStr})) t;
  RAISE NOTICE '%', r::text;
END;$$;`;

  try {
    // The DO block returns notices, not rows. We need a different approach.
    // Use a wrapper function that sets claims and calls RPC in same statement.
    const sql2 = `SELECT * FROM exec_rpc_as_user('${userId}'::uuid, '${rpcName}', '${JSON.stringify(params).replace(/'/g, "''")}'::jsonb)`;
    const rows = await runSqlHttp(sql2);
    if (rows.length === 0) return { data: null, error: null };
    const row = rows[0];
    if (row && typeof row === 'object') {
      if (row.error) return { data: null, error: row.error };
      const keys = Object.keys(row);
      if (keys.length === 1 && typeof row[keys[0]] === 'object' && row[keys[0]] !== null) {
        return { data: row[keys[0]], error: null };
      }
    }
    return { data: row, error: null };
  } catch (e: any) {
    return { data: null, error: e.message };
  }
}

/**
 * Disable all triggers on all tables.
 */
export async function disableTriggers(_client?: any): Promise<void> {
  const tables = await runSqlHttp("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  for (const row of tables) {
    try {
      await runSqlHttp(`ALTER TABLE ${row.tablename} DISABLE TRIGGER ALL`);
    } catch { /* some tables may not have triggers */ }
  }
}

/**
 * Re-enable all triggers on all tables.
 */
export async function enableTriggers(_client?: any): Promise<void> {
  const tables = await runSqlHttp("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  for (const row of tables) {
    try {
      await runSqlHttp(`ALTER TABLE ${row.tablename} ENABLE TRIGGER ALL`);
    } catch { /* some tables may not have triggers */ }
  }
}

/** No-op alias for backward compatibility */
export async function asPostgres(_client?: any): Promise<void> {}

/** Set role to authenticated — no-op with HTTP API (role set per-query) */
export async function asAuthenticated(_client?: any): Promise<void> {}
