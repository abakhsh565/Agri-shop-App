/**
 * QA Database Client
 *
 * Uses the Supabase HTTP API for all SQL operations.
 * Uses Supabase Auth for user-context testing (real JWT tokens).
 *
 * Architecture:
 * - SQL execution: run_sql SECURITY DEFINER function over HTTP API
 * - User-context RPCs: Supabase Auth → real JWT → PostgREST → RPC
 * - This avoids IPv6 DNS issues on GitHub Actions AND pooler session-reset issues
 *
 * Credentials are loaded from .env.qa or environment variables.
 * NEVER connects to production.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

// ── Environment Guard ────────────────────────────────────────
// Prevents tests from accidentally running against production.
const QA_PROJECT_ID = 'bpybjrjenwccowvtrevu';
const _extractedId = QA_URL.match(/\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
if (_extractedId && _extractedId !== QA_PROJECT_ID) {
  throw new Error(
    `[ENVIRONMENT MISMATCH] Tests must run against QA project (${QA_PROJECT_ID}). ` +
    `Connected to: ${_extractedId} (${QA_URL}). ` +
    `Set QA_SUPABASE_URL to the correct QA project.`
  );
}
console.log(`[EnvGuard] Test environment: ${_extractedId} (${QA_URL})`);

/** Service-role client (bypasses RLS, for test setup/teardown) */
export const qaServiceClient = createClient(QA_URL, QA_SERVICE_ROLE);

/** Anon client (RLS-enforced, for testing RLS policies) */
export const qaAnonClient = createClient(QA_URL, QA_ANON_KEY);

// ─── Auth-based user context ────────────────────────────────────────

/**
 * Cache of Supabase clients signed in as specific test users.
 * Each client has a real JWT from Supabase Auth.
 */
const authClients = new Map<string, SupabaseClient>();

/**
 * Get or create a Supabase client authenticated as a specific user.
 *
 * Flow:
 * 1. Create a Supabase Auth user with UUID matching the `users` table entry
 * 2. Sign in with email/password to get a real JWT
 * 3. Return the authenticated client for RPC calls
 *
 * This produces real JWTs that PostgREST validates — no pooler session issues.
 */
