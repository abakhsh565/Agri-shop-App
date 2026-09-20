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
  {
    category: 'prevention_rule',
    title: 'Shop-owner screens must speak business language, and the users list is not the membership',
    component: 'src/pages/admin/employees/*, src/pages/admin/settings/RolesAccessPage.tsx, src/lib/permissionLabels.ts, src/lib/i18n.ts',
    description:
      'The employee/access screens shipped internal RBAC vocabulary to the shop owner: Permission counts, Effective permissions, Employee exceptions, Inherited from role, Reset to Role Defaults, Branch scope, Access profile, Role template — and the employee detail asked the same question twice (a legacy Owner/Admin/Employee chip next to the real role profile). Two hard facts came out of fixing it. (1) employeesStore.load() maps the users table only, and users has no membership_role column, so emp.membershipRole is ALWAYS undefined for listed employees: any UI branch on it is wrong. That is what made the simplified list print an Admin chip on every row; the authoritative membership role is what get_employee_access() returns, and isOriginalOwner is the reliable client-side owner flag. (2) permissions.action is not a closed verb set (it contains supplier), so rendering a raw action or code.split fallback leaks tokens like "supplier" into the UI. RULE: owner-facing access copy comes from one shared label module (permissionLabels + area./action. i18n keys, EN and UR), the access a screen shows must be the employee role rows read back from the database, advanced configuration is progressive disclosure behind a single Customize access action, and no screen may branch on membership fields the users list does not carry. Verified by tests/e2e/accessUx.spec.ts (5/5): areas shown for a role equal role_permissions modules, a created employee gets users + membership(role_id, status, branch_scope), Customize access stores is_override rows and Use role access only removes them.',
    evidence: {
      bugFound: 'list chip printed Admin on all four QA employees because emp.membershipRole was undefined and the ternary fell through to the admin label',
      dbTruth: 'memberships: Shop Owner owner, Sales Employee employee, QA Admin owner, QA Employee employee | templates: Sales Employee / Inventory Clerk',
      copyFix: 'employee detail now reads Role / Can work at / Access / Customize access, and the Urdu legend renders کردار سے / صرف اس ملازم کے لیے / اس ملازم کے لیے بند',
      reconciliation: 'Sales Manager role shown on screen = role_permissions modules customers, inventory, products, reports, returns, sales (exact set equality asserted in the spec)',
      regression: 'accessUx 5/5, Vitest 337/337, tsc clean, production build passes, QA baseline back to 4 users / 0 overrides'
    },
  },
  {
    category: 'failure_pattern',
    title: 'The device PIN gate has two different routes, and a substring check silently breaks E2E login',
    component: 'tests/e2e/accessUx.spec.ts (login helper), src/pages/auth/SplashPage.tsx, src/lib/pinLock.ts',
    description:
      'A new spec failed at login with a bare 30s navigation timeout. The cause was the helper, not the product: it treated "URL contains /login/pin" as the returning-user gate, but /login/pin-set contains that substring too. A fresh browser context has no device PIN, so SplashPage routes to /login/pin-set, where entering the PIN once only SETS it and the screen then asks for confirmation — the helper waited for a dashboard that could never appear. The same substring trap affects any check on localStorage keys such as agri_pin_<userId>. Note the two gates are genuinely different flows: /login/pin-set needs the PIN twice (set then confirm), /login/pin needs it once, and a full page load only reaches either when the store is empty at first paint. Verified behaviour after the fix: OTP verify -> /login/pin-set -> set+confirm 4321 -> /admin/dashboard, with agri_pin_<userId> present afterwards and deep links (for example /admin/employees/new) loading without re-locking.',
    evidence: {
      before: 'accessUx test 1 failed: waiting for navigation until "load" at the PIN branch, tests 2-5 did not run',
      diagnostic: 'DIAG after-otp url: /login/pin-set | after-pin url: /admin/dashboard | pin keys: ["agri_pin_bfb26cc6-b32c-4d8f-a0b9-ac69caa1e483"] | deep-load url: /admin/employees/new',
      afterFix: 'accessUx 5/5 passed in 1.0m'
    },
  },
  {
    category: 'failure_pattern',
    title: 'QA cleanup was deleting the Engineering Memory table itself',
    component: 'scripts/clean-test-data.mjs, tests/setup/global-teardown.ts, engineering_memory',
    description:
      'The QA data cleaner ran DELETE FROM engineering_memory as one of its tables, so every cleanup (and every post-suite tidy-up) silently destroyed the durable Engineering OS knowledge base: after a full Playwright run and one clean-test-data run the table held 0 rows even though 13 verified findings had just been recorded. Durable knowledge is not test data and must never be in a test-cleanup list; the vitest global teardown already omitted it, only the npm cleaner touched it. Fixed by removing engineering_memory from the cleaner with an explanatory comment, then re-recording the memories, and the recorder prints the active total so a wipe is visible in its output. RULE: a cleanup script may only delete data the tests created; anything that documents the system is out of bounds.',
    evidence: {
      symptom: 'engineering_memory: 0 rows after node scripts/clean-test-data.mjs (13 memories missing)',
      cause: "clean-test-data.mjs table list contained 'engineering_memory'",
      afterFix: 'node scripts/record-engineering-memory.mjs -> recorded 13 entries; memory by status: active=13'
    },
  },
  {
    category: 'failure_pattern',
    title: 'A regex "no hardcoded English" gate cannot see four shapes of shipped English',
    component: 'tests/unit/i18nCoverage.test.ts, src/pages/admin/more/MoreMenuPage.tsx, src/components/admin/ObservationBotPanel.tsx, src/lib/i18n.ts',
    description:
      'The EN/UR gate reported clean while the Urdu app still shipped English. Driving every real route in Urdu and reading the DOM found (1) single-quoted calls: ObservationBotPanel used t(\'overview\') and 11 more, which a t("...")-only scan cannot match, so the whole panel fell back to its English literals; (2) keys referenced indirectly as labelKey: "admin.observationBot" in a config array, where the key did not exist at all and the owner\'s More menu printed the raw key text; (3) JSX text containing an expression or parentheses, e.g. "Credit Limit (Optional)", "Stock ({baseUnit})", "Actual inventory in {baseUnit}. Sellable units consume from this pool."; (4) one-sided ternaries and JSX expression literals, e.g. cond ? "All products are well-stocked" : `…` and {company ? company.name : "Select supplier…"}, which a both-arms-are-literals regex needs two literals to catch. Two data defects rode along: the base-unit token ("piece") was interpolated into user-visible labels instead of its translated label (products.unit.*), and products.variants was translated as ورژن ("version"). RULE: translation coverage is proved by rendering the real UI in the non-default language and reading the DOM — a source scan can only prove the absence of the shapes it knows. The gate now parses the JSX with the TypeScript AST and ratchets every rendered literal (JSX text plus string literals inside {…}), excluding keyboard tokens and the English arm of an inline bilingual ternary.',
    evidence: {
      before: 'Urdu /admin/more rendered the raw key admin.observationBot; /admin/inventory/new rendered "Actual inventory in piece…"; /admin/purchases/new rendered "Select supplier…"; guard reported 7/7 pass',
      afterFix: 'Urdu /admin/more -> آبزرویشن بوٹ; Observation Bot panel chrome in Urdu (👁️ جان — مشاہدہ کار / ایکسپورٹ / تازہ کریں / جائزہ / کارروائیاں / خرابیاں / رائے); zero English on /admin/purchases/new, /admin/inventory/reorder, /admin/inventory/barcodes, /admin/customers/new, /admin/inventory/new, /register/shop-details, /employee/notifications with dir=rtl and 0px overflow',
      guard: 'tests/unit/i18nCoverage.test.ts 8/8, EN=UR=1107 keys, AST ratchet baseline 97 (measured; may only decrease)',
      verified: '348/348 Vitest across 25 files; tsc clean; production build clean'
    },
  },
  {
    category: 'failure_pattern',
    title: 'An integration suite that borrowed another suite\'s identity only passed by file order',
    component: 'tests/integration/rbacFoundation.test.ts, tests/integration/employeePermissions.test.ts',
    description:
      'rbacFoundation.test.ts authenticated as e1000000-…0001, an admin that employeePermissions.test.ts both seeds and deletes in its afterAll. It never created that identity itself, so on a clean database every assertion failed with NOT_AUTHORIZED: tenant access denied and the file passed only when the other file happened to run first — the classic "intermittent integration failure" that gets labelled flaky. Proven by running the file alone on a cleaned QA database: 4/4 failed, then 4/4 passed after it seeded its own private admin (inserting the users row also creates the owner membership, via the ensure_user_membership trigger). Every integration suite was then run alone on a clean database to make sure no other file has the same coupling. RULE: a test file owns the identities it authenticates as; sharing an identity across files that also delete it is a latent order dependency, and "run the whole suite" is not evidence that a file is self-sufficient.',
    evidence: {
      before: 'npx vitest run tests/integration/rbacFoundation.test.ts on a cleaned QA DB -> 4 failed (NOT_AUTHORIZED: tenant access denied)',
      afterFix: 'same command -> 4 passed, 12.4s; per-file isolation audit: 11/12 suites pass alone on a clean DB (the 12th passed twice on re-run)',
      verified: 'full integration suite 21/21 files, four consecutive clean runs'
    },
  },
  {
    category: 'prevention_rule',
    title: 'Shared-fixture cleanup must be scoped — an unscoped DELETE wiped a parallel suite\'s rows',
    component: 'tests/setup/fixtures.ts, tests/integration/tenantIsolationOps.test.ts',
    description:
      'cleanupTestData() in tests/setup/fixtures.ts ran unscoped DELETEs on reminder_logs, reminder_occurrences and reminder_configs, and three suites call it in beforeAll. Running in parallel with tenantIsolationOps, it deleted that suite\'s own reminder config mid-test, so the very next RPC failed with: insert or update on table "reminder_occurrences" violates foreign key constraint "reminder_occurrences_config_id_fkey" — about one run in three, with no failing assertion in the guilty file. The file already documented the rule for identities ("deleting them here made a finishing suite wipe fixtures another suite was still using"); the reminder deletes were the last violation of it. They are now scoped to the fixture customers. RULE: a cleanup helper deletes only the rows its own fixtures own; any whole-table DELETE in a suite that runs in parallel is a cross-suite failure generator that will be reported as flakiness in an unrelated file.',
    evidence: {
      before: 'npx vitest run tests/integration/ -> 1 failed | 20 passed, error at tenantIsolationOps.test.ts:191 (FK reminder_occurrences_config_id_fkey), reproduced in 1 of 3 runs',
      afterFix: 'four consecutive full integration runs -> 21 passed (21) each, 0 failures',
      verified: 'full suite 348/348 Vitest; Playwright E2E re-run after the change'
    },
  },
  {
    category: 'failure_pattern',
    title: 'Scaffold defaults ship silently: the app title and description came from the Figma template',
    component: '.figma/make/site.json, vite.config.ts (figmaSiteConfiguration), dist/index.html',
    description:
      'The built app carried <title>Figma Make App</title>, that same string as og:title, and the Figma product blurb ("Transform your Figma designs into fully functional web applications…") as <meta name="description">. Cause: vite.config.ts resolves the title as config.title ?? "Figma Make App", and .figma/make/site.json never defined a title — so the scaffold fallback was shipped as if it were product copy. Nothing failed, no test covered it, and the wrong value is only visible in the artifact (the browser tab, the OG card, the document metadata). The rendered <html lang>/<dir> were already correct because applyDirection() in stores/themeStore.ts sets them at runtime, so this was purely static document metadata — which is exactly why every rendered-UI check passed. RULE: a scaffold template default is not configuration. Any value resolved from a template with a ?? fallback must be verified in the built artifact, not in the source that relies on the fallback.',
    evidence: {
      before: "grep -o '<title>[^<]*</title>' dist/index.html -> <title>Figma Make App</title>; og:title Figma Make App; meta description = Figma marketing copy",
      source: 'vite.config.ts:84 -> const title = config.title ?? "Figma Make App"; .figma/make/site.json had description+robots+accessibility only',
      afterFix: "<title>AgriShop</title>, og:title AgriShop, description 'AgriShop — inventory, sales, purchases, customer credit and payments for agricultural retail shops.'",
      verified: 'rebuilt and re-read the artifact (npm run build ✓ 2.83s); tsc clean; Vitest 348/348; Playwright 63/63',
      regression: 'tests/unit/i18nCoverage.test.ts and the build step both run in CI',
      fixedIn: '.figma/make/site.json'
    },
  },
  {
    category: 'prevention_rule',
    title: 'A long E2E suite is not a hang: exit code 143 is the local wrapper, and this suite takes 16.9 minutes',
    component: 'playwright.config.ts, tests/e2e/*.spec.ts (7 files, 63 tests)',
    description:
      'The full Playwright run appeared to "hang" and was reported as a failure twice. It is neither: the suite grew from 13 tests / 113 s (2026-09-14, crossScreenSync alone) to 63 tests / 16.9 min across 7 files, and any local invocation inside a 10-minute command budget is therefore killed by the wrapper. The tell is the reported symptom — "worker process exited unexpectedly (code=143, signal=null)": 143 = 128 + 15 = SIGTERM, i.e. the harness being terminated from outside, not a browser crash, not an assertion, and not a product failure. Because the JSON reporter writes results.json only at the end of a run, the file still held the previous run\'s figures, which made the aborted run look like it had silently passed. The workflow\'s own test job allows timeout-minutes: 60, so the real runtime is comfortably inside CI. RULE: before diagnosing "flaky" or "hang", compare the suite\'s measured runtime against the budget it was given, and read the exit code (143 = killed by the caller) instead of assuming the product regressed.',
    evidence: {
      measuredRuntime: 'npx playwright test (detached, log polled to completion) -> 63 passed (16.9m), 0 failed, 0 retried, 0 skipped',
      perSpecFirst: 'every spec also verified alone first: accessUx 5/5, actionCenter 12/12, crossScreenSync 13/13, dashboardScope 5/5, imageSync 10/10, rtlLtr 16/16, splitPayment 2/2',
      misreadSymptom: 'worker process exited unexpectedly (code=143, signal=null) -> local timeout wrapper SIGTERM, e.g. tests\\e2e\\actionCenter.spec.ts test 12 at a 200 s budget (needs ~3.6 min)',
      staleArtifact: 'tests/e2e/results.json still showed startTime 2026-09-14 / expected 13 after the aborted run',
      integrationResult: 'Vitest 348/348 across 25 files in the same session',
      budgetInCi: 'build-apk.yml test job: timeout-minutes: 60'
    },
  },
  {
    category: 'technical_decision',
    title: 'Adding an employee issues an INVITATION; role assignment is not access',
    component: 'supabase/migrations/0129_employee_invite_lifecycle.sql, src/lib/auth.ts, employeesStore, EmployeesListPage, EmployeeDetailPage',
    description:
      'create_employee (0113) wrote memberships.status = active directly, so a person the owner had merely added already held full tenant access before ever signing in. That collapsed three different things into one: the invitation, the employee record, and the person\'s access. The locked intent separates them — adding somebody ISSUES AN INVITE, and the employee becomes active only when they complete onboarding. The activation point had to be derived from facts rather than chosen: the device PIN is deliberately device-only (lib/pinLock.ts hashes it into localStorage and never sends it, so users.pin_hash is unused and there is NO server-visible "PIN set" event), which leaves a successful phone OTP — which also establishes the JWT that app_current_user_id() reads — as the only server-observable proof that the invitee accepted. So complete_member_onboarding() is a SECURITY DEFINER RPC that activates ONLY the caller\'s own memberships, ONLY from pending, and refuses if the user row is not active: it cannot grant access to another user, cannot revive a suspended membership, and cannot create tenant access that did not already exist. A second hole had to be closed in sync_membership_status(): that trigger derived status purely from users.is_active, so (a) reactivating a still-pending invite promoted it, and (b) cancelling an invite (deactivate -> suspended) and re-enabling it LOST the pending marker and restored access to somebody who had never signed in. The rule is now that reactivation returns an employee who has never signed in (first_login_at/last_login_at both NULL, and not the original owner) to pending. RULE: "who may access tenant data" must be a state the database can prove, not a state the add-employee form happens to leave behind.',
    evidence: {
      before: "create_employee -> memberships.status = 'active' for a brand-new user; employees list showed them as Active",
      afterCreate: "memberships.status = 'pending'; get_my_permissions() = []; create_customer refused; customers table unchanged (no row)",
      afterOnboarding: "complete_member_onboarding() as the invitee -> activated=1, status active, role defaults (Sales Employee) in force; second call -> activated=0",
      cannotEscalate: "an active employee calling complete_member_onboarding() left a pending colleague pending; a deactivated invitee calling it raised ACCOUNT_NOT_ACTIVE-equivalent error and stayed suspended",
      reactivation: "pending -> deactivate -> suspended -> reactivate -> pending (not active), and still zero permissions until onboarding",
      grants: "authenticated:EXECUTE only (REVOKE ... FROM PUBLIC, anon, house rule from 0115/0116/0121)",
      regression: 'tests/integration/employeeInviteLifecycle.test.ts 5/5; rbacFoundation + rbacEnforcement 26/26; accessUx E2E 5/5; Vitest 353/353; tsc clean; build clean',
      fixedIn: '0129 + auth.ts/employeesStore/EmployeesListPage/EmployeeDetailPage'
    },
  },
  {
    category: 'failure_pattern',
    title: 'Performance must be attributed by employee id — a name fallback invents results for the wrong person',
    component: 'src/pages/admin/employees/EmployeeDetailPage.tsx',
    description:
      'Employee performance filtered sales with `s.employeeId === emp.id || s.employeeName === emp.name`. sales.employee_id is NOT NULL, so the name arm had no legitimate purpose — and it is exactly how a brand-new employee came to display somebody else\'s revenue, sales count and recent-sale list as their own: any colleague sharing their name contributed to their numbers. This is the concrete form of the reported "pending employee shows fake performance": the screen was not inventing numbers, it was borrowing another person\'s. The name arm is removed, and operational data is now gated on the inviter having accepted: an employee whose membership is still pending sees an "Invitation sent" state instead of a Performance panel and a Recent sales list, because zeros presented under a Performance heading read as a result rather than as absence. RULE: attribute people from stable ids; a display-name snapshot is for showing, never for joining, and never silently widens a filter.',
    evidence: {
      before: 'empSales = sales.filter((s) => !s.isVoided && (s.employeeId === emp.id || s.employeeName === emp.name))',
      columnTrap: 'information_schema: sales.employee_id uuid NOT NULL — the fallback could only ever add false positives',
      afterFix: 'empSales = sales.filter((s) => !s.isVoided && s.employeeId === emp.id); invited employees render t("empDetail.invitedTitle") and no Performance/Recent sales',
      browser: 'tests/e2e/accessUx.spec.ts: after creating an employee the list contains "Invited", the detail contains "Invitation sent" and does NOT contain "Recent sales"',
      regression: 'tests/e2e/accessUx.spec.ts 5/5; crossScreenSync 13/13'
    },
  },
  {
    category: 'prevention_rule',
    title: 'Split the E2E lanes by what each spec asserts, not by how long it takes',
    component: 'scripts/run-e2e-lanes.mjs, package.json (test:e2e:lanes), tests/e2e/*.spec.ts',
    description:
      'The browser suite reached 63 tests / ~17 minutes serially, which is longer than a local command budget and therefore slowed every verification cycle. Raising the worker count globally is unsafe for a specific, checkable reason: dashboardScope.spec.ts reconciles the figures RENDERED on the dashboard against aggregate queries over the same tenant, and actionCenter.spec.ts counts tenant-wide signals and badges, so any spec that concurrently inserts a sale or customer in that tenant changes the aggregate between the UI read and the DB read and fails the assertion for a reason unrelated to the product. The partition therefore follows what a spec ASSERTS: specs that mint their own rows (crossScreenSync/imageSync/splitPayment use randomUUID()/Date.now(), rtlLtr only renders, accessUx asserts on the entity it just created) run in a parallel lane, and the tenant-wide reconcilers run in a serial lane. Lanes run one after the other — running them simultaneously would put writers back beside the reconcilers and reintroduce the interference the split exists to prevent. RULE: parallelize tests by isolation property, never by runtime; a test that asserts a whole-tenant aggregate may never share a database moment with a test that writes to that tenant.',
    evidence: {
      before: 'npx playwright test -> 63 passed (16.9m), workers=1',
      after: 'node scripts/run-e2e-lanes.mjs -> isolated lane 33 passed (3m30s, workers=4) + reconcilers lane 30 passed (6m51s, workers=1); total 10m21s, 0 failed, 0 flaky',
      measured: '39% less wall clock for identical coverage (63 tests)',
      isolatedLaneSerialEquivalent: 'the same 4 files took ~7.6m serially, so the parallel lane alone is ~54% faster',
      whySafe: 'every one of the 63 tests had already been proven to pass on its own before the lanes were introduced'
    },
  },
  {
    category: 'failure_pattern',
    title: 'A function rewrite dropped every return rule — and a SELECT INTO nulled the refund on the way back',
    component: 'supabase/migrations/0130_restore_return_integrity_guards.sql, process_return, src/lib/db.ts',
    description:
      '0052 was the last version of process_return that enforced the return rules. 0112 rewrote the function to add the RBAC gate and to follow the variant-stock schema — and silently dropped every rule with it, leaving only an existence check: a return could be made on a VOIDED sale (double-restoring stock that void had already restored), for MORE than was sold, from a line belonging to a DIFFERENT sale, with a client-chosen unit price, without a reason, and repeatedly — even though the client has always sent an idempotency_key and returns.idempotency_key has been UNIQUE since 0014. Two fingerprints identified the loss without needing to know 0052 existed: (1) src/lib/db.ts maps RETURN_WINDOW_EXPIRED / EXCESS_RETURN / ITEM_NOT_OWNED / SALE_ITEM_NOT_FOUND / REASON_REQUIRED to friendly messages — error codes nothing could produce any more; (2) db.ts reads data.return_number / data.total_refund while the live function returned camelCase, so the return number rendered undefined and the refund 0. RESTORING the guards then produced a second defect that only a behavioural check could catch: my restored version ran an idempotency `SELECT r.id, r.return_number, r.total_refund INTO v_id, v_return_number, v_total` before the work, and plpgsql assigns NULL to EVERY target when no row matches — so the `v_total numeric(14,4) := 0` initialisation was wiped, every refund was computed from NULL, total_refund was stored as NULL, and `outstanding_balance = GREATEST(0, outstanding_balance - NULL)` propagated the NULL into the customer balance. All six guard tests passed while the happy path wrote NULL; only asserting the VALUE of a successful return exposed it. 0052 had carried an explicit `v_total_refund := 0; v_return_id := NULL; v_return_number := NULL;` reset line after that lookup, and dropping it was the entire bug. RULES: when a migration rewrites a function, diff the guards, not just the signature — and treat frontend error strings and response-key mappings that nothing produces as evidence of deleted behaviour; and after a SELECT ... INTO used as an existence probe, never assume the declared initialiser survived.',
    evidence: {
      droppedGuards: "process_return before 0130 guarded only SALE_NOT_FOUND; BUSINESS-RULES.md §8 requires non-voided origin, per-item quantity cap, and same-sale lines",
      fingerprint1: 'src/lib/db.ts friendly() maps RETURN_WINDOW_EXPIRED, EXCESS_RETURN, ITEM_NOT_OWNED, SALE_ITEM_NOT_FOUND, REASON_REQUIRED — none producible by the live function',
      fingerprint2: 'db.ts reads data.return_number/data.total_refund; live function returned returnNumber/totalRefund, so both were undefined/0',
      nullableTrap: "returns.total_refund is nullable with default 0; a NULL refund silently propagated to customers.outstanding_balance via GREATEST(0, x - NULL)",
      reproducedDirectly: "select process_return(payload) with SET LOCAL role authenticated + jwt claims -> {\"total_refund\":null} in both the response AND the stored row",
      afterFix: 'valid return of qty 2 at 100 -> total_refund 200 (response and stored row), customer balance not null; retry with the same key -> same id, idempotent true, total_refund 200, no second row',
      negativeCoverage: 'voided sale / qty above sold / line from another sale / inflated unit price / missing reason are rejected AND asserted to write no row',
      regression: 'tests/integration/returnIntegrityGuards.test.ts 6/6; Vitest 359/359 across 27 files; tsc clean; build clean',
      fixedIn: '0130'
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
