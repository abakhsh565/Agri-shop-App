/**
 * cleanupOwnership.ts — what THIS test run created, and nothing else.
 *
 * THE DEFECT THIS REPLACES (measured 2026-10-13, on the shared QA database)
 *   `tests/e2e/helpers.ts` `cleanupFixtures()` issued unscoped, table-wide deletes across 20
 *   business tables (`DELETE FROM sales`, `DELETE FROM audit_events`, `DELETE FROM notifications`, …)
 *   and swallowed every error in `catch { /* skip *\/ }`. Eight lanes that had been assumed
 *   read-only ran it — and the QA baseline lost exactly the seven rows it targets
 *   (customers 20000000-…001..003, products 30000000-…001..002, variants 40000000-…001..002 = 3+2+2),
 *   while the statements that would have destroyed hundreds of rows failed silently and unnoticed.
 *   A helper that cannot say what it deleted, and cannot say what it failed to delete, is not
 *   cleanup.
 *
 * WHAT REPLACES IT
 *   Ownership is explicit and run-scoped. A test registers the ids it created
 *   (`trackOwned(ownership, 'sales', saleId)`); cleanup deletes only ids present in that registry,
 *   only in the column that actually points at them, children before parents. Nothing is inferred
 *   from a name prefix and nothing is table-wide: an empty registry means an empty plan.
 *
 * THE SECOND DEFECT THIS FILE CARRIES THE FIX FOR (measured 2026-10-14)
 *   The graph used to delete `memberships` for every owned user and had no `users` step at all, so a
 *   lane that inserts its own fixture account deleted the account's membership and left the account
 *   behind — four such rows sat in QA (`Sync Employee`, `Img Employee`, `E2E Employee`, a second
 *   role-deletion employee) and failed `rbacInvariants` Invariant D and `rbacEnforcement`. Cleanup
 *   must not be able to produce an orphan: a user row now either goes with its membership by CASCADE,
 *   or stays with it (guarded, see `USER_DELETE_GUARDS`).
 *
 *   This file holds the whole decision — the ownership graph, the protected ids, the SQL shape —
 *   and performs no I/O, so every clause is testable without touching QA.
 */

/**
 * Records that must never be deleted by cleanup, whatever a test registers.
 *
 * WHY THESE. The four phones below are the QA keep-list (`tests/unit/qaFixtureKeepList.test.ts`
 * pins them against `scripts/clean-test-data.mjs` and the vitest teardown): they are the accounts
 * the app signs in with, and their Supabase Auth credential lives in `auth.users` — deleting the
 * row deletes the credential, which the app cannot re-create, so every later lane fails to sign in.
 * `companyA` is referenced by `supplier_payments` (measured: 1 row on QA) and is the shared supplier
 * fixture; the E2E helper's own docblock already calls these identities a shared baseline.
 *
 * Ids come from the QA inventory of 2026-10-13 (`users.id` for the four keep-list phones, and
 * `QA_IDS.companyA`).
 */
export const PROTECTED_QA_IDS: readonly string[] = [
  '10000000-0000-0000-0000-000000000003', // 923001234567 — owner, used by every lane's sign-in
  '10000000-0000-0000-0000-000000000004', // 923001122334 — sales employee
  '10000000-0000-0000-0000-000000000001', // 923009999999 — QA Admin
  '10000000-0000-0000-0000-000000000002', // 923008888888 — QA Employee
  '50000000-0000-0000-0000-000000000001', // QA Supplier A (companyA), FK-referenced
];

/** Registry of what the current run created: a "kind" (usually a table name) → ids. */
export type Ownership = Map<string, Set<string>>;

export function createOwnership(): Ownership {
  return new Map();
}

/**
 * Record ids this run created. Returns the ids that were actually tracked, so a caller can assert
 * that a protected id was NOT silently accepted as owned.
 */
export function trackOwned(
  ownership: Ownership,
  kind: string,
  ids: string | readonly string[],
): string[] {
  const tracked: string[] = [];
  for (const raw of typeof ids === 'string' ? [ids] : ids) {
    const id = String(raw);
    assertSafeId(id);
    if (PROTECTED_QA_IDS.includes(id)) continue;
    const bucket = ownership.get(kind) ?? new Set<string>();
    bucket.add(id);
    ownership.set(kind, bucket);
    tracked.push(id);
  }
  return tracked;
}

/** Every id the run currently owns, flattened — for diagnostics and the guard test. */
export function ownedCount(ownership: Ownership): number {
  let n = 0;
  for (const ids of ownership.values()) n += ids.size;
  return n;
}

export function clearOwnership(ownership: Ownership): void {
  ownership.clear();
}

