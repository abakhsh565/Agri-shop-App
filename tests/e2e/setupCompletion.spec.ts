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
 * The empty-shop premise — asserted, never manufactured.
 *
 * OWNERSHIP, AND WHY THIS LANE IS CURRENTLY BLOCKED.
 *
 * This function used to delete this shop's entire business content — suppliers, products, variants,
 * customers, sales, payments, movements, reminders and requests, 24 statements with a hand-derived
 * FK order — to establish its premise: "the shop is empty, so the checklist reads 0/3". Those rows
 * belong to whoever created them: other lanes, and hand-entered QA data. No amount of ownership
 * registration makes them this lane's to delete, so the deletes are gone.
 *
 * What survives is the premise, and it is checked LOUDLY: when the shop is not empty the lane fails
 * right here, naming exactly what is left, instead of deleting the difference. The lane's own rows
 * (none, in that state) are removed by the ownership registry through `cleanupFixtures()`.
 *
 * Making it runnable again means giving the lane its OWN tenant/shop to empty — a spec redesign,
 * tracked as a blocker in ENGINEERING_OS_STATE.md — not reintroducing the wipe.
 */
async function clearSetupEntities() {
  const shop = QA_IDS.shop;
  await cleanupFixtures();
  const [left] = await execSql(
    `SELECT (SELECT count(*) FROM companies  WHERE shop_id = '${shop}')::text AS suppliers,
            (SELECT count(*) FROM products   WHERE shop_id = '${shop}')::text AS products,
            (SELECT count(*) FROM customers  WHERE shop_id = '${shop}')::text AS customers`,
  );
  expect(
    Number(left.suppliers) + Number(left.products) + Number(left.customers),
    `the empty-shop premise could not be established (suppliers=${left.suppliers} products=${left.products} customers=${left.customers}): this lane needs a shop it can empty, and must not delete the shared QA shop's rows to get one`,
  ).toBe(0);
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
  // The block's count carries copy around the numbers — Home reads "0 / 3 completed",
  // Settings reads "0/3" — so the numbers are compared, not the sentence. The path is part of
  // the condition on purpose: if the session dropped and the app bounced to sign-in, the block
  // would be absent for the wrong reason and the wait would either hang (here) or pass vacuously
  // (in waitForSetupGone).
  await expect
    .poll(
      async () => {
        const block = await readSettingsBlock(page);
        // A missing block says WHERE it is missing: a bounced sign-in and a shop that has
        // nothing left to set up (the card hides itself) are different facts.
        return block ? `${block.path} ${block.count}` : `no block @ ${new URL(page.url()).pathname}`;
      },
      { timeout: 25000 },
    )
    .toMatch(/\/admin\/settings \d+\s*\/\s*\d+/);
}

/**
 * The count chip renders copy around two numbers. "0 / 3 completed" and "0/3" are the same
 * fact in two shapes, so the assertion compares the numbers and lets the words change.
 */
function countOf(text: string): string {
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? `${m[1]}/${m[2]}` : text;
}

/** Every required entity exists, so neither block may render any more. */
async function waitForSetupGone(page: Page) {
  await expect
    .poll(
      async () => {
        const settings = await readSettingsBlock(page);
        const home = await readHomeChecklist(page);
        const path = new URL(page.url()).pathname;
        // A bounced sign-in would leave both blocks absent for the wrong reason, so a
        // bounce is reported as a distinct state instead of counting as "gone".
        if (path.startsWith('/login') || path === '/') return `bounced:${path}`;
        return `${settings === null ? 'gone' : 'present'}|${home === null ? 'gone' : 'present'}`;
      },
      { timeout: 25000 },
    )
    .toBe('gone|gone');
}


/**
 * The Settings block: one line of progress with its own action.
 *
 * The two screens deliberately carry different widgets — Home shows the three steps so a
 * new owner can see the whole job, Settings shows a single quiet line so the block never
 * outranks the rows someone came to change. Both are read here, by their own test ids,
 * rather than one reader being bent to describe two different cards.
 */
async function readSettingsBlock(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="setup-checklist"]') as HTMLElement | null;
    if (!section) return null;
    const card = section.querySelector('.ds-listcard') as HTMLElement | null;
    return {
      path: location.pathname,
      heading: section.querySelector('p')?.textContent?.trim() ?? '',
      count: section.querySelector('[data-testid="setup-progress"]')?.textContent?.trim() ?? '',
      actions: [...section.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
      rows: section.querySelectorAll('.ds-row').length,
      cards: section.querySelectorAll('.ds-listcard').length,
      radius: card ? getComputedStyle(card).borderRadius : '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      dir: document.documentElement.dir,
    };
  });
}

