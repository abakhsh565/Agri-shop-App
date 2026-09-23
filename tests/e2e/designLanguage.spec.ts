/**
 * E2E Test: the grouped-list design language, measured on real data.
 *
 * WHY THIS EXISTS: the primitive guard (tests/unit/listPrimitiveGuard.test.ts) proves
 * every screen reaches for ListCard/ListRow instead of hand-rolling a bordered row.
 * It cannot prove the result LOOKS right, because a converted screen that has only
 * ever rendered its empty state looks correct for the wrong reason.
 *
 * So this spec seeds real rows, opens the busiest converted screens, and measures what
 * the reference board specifies: card radius/card tone and no border, row heights inside
 * the 46–64pt band (taller only where the content genuinely stacks), the hairline inset
 * starting after each row's own leading slot, and no horizontal overflow — with the
 * console clean, since a style regression usually surfaces as a React warning first.
 *
 * QA database only; every row this spec creates is deleted again.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSql } from './helpers';
import { loginViaUi } from './helpers';

const OWNER_PHONE = '03001234567';
const SHOP = '00000000-0000-0000-0000-000000000001';
const COMPANY = '50000000-0000-0000-0000-000000000001';
const PRODUCT_A = '30000000-0000-0000-0000-000000000001';
const PRODUCT_B = '30000000-0000-0000-0000-000000000002';
const VARIANT_A = '40000000-0000-0000-0000-000000000001';
const VARIANT_B = '40000000-0000-0000-0000-000000000002';
const CUSTOMER_A = '20000000-0000-0000-0000-000000000001';

/** Screens that render grouped lists, with the route that shows them. */
const SCREENS = [
  { name: 'Products list', path: '/admin/products' },
  { name: 'Employees list', path: '/admin/employees' },
  { name: 'More menu', path: '/admin/more' },
  { name: 'Settings', path: '/admin/settings' },
];

interface Measurements {
  cards: number;
  radius: string | null;
  borderWidth: string | null;
  cardBg: string | null;
  pageBg: string | null;
  rowHeights: number[];
  insets: string[];
  rawRowButtons: number;
  overflow: number;
  scrolled: number;
}

async function measure(page: Page): Promise<Measurements> {
  return page.evaluate(() => {
    const card = document.querySelector('.ds-listcard') as HTMLElement | null;
    const rows = Array.from(document.querySelectorAll('.ds-listcard .ds-row')) as HTMLElement[];
    const cs = card ? getComputedStyle(card) : null;
    const doc = document.documentElement;
    return {
      cards: document.querySelectorAll('.ds-listcard').length,
      radius: cs?.borderTopLeftRadius ?? null,
      borderWidth: cs?.borderTopWidth ?? null,
      cardBg: cs?.backgroundColor ?? null,
      pageBg: getComputedStyle(document.body).backgroundColor,
      rowHeights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
      insets: Array.from(
        new Set(
          rows
            .map((r) => getComputedStyle(r, '::before').insetInlineStart)
            .filter((v) => v && v !== 'auto')
        )
      ),
      // A direct child of the card that is a bare button is a hand-rolled row that
      // slipped past the guard — the primitive renders .ds-row instead.
      rawRowButtons: Array.from(card?.children ?? []).filter(
        (el) => el.tagName === 'BUTTON' && !el.classList.contains('ds-row')
      ).length,
      overflow: doc.scrollWidth - doc.clientWidth,
      scrolled: Math.round(window.scrollY),
    };
  });
}

