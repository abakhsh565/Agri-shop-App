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
