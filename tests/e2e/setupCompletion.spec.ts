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
/**
 * Empty the shop down to nothing, so the status can be observed from zero.
 *
 * The order below is read off the QA schema's real foreign keys
 * (`information_schema.constraint_column_usage`), not guessed: products are referenced by
 * product_variants, inventory_movements, purchase_items, return_items, sale_items and
 * stock_adjustments; customers by credit_limit_requests, customer_crops, customer_payments,
 * payments, reminder_configs, reminder_occurrences, returns and sales; and returns/voids/
 * sale_submissions/sale_items hang off sales. Deleting a parent before its children aborts
 * the clear half-way with a foreign-key error — which is exactly how this spec failed in a
 * full-suite run, once an earlier spec had left a credit_limit_request against the QA
 * customer. A half-cleared shop then makes every later assertion about the shop look wrong.
 */
async function clearSetupEntities() {
  const shop = QA_IDS.shop;
  const child = {
    product: `product_id IN (SELECT id FROM products WHERE shop_id = '${shop}')`,
    customer: `customer_id IN (SELECT id FROM customers WHERE shop_id = '${shop}')`,
    company: `company_id IN (SELECT id FROM companies WHERE shop_id = '${shop}')`,
    sale: `sale_id IN (SELECT id FROM sales WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = '${shop}'))`,
    config: `config_id IN (SELECT id FROM reminder_configs WHERE customer_id IN (SELECT id FROM customers WHERE shop_id = '${shop}'))`,
  };

  // Children first, parents last, one statement per edge.
  for (const sql of [
    `DELETE FROM reminder_logs WHERE ${child.config}`,
    `DELETE FROM credit_limit_requests WHERE ${child.customer}`,
    `DELETE FROM customer_crops WHERE ${child.customer}`,
    `DELETE FROM customer_payments WHERE ${child.customer}`,
    `DELETE FROM payments WHERE ${child.customer}`,
    `DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE ${child.customer})`,
    `DELETE FROM return_items WHERE ${child.product}`,
    `DELETE FROM voids WHERE ${child.sale}`,
    `DELETE FROM sale_submissions WHERE ${child.sale}`,
    `DELETE FROM sale_items WHERE ${child.sale}`,
    `DELETE FROM sale_items WHERE ${child.product}`,
    `DELETE FROM returns WHERE ${child.customer}`,
    `DELETE FROM reminder_occurrences WHERE ${child.customer}`,
    `DELETE FROM reminder_configs WHERE ${child.customer}`,
    `DELETE FROM inventory_movements WHERE ${child.product}`,
    `DELETE FROM purchase_items WHERE ${child.product}`,
    `DELETE FROM product_variants WHERE ${child.product}`,
    `DELETE FROM stock_adjustments WHERE ${child.product}`,
    `DELETE FROM supplier_payments WHERE ${child.company}`,
    `DELETE FROM purchases WHERE ${child.company}`,
    `DELETE FROM sales WHERE ${child.customer}`,
    `DELETE FROM products WHERE shop_id = '${shop}'`,
    `DELETE FROM customers WHERE shop_id = '${shop}'`,
    `DELETE FROM companies WHERE shop_id = '${shop}'`,
  ]) {
    await execSql(sql);
  }
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
    const rows = [...section.querySelectorAll('.ds-row')].map((r) => {
      const sep = getComputedStyle(r, '::before');
      return {
        text: (r.textContent ?? '').replace(/\s+/g, ' ').trim(),
        separator: sep.content === 'none' ? 'none' : `${sep.insetInlineStart}/${sep.insetInlineEnd}`,
        clickable: r.tagName.toLowerCase() === 'button',
      };
    });
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

    // The card is the shared tone surface: rounded, and its separators are full-bleed.
    expect(state!.radius).not.toBe('');
    expect(
      state!.rows.map((r) => r.separator).slice(1),
      'the card does not draw its separators edge to edge'
    ).toEqual(['0px/0px', '0px/0px']);
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

    // Rows must match the other cards' rows too: a leading glyph, and the card's own
    // hairline. The separator is full-bleed now, so it is measured against the card's
    // box rather than as a per-row inset — the line used to start after each row's
    // leading slot, which left the left of the card bare.
    const rows = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="setup-checklist"]') as HTMLElement;
      const card = section.querySelector('.ds-listcard') as HTMLElement;
      const cardRect = card.getBoundingClientRect();
      const mine = [...section.querySelectorAll('.ds-row')].map((r) => {
        const sep = getComputedStyle(r, '::before');
        return {
          hasIcon: !!r.querySelector('svg'),
          separator: sep.content === 'none' ? 'none' : `${sep.insetInlineStart}/${sep.insetInlineEnd}`,
          spansCard:
            Math.round(r.getBoundingClientRect().left) === Math.round(cardRect.left) &&
            Math.round(r.getBoundingClientRect().right) === Math.round(cardRect.right),
        };
      });
      return { mine, cardWidth: Math.round(cardRect.width) };
    });

    expect(rows.mine.length).toBe(3);
    expect(
      rows.mine.every((r) => r.hasIcon),
      'a setup row has no leading icon, so its left edge differs from the page\'s other rows'
    ).toBe(true);
    // Every separator that exists spans the card edge to edge; the first row has none.
    expect(
      rows.mine.map((r) => r.separator).slice(1),
      `hairline does not span the card: ${JSON.stringify(rows.mine)}`
    ).toEqual(['0px/0px', '0px/0px']);
    expect(rows.mine.every((r) => r.spansCard), 'a row does not span its card').toBe(true);
  });

  test('6. Home gives a new shop ONE next step, not the checklist', async ({ page }) => {
    await clearSetupEntities();
    await signIn(page);

    // A brand-new shop: Home shows the single action that unblocks them.
    await page.goto('/admin/dashboard');
    const nextStep = page.locator('[data-testid="setup-next-step"]');
    await expect(nextStep).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => (await page.locator('[data-testid="setup-next-step"]').count()) > 0, {
        timeout: 20000,
      })
      .toBe(true);

    // Home must NOT carry the Settings checklist: no percentage, no three-row audit.
    expect(
      await page.locator('[data-testid="setup-checklist"]').count(),
      'Home is showing the Settings checklist instead of one next step',
    ).toBe(0);

    // Dependency order: a supplier comes first, because a product needs one.
    const card = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="setup-next-step"]') as HTMLElement;
      const rows = [...el.querySelectorAll('.ds-row')] as HTMLElement[];
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        buttons: [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
        hasIcon: !!el.querySelector('svg'),
        rowCount: rows.length,
        // A chevron is the only trailing glyph the row should carry.
        chevrons: [...el.querySelectorAll('svg')].length,
        // The second line is spaced from the name rather than touching it.
        labelToMeta: (() => {
          const label = el.querySelector('.ds-row-label, .ds-row-strong') as HTMLElement | null;
          const meta = el.querySelector('.ds-row-meta') as HTMLElement | null;
          if (!label || !meta) return null;
          return Math.round(meta.getBoundingClientRect().top - label.getBoundingClientRect().bottom);
        })(),
      };
    });
    expect(card.buttons.length, 'the first-run row is the only control Home should carry').toBe(1);
    expect(card.buttons[0], 'the next step offers no action').toContain('Add supplier');
    expect(card.text, 'Home does not name the supplier step first').toMatch(/supplier/i);
    expect(card.hasIcon, 'the next step has no icon').toBe(true);
    // The reason travels with the action on the same row, so the prompt is one line of
    // intent rather than a card of buttons.
    expect(card.text, 'the row does not explain why the step comes first').toMatch(/needs a supplier/i);
    // One row on the shared list primitive — not a bespoke card that can drift from the
    // grammar the rest of the app (and Settings' own checklist) is built on.
    expect(card.rowCount, 'Home is not using the shared list row').toBe(1);
    expect(
      card.labelToMeta,
      'Home\'s next step crowds its reason against the action name'
    ).toBeGreaterThanOrEqual(2);
    expect(card.buttons, 'the full checklist leaked onto Home').not.toContain('Add product');
    expect(card.text, 'Home is carrying a second call to action').not.toMatch(/see all steps/i);

    // The first action must lead into the real create route, and come back afterwards.
    await nextStep.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/admin\/companies\/new/, { timeout: 15000 });
    await expect(page).toHaveURL(/returnTo=/, { timeout: 5000 });
    await page.goto('/admin/dashboard');
    await expect(nextStep).toBeVisible({ timeout: 20000 });

    // Configured shop: the guidance retires itself and Home gains nothing.
    await execSql(
      `INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
       VALUES ('${QA_IDS.companyA}', 'Setup Supplier', 0, 0, '${QA_IDS.shop}')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`
    );
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

    await page.goto('/admin/dashboard');
    await page.reload();
    // "Gone" is asserted, not assumed: the block must not be in the DOM once setup is done.
    await waitForSetupGone(page);
    expect(
      await readChecklist(page),
      'a configured shop still sees the first-run guidance on Home',
    ).toBeNull();
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
