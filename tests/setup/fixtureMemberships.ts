/**
 * A private fixture owns its membership, not only its `users` row.
 *
 * WHY THIS EXISTS (measured 2026-11-20, QA `bpybjrjenwccowvtrevu`)
 *   `employeePermissions`, `destructiveSafety` and `tenantIsolationOps` create their own users and then
 *   authenticate as them. The membership was left to `ensure_user_membership()` (0113), which is
 *   `AFTER INSERT` with `ON CONFLICT (user_id, tenant_id) DO NOTHING`: it creates the membership the
 *   first time the user row is new, and does nothing at all on every later run. So when a fixture user
 *   survived a run (a cleanup that could not delete it, a killed job) the suite's upsert "restored" the
 *   user row and the membership kept whatever state it had.
 *
 *   That state was often `'pending'`. `sync_membership_status()` (0129) returns a reactivated account
 *   to `'pending'` when it is not an original owner and has never signed in — and fixture users never
 *   sign in, they are impersonated through JWT claims, so `first_login_at`/`last_login_at` stay NULL
 *   forever. `membership_in_active_shop()` (0149) accepts only `status = 'active'`, so a pending
 *   membership resolves to no membership at all and every guarded RPC answers
 *   `NOT_AUTHORIZED: tenant access denied` — the message that reads like a product bug but was a
 *   fixture left behind by the previous run.
 *
 * WHAT IT DOES
 *   Mirrors `ensure_user_membership()` exactly (same role derivation, same system role template) and is
 *   idempotent: an existing membership is repaired to `'active'` instead of being skipped. An already
 *   assigned `role_id` and an already computed `branch_scope` are preserved, so suites that deliberately
 *   attach a different role or scope keep doing so.
 *
 * USAGE — immediately after the suite's `INSERT INTO users …` upsert:
 *   await admin(ensureActiveFixtureMemberships(T.adminUser, T.employeeA));
 *   await client.query(ensureActiveFixtureMemberships(T.adminUser, T.employeeUser));
 */

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * One statement that guarantees an ACTIVE membership for each id, for the shop on its user row.
 *
 * Single statement on purpose: it works through `pg` (`client.query(sql)`), through
 * `execSqlAsAdmin(sql)` and through any wrapper in between, and it cannot leave the fixture half
 * repaired if one id is missing (a missing user simply contributes no row).
 */
export function ensureActiveFixtureMemberships(...userIds: string[]): string {
  const ids = userIds.map((id) => String(id).toLowerCase());
  for (const id of ids) {
    if (!UUID.test(id)) {
      throw new Error(`ensureActiveFixtureMemberships: not a uuid: ${JSON.stringify(id)}`);
    }
  }
  if (ids.length === 0) throw new Error('ensureActiveFixtureMemberships: no user ids given');

  const list = ids.map((id) => `'${id}'`).join(', ');
  return `INSERT INTO memberships (user_id, tenant_id, role, status, branch_scope, role_id)
SELECT u.id,
       u.shop_id,
       CASE WHEN u.is_original_owner THEN 'owner'::membership_role
            WHEN u.role = 'admin' THEN 'admin'::membership_role
            ELSE 'employee'::membership_role END,
       'active'::membership_status,
       NULL,
       (SELECT r.id FROM roles r
         WHERE r.tenant_id = u.shop_id
           AND r.is_system = true
           AND r.name = CASE WHEN u.is_original_owner THEN NULL
                             WHEN u.role = 'admin' THEN 'Store Manager'
                             ELSE 'Sales Employee' END
         LIMIT 1)
  FROM users u
 WHERE u.id IN (${list})
   AND u.shop_id IS NOT NULL
ON CONFLICT (user_id, tenant_id) DO UPDATE
   SET status = 'active'::membership_status,
       role = EXCLUDED.role,
       role_id = COALESCE(memberships.role_id, EXCLUDED.role_id),
       updated_at = now()`;
}
