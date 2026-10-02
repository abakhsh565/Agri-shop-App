/**
 * Permanent guard: a consequential submit must not rely on `disabled={loading}`.
 *
 * `disabled` is applied on the re-render. React batches, so two taps dispatched in one
 * JavaScript task — which is what a double tap actually is — both reach the handler
 * before that attribute exists. The owner reported the consequence three separate times
 * ("double-click confirm... it's created twice"), and it was found again on the employee
 * confirmation, the role delete, and four create screens.
 *
 * The protection has to be written synchronously (a ref), and for anything that moves
 * money or inventory it has to be claimed in the database too (an idempotency key).
 *
 * Two assertions:
 *   1. NO `if (<boolean useState>) return;` re-entry guard anywhere in src/ — that shape
 *      cannot protect a second click in the same task.
 *   2. Every consequential submit KEEPS its ref guard, and every submit that claims an
 *      idempotency key keeps doing so. A guard that is deleted is a regression even if
 *      the test suite stays green, so it is asserted here.
 *
 * If this fails, fix it with a ref. Do not delete the check.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

/**
 * `if (<state>) return;` is not a re-entry guard for a WRITE here: the caller is a
 * read-only refresh, so a repeat changes nothing.
 */
const STATE_GUARD_ALLOWED = new Map<string, string>([
  ['src/components/ui/PullToRefresh.tsx', 'guards a scroll gesture, and its caller only re-reads'],
]);

/** Consequential submits, and the ref that must protect each one. */
const REF_GUARDS: Record<string, string> = {
  'src/pages/admin/employees/AddEmployeePage.tsx': 'creatingRef',
  'src/pages/admin/employees/EmployeeDetailPage.tsx': 'statusBusyRef',
  'src/pages/admin/settings/RolesAccessPage.tsx': 'deletingRef',
  'src/components/sales/SaleDetailView.tsx': 'voidingRef',
  'src/pages/admin/inventory/AddProductPage.tsx': 'savingRef',
  'src/pages/admin/inventory/InventoryAdjustPage.tsx': 'submittingRef',
  'src/pages/admin/payments/RecordSupplierPaymentPage.tsx': 'submittingRef',
  'src/pages/admin/purchases/RecordPurchasePage.tsx': 'savingRef',
  'src/pages/admin/companies/AddCompanyPage.tsx': 'savingRef',
  'src/pages/admin/returns/AdminReturnConfirmPage.tsx': 'submittingRef',
  'src/pages/employee/customers/RecordCustomerPaymentPage.tsx': 'submittingRef',
  'src/pages/employee/returns/ReturnConfirmPage.tsx': 'submittingRef',
  // The LIVE sale confirm screen is CartPage (route `sale/cart`); SaleReviewPage is not routed.
  // Both are listed: deleting the ref from either is a regression, but only CartPage is reachable.
  'src/pages/employee/sale/CartPage.tsx': 'completingRef',
  'src/pages/employee/sale/SaleReviewPage.tsx': 'submittingRef',
};

/**
 * Submits whose action is claimed in the database by a client key. The key is what makes
 * a RETRY safe when the first attempt reached the database and only the answer was lost,
 * so the page must keep sending one.
 */
const KEY_CLAIMING = [
  'src/pages/admin/inventory/InventoryAdjustPage.tsx',
  'src/pages/admin/payments/RecordSupplierPaymentPage.tsx',
  'src/pages/admin/purchases/RecordPurchasePage.tsx',
  'src/pages/admin/returns/AdminReturnConfirmPage.tsx',
  'src/pages/employee/customers/RecordCustomerPaymentPage.tsx',
  'src/pages/employee/returns/ReturnConfirmPage.tsx',
  'src/pages/employee/sale/CartPage.tsx',
  'src/pages/employee/sale/SaleReviewPage.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (abs: string) => fs.readFileSync(abs, 'utf8');
const rel = (abs: string) => path.relative(process.cwd(), abs).split(path.sep).join('/');

describe('Re-entry protection', () => {
  it('no submit is guarded by a state variable, which cannot stop a double tap', () => {
    const offenders: string[] = [];

    for (const abs of files) {
      const src = read(abs);
      const stateNames = new Set(
        Array.from(src.matchAll(/const\s*\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/g)).map((m) => m[1])
      );
      if (stateNames.size === 0) continue;

      for (const m of src.matchAll(/if\s*\(\s*(\w+)\s*\)\s*return;/g)) {
        if (!stateNames.has(m[1])) continue;
        const file = rel(abs);
        if (STATE_GUARD_ALLOWED.has(file)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}  if (${m[1]}) return;`);
      }
    }

    expect(
      offenders,
      'these guards read a React state variable, which is still false for the second click in the same task — use a ref: `if (busyRef.current) return; busyRef.current = true;`',
    ).toEqual([]);
  });

  it('every consequential submit keeps its ref guard', () => {
    const missing: string[] = [];

    for (const [file, refName] of Object.entries(REF_GUARDS)) {
      const abs = path.join(process.cwd(), file);
      if (!fs.existsSync(abs)) {
        missing.push(`${file} — no longer exists`);
        continue;
      }
      const src = read(abs);
      const guards = new RegExp(`${refName}\\.current`);
      if (!guards.test(src)) {
        missing.push(`${file} — ${refName} is gone`);
        continue;
      }
      const declared = new RegExp(`const\\s+${refName}\\s*=\\s*useRef`);
      if (!declared.test(src)) missing.push(`${file} — ${refName} is not declared`);
    }

    expect(missing, 'a confirmed action lost its re-entry protection').toEqual([]);
  });

  it('submits that claim an idempotency key keep sending it', () => {
    const missing = KEY_CLAIMING.filter((file) => {
      const abs = path.join(process.cwd(), file);
      return !fs.existsSync(abs) || !/idempotencyKey/.test(read(abs));
    });

    expect(
      missing,
      'without the key, a retry after a lost answer is recorded as a second action',
    ).toEqual([]);
  });
});
