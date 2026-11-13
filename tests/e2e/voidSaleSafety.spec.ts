/**
 * E2E: voiding a sale — the confirmation has to mean something, and it must fire once.
 *
 * Two things were wrong on this dialog and both are the kind this product cannot
 * afford. It said "Are you sure you want to void this sale?" — a question that tells
 * the owner nothing about stock, the customer's balance, or the history, when voiding
 * is the most consequential action in the app. And its confirm button had no
 * re-entry protection: a double tap sent two void calls, and because the second is
 * now correctly refused by the database, the owner saw an ERROR toast immediately
 * after a successful void.
 *
 * Real Chrome, QA database only.
 */
import { test, expect } from './base';
import { randomUUID } from 'crypto';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  claimOwned,
  ownership,
  trackOwned,
  injectAdminAuth,
} from './helpers';
import {
  captureSharedCells,
  restorationStatements,
  sharedCellLabel,
  type CapturedSharedCell,
} from './sharedRowRestore';
import { runCleanupStatements, runTeardownSteps } from '../setup/ownedCleanup';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const SALE_ID = randomUUID();
const SALE_ITEM_ID = randomUUID();
const SALE_NUMBER = `QA-VOID-${Date.now().toString(36).toUpperCase()}`;
const QTY = 2;

/** The shared cells this lane writes, with the value each had BEFORE it wrote. Filled in beforeAll. */
const sharedCells: CapturedSharedCell[] = [];