async function getAuthClient(userId: string): Promise<SupabaseClient> {
  // Look up user's phone from the users table (needed for both cached and new clients)
  let userPhone = '';
  try {
    const rows = await runSqlHttp(`SELECT phone FROM users WHERE id = '${userId}'`);
    if (rows[0]?.phone) userPhone = rows[0].phone;
  } catch { /* user may not exist yet */ }

  const cached = authClients.get(userId);
  if (cached) {
    // Ensure phone matches current users table value
    // If phone changed (e.g., another test modified it), JWT is stale — re-authenticate
    if (userPhone) {
      // Get current auth.users phone
      const authPhoneRows = await runSqlHttp(`SELECT phone FROM auth.users WHERE id = '${userId}'`);
      const currentAuthPhone = authPhoneRows[0]?.phone || '';
      
      if (currentAuthPhone !== userPhone) {
        // Phone changed — evict cache and re-authenticate with fresh JWT
        authClients.delete(userId);
        return getAuthClient(userId);
      }
    }
    return cached;
  }

  const email = `qa-test-${userId}@test.local`;
  const password = `QA-test-${userId}-2024!`;

  // Create auth user with matching UUID (phone set separately to bypass E.164 validation)
  const { error: createError } = await qaServiceClient.auth.admin.createUser({
    id: userId,
    email,
    password,
    email_confirm: true,
  });
  // Ignore "already exists" errors
  if (createError && !createError.message?.includes('already been registered')) {
    console.warn(`Auth user create warning for ${userId}: ${createError.message}`);
  }

  // Set phone on auth.users directly via SQL (bypasses E.164 validation)
  // get_authenticated_user_id() matches users by phone from auth.users
  if (userPhone) {
    try {
      await runSqlHttp(`UPDATE auth.users SET phone = '${userPhone}' WHERE id = '${userId}' AND (phone IS NULL OR phone != '${userPhone}')`);
    } catch {
      // Retry once
      await runSqlHttp(`UPDATE auth.users SET phone = '${userPhone}' WHERE id = '${userId}'`);
    }
  }

  // Sign in with anon key to get a real JWT
  const client = createClient(QA_URL, QA_ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Auth sign-in failed for ${userId}: ${signInError.message}`);

  authClients.set(userId, client);
  return client;
}

// ─── HTTP API execution layer (SQL via run_sql) ─────────────────────

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

// ─── pg.Client-compatible wrapper ───────────────────────────────────

/**
 * Creates a pg.Client-compatible object that uses the HTTP API.
 * Supports .connect(), .end(), .query() — all backed by run_sql RPC.
 */
function createHttpClient(): any {
  let connected = false;

  const client = {
    connect: async () => { connected = true; },
    end: async () => { connected = false; },
    query: async (sqlOrConfig: any, _params?: any[]): Promise<any> => {
      let sql: string;
      if (typeof sqlOrConfig === 'string') {
        sql = sqlOrConfig;
      } else if (sqlOrConfig && sqlOrConfig.text) {
        sql = sqlOrConfig.text;
      } else {
        throw new Error('Invalid query argument');
      }

      const upper = sql.trim().toUpperCase();

      // Intercept SET LOCAL role — no-op with HTTP API
      const roleMatch = sql.match(/SET\s+(?:LOCAL\s+)?role\s*=\s*'([^']+)'/i);
      if (roleMatch) {
        return { rows: [], rowCount: 0, command: 'SET' };
      }

      // Intercept RESET role
      if (upper.startsWith('RESET ROLE') || upper.startsWith('RESET "ROLE"')) {
        return { rows: [], rowCount: 0, command: 'RESET' };
      }

      // Intercept set_config for JWT claims — no-op with HTTP API
      if (sql.match(/set_config\(\s*'request\.jwt\.claims'/i)) {
        return { rows: [], rowCount: 0, command: 'SELECT' };
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

  return client;
}

// ─── Exported functions ─────────────────────────────────────────────

/**
 * Create a PostgreSQL client that uses the HTTP API internally.
 * Queries run as postgres (bypasses RLS and protect_* triggers).
 */
export function getDbClient(): any {
  return createHttpClient();
}

/**
 * Create a raw client using HTTP API.
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
 * Execute an RPC as a specific user using Supabase Auth.
 *
 * Creates a real JWT via Supabase Auth REST API — no pooler session issues.
 * PostgREST validates the JWT and sets request.jwt.claims automatically.
 * The SECURITY DEFINER RPC then sees the correct user identity.
 */
export async function execRpcAsUser(
  userId: string,
  rpcName: string,
  params: Record<string, any>,
  _retry = true
): Promise<{ data: any; error: string | null }> {
  try {
    const client = await getAuthClient(userId);

    // Convert parameters for Supabase JS client
    const rpcParams: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') {
        try {
          rpcParams[k] = JSON.parse(v);
        } catch {
          rpcParams[k] = v;
        }
      } else if (v === null || v === undefined) {
        rpcParams[k] = null;
      } else {
        rpcParams[k] = v;
      }
    }

    const { data, error } = await client.rpc(rpcName, rpcParams);
    if (error) {
      // If NOT_AUTHENTICATED, the JWT may be stale — evict and retry once
      if (_retry && error.message?.includes('NOT_AUTHENTICATED')) {
        authClients.delete(userId);
        return execRpcAsUser(userId, rpcName, params, false);
      }
      return { data: null, error: error.message };
    }
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e.message };
  }
}

/**
 * Execute a query as a specific user via the _test_check_auth helper function.
 * Returns { user_id, is_admin, phone } for the given user.
 * Used by authorization model verification tests.
 */
export async function checkAuthAsUser(
  userId: string
): Promise<{ user_id: string | null; is_admin: boolean | null; phone: string | null }> {
  try {
    const client = await getAuthClient(userId);
    const { data, error } = await client.rpc('_test_check_auth');
    if (error) throw new Error(error.message);
    if (data && data.length > 0) {
      return data[0];
    }
    return { user_id: null, is_admin: null, phone: null };
  } catch {
    return { user_id: null, is_admin: null, phone: null };
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

/**
 * Invalidate all cached auth clients.
 * Forces re-authentication on next execRpcAsUser call.
 * Use when other tests may have modified user data that affects JWT validity.
 */
export function invalidateAuthCache(): void {
  authClients.clear();
}
