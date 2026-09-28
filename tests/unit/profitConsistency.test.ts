import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lineCogs,
  refundedCogs,
  summariseSale,
  summariseSales,
  profitDisplay,
} from '../../src/lib/profit';
import type { SaleItem } from '../../src/types';

/**
 * Profit is one number with one meaning — "what I sold it for minus what I bought it for" —
 * and it had drifted into four different arithmetic in four different files:
 *
 *   Home      revenue − recorded COGS
 *   Reports   revenue − COGS (revenue re-summed from lines, so it drifted from Home)
 *   Sale page revenue − COGS − returns refunds (charging the sale the cost of goods that
 *             came back to the shelf, so a return cost the profit twice)
 *   Sales     `Math.round(total * 0.2)` — a flat fifth of whatever was sold, which is not
 *             anybody's margin, and which disagreed with the sale opened from that very list
 *
 * They all call src/lib/profit.ts now. This guard keeps them there.
 */
describe('profit has one calculation', () => {
  const root = process.cwd();
  const screens = [
    'src/pages/admin/dashboard/AdminDashboardPage.tsx',
    'src/pages/admin/sales/AdminSalesListPage.tsx',
    'src/pages/admin/reports/AdminReportsPage.tsx',
    'src/components/sales/SaleDetailView.tsx',
  ];

  it('no screen invents profit from a percentage of revenue', () => {
    // The exact shape of the old bug: revenue multiplied by a constant to make a "profit".
    const invented = /\b(total|revenue|amount|sales)\w*\s*\*\s*0?\.\d+/i;

    for (const file of screens) {
      const src = fs.readFileSync(path.resolve(root, file), 'utf8');
      const hits = src
        .split(/\r?\n/)
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => invented.test(line) && /profit/i.test(line));
      expect(hits, `${file} derives profit from a percentage of revenue`).toEqual([]);
    }
  });

  it('every profit on a screen comes from the shared calculation', () => {
    for (const file of screens) {
      const src = fs.readFileSync(path.resolve(root, file), 'utf8');
      expect(
        /from "@\/lib\/profit"/.test(src),
        `${file} computes a profit without importing src/lib/profit.ts`,
      ).toBe(true);
    }
  });

  const line = (over: Partial<SaleItem> = {}): SaleItem =>
    ({
      id: 'l1', saleId: 's1', productId: 'p1', productName: 'Lambda', variantId: 'v1',
      variantName: '5-KG', qty: 2, unitPrice: 100, unitSize: 5, baseUnit: 'kg',
      lineTotal: 200, ...over,
    }) as SaleItem;

  it('a cost nobody recorded is unknown, never free', () => {
    // The bug this exists for: a variant whose buying price was never entered holds 0, and
    // reading that as "the goods were free" turns the whole sale price into profit.
    expect(lineCogs(line({ cogsAmount: 0 }))).toBeNull();
    expect(lineCogs(line({ cogsAmount: undefined }))).toBeNull();
    expect(lineCogs(line({ cogsAmount: undefined }), () => 0)).toBeNull();
    expect(lineCogs(line({ cogsAmount: undefined }), () => undefined)).toBeNull();
    // A real recorded cost wins over today's price, so editing a product cannot rewrite the
    // profit of a sale already made.
    expect(lineCogs(line({ cogsAmount: 140 }), () => 999)).toBe(140);
    // The live price is only a fallback for lines the snapshot could not price.
    expect(lineCogs(line({ cogsAmount: undefined, qty: 2 }), () => 70)).toBe(140);
  });

  it('buy 70, sell 100, profit 30', () => {
    // The plain case, which is the one the shopkeeper checks by hand.
    const sale = { totalAmount: 100, items: [line({ qty: 1, unitPrice: 100, cogsAmount: 70 })] };
    const p = summariseSale(sale);
    expect(p.cogs).toBe(70);
    expect(p.profit).toBe(30);
    expect(p.margin).toBe(30);
    expect(profitDisplay(p)).toEqual({ kind: 'exact', amount: 30, margin: 30 });
  });

  it('reports a total it cannot stand behind as a floor, not as a figure', () => {
    const sale = {
      totalAmount: 300,
      items: [line({ cogsAmount: 70, qty: 1 }), line({ id: 'l2', cogsAmount: 0, qty: 1 })],
    };
    const partly = summariseSale(sale);
    expect(partly.cogs).toBe(70);
    expect(partly.unknownLines).toBe(1);
    expect(profitDisplay(partly)).toEqual({ kind: 'atLeast', amount: 230, margin: 77, unknownLines: 1 });

    const none = summariseSale({ totalAmount: 300, items: [line({ cogsAmount: 0 })] });
    expect(none.profit).toBe(300);
    expect(profitDisplay(none)).toEqual({ kind: 'unknown', unknownLines: 1 });
  });

  it('a return refunds the price and returns the goods, once', () => {
    const sale = {
      totalAmount: 400,
      items: [line({ qty: 4, unitPrice: 100, cogsAmount: 280 })],
    };
    const returnedQty = { 'Lambda-5-KG': 1 };
    // Cost per unit 70, so one returned unit gives back 70 of cost.
    expect(refundedCogs(sale, returnedQty)).toBe(70);
    // A return can never credit back more units than the line ever had.
    expect(refundedCogs(sale, { 'Lambda-5-KG': 99 })).toBe(280);
    // An unknown cost cannot be given back, and must not be invented as zero either.
    expect(refundedCogs({ items: [line({ cogsAmount: 0 })] }, returnedQty)).toBe(0);
  });

  it('a period is its sales, so a sale page cannot disagree with the list', () => {
    const s1 = { totalAmount: 100, items: [line({ cogsAmount: 70 })] };
    const s2 = { totalAmount: 250, items: [line({ id: 'l3', cogsAmount: 100 })] };
    const period = summariseSales([s1, s2]);
    expect(period.revenue).toBe(350);
    expect(period.profit).toBe(summariseSale(s1).profit + summariseSale(s2).profit);
    expect(period.complete).toBe(true);
  });
});