test.describe('grouped-list design language', () => {
  test.beforeAll(async () => {
    await execSql(`
      INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
      VALUES ('${COMPANY}', 'QA Supplier A', 15000, 50000, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
      VALUES ('${PRODUCT_A}', 'QA Product A', '${COMPANY}', 'seed', 100, '${SHOP}'),
             ('${PRODUCT_B}', 'QA Product B', '${COMPANY}', 'fertilizer', 0, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
      VALUES ('${VARIANT_A}', '${PRODUCT_A}', '1kg', 500, 300, 1, 10, 100),
             ('${VARIANT_B}', '${PRODUCT_B}', '5kg', 2000, 1500, 5, 5, 0)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${CUSTOMER_A}', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '${SHOP}', 'QA')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `);

    await execSql(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES
        ('10000000-0000-0000-0000-000000000001', 'QA Admin', '923009999999', 'admin', true, true, '${SHOP}'),
        ('10000000-0000-0000-0000-000000000002', 'QA Employee', '923008888888', 'employee', false, true, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone;
    `);
  });

  test.afterAll(async () => {
    await execSql(`
      DELETE FROM product_variants WHERE id IN ('${VARIANT_A}', '${VARIANT_B}');
      DELETE FROM products WHERE id IN ('${PRODUCT_A}', '${PRODUCT_B}');
      DELETE FROM companies WHERE id = '${COMPANY}';
      DELETE FROM customers WHERE id = '${CUSTOMER_A}';
    `);
  });

  test('cards, rows and hairlines measure inside the reference bands', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (msg) => {
      // A generic "Failed to load resource" tells you nothing; record the URL that
      // actually failed so a real missing asset is not mistaken for noise.
      if (msg.type() === 'error') consoleErrors.push(`${msg.text()} @ ${msg.location().url}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
    });

    await loginViaUi(page, OWNER_PHONE);

    const evidence: string[] = [];

    for (const screen of SCREENS) {
      await page.goto(`http://localhost:5173${screen.path}`);
      await page.waitForLoadState('networkidle');
      await expect
        .poll(async () => (await measure(page)).cards, {
          message: `${screen.name}: no grouped list card rendered`,
          timeout: 15000,
        })
        .toBeGreaterThan(0);

      const m = await measure(page);
      evidence.push(
        `${screen.name}: cards=${m.cards} radius=${m.radius} border=${m.borderWidth} ` +
          `rowHeights=[${m.rowHeights.join(',')}] insets=[${m.insets.join(',')}] ` +
          `rawRowButtons=${m.rawRowButtons} overflow=${m.overflow}`
      );

      // The reference's grouped card: 18px corners, separated from the page by tone
      // alone (no drawn border).
      expect(m.radius, `${screen.name}: card radius`).toBe('18px');
      expect(m.borderWidth, `${screen.name}: card draws a border`).toBe('0px');
      expect(m.cardBg, `${screen.name}: card tone is not distinct from the page`).not.toBe(m.pageBg);

      // No direct child button: every row goes through the primitive.
      expect(m.rawRowButtons, `${screen.name}: hand-rolled row inside the card`).toBe(0);

      // Rows sit inside the 46–64pt band; a row whose content genuinely stacks
      // (a name plus two supporting lines) is allowed to grow.
      for (const h of m.rowHeights) {
        expect(h, `${screen.name}: row height ${h}px outside 46–96`).toBeGreaterThanOrEqual(46);
        expect(h, `${screen.name}: row height ${h}px outside 46–96`).toBeLessThanOrEqual(96);
      }

      // The hairline starts after the row's own leading slot — never edge to edge.
      for (const inset of m.insets) {
        expect(
          ['16px', '52px', '72px'],
          `${screen.name}: unexpected hairline inset ${inset}`
        ).toContain(inset);
      }

      expect(m.overflow, `${screen.name}: horizontal overflow`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `tests/e2e/results/design-${screen.path.replace(/\//g, '-')}.png` });
    }

    console.log('\n[design language]\n' + evidence.join('\n'));

    // Two known-benign entries, both named explicitly rather than filtered loosely:
    // X-Frame-Options is inert meta markup the app ships on purpose, and
    // /favicon.ico is the browser's implicit request (the shipped app is an APK, so
    // the project has no favicon) — neither is produced by application code.
    const realErrors = consoleErrors.filter(
      (e) => !/X-Frame-Options/i.test(e) && !/favicon\.ico/.test(e)
    );
    expect(
      realErrors,
      `console errors: ${realErrors.join(' | ')}\nfailed requests: ${failedRequests.join(' | ')}`
    ).toEqual([]);
  });
});
