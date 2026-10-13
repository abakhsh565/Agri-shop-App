/**
 * supplierPayableFreshness — a screen that changes a supplier's payable refreshes the suppliers.
 *
 * THE DEFECT THIS PREVENTS, measured through the running app before it was fixed
 * (docs/LOCAL_DEVELOPMENT.md §8.8 and §9.3):
 *
 *   Recording a purchase made the Payments screen report “We owe suppliers Rs. 0” and “No suppliers
 *   to pay — All suppliers are settled” while `companies.outstanding_payable` held 96,000 and the
 *   Purchases screen itself showed “Rs. 96,000 to pay”. A supplier payment had the mirror-image
 *   result. A fresh page load showed the right number, so nothing was wrong with the data — the
 *   in-session state was stale.
 *
 * WHY IT IS A STORE PROBLEM AND NOT A FETCH PROBLEM. `companies` is loaded once by the shell
 * (`useBootstrapData`) and then maintained by Realtime. Both are asynchronous: the shell's read is
 * long finished by the time the shopkeeper taps Confirm, and a Realtime event is a network round
 * trip on a socket that may be down — and while the publication is missing (0199 exists because it
 * was) none arrives at all. So the number the owner just changed was the one number that did not
 * move, on the two screens whose whole purpose is that number.
 *
 * THE RULE, and the reason this is a guard rather than two lines of code: a NEW screen that moves a
 * payable will be written by copying an existing one, and the fastest thing to leave out is the
 * refresh. `RecordCustomerPaymentPage` already did it for customers, which is why the customer half
 * never showed the symptom — the pattern was there to copy and was copied for `companies` only after
 * the bug was measured. This checks the property, not the paragraph: after the write, before the
 * navigation, the store is re-read.
 *
 * NON-VACUITY. A guard that cannot fail reads as evidence. The last block takes the real source,
 * removes the refresh, and asserts the checker reports it — then moves the refresh ABOVE the write,
 * which is the subtler mistake: it compiles, it looks identical at a glance, and it fetches the
 * payable from before the purchase.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

interface Screen {
  file: string;
  /** The call that changes the payable. */
  write: string;
  /** Where the screen goes afterwards — the refresh must land before this. */
  then: string;
}

/**
 * Every screen in the app that changes a supplier's payable. Two of them exist today: recording the
 * delivery (the payable grows) and paying the supplier (it shrinks).
 */
const SCREENS: Screen[] = [
  {
    file: 'src/pages/admin/purchases/RecordPurchasePage.tsx',
    write: 'rpcCreatePurchase(',
    then: 'navigate("/admin/purchases"',
  },
  {
    file: 'src/pages/admin/payments/RecordSupplierPaymentPage.tsx',
    write: 'rpcRecordSupplierPayment(',
    then: 'navigate("/admin/payments"',
  },
];

const source = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const REFRESH = 'useCompaniesStore.getState().load()';

/**
 * Does this screen re-read the suppliers after it changed them?
 *
 * Returns the problems it found, in the same style as the other source-reading guards: an empty
 * array is a pass, and each message names what a reader of the rendered screen would see.
 */
function refreshProblems(code: string, screen: Screen): string[] {
  const problems: string[] = [];
  const write = code.indexOf(screen.write);
  const refresh = code.indexOf(REFRESH);
  const then = code.indexOf(screen.then);

  if (write === -1) {
    problems.push(`${screen.file} no longer calls ${screen.write}, so this guard cannot find the write`);
    return problems;
  }
  if (then === -1) problems.push(`${screen.file} no longer navigates on success, so there is no point the refresh must precede`);

  if (refresh === -1) {
    problems.push(
      `${screen.file} changes the supplier's payable and never re-reads the companies store, so Payments, Alerts and the supplier's own screen keep showing the balance from before the change until something else refreshes it`,
    );
    return problems;
  }
  if (refresh < write) {
    problems.push(
      `${screen.file} refreshes the suppliers BEFORE the write, so the store holds the payable from before the change`,
    );
  }
  if (then !== -1 && refresh > then) {
    problems.push(
      `${screen.file} refreshes the suppliers only after it has already navigated away, so the screen it lands on reads the stale store`,
    );
  }

  return problems;
}

describe('a screen that changes a supplier payable re-reads the suppliers', () => {
  it('reads both screens as real files, not empty strings', () => {
    for (const screen of SCREENS) {
      const code = source(screen.file);
      expect(code.length, `${screen.file} is suspiciously small`).toBeGreaterThan(1000);
      expect(code).toContain(screen.write);
      // If the import were dropped the check would pass on an unresolvable name.
      expect(code).toContain('useCompaniesStore');
    }
  });

  it.each(SCREENS)('$file refreshes after the write and before the navigation', (screen) => {
    expect(refreshProblems(source(screen.file), screen)).toEqual([]);
  });

  it('covers every screen that calls a payable-changing RPC, not just the two known ones', () => {
    // A third screen (say, a combined "record delivery and pay the rest") would otherwise be added
    // without appearing here. This walks the tree for the two RPC names and fails if a file that
    // calls one is not in the list above.
    // `src/lib/db.ts` holds the definitions (`export async function rpcCreatePurchase`), so it
    // names both writes without being a screen that changes a payable.
    const DEFINES_THE_RPCS = 'src/lib/db.ts';
    const walked: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(rel);
        else if (/\.tsx?$/.test(entry.name)) {
          const file = rel.replace(/\\/g, '/');
          if (file === DEFINES_THE_RPCS) continue;
          const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
          if (SCREENS.some((s) => code.includes(s.write))) walked.push(file);
        }
      }
    };
    visit('src');

    expect(walked.sort()).toEqual(SCREENS.map((s) => s.file).sort());
  });
});

