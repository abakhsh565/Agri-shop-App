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
import { assertQaProject } from './env-guard';
assertQaProject(QA_URL);

/**
 * QA clients are created LAZILY, on first use — never at module load.
 *
 * WHY. `createClient(url, '')` throws `supabaseKey is required` at construction.
 * These two clients used to be built at import time, so a run without
 * QA_SUPABASE_SERVICE_ROLE / QA_SUPABASE_ANON_KEY died while *importing* the
 * module: the whole gates job failed with that one opaque line, and two unit
 * guards (e2eCleanupOwnership, signalEngine) could not even load, although
 * neither of them opens a connection. The failure also named no variable, so
 * the reader could not tell which secret was missing. Deferring construction
 * to first use keeps the import safe; the first call that actually needs the
 * client throws an error naming the missing variable instead.
 *
 * The proxy forwards every property access to the real client created on first
 * use, so every existing call site (`qaServiceClient.rpc(...)`,
 * `qaServiceClient.auth.admin.createUser(...)`, `qaAnonClient.from(...)`)
 * behaves exactly as before once the keys exist.
 */
function lazyQaClient(kind: 'service' | 'anon'): SupabaseClient {
  let real: SupabaseClient | null = null;
  const create = (): SupabaseClient => {
    if (real) return real;
    const key = kind === 'service' ? QA_SERVICE_ROLE : QA_ANON_KEY;
    if (!key) {
      throw new Error(
        `QA_SUPABASE_${kind === 'service' ? 'SERVICE_ROLE' : 'ANON_KEY'} is not set — the QA client cannot be created. ` +
          `In CI this comes from the repository secret; locally, set it in .env.qa or the environment.`,
      );
    }
    real = createClient(QA_URL, key);
    return real;
  };
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      const target = create();
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Service-role client (bypasses RLS, for test setup/teardown) */
export const qaServiceClient = lazyQaClient('service');

/** Anon client (RLS-enforced, for testing RLS policies) */
export const qaAnonClient = lazyQaClient('anon');

// ─── Direct PG Client (bypasses pooler for fixture setup/teardown) ──────

import { Client } from 'pg';

const QA_DB_HOST = process.env.QA_DB_HOST || '';
const QA_DB_USER = process.env.QA_DB_USER || '';
const QA_DB_PASS = process.env.QA_DB_PASS || '';

let _directClient: Client | null = null;

/**
 * Get a direct PostgreSQL connection (bypasses PgBouncer pooler).
 * This ensures writes are immediately visible to all subsequent queries.
 */
export async function getDirectClient(): Promise<Client> {
  if (_directClient) return _directClient;
  if (!QA_DB_HOST || !QA_DB_USER || !QA_DB_PASS) {
    throw new Error('QA_DB_HOST/QA_DB_USER/QA_DB_PASS not set — cannot create direct PG client');
  }
  _directClient = new Client({
    host: QA_DB_HOST,
    user: QA_DB_USER,
    password: QA_DB_PASS,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await _directClient.connect();
  return _directClient;
}

/**
 * Execute SQL via direct PostgreSQL connection (bypasses pooler).
 * Use for fixture setup/teardown where immediate visibility is required.
 */
/**
 * One pg.Client cannot run two queries at once. Suites run in parallel against
 * this shared connection, and pg says so itself: "Calling client.query() when the
 * client is already executing a query is deprecated" (node --trace-deprecation
 * shows it during a normal run). The rejected call then reached
 * execSqlAsAdmin()'s catch, which falls back to the HTTP pooler — whose
 * visibility is DELAYED — so a fixture write could be invisible to PostgREST for
 * a moment and an authorization check would answer NOT_AUTHORIZED for a member
 * that exists. Queries are therefore queued on the shared client: each caller
 * still awaits its own result, the socket just stops being shared mid-flight.
 */
let _directQueue: Promise<unknown> = Promise.resolve();

export async function execSqlDirect(sql: string): Promise<{ rows: any[]; rowCount: number; command: string }> {
  const client = await getDirectClient();
  const attempt = _directQueue.then(() => client.query(sql));
  // Keep the chain alive whatever this query did, so one rejection cannot block
  // every later query on the connection.
  _directQueue = attempt.then(() => undefined, () => undefined);
  const result = await attempt;
  return { rows: result.rows, rowCount: result.rowCount ?? 0, command: result.command };
}

// ─── Auth-based user context ────────────────────────────────────────

/**
 * Cache of Supabase clients signed in as specific test users.
 * Each client has a real JWT from Supabase Auth.
 */
const authClients = new Map<string, SupabaseClient>();

/**
 * Normalise a phone the same way the application does (src/lib/auth.ts).
 * A Supabase Auth user has exactly ONE email, so tests must derive the same
 * credentials the browser session uses — otherwise the test's private scheme
 * collides with the real session for the same user id.
 */
function normalizeE164(input: string): string {
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0')) return '92' + digits.slice(1);
  if (digits.startsWith('92')) return digits;
  return '92' + digits;
}

/** Same deterministic credentials the app uses for phone → Auth session. */
function phoneToAuthCredentials(phone: string) {
  const e164 = normalizeE164(phone);
  return { email: `user-${e164}@agrishop.auth.local`, password: `AgriShop-${e164}-2026!` };
}

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
  // Use direct PG to bypass pooler visibility issues
  let userPhone = '';
  try {
    const { rows } = await execSqlDirect(`SELECT phone FROM users WHERE id = '${userId}'`);
    if (rows[0]?.phone) userPhone = rows[0].phone;
  } catch { /* user may not exist yet */ }

  const cached = authClients.get(userId);
  if (cached) {
    // Ensure phone matches current users table value
    // If phone changed (e.g., another test modified it), JWT is stale — re-authenticate
    if (userPhone) {
      // Get current auth.users phone (use direct PG for visibility)
      const { rows: authPhoneRows } = await execSqlDirect(`SELECT phone FROM auth.users WHERE id = '${userId}'`);
      const currentAuthPhone = authPhoneRows[0]?.phone || '';
      
      if (currentAuthPhone !== userPhone) {
        // Phone changed — evict cache and re-authenticate with fresh JWT
        authClients.delete(userId);
        return getAuthClient(userId);
      }
    }
    return cached;
  }

  // Derive the SAME credentials the app uses. Without a phone there is no app
  // credential, so fall back to an id-scoped address.
  const appCred = userPhone ? phoneToAuthCredentials(userPhone) : null;
  let email = appCred?.email ?? `qa-test-${userId}@test.local`;
  let password = appCred?.password ?? `QA-test-${userId}-2024!`;

  // A Supabase Auth row has ONE email. If this phone-derived email is already
  // owned by a different, still-live app user, fall back to an id-scoped
  // address; if it is owned by an ORPHAN auth row (its app user was deleted by
  // an earlier run's cleanup) reclaim it, because that row would otherwise make
  // every future run fail with "User not found".
  if (appCred) {
    const { rows: owners } = await execSqlDirect(
      `SELECT id FROM auth.users WHERE email = '${email}' AND id <> '${userId}'`
    );
    for (const owner of owners) {
      const { rows: liveAppUser } = await execSqlDirect(`SELECT id FROM users WHERE id = '${owner.id}'`);
      if (liveAppUser.length > 0) {
        email = `qa-test-${userId}@test.local`;
        password = `QA-test-${userId}-2024!`;
        break;
      }
      await execSqlDirect(`DELETE FROM auth.users WHERE id = '${owner.id}'`);
    }
  }

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

  // Self-heal: an auth row left behind by an earlier run (or by app-side
  // provisioning) may hold a different email/password. Normalise it so sign-in
  // with the deterministic credentials always succeeds for this user id.
  const { error: repairError } = await qaServiceClient.auth.admin.updateUserById(userId, {
    email,
    password,
    email_confirm: true,
  });
  if (repairError) {
    throw new Error(`Auth credential repair failed for ${userId} (${email}): ${repairError.message}`);
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
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return [{ result: data }];
    }
  }
  // run_sql reports SQL errors IN BAND, as {error}. Returning that as a "row" made a
  // failed fixture write look like data — an assertion on it could then pass for the
  // wrong reason, or fail while blaming the product instead of the fixture.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
    throw new Error(`run_sql: ${String((parsed as { error: unknown }).error)}`);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
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

      // Default: use direct PG connection for immediate visibility
      return execSqlDirect(sql);
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
 * Execute SQL as postgres (bypasses RLS and triggers).
 * Uses direct PG connection to bypass PgBouncer pooler visibility issues.
 * Falls back to HTTP API if direct connection is not available.
 */
export async function execSqlAsAdmin(sql: string): Promise<{ rows: any[]; rowCount: number; command: string }> {
  try {
    return await execSqlDirect(sql);
  } catch {
    return execSqlResult(sql);
  }
}

/**
 * Execute SQL (same as execSqlAsAdmin — both use direct PG).
 */
export async function execSql(sql: string): Promise<{ rows: any[]; rowCount: number; command: string }> {
  return execSqlAsAdmin(sql);
}

/**
 * A built-in role's id in a tenant, resolved by NAME at run time.
 *
 * THE DEFECT THIS PREVENTS. Suites used to hard-code `a0000000-0000-0000-0000-000000000001` as "the
 * seeded Sales Employee role". A built-in role is deletable through the app, and the app says so in
 * its own microcopy (roles.deleteHintBuiltIn): "comes with the app... it can be removed — you can
 * create it again whenever you need it." When that happens, `delete_role` (0183) clears
 * `memberships.role_id` for everyone who was on the role, and the fixed id is then either gone or —
 * because `roles.id` is ONE global key, not one per tenant — held by another tenant's role.
 *
 * Observed in QA: `a0000000-…-0001` was deleted in the demo tenant on 2026-10-04 (audit:
 * { revokedFrom: 2, wasSystemRole: true }) and recreated under a new id, while the old id stayed in
 * use by the tenant the write lanes register through. Four suites kept assigning an id that no longer
 * belonged to the tenant they act in.
 *
 * (tenant_id, name) is the identity the product actually guarantees, so that is what suites resolve.
 */
/**
 * The branch a tenant's work happens in, created if the tenant has none.
 *
 * THE DEFECT THIS PREVENTS. 0188's `authorize_business_action` resolves the branch an action happens
 * in — `COALESCE(p_branch_id, current_branch_id())` — and refuses with "NOT_AUTHORIZED: branch access
 * denied" when that branch is NULL or belongs to another tenant. `current_branch_id()` only resolves
 * inside the ACTIVE shop, so a tenant created as a bare `shops` row (as several suites do) has no
 * branch to act in and every RPC it attempts is refused. That is the intended contract — a branch is
 * not its tenant — so a suite that needs a tenant to act must give it a branch, as the app's own
 * registration flow does.
 */
export async function ensureTenantBranch(tenantId: string, name = 'Main Branch'): Promise<string> {
  const existing = await execSqlAsAdmin(
    `SELECT id FROM branches WHERE tenant_id = '${tenantId}' AND is_active = true ORDER BY is_default DESC, created_at LIMIT 1`
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const created = await execSqlAsAdmin(
    `INSERT INTO branches (tenant_id, name, is_default, is_active) VALUES ('${tenantId}', '${name}', true, true) RETURNING id`
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error(`ensureTenantBranch: could not create a branch for tenant ${tenantId}`);
  return id;
}

/**
 * Select the branch an account is working in, through the app's own RPC.
 *
 * 0188's `set_active_branch` writes `user_active_shops`, which is what `current_shop_id()` and
 * `current_branch_id()` read. Setting this is what "opening a branch" means in the product, so a suite
 * that acts in a tenant must do it rather than assuming the database will guess.
 */
export async function setActiveBranchAsUser(userId: string, branchId: string): Promise<void> {
  const res = await execRpcAsUser(userId, 'set_active_branch', { p_branch_id: branchId });
  if (res.error) throw new Error(`setActiveBranchAsUser(${userId}, ${branchId}): ${res.error}`);
}

/**
 * Give a membership the branch scope the app's own invitation path writes.
 *
 * 0190's `create_employee_core` sets `branch_scope := ARRAY[current_branch_id()]` when the payload
 * carries no explicit scope, because 0188 denies a non-owner every action whose branch is not inside
 * the membership's scope (NULL scope resolves to '{}'). An employee inserted by direct SQL therefore
 * has no scope and is refused everything — realistic only if the product behaved that way, which it
 * does not.
 */
export async function setMembershipBranchScope(
  userId: string,
  tenantId: string,
  branchIds: string[]
): Promise<void> {
  const arr = branchIds.map((b) => `'${b}'::uuid`).join(', ');
  const r = await execSqlAsAdmin(
    `UPDATE memberships SET branch_scope = ARRAY[${arr}], updated_at = now()
      WHERE user_id = '${userId}' AND tenant_id = '${tenantId}' RETURNING id`
  );
  if (!r.rows[0]?.id) {
    throw new Error(`setMembershipBranchScope: no membership for ${userId} in ${tenantId}`);
  }
}

export async function roleIdByName(tenantId: string, name: string): Promise<string> {
  const r = await execSqlAsAdmin(
    `SELECT id FROM roles WHERE tenant_id = '${tenantId}' AND name = '${name}'`
  );
  const id = r.rows[0]?.id;
  if (!id) {
    throw new Error(
      `roleIdByName: tenant ${tenantId} has no role named "${name}". The built-in roles are the "${name}" ` +
        `role 0107 seeds; if an owner deleted it, restore it (node scripts/dev/qa-restore-canonical-roles.mjs).`
    );
  }
  return id;
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
  // Max retries for pooler visibility issues
  const maxPoolerRetries = 3;
  for (let attempt = 0; attempt <= maxPoolerRetries; attempt++) {
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
        // If FK constraint violation or pooler visibility issue, retry after delay
        if (attempt < maxPoolerRetries && (
          error.message?.includes('violates foreign key') ||
          error.message?.includes('does not exist')
        )) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        return { data: null, error: error.message };
      }
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }
  return { data: null, error: 'max retries exceeded' };
}

/**
 * Accept a pending invitation the way the app does since 0286.
 *
 * 0286 made `complete_member_onboarding()` a deliberate no-op (it returns
 * `activated: 0` always) and replaced it with `accept_my_invitation
 * (p_membership_id)` — one invitation, accepted by its own invitee. The
 * invitation id is the invitation itself; the app reads it from
 * `get_my_invitations()`, the test reads the same pending row directly.
 * Returns the accepted membership id, so a caller can prove a second accept
 * finds no pending invitation (INVITATION_NOT_FOUND).
 */
export async function acceptInvitationAsUser(userId: string): Promise<string> {
  const pending = await execSqlAsAdmin(
    `SELECT id FROM memberships WHERE user_id = '${userId}' AND status = 'pending'`
  );
  const membershipId = pending.rows[0]?.id as string | undefined;
  if (!membershipId) {
    throw new Error(`acceptInvitationAsUser: no pending invitation for ${userId}`);
  }
  const res = await execRpcAsUser(userId, 'accept_my_invitation', { p_membership_id: membershipId });
  if (res.error) {
    throw new Error(`acceptInvitationAsUser(${userId}): ${res.error}`);
  }
  if (res.data?.ok !== true) {
    throw new Error(`acceptInvitationAsUser(${userId}): accept_my_invitation did not return ok`);
  }
  const after = await execSqlAsAdmin(
    `SELECT status FROM memberships WHERE id = '${membershipId}'`
  );
  if (after.rows[0]?.status !== 'active') {
    throw new Error(
      `acceptInvitationAsUser(${userId}): membership ${membershipId} is ${after.rows[0]?.status ?? 'missing'}, not active`
    );
  }
  return membershipId;
}

/**
 * Read a table as a specific user through PostgREST + RLS.
 * Used to prove tenant isolation at the real client path (not service-role SQL).
 */
export async function selectAsUser(
  userId: string,
  table: string,
  columns = '*',
  filters: Record<string, string> = {}
): Promise<{ data: any[] | null; error: string | null }> {
  try {
    const client = await getAuthClient(userId);
    let query = client.from(table).select(columns);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query;
    return { data: (data as any[]) ?? null, error: error?.message ?? null };
  } catch (e: any) {
    return { data: null, error: e.message };
  }
}

/**
 * INSERT a row as a specific user through PostgREST, so RLS policies and column
 * defaults (`shop_id DEFAULT current_shop_id()`) are exercised for real.
 */
export async function insertAsUser(
  userId: string,
  table: string,
  row: Record<string, any>
): Promise<{ data: any[] | null; error: string | null }> {
  try {
    const client = await getAuthClient(userId);
    const { data, error } = await client.from(table).insert(row).select('*');
    return { data: (data as any[]) ?? null, error: error?.message ?? null };
  } catch (e: any) {
    return { data: null, error: e.message };
  }
}

/**
 * UPDATE rows as a specific user through PostgREST, so the UPDATE policies are
 * exercised for real (an UPDATE that RLS refuses matches zero rows rather than
 * erroring, which is exactly why the caller must read the row back afterwards).
 */
export async function updateAsUser(
  userId: string,
  table: string,
  patch: Record<string, any>,
  match: Record<string, any>
): Promise<{ data: any[] | null; error: string | null }> {
  try {
    const client = await getAuthClient(userId);
    let query = client.from(table).update(patch);
    for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
    const { data, error } = await query.select('*');
    return { data: (data as any[]) ?? null, error: error?.message ?? null };
  } catch (e: any) {
    return { data: null, error: e.message };
  }
}

/** DELETE rows as a specific user through PostgREST (RLS enforced). */
export async function deleteAsUser(
  userId: string,
  table: string,
  column: string,
  value: string
): Promise<{ error: string | null }> {
  try {
    const client = await getAuthClient(userId);
    const { error } = await client.from(table).delete().eq(column, value);
    return { error: error?.message ?? null };
  } catch (e: any) {
    return { error: e.message };
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