/**
 * An id is interpolated into SQL, so it must be a plain identifier. Anything else fails closed
 * rather than being escaped and hoped for.
 */
export function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`[QA CLEANUP] refusing to use "${id}" as an id — not a plain identifier`);
  }
}

export interface DeleteStep {
  /** Table to delete from. */
  table: string;
  /** Column that carries the owned id (the foreign key, or `id`). */
  column: string;
  /** Registry bucket the ids come from — for a `via` step, the parent bucket named in `via`. */
  from?: string;
  ids: string[];
  /**
   * Pointers that would REFUSE this delete and that cleanup cannot own. With any of them present the
   * row — and everything that hangs off it — is preserved instead of the statement failing on a
   * foreign key. See `USER_DELETE_GUARDS` for the only step that carries one, and why.
   */
  unlessReferenced?: readonly UserReference[];
  /**
   * One extra hop for grandchildren: delete rows whose `column` points at a PARENT row that is
   * itself selected through an owned id. Example: a lane registers the customers it created, and
   * `purchase_items` must go before `purchases`, which must go before `companies`. The ids in the
   * statement stay explicit — the hop only turns a registered parent into its children's ids.
   */
  via?: { table: string; column: string; parent: string };
}

/**
 * THE OWNERSHIP GRAPH, in FK-safe order: every statement is a child before its parent.
 * `voids`/`sale_items` before `sales`, `product_variants` before `products`, `role_permissions`
 * before `roles`, `reminder_logs`/`reminder_occurrences` before `reminder_configs`, and so on.
 *
 * A table appears once per column it can be owned through, because two different parents can point
 * at the same child (`customer_payments` belongs to a customer AND can be registered by id).
 */
/** A column that points at a `users` row, named as table + column. */
export interface UserReference {
  table: string;
  column: string;
}

/**
 * Every foreign key on `public.users(id)` whose delete rule would REFUSE the delete.
 *
 * MEASURED, not guessed: read from `information_schema.referential_constraints` on the QA project
 * (2026-10-14). The keys that CASCADE (`memberships`, `user_permissions.user_id`, `user_active_shops`)
 * or SET NULL (`client_error_events`, `branch_responsibility.granted_by/revoked_by`) are deliberately
 * NOT here — they cannot refuse anything, and listing them would make the guard preserve rows for a
 * reason that does not exist.
 *
 * THIS LIST IS A CONTRACT. `rbacInvariants` (Invariant F, integration lane) reads the live schema and
 * fails when a NO ACTION/RESTRICT key on `users(id)` is missing from it, so adding such a key in a
 * migration cannot silently turn the guarded delete into a failing one. `e2eCleanupOwnership` pins the
 * list itself, so widening it is a reviewed edit rather than a convenience.
 */
export const USER_DELETE_GUARDS: readonly UserReference[] = [
  { table: 'activity_log', column: 'user_id' },
  { table: 'audit_events', column: 'user_id' },                              // 0009
  { table: 'branch_responsibility', column: 'user_id' },                     // RESTRICT
  { table: 'cash_reconciliations', column: 'reconciled_by' },                // 0009
  { table: 'daily_cash_reconciliations', column: 'reconciled_by' },          // 0009
  { table: 'inventory_movements', column: 'created_by' },                    // 0009
  { table: 'returns', column: 'processed_by' },
  { table: 'sales', column: 'employee_id' },
  { table: 'user_permissions', column: 'granted_by' },                       // 0106
  { table: 'voids', column: 'voided_by' },                                   // 0009
];

