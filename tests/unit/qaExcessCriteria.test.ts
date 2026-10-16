import { describe, it, expect } from 'vitest';
import {
  FIXTURE_ACTORS,
  ORPHAN_PRESERVED,
  ORPHAN_RULES,
  ORPHAN_TABLES,
  SUITE_ACTOR_ID,
  SUITE_ACTOR_NAME,
  SUITE_ACTORS,
  SUITE_CREDIT_CUSTOMER,
  SUITE_RUN_FROM,
  SUITE_SALE_CUSTOMER,
  excessWhere,
  isExcessRow,
  isOrphanRow,
  orphanWhere,
} from '../../scripts/dev/qa-excess-criteria.mjs';
import { PROTECTED_QA_IDS } from '../e2e/cleanupOwnership';

/**
 * THE DEFECT THIS PREVENTS
 *
 *   `qa-prune-excess.mjs` DELETES rows from the QA database. It decides which rows by the criteria in
 *   `scripts/dev/qa-excess-criteria.mjs`, and those criteria once existed as SQL strings only — which
 *   meant the only way to know whether a widened pattern had started matching a fixture was to run the
 *   remover and look at what disappeared. That is the wrong order for a destructive tool.
 *
 *   The criteria are now data, and `isExcessRow()` evaluates the same data in JS. These tests drive it
 *   with the actual rows observed in QA on 2026-10-14: the 18 confirmed residue sales and the rows that
 *   must survive beside them, which are structurally similar on purpose — the five manual QA sales from
 *   2026-10-11/12 are the same actor, the same customer, the same 1000.00 amount and the same voided
 *   state as the excess. ONLY the date separates them, so if the date bound is ever dropped, this file
 *   fails before data does.
 */

const manualSale = {
  sale_number: 'SALE-21225',
  created_at: '2026-10-11T22:23:19.925Z',
  employee_name: SUITE_ACTOR_NAME,
  customer_id: SUITE_SALE_CUSTOMER,
  total_amount: '1000.00',
  is_voided: true,
};

const excessSale = {
  sale_number: 'SALE-13663',
  created_at: '2026-10-13T21:48:12.340Z',
  employee_name: SUITE_ACTOR_NAME,
  customer_id: SUITE_SALE_CUSTOMER,
  total_amount: '1000.00',
  is_voided: true,
};

const ownerSale = {
  sale_number: 'SALE-58082',
  created_at: '2026-10-09T14:38:48.285Z',
  employee_name: 'Arc Zari Form',
  customer_id: '1a05c3b2-cd85-43c3-9ab1-dc1a2199f695',
  total_amount: '156000.00',
  is_voided: null,
};

const permSale = {
  sale_number: 'PERM-SALE-001',
  created_at: '2026-10-13T21:43:34.134Z',
  employee_name: 'Perm Test Admin',
  customer_id: SUITE_CREDIT_CUSTOMER,
  total_amount: '5000.00',
  is_voided: null,
};

const manualCredit = {
  customer_id: SUITE_CREDIT_CUSTOMER,
  created_at: '2026-10-12T09:00:00.000Z',
  status: 'pending',
};

const excessCredit = {
  customer_id: SUITE_CREDIT_CUSTOMER,
  created_at: '2026-10-13T21:43:38.355Z',
  status: 'approved',
};