/**
 * The other half of the same defect: one label, two definitions.
 *
 * The Purchases header read “Outstanding Supplier Payable” and summed the deliveries' own residuals
 * (`purchases.amount_due` = `total - paid` at the moment each delivery was recorded), while the
 * Payments screen read `companies.outstanding_payable` — the balance a supplier payment actually
 * reduces. Nothing allocates a payment to a delivery (`supplier_payments` has no `purchase_id`), so
 * the two agreed only until the first payment: the delivery kept saying “Rs. 96,000 to pay” beside a
 * supplier balance of zero. Refreshing could never fix that, which is why it needs its own rule.
 */
function payableDefinitionProblems(sources: { purchases: string; payments: string }): string[] {
  const problems: string[] = [];
  const screens: Array<[string, string]> = [
    ['AdminPurchasesPage', sources.purchases],
    ['AdminPaymentsPage', sources.payments],
  ];

  for (const [name, code] of screens) {
    if (!code.includes('useCompaniesStore')) {
      problems.push(`${name} no longer reads the suppliers, so its payable total is not the supplier balance`);
    }
    if (!/outstandingPayable\s*>\s*0/.test(code)) {
      problems.push(`${name} no longer restricts the total to suppliers that are actually owed money`);
    }
  }

  // The specific regression: a shop-level payable computed from the delivery rows.
  if (/purchases(\.reduce|\s*\n?\s*\.reduce)\(/.test(sources.purchases)) {
    problems.push(
      'AdminPurchasesPage sums the deliveries into a shop-level payable again, so a delivery whose supplier was paid later still counts as owed',
    );
  }

  return problems;
}

describe('both screens take “what we owe suppliers” from the one figure that means it', () => {
  const FILES = {
    purchases: 'src/pages/admin/purchases/AdminPurchasesPage.tsx',
    payments: 'src/pages/admin/payments/AdminPaymentsPage.tsx',
  } as const;
  const read = () => ({ purchases: source(FILES.purchases), payments: source(FILES.payments) });

  it('reads both screens as real files', () => {
    const sources = read();
    expect(sources.purchases.length).toBeGreaterThan(1000);
    expect(sources.payments.length).toBeGreaterThan(1000);
  });

  it('agrees by construction: both total the suppliers\u2019 balances', () => {
    expect(payableDefinitionProblems(read())).toEqual([]);
  });

  it('says which number a delivery row is showing', () => {
    // The per-delivery residual is a real figure and stays; it must not read as the shop's balance.
    expect(read().purchases).toContain('purchases.unpaidOnDelivery');
    expect(source(FILES.purchases)).not.toContain('t("common.payable")');
  });

  it('is not vacuous: it catches the header summing the deliveries again', () => {
    const sources = read();
    const mutated = {
      ...sources,
      purchases: `${sources.purchases}\nconst totalPayable = purchases.reduce((s, p) => s + p.outstandingPayable, 0);\n`,
    };
    expect(payableDefinitionProblems(mutated).join(' ')).toContain('sums the deliveries');
  });

  it('is not vacuous: it catches a screen that stops reading the suppliers', () => {
    const sources = read();
    const withoutReading = sources.payments.replaceAll('useCompaniesStore', 'someOtherStore');
    expect(withoutReading).not.toBe(sources.payments);
    expect(payableDefinitionProblems({ ...sources, payments: withoutReading }).join(' ')).toContain(
      'no longer reads the suppliers',
    );
  });
});

describe('the guard is not vacuous', () => {
  const screen = SCREENS[0];
  const code = source(screen.file);
  // No trailing newline: the pages are checked out with CRLF endings, so `…;\n` is not the text on
  // disk and a pattern that assumes it silently matches nothing — the deletion below would then
  // "pass" while changing the file by zero characters.
  const refreshStatement = `      await ${REFRESH};`;

  /** The real source with the refresh taken out, so an injection can put it back somewhere else. */
  function withoutRefresh(): string {
    const stripped = code.replace(refreshStatement, '');
    expect(stripped.length).toBeLessThan(code.length);
    return stripped;
  }

  it('catches the refresh being deleted', () => {
    expect(code, 'the refresh must be findable to delete it').toContain(refreshStatement);
    const mutated = withoutRefresh();
    expect(refreshProblems(mutated, screen).join(' ')).toContain('never re-reads the companies store');
  });

  it('catches the refresh moved above the write', () => {
    const stripped = withoutRefresh();
    const at = stripped.indexOf(screen.write);
    expect(at, 'the write must be findable to move the refresh above it').toBeGreaterThan(-1);
    // One line up is enough: it is now before the RPC and still before the navigation.
    const lineStart = stripped.lastIndexOf('\n', at) + 1;
    const mutated = `${stripped.slice(0, lineStart)}${refreshStatement.trimStart()}\n${stripped.slice(lineStart)}`;
    expect(mutated).toContain(REFRESH);
    expect(refreshProblems(mutated, screen).join(' ')).toContain('BEFORE the write');
  });

  it('catches the refresh left until after the navigation', () => {
    const stripped = withoutRefresh();
    const at = stripped.indexOf(screen.then);
    expect(at).toBeGreaterThan(-1);
    // AFTER the navigation line ends, not at its first character — this is the shape a copy-paste
    // produces when the refresh is added as the last statement of the function.
    const lineEnd = stripped.indexOf('\n', at) + 1;
    const mutated = `${stripped.slice(0, lineEnd)}${refreshStatement}\n${stripped.slice(lineEnd)}`;
    expect(mutated).toContain(REFRESH);
    expect(refreshProblems(mutated, screen).join(' ')).toContain('already navigated away');
  });
});