const STEPS: readonly Omit<DeleteStep, 'ids'>[] = [
  { table: 'reminder_logs', column: 'config_id', from: 'reminder_configs' },
  { table: 'reminder_occurrences', column: 'id', from: 'reminder_occurrences' },
  { table: 'reminder_configs', column: 'id', from: 'reminder_configs' },
  { table: 'reminder_logs', column: 'config_id', from: 'reminder_configs', via: { table: 'reminder_configs', column: 'customer_id', parent: 'customers' } },
  { table: 'reminder_occurrences', column: 'customer_id', from: 'customers' },
  { table: 'reminder_configs', column: 'customer_id', from: 'customers' },
  { table: 'return_items', column: 'return_id', from: 'returns' },
  { table: 'return_items', column: 'return_id', from: 'returns', via: { table: 'returns', column: 'customer_id', parent: 'customers' } },
  // Sale children first — directly by registered sale id, then through a customer this run created.
  { table: 'voids', column: 'sale_id', from: 'sales' },
  { table: 'sale_items', column: 'sale_id', from: 'sales' },
  { table: 'sale_submissions', column: 'sale_id', from: 'sales' },
  // WHAT THE DATABASE WRITES ALONGSIDE A SALE, and the reason 3 `inventory_movements` and 4
  // `notifications` were still in QA on 2026-10-14 while their sales were long gone: a lane registers
  // the sale it created and the RPC writes these two rows as a side effect, so cleanup removed the
  // parent and left the children pointing at a row that no longer exists. `reference_id`/
  // `entity_id` are polymorphic (no foreign key), which is why nothing cascaded and nothing complained.
  // Scoped by the owned sale ids exactly like the other children — a movement or notification
  // belonging to a sale this run did not create is not in the list.
  { table: 'inventory_movements', column: 'reference_id', from: 'sales' },
  { table: 'notifications', column: 'entity_id', from: 'sales' },
  { table: 'voids', column: 'sale_id', from: 'sales', via: { table: 'sales', column: 'customer_id', parent: 'customers' } },
  // A void writes its own movement (`reference_type = 'void'`), and an owned void's movement is
  // reachable only through the void id.
  { table: 'inventory_movements', column: 'reference_id', from: 'voids' },
  { table: 'sale_items', column: 'sale_id', from: 'sales', via: { table: 'sales', column: 'customer_id', parent: 'customers' } },
  { table: 'sale_submissions', column: 'sale_id', from: 'sales', via: { table: 'sales', column: 'customer_id', parent: 'customers' } },
  { table: 'sales', column: 'id', from: 'sales' },
  // Only for customers THIS run registered: an owned customer's sales were created through it.
  { table: 'sales', column: 'customer_id', from: 'customers' },
  { table: 'returns', column: 'customer_id', from: 'customers' },
  { table: 'returns', column: 'id', from: 'returns' },
  { table: 'customer_payments', column: 'customer_id', from: 'customers' },
  { table: 'customer_payments', column: 'id', from: 'customer_payments' },
  // A payment notification's `entity_id` is the CUSTOMER on the rows measured here, and the payment on
  // others (`kind = 'payment'` is written by two different paths), so both readings are listed and
  // each is scoped by ids this run registered. `notifications` was otherwise only ever deleted by its
  // own registered id — a lane that registers a customer still left the notification behind.
  { table: 'notifications', column: 'entity_id', from: 'customers' },
  { table: 'notifications', column: 'entity_id', from: 'customer_payments' },
  { table: 'payments', column: 'customer_id', from: 'customers' },
  { table: 'payments', column: 'id', from: 'payments' },
  { table: 'supplier_payments', column: 'id', from: 'supplier_payments' },
  { table: 'inventory_movements', column: 'product_id', from: 'products' },
  { table: 'inventory_movements', column: 'id', from: 'inventory_movements' },
  { table: 'stock_adjustments', column: 'product_id', from: 'products' },
  { table: 'stock_adjustments', column: 'id', from: 'stock_adjustments' },
  // Purchases/supplier payments belong to a company this run created, one hop further down.
  { table: 'purchase_items', column: 'purchase_id', from: 'purchases' },
  { table: 'purchase_items', column: 'purchase_id', from: 'purchases', via: { table: 'purchases', column: 'company_id', parent: 'companies' } },
  { table: 'purchases', column: 'company_id', from: 'companies' },
  { table: 'purchases', column: 'id', from: 'purchases' },
  { table: 'supplier_payments', column: 'company_id', from: 'companies' },
  { table: 'credit_limit_requests', column: 'customer_id', from: 'customers' },
  { table: 'credit_limit_requests', column: 'id', from: 'credit_limit_requests' },
  { table: 'customer_crops', column: 'customer_id', from: 'customers' },
  { table: 'notifications', column: 'id', from: 'notifications' },
  { table: 'activity_log', column: 'id', from: 'activity_log' },
  { table: 'role_permissions', column: 'role_id', from: 'roles' },
  { table: 'roles', column: 'id', from: 'roles' },
  // A lane can also create permission rows ON a shared user it does not own (an override granted to
  // the fixture employee it must not delete). Those rows are owned by their own id, so the shared
  // account survives while the exception this run granted does not.
  { table: 'user_permissions', column: 'id', from: 'user_permissions' },
  { table: 'user_permissions', column: 'user_id', from: 'users' },
  // THE USER ROW ITSELF, guarded — and where the memberships delete used to sit.
  //
  // A lane that inserts its own `users` row (crossScreenSync's 'Sync Employee', imageSync's
  // 'Img Employee', splitPayment's 'E2E Employee', roleInUseDeletion's second employee) registers it
  // here. The membership of that row is written by the product's own trigger (0113
  // `ensure_user_membership`), and cleanup must never remove it on its own: `memberships` used to be
  // deleted for every owned user, so a failed `users` delete (or, as measured, the total ABSENCE of
  // one) left the row in place with no membership — precisely the orphan that `rbacInvariants`
  // Invariant D and `rbacEnforcement` fail on, four rows deep in QA on 2026-10-14. Deleting the user
  // removes its membership, its permission rows and its active-shop row by CASCADE, so there is no
  // statement for those tables here at all.
  //
  // The guard exists because a fixture user can legitimately be REFERENCED by rows cleanup cannot
  // own: `audit_events`/`activity_log` history the system writes when that account acts, a sale
  // recorded as that employee, an inventory movement it created. Those FKs are NO ACTION/RESTRICT,
  // so an unguarded delete would fail and fail the lane — turning a leftover row into a red run.
  // Preserving the row preserves its membership, so the invariant still holds; the row is residue
  // the drift report can see, which is the honest direction.
  { table: 'users', column: 'id', from: 'users', unlessReferenced: USER_DELETE_GUARDS },
  { table: 'product_variants', column: 'product_id', from: 'products' },
  { table: 'product_variants', column: 'id', from: 'product_variants' },
  { table: 'products', column: 'id', from: 'products' },
  { table: 'customers', column: 'id', from: 'customers' },
  { table: 'companies', column: 'id', from: 'companies' },
  // `audit_events` is deliberately last and only ever by registered id: historical audit rows are
  // never owned by a test run, and a whole-table delete there destroys the system's own history.
  { table: 'audit_events', column: 'id', from: 'audit_events' },
];