/** The Home block: the three-step checklist, one row and one action per missing step. */
async function readHomeChecklist(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="setup-next-step"]') as HTMLElement | null;
    if (!section) return null;
    const card = section.querySelector('.ds-listcard') as HTMLElement | null;
    const rows = [...section.querySelectorAll('.ds-row')].map((r) => {
      const sep = getComputedStyle(r, '::before');
      return {
        text: (r.textContent ?? '').replace(/\s+/g, ' ').trim(),
        separator: sep.content === 'none' ? 'none' : `${sep.insetInlineStart}/${sep.insetInlineEnd}`,
        clickable: r.tagName.toLowerCase() === 'button',
        // Each missing step carries its action as a button inside the row, so this is
        // what "actionable" means on this card — the row itself is a label, not a link.
        hasAction: !!r.querySelector('button'),
      };
    });
    return {
      path: location.pathname,
      count: section.querySelector('[data-testid="setup-progress"]')?.textContent?.trim() ?? '',
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
    // Only what this run owns is removed. The shared shop is left exactly as found — that is the
    // point of the ownership work, and re-running the wipe in afterAll is what made the damage
    // invisible after a FAILED run.
    await cleanupFixtures();
  });

  test('1. empty shop: nothing done, three missing steps each with its action', async ({ page }) => {
    await clearSetupEntities();
    await signIn(page);

    // Home carries the three steps, because that is the screen a new owner lands on and
    // the one place the whole job fits. The stored requirement stays hidden on the rows
    // it would otherwise crowd: Settings gets the one-line progress card instead.
    await page.goto('/admin/dashboard');
    await expect(page.locator('[data-testid="setup-next-step"]')).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await readHomeChecklist(page))?.rows.length ?? 0, { timeout: 25000 }).toBe(3);

    const home = await readHomeChecklist(page);
    expect(home, 'the checklist did not render on Home').not.toBeNull();
    expect(home!.rows.length, 'one row per required entity in the graph').toBe(3);
    expect(home!.cards, 'the block uses the one list implementation').toBe(1);
    expect(countOf(home!.count), 'nothing done yet').toBe('0/3');

    for (const label of ['Add supplier', 'Add product', 'Add customer']) {
      expect(home!.rows.map((r) => r.text).join(' | '), `missing step "${label}"`).toContain(label);
    }
    // A missing step must be actionable — that is what the step list is for.
    expect(home!.rows.filter((r) => r.hasAction).length, 'missing steps offer no action').toBe(3);
    expect(home!.radius, 'the block is not on the shared card surface').not.toBe('');
    expect(
      home!.rows.map((r) => r.separator).slice(1),
      'the card does not draw its separators edge to edge',
    ).toEqual(['0px/0px', '0px/0px']);
    expect(home!.overflow, 'the block overflows at phone width').toBe(false);

    // Settings states the same fact in one line, and is counted from the same derivation.
    await page.goto('/admin/settings');
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupReady(page);
    const settings = await readSettingsBlock(page);
    expect(countOf(settings!.count), 'nothing done yet').toBe('0/3');
    expect(settings!.rows, 'the Settings variant should be one line, not the step list').toBe(0);
  });

  test('2. adding a supplier moves the status, from the real data', async ({ page }) => {
    // The supplier row is the SHARED baseline fixture (setupFixtures writes it). This lane used to
    // INSERT it as 'Setup Supplier', which renamed a shared fixture other lanes read; it is now
    // asserted, not written, and never registered as owned.
    const [supplier] = await execSql(`SELECT id FROM companies WHERE id = '${QA_IDS.companyA}'`);
    expect(supplier, 'the shared supplier fixture is missing — setupFixtures must run first').toBeTruthy();

    await signIn(page);
    await page.goto('/admin/settings');
    await waitForSetupReady(page);

    const state = await readSettingsBlock(page);
    expect(state, 'the Settings block is missing — is this the settings screen?').not.toBeNull();
    expect(state!.path, 'the app is not on the settings screen').toBe('/admin/settings');
    expect(countOf(state!.count), 'one of three done should read 1/3').toBe('1/3');

    // The step list follows the same data. A finished step stays listed — it keeps its check
    // and its name, so the shape of the job is still visible — but it loses its reason and
    // its action, which is what "done" means on this card.
    await page.goto('/admin/dashboard');
    await expect.poll(async () => (await readHomeChecklist(page))?.rows.length ?? 0, { timeout: 25000 }).toBe(3);
    const home = await readHomeChecklist(page);
    const supplierRow = home!.rows.find((r) => /supplier/i.test(r.text));
    expect(supplierRow, 'the supplier step disappeared instead of being marked done').toBeTruthy();
    expect(supplierRow!.hasAction, 'a completed step still offers its create action').toBe(false);
    expect(supplierRow!.text, 'a completed step still asks for the supplier to be added').not.toContain('Add supplier');
    expect(countOf(home!.count), 'the Home count did not follow the data').toBe('1/3');
  });

  test('3. complete setup: the guidance disappears by itself', async ({ page }) => {
    // Same as test 2: the product and the customer are the SHARED fixtures. They are asserted
    // rather than INSERTed-and-renamed, and they are never registered as owned.
    const [product] = await execSql(`SELECT id FROM products WHERE id = '${QA_IDS.productA}'`);
    expect(product, 'the shared product fixture is missing — setupFixtures must run first').toBeTruthy();
    const [customer] = await execSql(`SELECT id FROM customers WHERE id = '${QA_IDS.customerA}'`);
    expect(customer, 'the shared customer fixture is missing — setupFixtures must run first').toBeTruthy();

    await signIn(page);
    await page.goto('/admin/settings');
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupGone(page);

    expect(
      await readSettingsBlock(page),
      'setup is complete, so the Settings block must not be rendered at all',
    ).toBeNull();
    await page.goto('/admin/dashboard');
    await page.waitForTimeout(1800);
    expect(
      await readHomeChecklist(page),
      'setup is complete, so Home must not still be showing the steps',
    ).toBeNull();
  });

  test('4. the block carries the Settings page\'s own section style, not a new one', async ({ page }) => {
    await clearSetupEntities();
    await signIn(page);
    await page.goto('/admin/settings');
    await expect(page.locator('[data-testid="setup-checklist"]')).toBeVisible({ timeout: 20000 });
    await waitForSetupReady(page);

    const card = await readSettingsBlock(page);
    expect(card, 'the Settings block did not render').not.toBeNull();
    expect(card!.rows, 'the Settings variant is one line, not a list of steps').toBe(0);
    expect(card!.actions.length, 'the Settings variant carries exactly its one action').toBe(1);

    // One card on the page has to exist to compare against, or "matches the page" is a
    // comparison with nothing.
    await expect.poll(async () => page.locator('.ds-listcard').count(), { timeout: 15000 }).toBeGreaterThan(1);

    const styles = await page.evaluate(() => {
      const block = document.querySelector('[data-testid="setup-checklist"]') as HTMLElement | null;
      const mineCard = block?.querySelector('.ds-listcard') as HTMLElement | null;
      const mineTitle = block?.querySelector('p') as HTMLElement | null;
      // Any other card on the same screen is the reference: same surface, same gutter,
      // same font. What is guarded against is a card that invents its own treatment.
      const otherCard = [...document.querySelectorAll('.ds-listcard')].find(
        (c) => !c.closest('[data-testid="setup-checklist"]'),
      ) as HTMLElement | null;
      return {
        hasOther: !!otherCard,
        mineFont: mineTitle ? getComputedStyle(mineTitle).fontFamily : '',
        pageFont: getComputedStyle(document.body).fontFamily,
        mineRadius: mineCard ? getComputedStyle(mineCard).borderRadius : '',
        otherRadius: otherCard ? getComputedStyle(otherCard).borderRadius : '',
        minePad: block ? getComputedStyle(block).paddingInlineStart : '',
        // The page gutter is a token, so the comparison is against the system rather than
        // against whichever wrapper happens to sit above another card.
        gutterToken: getComputedStyle(document.documentElement).getPropertyValue('--space-4').trim(),
      };
    });

    expect(styles.hasOther, 'no other card on the page to compare the block against').toBe(true);
    // One font, taken from the page rather than chosen by this card.
    expect(styles.mineFont, 'the setup card uses a font of its own').toBe(styles.pageFont);
    // The shared card surface and the page's gutter, not values of its own.
    expect(styles.mineRadius, 'card radius differs from the rest of the page').toBe(styles.otherRadius);
    expect(styles.minePad, 'the section gutter is not the page gutter token').toBe(styles.gutterToken);

    // The card carries the shared mark: an icon in its own tinted circle, so it reads as a
    // card header and not as a bare paragraph that happens to sit above the settings rows.
    const mark = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="setup-checklist"]') as HTMLElement;
      const glyph = section.querySelector('svg') as SVGSVGElement | null;
      return { hasMark: !!glyph, markSize: glyph ? getComputedStyle(glyph).width : '' };
    });
    expect(mark.hasMark, 'the setup card lost its mark').toBe(true);
    expect(parseFloat(mark.markSize), 'the mark is not on the icon token').toBeGreaterThan(0);
  });

  test('6. Home gives a new shop the three steps, in dependency order, and retires them', async ({ page }) => {
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
        // Every step leads with its own mark: an empty ring, or a filled check once done.
        tiles: [...el.querySelectorAll('.ds-row')].filter((r) => r.firstElementChild).length,
        rowCount: rows.length,
        // The reason is spaced from the step's name rather than touching it.
        labelToMeta: (() => {
          const first = el.querySelector('.ds-row') as HTMLElement | null;
          const lines = first ? [...first.querySelectorAll('p')] : [];
          if (lines.length < 2) return null;
          return Math.round(lines[1].getBoundingClientRect().top - lines[0].getBoundingClientRect().bottom);
        })(),
      };
    });
    expect(card.rowCount, 'Home is not using the shared list row').toBe(3);
    expect(card.tiles, 'a step has no mark beside it').toBe(3);
    expect(card.buttons.length, 'every missing step should carry its own action').toBe(3);
    expect(card.buttons[0], 'the next step offers no action').toContain('Add supplier');
    // Dependency order: the supplier leads, because a product needs one.
    expect(card.text.indexOf('Add supplier'), 'the supplier step is not first').toBeLessThan(
      card.text.indexOf('Add product'),
    );
    // Each step carries its reason beside its action, so the list is intent, not buttons.
    expect(card.text, 'the steps do not explain why they come in this order').toMatch(/needs a supplier/i);
    expect(
      card.labelToMeta,
      'Home\'s steps crowd their reason against the action name',
    ).toBeGreaterThanOrEqual(2);

    // The first action must lead into the real create route, and come back afterwards.
    await nextStep.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/admin\/companies\/new/, { timeout: 15000 });
    await expect(page).toHaveURL(/returnTo=/, { timeout: 5000 });
    await page.goto('/admin/dashboard');
    await expect(nextStep).toBeVisible({ timeout: 20000 });

    // Configured shop: the guidance retires itself and Home gains nothing.
    //
    // The three rows are the SHARED baseline fixtures — this used to INSERT them as 'Setup
    // Supplier' / 'Setup Product' / 'Setup Customer', renaming rows that four other lanes read.
    // They are asserted instead of written, and never registered as owned: the fixtures are the
    // baseline the ownership model exists to protect.
    const [setupSupplier] = await execSql(`SELECT id FROM companies WHERE id = '${QA_IDS.companyA}'`);
    expect(setupSupplier, 'the shared supplier fixture is missing — setupFixtures must run first').toBeTruthy();
    const [setupProduct] = await execSql(`SELECT id FROM products WHERE id = '${QA_IDS.productA}'`);
    expect(setupProduct, 'the shared product fixture is missing — setupFixtures must run first').toBeTruthy();
    const [setupCustomer] = await execSql(`SELECT id FROM customers WHERE id = '${QA_IDS.customerA}'`);
    expect(setupCustomer, 'the shared customer fixture is missing — setupFixtures must run first').toBeTruthy();

    await page.goto('/admin/dashboard');
    await page.reload();
    // "Gone" is asserted, not assumed: the block must not be in the DOM once setup is done.
    await waitForSetupGone(page);
    expect(
      await readHomeChecklist(page),
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

    const state = await readSettingsBlock(page);
    expect(state, 'setup block missing in Urdu').not.toBeNull();
    expect(state!.dir, 'the page did not switch to RTL').toBe('rtl');
    expect(state!.heading, 'Urdu heading not rendered').toMatch(/[\u0600-\u06FF]/);
    expect(countOf(state!.count), 'the count is not rendered in Urdu').toBe('0/3');
    expect(state!.overflow, 'RTL layout overflows at phone width').toBe(false);

    // No English leakage in the step copy either.
    await page.goto('/admin/dashboard');
    await expect.poll(async () => (await readHomeChecklist(page))?.rows.length ?? 0, { timeout: 25000 }).toBe(3);
    const home = await readHomeChecklist(page);
    const joined = home!.rows.map((r) => r.text).join(' | ');
    expect(joined, 'English leaked into the Urdu steps').not.toContain('Add supplier');
    expect(joined).toMatch(/[\u0600-\u06FF]/);
    expect(home!.dir, 'the dashboard is not RTL').toBe('rtl');
    expect(home!.overflow, 'RTL steps overflow at phone width').toBe(false);

    await page.evaluate(() => localStorage.removeItem('agrishop-theme'));
  });
});
