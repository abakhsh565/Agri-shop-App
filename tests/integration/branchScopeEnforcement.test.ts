/**
 * Branch scope enforcement regression suite.
 *
 * Proves, through the real client path (JWT → PostgREST → RLS/trigger → DB):
 *   1. Operational records get persistent branch ownership.
 *   2. A branch-limited member operates in its own branch by default.
 *   3. A branch-limited member cannot WRITE into a branch outside its scope,
 *      and no row is persisted.
 *   4. A branch-limited member cannot READ another branch's records.
 *   5. A multi-branch member can work in both branches.
 *   6. An all-branch (owner) member sees the whole tenant.
 *
 * Self-contained: creates its own users + records and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, insertAsUser, selectAsUser } from '../setup/qa-client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const OWNER_A = 'd2000000-0000-0000-0000-00000000000a';
const EMP_MAIN = 'd2000000-0000-0000-0000-0000000000e1';
const EMP_BOTH = 'd2000000-0000-0000-0000-0000000000e2';
const TAG = `QA-BRANCH-${Date.now()}`;

let mainBranch = '';
let warehouseBranch = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function cleanup() {
  await sql(`DELETE FROM sales WHERE sale_number LIKE '${TAG}%' OR sale_number LIKE 'QA-BRANCH-%'`).catch(() => undefined);
  await sql(`DELETE FROM audit_events WHERE user_id IN ('${OWNER_A}','${EMP_MAIN}','${EMP_BOTH}')`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE id IN ('${OWNER_A}','${EMP_MAIN}','${EMP_BOTH}')`).catch(() => undefined);
}

function saleRow(suffix: string, employeeId: string, branchId?: string) {
  const row: Record<string, any> = {
    sale_number: `${TAG}-${suffix}`,
    employee_id: employeeId,
    total_amount: 100,
    amount_paid: 100,
    amount_due: 0,
    shop_id: TENANT_A,
  };
  if (branchId) row.branch_id = branchId;
  return row;
}

beforeAll(async () => {
  await cleanup();

  const branches = await sql(
    `SELECT id, name FROM branches WHERE tenant_id = '${TENANT_A}' AND is_active = true ORDER BY is_default DESC, created_at`
  );
  mainBranch = branches.rows[0]?.id;
  warehouseBranch = branches.rows[1]?.id;
  expect(mainBranch).toBeTruthy();
  expect(warehouseBranch).toBeTruthy();

  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER_A}',  '${TAG} Owner',    '923009790001', 'admin',    true,  true, '${TENANT_A}'),
      ('${EMP_MAIN}', '${TAG} MainOnly', '923009790002', 'employee', false, true, '${TENANT_A}'),
      ('${EMP_BOTH}', '${TAG} TwoBranch','923009790003', 'employee', false, true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);

  // Owner: all branches (NULL scope). Employees: explicit scopes.
  await sql(`UPDATE memberships SET branch_scope = NULL WHERE user_id = '${OWNER_A}'`);
  await sql(`UPDATE memberships SET branch_scope = ARRAY['${mainBranch}']::uuid[] WHERE user_id = '${EMP_MAIN}'`);
  await sql(`UPDATE memberships SET branch_scope = ARRAY['${mainBranch}','${warehouseBranch}']::uuid[] WHERE user_id = '${EMP_BOTH}'`);
});

afterAll(async () => {
  await cleanup();
});

describe('Branch ownership — records are stamped with a branch', () => {
  it('stamps an all-branch owner record with the tenant default branch', async () => {
    const res = await insertAsUser(OWNER_A, 'sales', saleRow('owner-1', OWNER_A));
    expect(res.error).toBeNull();
    expect(res.data?.[0]?.branch_id).toBe(mainBranch);
  });

  it('stamps a branch-limited member record with its OWN branch', async () => {
    const res = await insertAsUser(EMP_MAIN, 'sales', saleRow('main-1', EMP_MAIN));
    expect(res.error).toBeNull();
    expect(res.data?.[0]?.branch_id).toBe(mainBranch);
  });

  it('kept branch ownership on existing history (no orphan rows)', async () => {
    const orphans = await sql(`SELECT count(*)::int AS c FROM sales WHERE branch_id IS NULL`);
    expect(orphans.rows[0].c).toBe(0);
  });
});

describe('Branch scope — writes outside the scope are refused', () => {
  it('refuses a write into another branch and persists nothing', async () => {
    const res = await insertAsUser(EMP_MAIN, 'sales', saleRow('main-bad', EMP_MAIN, warehouseBranch));
    expect(res.error).toContain('branch access denied');

    const persisted = await sql(`SELECT count(*)::int AS c FROM sales WHERE sale_number = '${TAG}-main-bad'`);
    expect(persisted.rows[0].c).toBe(0);
  });

  it('allows a multi-branch member to write in both of its branches', async () => {
    const inMain = await insertAsUser(EMP_BOTH, 'sales', saleRow('both-main', EMP_BOTH, mainBranch));
    const inWarehouse = await insertAsUser(EMP_BOTH, 'sales', saleRow('both-wh', EMP_BOTH, warehouseBranch));
    expect(inMain.error).toBeNull();
    expect(inWarehouse.error).toBeNull();
    expect(inMain.data?.[0]?.branch_id).toBe(mainBranch);
    expect(inWarehouse.data?.[0]?.branch_id).toBe(warehouseBranch);
  });
});

describe('Branch scope — reads are isolated per branch', () => {
  it('hides another branch record from a branch-limited member', async () => {
    const seen = await selectAsUser(EMP_MAIN, 'sales', 'id,sale_number,branch_id');
    expect(seen.error).toBeNull();
    const numbers = (seen.data ?? []).map((s: any) => s.sale_number);
    expect(numbers).not.toContain(`${TAG}-both-wh`);
    expect(numbers).toContain(`${TAG}-main-1`);
  });

  it('shows both branches to the multi-branch member', async () => {
    const seen = await selectAsUser(EMP_BOTH, 'sales', 'sale_number');
    const numbers = (seen.data ?? []).map((s: any) => s.sale_number);
    expect(numbers).toContain(`${TAG}-both-wh`);
    expect(numbers).toContain(`${TAG}-main-1`);
  });

  it('shows the whole tenant to an all-branch owner', async () => {
    const seen = await selectAsUser(OWNER_A, 'sales', 'sale_number');
    const numbers = (seen.data ?? []).map((s: any) => s.sale_number);
    expect(numbers).toContain(`${TAG}-both-wh`);
    expect(numbers).toContain(`${TAG}-main-1`);
  });
});

describe('Branch scope — tenant boundary still holds', () => {
  it('refuses a record addressed to another tenant', async () => {
    const res = await insertAsUser(EMP_BOTH, 'sales', {
      ...saleRow('cross-tenant', EMP_BOTH, warehouseBranch),
      shop_id: '00000000-0000-0000-0000-00000000c0c0',
    });
    expect(res.error).not.toBeNull();
    const persisted = await sql(`SELECT count(*)::int AS c FROM sales WHERE sale_number = '${TAG}-cross-tenant'`);
    expect(persisted.rows[0].c).toBe(0);
  });
});