export interface CleanupPlan {
  steps: DeleteStep[];
  /** Ids that were registered but are protected — reported, never deleted. */
  protectedSkipped: string[];
}

/**
 * Turn the ownership registry into the exact statements cleanup will run. An empty registry, or one
 * holding only protected ids, yields an empty plan — the safe failure direction.
 */
export function planCleanup(ownership: Ownership): CleanupPlan {
  const steps: DeleteStep[] = [];
  const protectedSkipped: string[] = [];
  for (const step of STEPS) {
    // A `via` step is driven by the PARENT bucket: the ids it interpolates are the parents'.
    const key = step.via ? step.via.parent : step.from;
    if (!key) continue;
    const bucket = ownership.get(key);
    if (!bucket || bucket.size === 0) continue;
    const ids = [...bucket].filter((id) => {
      if (PROTECTED_QA_IDS.includes(id)) {
        protectedSkipped.push(id);
        return false;
      }
      return true;
    }).sort();
    if (ids.length) steps.push({ ...step, from: key, ids });
  }
  return { steps, protectedSkipped };
}

/**
 * The only statement shapes cleanup may produce: scoped by id, or by ids selected through an owned
 * parent. Never table-wide, and never keyed on a name, a phone or a shared fixture.
 */
export function deleteSql(step: DeleteStep): string {
  if (!step.ids.length) throw new Error(`[QA CLEANUP] refusing an empty delete on ${step.table}`);
  for (const id of step.ids) assertSafeId(id);
  assertSafeId(step.table);
  assertSafeId(step.column);
  const list = step.ids.map((id) => `'${id}'`).join(', ');
  if (step.via) {
    assertSafeId(step.via.table);
    assertSafeId(step.via.column);
    return `DELETE FROM ${step.table} WHERE ${step.column} IN (SELECT id FROM ${step.via.table} WHERE ${step.via.column} IN (${list}))`;
  }
  const base = `DELETE FROM ${step.table} WHERE ${step.column} IN (${list})`;
  const guards = step.unlessReferenced ?? [];
  if (!guards.length) return base;
  // A guarded delete says what it refuses to break. Every clause names a real column, so a typo is a
  // failure here rather than a statement that silently deletes more than it should.
  const clauses = guards.map((reference) => {
    assertSafeId(reference.table);
    assertSafeId(reference.column);
    return `NOT EXISTS (SELECT 1 FROM ${reference.table} r WHERE r.${reference.column} = ${step.table}.id)`;
  });
  return `${base} AND ${clauses.join(' AND ')}`;
}

/** Storage objects are owned the same way rows are: registered, then removed by name. */
export interface OwnedObject {
  bucket: string;
  path: string;
}

export function trackOwnedObject(objects: OwnedObject[], bucket: string, path: string): void {
  // A storage path is not SQL, but it is still a value that reaches an API call; keep it bounded
  // and reject control characters so a stray newline cannot smuggle a second path in.
  if (!bucket || !path || /[\x00-\x1f]/.test(path) || path.length > 512) {
    throw new Error(`[QA CLEANUP] refusing to track storage object ${bucket}/${path}`);
  }
  if (!objects.some((o) => o.bucket === bucket && o.path === path)) objects.push({ bucket, path });
}
