/**
 * E2E: business setup status is persistent, derived, and self-retiring.
 *
 * The requirement, on the real surface:
 *   "Show what required setup is complete and what is missing, let the user go straight
 *    to the missing item, derive the requirements from the existing business rules — and
 *    do not keep showing a checklist forever once setup is done."
 *
 * The required set is derived from the dependency graph (supplier → product → customer),
 * not chosen by hand, so this spec also proves the derivation is live: it changes the
 * underlying data and the status must follow.
 *
 *   1. empty business data  → 0% ready, all three rows missing, each offering its action
 *   2. one supplier added   → that row is done, the percentage moves
 *   3. all three present    → the whole block disappears (no nagging)
 *   4. Urdu / RTL           → the same block renders in Urdu with dir=rtl
 *
 * QA database only. Everything it creates is removed in afterAll.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSql, setupFixtures, cleanupFixtures, loginViaUi, QA_IDS } from './helpers';

const OWNER_PHONE = '923001234567';

// Sign-in goes through the repo's own helper rather than a hand-rolled copy: the OTP
// field auto-advances and an entry that lands one box off submits nothing and reports
// nothing, which reads exactly like a frozen screen. `loginViaUi` types the code as a
// person does and asserts each digit landed before trusting the navigation.
const signIn = (page: Page) => loginViaUi(page, OWNER_PHONE);

/**
 * Remove the setup entities in dependency order.
 *
 * Variants reference products and products reference companies, so the reverse order
 * fails on `products_company_id_fkey` — the database correctly refused to let a supplier
 * be deleted while stock still pointed at it.
 */
async function clearSetupEntities() {
  await execSql(
    `DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE shop_id = '${QA_IDS.shop}')`
  );
  await execSql(`DELETE FROM products WHERE shop_id = '${QA_IDS.shop}'`);
  await execSql(`DELETE FROM customers WHERE shop_id = '${QA_IDS.shop}'`);
  await execSql(`DELETE FROM companies WHERE shop_id = '${QA_IDS.shop}'`);
}

/** The checklist block, read from the live DOM rather than from source. */
/**
 * Wait for the status to be settled rather than sleeping.
 *
 * The three stores load asynchronously, so the block briefly reports "loading". A fixed
 * sleep either makes the suite slower than it needs to be or flakes; polling for a rendered
 * percentage is language-neutral (both languages print a "%") and waits exactly as long as
 * the data takes.
 */
async function waitForSetupReady(page: Page) {
  await expect
    .poll(async () => (await readChecklist(page))?.percent ?? 'still loading', { timeout: 25000 })
    .toContain('%');
}

/** Every required entity exists, so the block must stop rendering entirely. */
async function waitForSetupGone(page: Page) {
  await expect
    .poll(async () => (await readChecklist(page)) === null, { timeout: 25000 })
    .toBe(true);
}

/**
 * Read the block from the live DOM, addressed by a test id rather than by copy or class
 * names: the label is translated, and the section deliberately reuses the page's existing
 * `text-xs font-bold uppercase` header rather than a distinct heading element.
 */
async function readChecklist(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="setup-checklist"]') as HTMLElement | null;
    if (!section) return null;
    const rows = [...section.querySelectorAll('.ds-row')].map((r) => ({
      text: (r.textContent ?? '').replace(/\s+/g, ' ').trim(),
      inset: (r as HTMLElement).style.getPropertyValue('--row-inset'),
      clickable: r.tagName.toLowerCase() === 'button',
    }));
    const card = section.querySelector('.ds-listcard') as HTMLElement | null;
    return {
      heading: section.querySelector('p')?.textContent?.trim() ?? '',
      percent: section.querySelector('[data-testid="setup-percent"]')?.textContent?.trim() ?? '',
      rows,
      cards: section.querySelectorAll('.ds-listcard').length,
      radius: card ? getComputedStyle(card).borderRadius : '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      dir: document.documentElement.dir,
    };
  });
}