test.describe('Void sale safety', () => {
  test.beforeAll(async () => {
    await setupFixtures();

    // CAPTURE BEFORE THE FIRST WRITE. This lane decrements the shared variant's stock and the void
    // in the body is what puts it back — so when an assertion above the void failed, QA Variant A
    // stayed at 98 for every lane that followed, and the next run read that leftover as the fixture.
    // The original value is read here, and restored from it in afterAll.
    //
    // THE CUSTOMER'S MONEY IS PART OF THE SAME WRITE. The sale below is INSERTed directly, so the
    // customer's totals were never incremented — but the void that this lane drives goes through
    // `void_sale`, whose accounting subtracts the unpaid amount from `outstanding_balance` and the
    // sale total from `total_purchases` (0227 lines 108/113). Measured by the full E2E run on
    // 2026-10-18: the lane passed and left QA Customer A at 29000 / 79000 — minus exactly this
    // sale's 1000 — which the QA baseline reported as drift two minutes later. The two columns are
    // captured here and restored in afterAll, like every other lane that moves them.
    sharedCells.push(
      ...(await captureSharedCells(execSql, [
        { table: 'product_variants', column: 'stock_qty', id: QA_IDS.variantA },
        { table: 'customers', column: 'outstanding_balance', id: QA_IDS.customerA },
        { table: 'customers', column: 'total_purchases', id: QA_IDS.customerA },
      ])),
    );

    await execSql(`
      INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status,
        payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, created_at, updated_at)
      VALUES ('${SALE_ID}', '${SALE_NUMBER}', '${QA_IDS.customerA}', '${QA_IDS.admin}', ${QTY * 500}, 'completed',
        'credit', 'cash', 0, ${QTY * 500}, 0, false, '${QA_IDS.shop}', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await execSql(`
      INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, line_total)
      VALUES ('${SALE_ITEM_ID}', '${SALE_ID}', '${QA_IDS.productA}', 'QA Product A', '${QA_IDS.variantA}', '1kg', ${QTY}, 500, ${QTY * 500})
      ON CONFLICT (id) DO NOTHING
    `);
    await execSql(`UPDATE product_variants SET stock_qty = stock_qty - ${QTY} WHERE id = '${QA_IDS.variantA}'`);

    // OWNED: the sale this lane creates, by its explicit id. Its line items, its void and its
    // stock movement are removed through that key rather than by re-stating the joins here.
    await trackOwned(ownership(), 'sales', SALE_ID);
  });

  test.afterAll(async () => {
    // Nothing is deleted inline any more: the four deletes that used to run here (movements,
    // voids, items, then the sale — by this lane's own ids, with every error swallowed) are
    // replaced by the registry, which deletes the same rows in FK order and FAILS the lane if a
    // delete does not succeed.
    //
    // The restore runs first and always: it is a teardown, not the body's last line, and both it
    // and the registry report their own failures instead of swallowing them.
    await runTeardownSteps([
      {
        label: `restore ${sharedCells.map(sharedCellLabel).join(', ') || 'the shared cells this lane mutates'}`,
        run: () =>
          runCleanupStatements(execSql, restorationStatements(sharedCells), 'voidSaleSafety shared-row restore'),
      },
      { label: 'remove the rows this lane owns', run: () => cleanupFixtures() },
    ]);
  });

  test('the confirmation names the sale, explains the consequence, and double-tapping it voids once', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/admin/sales/${SALE_ID}`);
    await page.waitForLoadState('networkidle');

    // The shipped label is t("admin.voidSale") = "Delete this sale" — the action is
    // offered in the owner's own language; the row stays in the history, marked deleted.
    await page.locator('[data-testid="sale-void"]').click();

    // The dialog must identify WHICH sale, and say what will happen to stock, the
    // balance and the history — not ask a generic "are you sure?".
    const named = page.getByText(new RegExp(`Sale ${SALE_NUMBER.replace(/-/g, '\\-')} will be deleted`, 'i')).first();
    await expect(named, 'the dialog does not identify which sale is being deleted').toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/back into stock/i).first()).toBeVisible();
    await expect(page.getByText(/history/i).first()).toBeVisible();
    await expect(page.getByText(/are you sure/i)).toHaveCount(0);

    // A reason is required before voiding is allowed.
    const confirmBtn = page.getByRole('button', { name: /^delete this sale$/i }).last();
    await expect(confirmBtn).toBeDisabled();
    await page.locator('input[type="text"], input:not([type])').last().fill('QA void safety');

    // Two clicks in ONE task — a real double tap. The second must not report a
    // failure after the first one succeeded.
    await page.evaluate(() => {
      // The page's own "Delete this sale" opener also matches the text, so it is
      // excluded by its hook: only the dialog's confirm button may be double-tapped.
      const btns = Array.from(document.querySelectorAll('button')).filter((b) =>
        /^delete this sale$/i.test((b.textContent || '').trim()) &&
        b.getAttribute('data-testid') !== 'sale-void'
      ) as HTMLButtonElement[];
      const btn = btns[btns.length - 1];
      if (!btn) throw new Error('void confirm button not found');
      btn.click();
      btn.click();
    });

    // Watch the toast surface for the whole life of a toast (they self-dismiss after
    // 3s) — an error that appears and then disappears would pass a single check at
    // the end, which is exactly the mistake a weaker version of this test made.
    let sawSuccess = false;
    let sawFailureWord = false;
    for (let i = 0; i < 50; i++) {
      // page.evaluate does not auto-wait: a locator read inside this loop would wait
      // 10s every time the toast is absent, which is most of the loop.
      const text = await page.evaluate(() => {
        const el = document.querySelector('div.fixed[style*="--tabbar-height"]');
        return el ? (el as HTMLElement).innerText : '';
      }).catch(() => '');
      // The shipped success toast is t("copy.saleCancelled") = "Sale deleted. The item is
      // back in stock." It used to be the literal "Sale voided successfully", which this
      // control looked for — so once the wording moved into the dictionary, the control
      // silently stopped seeing the toast.
      if (text.includes('Sale deleted')) sawSuccess = true;
      // friendly() maps an unrecognised refusal ("Sale is already voided") to this
      // sentence; seeing it right after a successful void is the misinformation.
      if (/did not work/i.test(text)) sawFailureWord = true;
      await page.waitForTimeout(100);
    }
    expect(sawSuccess, 'control: the success toast must be observed, or this check proves nothing').toBe(true);
    expect(sawFailureWord, 'the second tap must not report a failure after the void already succeeded').toBe(false);

    const voids = await execSql(`SELECT count(*)::int AS n FROM voids WHERE sale_id = '${SALE_ID}'`);
    expect(voids[0].n, 'a double tap must record exactly one void').toBe(1);

    const flags = await execSql(`SELECT is_voided FROM sales WHERE id = '${SALE_ID}'`);
    expect(flags[0].is_voided).toBe(true);

    // Stock is restored exactly once.
    const stock = await execSql(`SELECT stock_qty FROM product_variants WHERE id = '${QA_IDS.variantA}'`);
    expect(Number(stock[0].stock_qty)).toBe(100);

    // The movement the void wrote points at THIS lane's sale, so it is owned by that exact
    // foreign key — the one relation the sale id alone cannot express in the cleanup graph.
    await claimOwned(
      'inventory_movements',
      `SELECT id FROM inventory_movements WHERE reference_id = '${SALE_ID}'`,
    );
  });
});
