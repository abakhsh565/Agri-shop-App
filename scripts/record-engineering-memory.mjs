/**
 * Record the verified tenant/authorization foundation learnings in Engineering
 * Memory, and supersede the earlier incorrect creditRequest root cause.
 *
 * Engineering Memory is the system that is supposed to stop the same class of
 * defect recurring, so a wrong entry in it is a real liability: the previous
 * entry blamed PgBouncer pooler visibility, which would have led the next
 * engineer to "fix" the test runner instead of the shared-fixture teardown that
 * actually caused the intermittent failure.
 *
 * Idempotent: re-running updates the entry with the same title instead of
 * duplicating it. QA project only.
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
  console.error('Refusing to run: not the QA project.');
  process.exit(1);
}

const pool = new pg.Pool({
  host: env.QA_DB_HOST, port: 6543, database: 'postgres',
  user: env.QA_DB_USER, password: env.QA_DB_PASS,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});

const MEMORIES = [
  {
    category: 'failure_pattern',
    title: 'creditRequest Intermittent Failure — Shared Fixture Teardown (not pooler)',
    component: 'tests/integration/creditRequest.test.ts, tests/setup/fixtures.ts',
    description:
      'creditRequest failed intermittently ONLY in the full parallel suite. The earlier recorded cause (PgBouncer pooler visibility) was WRONG. Real cause: two shared-fixture defects. (1) cleanupTestData() ran in afterAll and deleted the SHARED QA fixture users/customers/products/company, so a suite that finished wiped fixtures another parallel suite was still using (CUSTOMER_NOT_FOUND right after setupAllFixtures). (2) creditRequest beforeAll ran an UNSCOPED DELETE FROM credit_limit_requests, deleting rows a parallel suite had created, producing "Request not found or already processed" on approve. Fixes: teardown no longer deletes shared fixtures (setupAllFixtures is idempotent and re-seeds deterministically), and the suite clears only its own customer. Reproduced 3x with the interfering suites after the fix: 29/29, 29/29, 29/29; full suite 336/336.',
    evidence: {
      wrongCause: 'PgBouncer pooler visibility (superseded)',
      isolatedRuns: '6/6 PASS, three separate runs',
      afterFix: ['29/29', '29/29', '29/29', '336/336'],
      failureMessages: ['CUSTOMER_NOT_FOUND', 'Request not found or already processed'],
    },
  },
  {
    category: 'failure_pattern',
    title: 'RLS Enabled With Zero Policies Silently Breaks the App',
    component: 'shops, business_settings, reminder_configs/occurrences/logs, credit_limit_requests, customer_crops',
    description:
      'Tables had row level security ENABLED with ZERO policies. For the authenticated role that is a silent deny-all: reads return 0 rows and writes fail with "new row violates row-level security policy". Because the app ignores write errors and renders empty states, the failure looked like missing data rather than a defect. Evidence: shops had 1 row but returned 0 to the app; reminder_configs INSERT was rejected; Roles & Access showed "0 employees" for a role with 5 memberships because memberships only exposed the caller own row. Detection: a table with relrowsecurity = true and no row in pg_policies is ALWAYS a defect unless the table is platform/Engineering-OS internal. Guarded permanently by tests/integration/rbacInvariants.test.ts invariant A.',
    evidence: {
      detectionQuery: 'pg_class.relrowsecurity AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = relname)',
      observed: 'shops 1 row -> 0 visible; reminder_configs insert rejected; role employee count 0 vs 5 memberships',
      fixedIn: '0115, 0117, 0122',
    },
  },
  {
    category: 'failure_pattern',
    title: 'Frontend/DB Contract Drift in the Reminder Subsystem',
    component: 'reminder_configs, reminder_occurrences, reminder_logs',
    description:
      'The application read and wrote columns that did not exist in the database, so the reminder feature could never persist or load: reminder_occurrences was written with customer_id/occurrence_number/stage/crop_name/tone (none existed), reminder_configs was filtered and inserted by customer_id plus 9 other columns (none existed), and Reminder History ordered reminder_logs by sent_at (did not exist). All three surfaced as live browser 400 responses. Detection rule: when a UI read/write fails with 400 or a missing-column error, treat the DB contract as the authority and reconcile additively rather than patching the screen.',
    evidence: {
      liveErrors: [
        'GET reminder_configs?select=*&customer_id=eq. -> 400',
        'GET reminder_logs?order=sent_at.desc -> 400',
      ],
      fixedIn: '0116, 0122, 0123',
      afterFix: 'all reminder reads 200 in the same authenticated browser session',
    },
  },
  {
    category: 'prevention_rule',
    title: 'Tenant-owned operations must resolve context from membership, never from parameters',
    component: 'authorize_business_action, all tenant write RPCs',
    description:
      'Every tenant-owned operation must resolve identity -> active membership -> tenant -> effective permission -> branch from the authenticated JWT, through ONE authoritative guard. Before this rule, writes trusted caller-supplied actorId/adminId/shop_id parameters, several had no authorization at all, 23 write RPCs were executable by anon, approve_shop_request could provision a tenant anonymously, and update_admin_profile let any user rename another user by passing their id. A caller-supplied id is never identity. Tenant context must never be trusted from the frontend. Branch scope is enforced at the data layer by a trigger so a new code path cannot forget it. Guarded permanently by invariant E plus the RBAC suites.',
    evidence: {
      guardedWriteRpcs: '36 of 43 carry a guard; the rest are internal/trigger helpers/admin-gated and allowlisted',
      anonWrites: '23 -> 1 (insert_shop_request, the registration path)',
      tests: 'rbacEnforcement 17, rbacFoundation 4, rbacLifecycleAndSessions 12, tenantIsolationOps 9, branchScopeEnforcement 9, rbacInvariants 5',
      detectionCommand: 'node scripts/rbac-evidence.mjs',
    },
  },
  {
    category: 'technical_decision',
    title: 'Branch ownership lives on the record; scope is enforced by trigger + RESTRICTIVE policies',
    component: 'sales, purchases, returns, inventory_movements, *_payments, stock_adjustments',
    description:
      'memberships.branch_scope existed but NO business table carried a branch, so branch scope could only be checked against a parameter while every record looked like it belonged to every branch. Decision: each operational record is owned by exactly one branch (the branch the acting member operated in), stamped by a BEFORE INSERT/UPDATE trigger that also REJECTS a branch outside the scope, with RESTRICTIVE SELECT policies for branch-limited readers. A NULL scope means all branches. Trusted non-JWT contexts (direct owner connection, service_role) are still restricted by scope when one exists but may stamp the tenant default branch. The trigger stamps ownership and restricts; it never grants access, so it complements rather than replaces authorization. Rows written before this decision were converged to the tenant default branch.',
    evidence: {
      tables: 7, triggers: 7, recordsWithoutBranch: 0,
      tests: 'branchScopeEnforcement 9/9 (own-branch stamping, out-of-scope write refused and not persisted, multi-branch allowed, read isolation, cross-tenant refused)',
      fixedIn: '0118, 0119, 0120',
    },
  },
  {
    category: 'failure_pattern',
    title: 'Denormalized display attribution must be stamped at the table, not by each write path',
    component: 'sales, purchases, returns, customer_payments, supplier_payments, payments',
    description:
      'Transactional tables keep a denormalized copy of the party name (sales.customer_name_snapshot, sales.employee_name, sales.voided_by_name, purchases.company_name/recorded_by_name, returns.customer_name/processed_by_name, *_payments.recorded_by_name) so history shows the name at the time of the transaction. The screens read those columns directly (src/stores/salesStore.ts maps customerName: r.customer_name_snapshot with NO fallback), so a NULL renders a blank customer name and "Sold by:" with nothing after it. Evidence showed two distinct causes: (1) sales.customer_name_snapshot only arrived in migration 0102, so every earlier row was NULL - historical records, not test noise; (2) recorded_by_name on purchases and all three payment tables was stamped by NO function at all, so "Recorded by" was permanently blank on those screens while the RPCs resolved the actor and then discarded it. RULE: a denormalized display column must be filled by the table itself, never by each write path remembering to do it. Fix: 0124 backfills every NULL from the foreign key that already knows the answer and installs a declarative BEFORE INSERT/UPDATE trigger (stamp_display_names, spec target:fk:source_table:source_name_col) that only fills NULLs and NEVER overwrites, preserving the historical snapshot semantics. 0125 extends the same trigger to capture the JWT actor when a write omits recorded_by; in a non-JWT/system context it leaves the column NULL rather than inventing an attribution. This is display integrity only and is NOT an authorization mechanism.',
    evidence: {
      observedInBrowser: '/admin/dashboard Recent Sales showed 3 rows with a blank customer name and "Sold by:" empty',
      nullsBefore: 'sales.customer_name_snapshot 5/6, sales.employee_name 5/6, sales.voided_by_name 3/6, purchases.recorded_by_name 2/2',
      nullsAfter: 'sales.customer_name_snapshot 0/6, sales.employee_name 0/6, purchases.company_name 0/2',
      stampedByNoFunction: 'recorded_by_name on purchases, customer_payments, supplier_payments, payments',
      triggerProof: 'insert with NULL names -> customer_name_snapshot and employee_name resolved from FK; a pre-existing name was NOT overwritten (FROZEN-NAME preserved); rolled back with 0 rows left',
      actorProofDirectSql: 'simulated JWT sub -> purchases/customer_payments recorded_by = that user AND recorded_by_name resolved; with no JWT the actor stays NULL',
      actorProofRealPath: 'signed in via Supabase Auth, create_purchase through PostgREST -> DB row recorded_by = JWT sub (=== users.id) and recorded_by_name = user name; probe row deleted afterwards',
      unrecoverable: '2 historical purchases have recorded_by = NULL; the actor cannot be known retroactively and was deliberately left NULL',
      fixedIn: '0124, 0125',
    },
  },
  {
    category: 'failure_pattern',
    title: 'Empty-but-set request.jwt.claims throws 22P02 and cascades through authorization helpers',
    component: 'app_current_user_id, get_current_membership, get_current_tenant_id, is_authorized_for_tenant, resolve_shop_and_actor, _test_check_auth',
    description:
      'Authorization helpers parsed the claims GUC as current_setting(\'request.jwt.claims\', true)::json. Postgres returns an EMPTY STRING (not NULL) when that GUC is set to empty - e.g. set_config(\'request.jwt.claims\', NULL, ...), which the test/simulation helpers exec_rpc_as_user and run_sql_as_user do - and \'\'::json raises ERROR: invalid input syntax for type json (SQLSTATE 22P02). Because the helpers are nested, the failure cascades: app_current_user_id() -> current_branch_scope() -> enforce_branch_scope(), so an affected write aborts with a JSON syntax error instead of being denied cleanly or succeeding. RULE: absence of a claim must be represented as NULL, never as a parse attempt. Fix: NULLIF(current_setting(\'request.jwt.claims\', true), \'\') before the ::json cast in the six unguarded parsers. get_authenticated_user_id and record_incident were already safe (BEGIN/EXCEPTION WHEN OTHERS) and is_trusted_context already handled the empty case before parsing, so they were deliberately left unchanged. Authorization decisions were not altered - only how "no claim" is represented.',
    evidence: {
      observed: 'BEGIN; SELECT set_config(\'request.jwt.claims\', NULL, true); SELECT current_setting(\'request.jwt.claims\', true) -> \'\' (not NULL)',
      failure: 'INSERT INTO purchases -> ERROR 22P02, SQL function app_current_user_id, from current_branch_scope, from enforce_branch_scope',
      afterFix: 'same insert -> app_current_user_id NULL, tenant NULL, membership NULL, is_authorized_for_tenant false, and the write proceeds with recorded_by left NULL',
      parsersFound: 11,
      parsersChanged: 6,
      deliberatelyUnchanged: 'get_authenticated_user_id, record_incident (exception-guarded), is_trusted_context (CASE handles empty)',
      fixedIn: '0126',
    },
  },
  {
    category: 'failure_pattern',
    title: 'Financial figures must come from recorded snapshots, never a client-side lookup of filtered rows',
    component: 'sale_items.cogs_amount, src/stores/productsStore.ts, src/stores/salesStore.ts, src/pages/admin/dashboard/AdminDashboardPage.tsx',
    description:
      'The admin dashboard showed GROSS PROFIT Rs. 12,000 while the database said Rs. 6,000. The client built its cost lookup from the products store, which loads only ACTIVE rows (productsStore.ts: .eq("is_active", true)), and then defaulted a missing cost to zero: (unitPrice - (variantCost.get(variantId) ?? 0)) * qty. So every item whose product had since been deactivated silently cost nothing and inflated profit. The delta proved it exactly: 12,000 - 6,000 = 6,000 = 3000 x 2, the full COGS of the single item on the inactive product, with no other explanation fitting. Two structural traps compounded it: (1) the authoritative column sale_items.cogs_amount existed as NOT NULL DEFAULT 0 and NO function wrote it, so every row silently meant "cost is zero" while migration 0012 had intended it as v_cost * v_qty with a returned cogsTotal; (2) deriving a financial total from a list that is filtered by a business flag (is_active) is unsound in principle, because the filter is about what to SELL, not about history. RULES: a financial figure must be computed from a snapshot recorded at transaction time, because today cost_price is not yesterday cost; and a lookup that can miss must never fall back to a value that flatters the number (0 cost = maximum profit). Fix: 0127 backfills cogs_amount as LINE COGS (cost x qty - NOT the unit cost; an earlier pass of the same migration used the unit cost and was self-corrected with IS DISTINCT FROM), makes the column honest (NULL = not recorded, 0 = genuinely free) and stamps it on insert via a dedicated stamp_line_cogs() trigger that only fills NULL. salesStore maps cogsAmount and the dashboard now computes revenue - recorded COGS, using the variant lookup only as a fallback for pre-snapshot rows.',
    evidence: {
      observedInBrowser: '/admin/dashboard filter=All -> GROSS PROFIT Rs. 12,000',
      dbTruth: 'sum(line_total - cogs) over non-voided items = 6000.00',
      deltaExplained: '12000 - 6000 = 6000 = cost 3000 x qty 2 for DST-SALE-001 whose product is_active = false',
      columnTrap: 'sale_items.cogs_amount was NOT NULL DEFAULT 0 with 5 rows, 0 NULLs, SUM 0.00, and no writing function',
      semanticSource: 'migration 0012: cogs_amount = v_cost * v_qty and cogsTotal accumulates v_cost * v_qty (line COGS)',
      afterFix: 'per-item cogs 2400/2800/6000 (qty x cost); non-voided GP 6000.00; browser re-check shows Rs. 6,000',
      triggerProof: 'insert without cogs, qty 3 on a variant costing 800 -> cogs_amount 2400 (rolled back)',
      regression: '337/337 tests, tsc clean, build passes',
      fixedIn: '0127 + salesStore/AdminDashboardPage',
    },
  },
  {
    category: 'prevention_rule',
    title: 'E2E auth fixtures drift when the app moves to membership-based authorization',
    component: 'tests/e2e/helpers.ts (injectAdminAuth), Playwright specs injecting localStorage auth',
    description:
      'Several Playwright specs inject identity straight into localStorage (agri_auth) instead of logging in, because the old app authorized purely from client state. Once the backend started authorizing from the JWT and the admin routes became PermissionGuard-protected, two distinct drifts appeared. First, with no Supabase session at all, backend-authorized RPCs were refused (NOT_AUTHENTICATED), so specs failed for reasons unrelated to the behaviour under test. Second, even with a real session, the injected fixture user carried only a legacy role field and no tenantId / membershipRole / permissions; getCurrentPermissions() returns [] for a non-owner and PermissionGuard then redirects deep /admin/* paths to the dashboard, which surfaces as a mystery timeout (for example waiting for input[type=file] that never renders) rather than an authorization error. RULE: a test fixture that fabricates identity must mirror the authoritative membership row, and it must obtain a real session; a fixture that predates the authorization model keeps passing only on client-only checks and fails confusingly once enforcement is real. Fix: injectAdminAuth now signs in through the real login path (dev OTP) and then persists a user object matching the QA admin membership (tenantId, membershipRole owner, permissions [*]). Failures must be diagnosed from the fixtures whenever a suite that used to pass starts timing out on rendering.',
    evidence: {
      baselineBefore: 'full Playwright run: 44 passed, 14 failed',
      cause1: 'spec headers stated no browser JWT is needed, so RPC-backed specs were unauthenticated after backend enforcement',
      cause2: 'injected user lacked membershipRole/permissions -> PermissionGuard denies /admin/inventory/new and /admin/employees/new and /admin/companies/new; only /employee/* routes rendered',
      membershipTruth: 'QA admin membership row: role owner, status active, tenant 00000000-...-0001',
      afterFix: 'imageSync + crossScreenSync + splitPayment 25/25 passed (splitPayment 2 failures -> 0, crossScreenSync 5 -> 0, imageSync 6 -> 0)'
    },
  },
  {
    category: 'failure_pattern',
    title: 'A cleaned QA database cannot re-provision browser logins by itself (signUp needs email confirmation and is rate-limited)',
    component: 'tests/e2e/helpers.ts (ensureAuthSession), scripts/clean-test-data.mjs, .github/workflows/build-apk.yml',
    description:
      'After clean-test-data.mjs removed the QA fixture auth rows, the whole E2E suite failed from a clean baseline and the symptom was misleading: the login screen showed "Could not start a secure session for this account. Please try again, or ask the shop owner to re-provision your login." and every spec then timed out waiting for a URL change. The app signs in with an email+password derived from the phone and falls back to supabase.auth.signUp; the network trace proves the real sequence — POST /auth/v1/token?grant_type=password returns 400 invalid_credentials, then POST /auth/v1/signup returns 429 over_email_send_rate_limit ("email rate limit exceeded"). signUp therefore cannot self-heal a fresh credential, and neither can a provisioning script that runs before the suite, because the fixture user itself is created inside the suite (setupFixtures). RULE: any identity a test drives through the real login UI must have a confirmed credential provisioned out-of-band (admin API, email_confirm: true) at the moment the fixture is created; do not assume the application can create its own. The shared helper now calls ensureAuthSession(phone) before driving the login, and clean-test-data.mjs was also fixed to stop swallowing delete errors and to delete purchase_items/purchases before products (their FKs had blocked product/variant/company cleanup, leaving a dirty baseline).',
    evidence: {
      symptomBefore: 'actionCenter test 2 timed out 30s in page.waitForURL after OTP; suite fails broadly from a clean DB',
      trace: 'POST /auth/v1/token?grant_type=password -> 400 invalid_credentials; POST /auth/v1/signup -> 429 over_email_send_rate_limit; app logs "Could not establish Supabase Auth session: Invalid login credentials; email rate limit exceeded"',
      afterFix: 'POST /auth/v1/token?grant_type=password -> 200 with JWT sub=10000000-0000-0000-0000-000000000001, flow proceeds to /login/pin-set and the dashboard',
      suiteAfter: 'full Playwright run from a cleaned baseline: 57 passed / 1 failed, where the single failure was the spec\'s own copy assertion ("actions needed" vs "1 action needed") and was replaced with a DB-reconciled assertion',
      cleanupFix: 'clean-test-data.mjs now reports the real FK error instead of hiding it, and the baseline ends at 2 users / 2 auth rows / 2 memberships / 0 business rows'
    },
  },
  {
    category: 'technical_decision',
    title: 'Stock of record is the variant; products.stock_qty is a derived rollup',
    component: 'supabase/migrations/0128_variant_stock_of_record.sql, src/lib/formatters.ts (productLowStockThreshold), sale browse/variant-selector/cart screens, AdminDashboardPage, AdminReportsPage, InventoryAlertsPage',
    description:
      'Inventory had two columns and three competing models. Legacy migrations (0015 flexible units, and every RPC through 0049) treat products.stock_qty as BASE units and deduct qty * unit_size. The current RPCs (create_sale, create_purchase, process_return) mutate product_variants.stock_qty by qty, and adjust_stock documents the intended model in its own comment: "the variant is the authoritative stock level", recomputing the product column as SUM of the active variants. Nothing except adjust_stock ever recomputed that sum, so the product column went stale after every sale/purchase/return, and void_sale — the function the app actually calls — restored products.stock_qty += qty * unit_size while never touching the variant: stock of record stayed permanently reduced and the product column was inflated with a base-unit quantity no other path uses. DECISION (per the product owner: variant-level is the actual inventory): the VARIANT is the stock of record, and products.stock_qty is derived. A single SECURITY DEFINER trigger now keeps the rollup equal to SUM(active variants) for every write path, void_sale restores the variant (honouring quantities already returned), and screens read the variant for availability. RULE: never derive a sellable quantity by dividing a product total by unit_size, and never let a screen compute its own inventory aggregation — use the variant level and the shared threshold helper.',
    evidence: {
      rollupProof: 'inserted variant stock 10 -> products.stock_qty 10 (trigger)',
      saleProof: 'create_sale qty 4 -> variant 6.00 AND product rollup 6.00 (before this change the product column stayed at 10)',
      voidProof: 'void_sale -> variant 10.00, product rollup 10.00, restoredStock 4, void movement row 6.00 -> 10.00; all inside a rolled-back transaction',
      scopeStillOpen: 'the UNIT a variant holds (pack vs base unit) is not settled for the whole app: unit labels such as "Total stock: N kg" still assume base units, so that display question is recorded as a decision, not silently changed'
    },
  },
];

const client = await pool.connect();
try {
  for (const m of MEMORIES) {
    const existing = await client.query(
      'SELECT id FROM engineering_memory WHERE title = $1',
      [m.title]
    );
    let id;
    if (existing.rows.length) {
      id = existing.rows[0].id;
      await client.query(
        `UPDATE engineering_memory SET description = $2, component = $3, evidence = $4,
           confidence = 'verified', status = 'active', updated_at = now() WHERE id = $1`,
        [id, m.description, m.component, JSON.stringify(m.evidence)]
      );
      console.log(`updated  [${m.category}] ${m.title}`);
    } else {
      const ins = await client.query(
        `INSERT INTO engineering_memory (category, title, description, component, confidence, status, evidence, environment)
         VALUES ($1, $2, $3, $4, 'verified', 'active', $5, 'qa') RETURNING id`,
        [m.category, m.title, m.description, m.component, JSON.stringify(m.evidence)]
      );
      id = ins.rows[0].id;
      console.log(`recorded [${m.category}] ${m.title}`);
    }
  }

  // The superseded entry: same table name, wrong cause. Keep the history but stop
  // it from guiding future work.
  const wrong = await client.query(
    `SELECT id FROM engineering_memory
      WHERE title LIKE 'creditRequest%' AND title NOT LIKE '%Shared Fixture%'`
  );
  const right = await client.query(
    `SELECT id FROM engineering_memory WHERE title LIKE 'creditRequest%Shared Fixture%'`
  );
  for (const row of wrong.rows) {
    await client.query(
      `UPDATE engineering_memory SET status = 'superseded', superseded_by = $2, updated_at = now()
        WHERE id = $1`,
      [row.id, right.rows[0]?.id ?? null]
    );
    console.log(`superseded ${row.id} (wrong pooler root cause)`);
  }

  const totals = await client.query(
    `SELECT status, count(*)::int AS c FROM engineering_memory GROUP BY status ORDER BY status`
  );
  console.log('memory by status:', totals.rows.map((r) => `${r.status}=${r.c}`).join(', '));
} finally {
  client.release();
  await pool.end();
}