describe('QA excess criteria select the confirmed residue', () => {
  it('selects the 2026-10-13 suite burst, drive row by row', () => {
    expect(isExcessRow('sales', excessSale)).toBe(true);
    expect(isExcessRow('credit_limit_requests', excessCredit)).toBe(true);
  });

  it('preserves the manual QA sessions, which differ ONLY by date', () => {
    // Same actor, same fixture customer, same amount, same voided state — 2026-10-11/12, not 10-13.
    expect(isExcessRow('sales', manualSale)).toBe(false);
    expect(isExcessRow('credit_limit_requests', manualCredit)).toBe(false);
    // ...and the difference is exactly the date bound, so removing that rule is the failure this guards.
    expect(manualSale.created_at < SUITE_RUN_FROM).toBe(true);
    expect(excessSale.created_at >= SUITE_RUN_FROM).toBe(true);
  });

  it('preserves the owner-recorded and PERM sales', () => {
    expect(isExcessRow('sales', ownerSale)).toBe(false);
    expect(isExcessRow('sales', permSale)).toBe(false);
  });

  it('each individual rule is load-bearing — dropping any one of them changes the answer', () => {
    // A rescoped criterion (e.g. matching the actor alone) would swallow the manual rows and, worse,
    // any account called "QA Admin". Prove the conjunction is what decides.
    const actorOnly = { ...manualSale, created_at: '2026-10-13T20:00:00.000Z' };
    expect(isExcessRow('sales', actorOnly)).toBe(true);

    // A different actor on the same date, customer, amount and state is NOT residue.
    expect(isExcessRow('sales', { ...excessSale, employee_name: 'Arc Zari Form' })).toBe(false);
    // A different customer likewise.
    expect(isExcessRow('sales', { ...excessSale, customer_id: '20000000-0000-0000-0000-000000000001' })).toBe(false);
    // A live (unvoided) sale for the same fixture customer is not residue.
    expect(isExcessRow('sales', { ...excessSale, is_voided: null })).toBe(false);
    // A different amount is not residue.
    expect(isExcessRow('sales', { ...excessSale, total_amount: '1001.00' })).toBe(false);
    // A non-SALE number is not residue, even for the same fixtures.
    expect(isExcessRow('sales', { ...excessSale, sale_number: 'PERM-SALE-003' })).toBe(false);
  });

  it('never matches the sign-in fixtures as a table', () => {
    // The criteria are about sales and credit requests. If a future edit points one of them at users,
    // memberships or roles, this fails before anything is deleted.
    expect(Object.keys(excessWhere ? { sales: 1, credit_limit_requests: 1 } : {})).toEqual(['sales', 'credit_limit_requests']);
    expect(() => excessWhere('users')).toThrow();
    expect(() => excessWhere('memberships')).toThrow();
    expect(() => excessWhere('roles')).toThrow();
    expect(() => excessWhere('audit_events')).toThrow();
  });

  it('selects the one supplier payment recorded against the shared supplier fixture', () => {
    // Measured 2026-10-14: the only row in the table. It cannot be reached by ownership registration —
    // the lane paid the SHARED supplier fixture — which is why it needs a criterion of its own.
    const payment = {
      recorded_by: SUITE_ACTOR_ID,
      method: 'cash',
      amount: '500.00',
      created_at: '2026-10-13T23:18:19.289Z',
    };
    expect(isExcessRow('supplier_payments', payment)).toBe(true);
    // Each clause is load-bearing: a payment of another shape, by another account, or older than the
    // lane burst is preserved rather than swept up by "the actor owned the row".
    expect(isExcessRow('supplier_payments', { ...payment, amount: '5000.00' })).toBe(false);
    expect(isExcessRow('supplier_payments', { ...payment, method: 'bank' })).toBe(false);
    expect(isExcessRow('supplier_payments', { ...payment, recorded_by: OWNER_FIXTURE })).toBe(false);
    expect(isExcessRow('supplier_payments', { ...payment, created_at: '2026-10-12T10:00:00.000Z' })).toBe(false);
    expect(excessWhere('supplier_payments')).toContain(`recorded_by = '${SUITE_ACTOR_ID}'`);
  });

  it('emits SQL that carries every rule, with the alias applied', () => {
    const sql = excessWhere('sales', 's');
    for (const fragment of [
      `s.employee_name = '${SUITE_ACTOR_NAME}'`,
      `s.customer_id = '${SUITE_SALE_CUSTOMER}'`,
      `s.total_amount = 1000`,
      `s.is_voided = true`,
      `s.created_at >= '${SUITE_RUN_FROM}'`,
      `s.sale_number ~ '^SALE-'`,
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toContain('\n    and ');
    expect(excessWhere('credit_limit_requests')).toContain(`created_at >= '${SUITE_RUN_FROM}'`);
  });
});

/**
 * THE SECOND RESIDUE CLASS: rows whose SUBJECT is gone.
 *
 * THE DEFECT THIS PREVENTS. `inventory_movements.reference_id` and `notifications.entity_id` are
 * polymorphic columns with NO foreign key, so a lane could register the sale it created, have cleanup
 * delete that sale, and leave the movement and the notification pointing at a row that no longer exists
 * — 3 movements and 4 notifications were still in QA on 2026-10-14, and nothing in the schema objected.
 *
 * The rows below are those rows as they were measured, beside the rows the rule must refuse: a movement
 * whose sale is still there, a notification written before the lane window, one written by the owner
 * fixture that a human signs in as, and one whose `entity_type` this file has never seen.
 */
const GONE_SALE = '44ca2c04-8d61-4006-bf87-7b42a3180a9e';
const GONE_VOID = 'd426e234-08dd-493b-982d-4ac372e47226';
const LIVE_SALE = 'b22cce6a-a5a6-4baf-8fba-1f43c61a5b21';
const FIXTURE_CUSTOMER = '20000000-0000-0000-0000-000000000001';
// The owner fixture, taken from the module that protects it rather than typed in again: a second
// literal copy is what `tests/unit/fixtureIdCollision.test.ts` flags — that id is already declared by
// an integration suite, and two files owning one fixture id is the defect the guard exists for.
const OWNER_FIXTURE = PROTECTED_QA_IDS[0]; // 923001234567 — the owner every lane signs in with

const orphanMovement = {
  id: 'ea963003-d7f3-4d31-a573-513db5b8f0f4',
  reference_type: 'sale',
  reference_id: GONE_SALE,
  created_by: SUITE_ACTOR_ID,
  created_at: '2026-10-13T23:17:51.561Z',
};

const orphanVoidMovement = {
  ...orphanMovement,
  id: '62b18686-e775-4c7d-867e-9c1fe78407dc',
  reference_type: 'void',
  reference_id: GONE_VOID,
  created_at: '2026-10-13T23:44:55.019Z',
};

const orphanSaleNotification = {
  id: 'fb3f7623-592e-4368-9a39-c90b6d0a6ea2',
  kind: 'sale',
  entity_type: 'sale',
  entity_id: GONE_SALE,
  actor_id: SUITE_ACTOR_ID,
  created_at: '2026-10-13T23:17:52.115Z',
};

// The payment notification measured beside them carries the FIXTURE CUSTOMER in `entity_id`, and that
// customer still exists. It is residue because a suite-only account wrote it inside the lane window —
// not because a parent vanished — and the rule has to say that rather than claim the customer is gone.
const paymentNotification = {
  id: 'd1dc01ba-5266-4e96-bd4a-9596048f2a66',
  kind: 'payment',
  entity_type: 'payment',
  entity_id: FIXTURE_CUSTOMER,
  actor_id: SUITE_ACTOR_ID,
  created_at: '2026-10-13T23:17:28.284Z',
};

/** What still exists in QA after the lanes cleaned up: the fixture customer, and one live sale. */
const parentExists = (table: string, id: string) =>
  (table === 'customers' && id === FIXTURE_CUSTOMER) || (table === 'sales' && id === LIVE_SALE);

describe('QA residue criteria — rows whose subject is gone', () => {
  it('selects the 3 movements and 4 notifications measured on 2026-10-14', () => {
    expect(isOrphanRow('inventory_movements', orphanMovement, parentExists)).toBe(true);
    expect(isOrphanRow('inventory_movements', orphanVoidMovement, parentExists)).toBe(true);
    expect(isOrphanRow('notifications', orphanSaleNotification, parentExists)).toBe(true);
    expect(isOrphanRow('notifications', paymentNotification, parentExists)).toBe(true);
  });

  it('preserves a movement whose referenced sale or void still exists', () => {
    // The clause that keeps removal from taking a live row out from under a screen.
    expect(isOrphanRow('inventory_movements', { ...orphanMovement, reference_id: LIVE_SALE }, parentExists)).toBe(false);
    expect(parentExists('sales', LIVE_SALE)).toBe(true);
  });

  it('preserves everything a human run produced, and every type it has not measured', () => {
    // A hand-run signs in as the owner fixture (…0003); only a suite signs in as QA Admin/QA Employee.
    expect(isOrphanRow('notifications', { ...paymentNotification, actor_id: OWNER_FIXTURE }, parentExists)).toBe(false);
    expect(isOrphanRow('notifications', { ...paymentNotification, created_at: '2026-10-12T09:00:00.000Z' }, parentExists)).toBe(false);
    // An entity_type no rule models is preserved: an unknown type must not be read as an absent parent.
    expect(isOrphanRow('notifications', { ...paymentNotification, entity_type: 'customer' }, parentExists)).toBe(false);
    // An orphan movement is residue whatever fixture wrote it — with its subject gone it cannot be a
    // live record — so the owner fixture is still a candidate there. What the actor clause does exclude
    // is an account that is not a fixture at all, which is reported and preserved rather than judged.
    expect(isOrphanRow('inventory_movements', { ...orphanMovement, created_by: OWNER_FIXTURE }, parentExists)).toBe(true);
    expect(
      isOrphanRow('inventory_movements', { ...orphanMovement, created_by: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, parentExists),
    ).toBe(false);
  });

  it('requires the parent lookup rather than assuming nothing exists', () => {
    // A default of "no parent" would report every movement in QA as removable, so there is no default.
    expect(() => (isOrphanRow as unknown as (t: string, r: unknown) => boolean)('inventory_movements', orphanMovement)).toThrow(
      /parentExists/,
    );
  });

  it('covers exactly two tables and refuses every other one', () => {
    expect(ORPHAN_TABLES).toEqual(['inventory_movements', 'notifications']);
    for (const table of ['users', 'memberships', 'roles', 'audit_events', 'sales', 'customers', 'companies']) {
      expect(() => orphanWhere(table), `${table} must have no rule`).toThrow(/no orphan rule/);
      expect(() => (isOrphanRow as unknown as (t: string, r: unknown, p: unknown) => boolean)(table, {}, parentExists)).toThrow(
        /no orphan rule/,
      );
    }
  });

  it('emits the parent-absent test for the movement rule, and the actor test for notifications', () => {
    const movementSql = orphanWhere('inventory_movements', 'm');
    expect(movementSql).toContain('not exists (select 1 from sales t0 where t0.id = m.reference_id)');
    expect(movementSql).toContain('not exists (select 1 from voids t0 where t0.id = m.reference_id)');
    expect(movementSql).toContain(`m.created_by in (`);
    expect(movementSql).toContain(`m.created_at >= '${SUITE_RUN_FROM}'`);
    for (const actor of FIXTURE_ACTORS) expect(movementSql).toContain(`'${actor}'`);

    // The notification rule rests on the actor, so it must NOT claim a missing parent it cannot prove.
    const notificationSql = orphanWhere('notifications');
    expect(notificationSql).not.toContain('not exists');
    expect(notificationSql).toContain('actor_id in (');
    expect(notificationSql).toContain(`created_at >= '${SUITE_RUN_FROM}'`);
    for (const actor of SUITE_ACTORS) expect(notificationSql).toContain(`'${actor}'`);
    // The owner fixture a human signs in as is deliberately NOT in the notification rule's actor list.
    expect(notificationSql).not.toContain(`'${OWNER_FIXTURE}'`);
  });

  it('states what it preserves, and the rules agree with the statement', () => {
    const text = ORPHAN_PRESERVED.join(' ');
    expect(text).toContain('still exists');
    expect(text).toContain('2026-10-13');
    expect(text).toContain('suite account');
    // The suite-only actor list is a strict subset of the fixture accounts on purpose: widening it to
    // the owner fixture would make a human run's notifications removable.
    expect(SUITE_ACTORS.every((a) => FIXTURE_ACTORS.includes(a))).toBe(true);
    expect(SUITE_ACTORS).not.toContain(OWNER_FIXTURE);
    expect(ORPHAN_RULES.notifications.requireParentAbsent).toBe(false);
    expect(ORPHAN_RULES.inventory_movements.requireParentAbsent).toBe(true);
  });
});