test.describe('Business setup status is derived and self-retiring', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    await clearSetupEntities();
    await cleanupFixtures();
  });

  test('1. empty shop: 0% ready, three missing steps, each with its action', async ({ page }) => {
    await clearSetupEntities();
    await signIn(page);
    await page.goto('/admin/settings');
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupReady(page);

    const state = await readChecklist(page);
    expect(state, 'setup checklist did not render').not.toBeNull();
    expect(state!.rows.length, 'one row per required entity in the graph').toBe(3);
    expect(state!.cards, 'the block uses the one list implementation').toBe(1);
    expect(state!.percent, 'nothing done yet').toContain('0');

    for (const label of ['Add supplier', 'Add product', 'Add customer']) {
      expect(state!.rows.map((r) => r.text).join(' | '), `missing step "${label}"`).toContain(label);
    }
    // A missing step must be actionable — that is the whole point of showing it.
    expect(state!.rows.filter((r) => r.clickable).length, 'missing steps are not tappable').toBe(3);

    // The card is the shared tone surface: rounded, and the row owns the separator inset.
    expect(state!.radius).not.toBe('');
    expect(state!.rows.every((r) => r.inset !== ''), 'row did not publish --row-inset').toBe(true);
    expect(state!.overflow, 'the block overflows at phone width').toBe(false);
  });

  test('2. adding a supplier moves the status, from the real data', async ({ page }) => {
    await execSql(
      `INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
       VALUES ('${QA_IDS.companyA}', 'Setup Supplier', 0, 0, '${QA_IDS.shop}')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`
    );

    await signIn(page);
    await page.goto('/admin/settings');
    await page.reload();
    await waitForSetupReady(page);

    const state = await readChecklist(page);
    expect(state).not.toBeNull();
    expect(state!.rows.length).toBe(3);
    expect(state!.percent, 'one of three done should read 33%').toContain('33');

    const supplierRow = state!.rows.find((r) => /supplier/i.test(r.text) && /Setup Supplier|supplier/i.test(r.text));
    expect(supplierRow, 'supplier row not found').toBeTruthy();
    // The done row no longer offers a create action.
    expect(supplierRow!.clickable, 'a completed step still offers its create action').toBe(false);
    expect(supplierRow!.text).not.toContain('Add supplier');
  });

  test('3. complete setup: the guidance disappears by itself', async ({ page }) => {
    await execSql(
      `INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
       VALUES ('${QA_IDS.productA}', 'Setup Product', '${QA_IDS.companyA}', 'seed', 10, '${QA_IDS.shop}')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`
    );
    await execSql(
      `INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
       VALUES ('${QA_IDS.customerA}', 'Setup Customer', '923000000901', 10000, 0, 0, 0, '${QA_IDS.shop}', 'QA')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`
    );

    await signIn(page);
    await page.goto('/admin/settings');
    await page.reload();
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupGone(page);

    const state = await readChecklist(page);
    expect(
      state,
      'setup is complete, so the checklist must not be rendered at all'
    ).toBeNull();
  });

  test('4. the block carries the Settings page\'s own section style, not a new one', async ({ page }) => {
    await clearSetupEntities();
    await signIn(page);
    await page.goto('/admin/settings');
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupReady(page);

    const styles = await page.evaluate(() => {
      const pick = (el: Element | null) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          textTransform: s.textTransform,
          letterSpacing: s.letterSpacing,
          color: s.color,
        };
      };
      const mine = document.querySelector('[data-testid="setup-checklist"] p');
      // An existing section on the same page, used as the reference for "matches Settings".
      const existing = [...document.querySelectorAll('p')].find((p) =>
        /appearance|ظاہری|رنگ/i.test(p.textContent ?? '')
      );
      const wrapper = document.querySelector('[data-testid="setup-checklist"]') as HTMLElement | null;
      const refWrapper = existing?.closest('div') as HTMLElement | null;
      return {
        mine: pick(mine),
        existing: pick(existing ?? null),
        minePad: wrapper ? getComputedStyle(wrapper).paddingInlineStart : '',
        refPad: refWrapper ? getComputedStyle(refWrapper).paddingInlineStart : '',
        radius: (() => {
          const c = document.querySelector('[data-testid="setup-checklist"] .ds-listcard');
          return c ? getComputedStyle(c).borderRadius : '';
        })(),
        refRadius: (() => {
          const c = refWrapper?.querySelector('.ds-listcard') ?? null;
          return c ? getComputedStyle(c).borderRadius : '';
        })(),
      };
    });

    expect(styles.mine, 'setup label not found').not.toBeNull();
    expect(styles.existing, 'reference section label not found').not.toBeNull();
    // Identical label treatment: same size, weight, transform, spacing and colour as the
    // page's other sections. A new heading style here is the thing being guarded against.
    expect(styles.mine, 'the setup label does not match the page\'s existing section labels')
      .toEqual(styles.existing);
    // Same gutter and same card radius as every other section on the page.
    expect(styles.minePad, 'section gutter differs from the rest of the page')
      .toBe(styles.refPad);
    expect(styles.radius, 'card radius differs from the rest of the page')
      .toBe(styles.refRadius);
  });

  test('5. Urdu / RTL renders the same block in Urdu', async ({ page }) => {
    await clearSetupEntities();
    await signIn(page);

    const stored = await page.evaluate(() => localStorage.getItem('agrishop-theme'));
    const parsed = stored ? JSON.parse(stored) : { state: {} };
    parsed.state = { ...(parsed.state ?? {}), language: 'ur' };
    await page.evaluate((v) => {
      localStorage.setItem('agrishop-theme', v);
      localStorage.setItem('agri_theme', v);
    }, JSON.stringify(parsed));
    await page.goto('/admin/settings');
    await page.reload();
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupReady(page);

    const state = await readChecklist(page);
    expect(state, 'setup checklist missing in Urdu').not.toBeNull();
    expect(state!.dir, 'the page did not switch to RTL').toBe('rtl');
    expect(state!.heading, 'Urdu heading not rendered').toMatch(/[\u0600-\u06FF]/);
    expect(state!.percent).toContain('0');
    expect(state!.overflow, 'RTL layout overflows at phone width').toBe(false);

    // No English leakage in the missing-step copy.
    const joined = state!.rows.map((r) => r.text).join(' | ');
    expect(joined, 'English leaked into the Urdu checklist').not.toContain('Add supplier');
    expect(joined).toMatch(/[\u0600-\u06FF]/);

    await page.evaluate(() => localStorage.removeItem('agrishop-theme'));
  });
});
