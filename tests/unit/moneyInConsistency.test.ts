import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_MONEY_IN, summariseMoneyIn } from '../../src/lib/money';
import { translations } from '../../src/lib/i18n';

/**
 * "Money in" is two events, and it used to be reported as one word in two arithmetics:
 *
 *   Home      "Credit collect"   Σ `customer_payments.amount`  — udhaar coming back
 *   Reports   "Cash collected"   Σ `sales.amount_paid`         — cash taken at the counter
 *
 * Same reading, different quantities, both right, and no way for an owner to tell. They now
 * come from `src/lib/money.ts` and are named for the question each answers. This guard keeps
 * them there: it fails if a screen starts adding the money up itself again, and if the two
 * labels ever become the same words once more.
 */

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), 'utf8');

/** Every screen that prints a money-in figure. */
const screens = [
  'src/pages/admin/dashboard/AdminDashboardPage.tsx',
  'src/pages/admin/reports/AdminReportsPage.tsx',
];

const sale = (over: Partial<Parameters<typeof summariseMoneyIn>[0]['sales'][number]> = {}) => ({
  amountPaid: 0,
  outstandingBalance: 0,
  createdAt: '2026-09-28T10:00:00.000Z',
  isVoided: false,
  ...over,
});

describe('money in has one calculation', () => {
  it('every money screen reads the shared module', () => {
    for (const file of screens) {
      expect(
        /from "@\/lib\/money"/.test(read(file)),
        `${file} reports money in without importing src/lib/money.ts`,
      ).toBe(true);
    }
  });

  it('no screen adds the money up itself', () => {
    // The exact shapes that drifted: the counter half summed from `sales.amountPaid`, and the
    // udhaar half read straight off the table. Both live in the module now, and only there.
    for (const file of screens) {
      const src = read(file);
      expect(src.includes('amountPaid'), `${file} sums the counter half itself`).toBe(false);
      expect(src.includes('customer_payments'), `${file} reads the payments table itself`).toBe(false);
    }
  });

  it('an empty period is zero, not undefined', () => {
    expect(summariseMoneyIn({ sales: [], payments: [] })).toEqual(EMPTY_MONEY_IN);
  });

  it('counter cash and udhaar are different events, and neither is the other', () => {
    // Cash handed over with the sale: counter only.
    const fromSale = summariseMoneyIn({
      sales: [sale({ amountPaid: 2000, outstandingBalance: 1500 })],
      payments: [],
    });
    expect(fromSale.counter).toBe(2000);
    expect(fromSale.udhaar).toBe(0);

    // An old bill settled later: udhaar only — the sale it belongs to is not in this period.
    const fromPayment = summariseMoneyIn({
      sales: [],
      payments: [{ amount: 1500, createdAt: '2026-09-28T11:00:00.000Z' }],
    });
    expect(fromPayment.counter).toBe(0);
    expect(fromPayment.udhaar).toBe(1500);

    // Both on the same day: the total is the money that actually came in.
    const both = summariseMoneyIn({
      sales: [sale({ amountPaid: 2000, outstandingBalance: 1500 })],
      payments: [{ amount: 1500, createdAt: '2026-09-28T11:00:00.000Z' }],
    });
    expect(both.total).toBe(both.counter + both.udhaar);
    expect(both.total).toBe(3500);
  });

  it('money given on credit is not money in', () => {
    const onlyCredit = summariseMoneyIn({
      sales: [sale({ amountPaid: 0, outstandingBalance: 5000 })],
      payments: [],
    });
    expect(onlyCredit.creditGiven).toBe(5000);
    expect(onlyCredit.total).toBe(0);
  });

  it('a voided sale hands over nothing', () => {
    const voided = summariseMoneyIn({
      sales: [sale({ amountPaid: 2000, outstandingBalance: 2000, isVoided: true })],
      payments: [],
    });
    expect(voided).toEqual(EMPTY_MONEY_IN);
  });

  it('a period is its two halves, and the halves of a period add up', () => {
    const inPeriod = (iso: string) => iso.startsWith('2026-09-28');
    const sales = [
      sale({ amountPaid: 1000, outstandingBalance: 500 }),
      sale({ amountPaid: 400, createdAt: '2026-09-27T09:00:00.000Z' }),
    ];
    const payments = [
      { amount: 300, createdAt: '2026-09-28T12:00:00.000Z' },
      { amount: 900, createdAt: '2026-09-01T12:00:00.000Z' },
    ];

    const day = summariseMoneyIn({ sales, payments, inPeriod });
    expect(day.counter).toBe(1000);
    expect(day.udhaar).toBe(300);
    expect(day.total).toBe(1300);

    // The same rows with no filter are the whole history, and nothing is lost or counted twice.
    const all = summariseMoneyIn({ sales, payments });
    expect(all.total).toBe(1400 + 1200);
  });
});

describe('the two money-in labels cannot be confused again', () => {
  it('the ambiguous "Cash collected" is gone', () => {
    expect((translations.en as Record<string, string>)['reports.cashCollected']).toBeUndefined();
    expect((translations.ur as Record<string, string>)['reports.cashCollected']).toBeUndefined();
  });

  it('each figure is named for what it is, in both languages', () => {
    const en = translations.en as Record<string, string>;
    const ur = translations.ur as Record<string, string>;
    for (const key of ['reports.moneyIn', 'reports.counterCash', 'reports.creditCollected', 'inline.credit_collect']) {
      expect(en[key], `${key} missing from English`).toBeTruthy();
      expect(ur[key], `${key} missing from Urdu`).toBeTruthy();
    }
    // The whole point of the rename: the counter and the credit figure must not read the same.
    expect(en['reports.counterCash']).not.toBe(en['reports.creditCollected']);
    expect(ur['reports.counterCash']).not.toBe(ur['reports.creditCollected']);
  });

  it('English never says "udhaar" or "khata" — Urdu keeps its own words', () => {
    // The owner's rule: one English word for credit everywhere, however it was written before.
    const banned = [/\budhaar\b/i, /\bkhata\b/i];
    const en = translations.en as Record<string, string>;
    const offenders = Object.entries(en)
      .filter(([, value]) => banned.some((re) => re.test(value)))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
