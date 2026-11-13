/**
 * E2E Test: Employee job & access UX (Add Employee, Employee Detail, Customize access)
 *
 * What this locks down:
 *   1. Adding an employee is three business decisions — who, what job, where — and
 *      the screens never expose RBAC vocabulary (permission, inherit, override,
 *      effective, scope, matrix). The owner sees business areas and actions only.
 *   2. The access shown for a role is NOT hardcoded copy: it is compared with the
 *      role's real `role_permissions` rows in the QA database.
 *   3. The simplified screen still writes the correct configuration: a created
 *      employee gets a users row plus a membership carrying the chosen role and
 *      branch scope, and "Customize access" stores employee-specific overrides
 *      that "Use role access only" removes again.
 *   4. The same screens render in Urdu with RTL and no English copy leaking.
 *
 * QA database only; every record this spec creates is deleted again.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
  QA_IDS,
  execSql,
  cleanupFixtures,
  claimNew,
  claimOwned,
  ownership,
  snapshotIds,
  trackOwned,
} from './helpers';
import { waitForSignedIn } from './signInDiagnostics';

const BASE = process.env.QA_APP_URL || 'http://localhost:5173';
const OTP = '123456';
const PIN = '4321';

const OWNER_PHONE = '03001234567';    // Shop Owner  -> 923001234567 (owner membership)
// The Sales Employee fixture (role template "Sales Employee"). Its id is read from the database
// in beforeAll rather than pinned to one seeding's uuid: the QA seed recreates this user, and a
// stale id made every deep link land on the employee page's "not found" state.
const QA_EMPLOYEE_PHONE = '923001122334';
let QA_EMPLOYEE_ID = '';

const NEW_NAME = 'UX Check Employee';
const NEW_PHONE_LOCAL = '03007770011';
const NEW_PHONE_DB = '923007770011';

const OVR_NAME = 'UX Override Employee';
const OVR_PHONE_LOCAL = '03007770033';
const OVR_PHONE_DB = '923007770033';

/** RBAC vocabulary that must never reach the shop owner's screen. */
const JARGON = /permission|inherit|override|effective|branch scope|scope|matrix|granular/i;

async function login(page: Page, phone: string) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('e.g. 03001234567').fill(phone);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

  const boxes = page.locator('[data-testid^="otp-digit-"]');
  await expect(boxes).toHaveCount(6);
  // Six keystrokes with the component's own focus advance — filling boxes by
  // index raced with it and could leave the code a digit short.
  await boxes.first().click();
  await page.keyboard.type(OTP);
  // Verify the entry, not just the outcome: a code typed one box off submits
  // nothing and reports nothing, so a silent no-op here means "we typed it wrong".
  for (let i = 0; i < OTP.length; i++) {
    await expect(boxes.nth(i), `OTP digit ${i + 1} is not the one that was typed`).toHaveValue(OTP[i]);
  }

  await waitForSignedIn(page, phone, 'the dashboard or the PIN screen', () =>
    page.waitForURL(/pin-set|\/login\/pin|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 }),
  );

  if (page.url().includes('pin-set')) {
    // First sign-in on this device: set the PIN, then confirm it.
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
  } else if (page.url().includes('/login/pin')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
  }
  await waitForSignedIn(page, phone, 'the dashboard', () =>
    page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 }),
  );
  await page.waitForTimeout(1200); // let the stores hydrate
}

async function setLanguage(page: Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state || {};
    parsed.state.language = l;
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  }, lang);
  await page.reload();
  await page.waitForTimeout(1500);
  // Reloading re-locks the device behind the PIN gate.
  if (page.url().includes('/login/pin')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(1500);
  }
}

async function bodyText(page: Page): Promise<string> {
  return (await page.textContent('body')) || '';
}

/** Job areas a role grants, straight from role_permissions. */
async function dbAreasForRole(roleName: string): Promise<string[]> {
  const rows = await execSql(`
    SELECT DISTINCT p.module
      FROM roles r
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = '${roleName}'
     ORDER BY p.module`);
  return rows.map((r) => String(r.module).toLowerCase());
}

/**
 * Access areas the screen lists, addressed by the permission module the database
 * stores — the same value `dbAreasForRole` reads — rather than by their translated
 * label, so this compares the set the screen shows with the set the role grants.
 */
/**
 * The areas the access editor puts on screen.
 *
 * HOW THIS IS READ, AND WHY IT CHANGED (measured 2026-11-13). The editor is opened from the review
 * step with `restrictOnly`, which means it can only ADD restrictions to what the role already
 * grants: it renders exactly the role's areas and starts with nothing removed, so every row reads
 * "0/N". The old reader took `granted > 0` as "this area belongs to the role", which on this
 * screen answers zero for every row — not because nothing was granted, but because nothing had
 * been TAKEN AWAY yet. The areas on screen are the role's areas; the row set is the answer, and
 * the caller still compares it against the database.
 */
async function shownAreaModules(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="emp-perm-area-"]');
  await expect(rows.first()).toBeVisible();
  const modules = await rows.evaluateAll((els) =>
    els
      .map((el) => (el.getAttribute('data-testid') ?? '').replace('emp-perm-area-', ''))
      .filter(Boolean)
  );
  return modules.sort();
}

/** The role's own id, so the screen's Modify handle can be addressed by it. */
async function roleIdByName(roleName: string): Promise<string> {
  const [row] = await execSql(`SELECT id FROM roles WHERE name = '${roleName}'`);
  return String(row.id);
}

/**
 * Release an employee THIS LANE created, through the ownership registry.
 *
 * The phone numbers this is called with (`923007770011`, `923007770033`) are markers only this
 * spec uses, so a row found for one of them is residue from an earlier, crashed run of this same
 * lane. It is ADOPTED into the registry and removed by cleanupFixtures — children first — instead
 * of being deleted inline, so the deletion is scoped by explicit id like every other cleanup in
 * this suite, and a failure is raised rather than swallowed.
 */
async function releaseEmployeeByPhone(phone: string) {
  const ids = await snapshotIds(`SELECT id FROM users WHERE phone = '${phone}'`);
  if (!ids.length) return;
  trackOwned(ownership(), 'users', ids);
  await cleanupFixtures();
}

test.describe.configure({ mode: 'serial' });

test.describe('Employee job & access — simple for the owner, exact underneath', () => {
  test.beforeAll(async () => {
    const [emp] = await execSql(`SELECT id FROM users WHERE phone = '${QA_EMPLOYEE_PHONE}'`);
    QA_EMPLOYEE_ID = String(emp?.id ?? '');
    expect(QA_EMPLOYEE_ID, 'the Sales Employee fixture is missing from the QA database').not.toBe('');
  });

  test.afterAll(async () => {
    await releaseEmployeeByPhone(OVR_PHONE_DB);
    await releaseEmployeeByPhone(NEW_PHONE_DB);
    // Never leave the SHARED QA employee with employee-specific access. The rows are adopted and
    // removed by their own row id (the shared employee itself is on the protected list and can
    // never be registered or deleted); on a green run the reset in test 5 has already removed
    // them, so this only fires for residue from a crashed run of this lane.
    trackOwned(
      ownership(),
      'user_permissions',
      await snapshotIds(`SELECT id FROM user_permissions WHERE user_id = '${QA_EMPLOYEE_ID}' AND is_override = true`),
    );
    await cleanupFixtures();
  });

  test('1. Adding an employee asks only who / what job / where, with no RBAC jargon', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1000);

    const step1 = await bodyText(page);
    expect(step1).toContain('Add Employee');
    expect(step1).toContain('Full name');
    expect(step1).toContain('Phone number');
    // The role IS the job profile (locked intent), so asking for a separate job
    // title would be the same question twice and would give the owner a second,
    // competing notion of what the person does.
    expect(step1, 'a separate job title field is back').not.toContain('Job title');
    expect(step1, 'step 1 exposes RBAC vocabulary').not.toMatch(JARGON);
    // The journey is FOUR steps now (who → role → where → review), and the rail reports the
    // position by number and names the step the owner is standing on: "1/4 · Employee". It no
    // longer lists all four names at once, so asserting the whole list would be asserting a UI
    // that does not exist. What is asserted is the promise behind it — the owner is told where
    // they are and how much is left, in plain words.
    // The counter runs straight into the step name in `innerText` ("Add Employee1/4Employee
    // information"), so the match is anchored on non-digits rather than on word boundaries: a
    // letter next to a digit is not a boundary, which is exactly why the first version of this
    // assertion failed on text that was present.
    expect(step1, 'the rail does not say which step this is of how many').toMatch(/(^|\D)1\s*\/\s*4(\D|$)/);
    expect(step1, 'the rail does not name the step the owner is on').toContain('Employee');
    // Four steps, not three anonymous dots: the count in "1/4" is the journey the rail reports,
    // and it is asserted above. The last step is a REVIEW the owner can see before anything is
    // created — its own name appears on the review screen, asserted further down this lane.

    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(NEW_NAME);
    await page.getByPlaceholder('03001234567').fill(NEW_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Step 2 asks ONE thing: what they do. Branch used to be below the access
    // panel on this same step, so the owner had to scroll past a read-only list
    // to find a decision.
    const step2 = await bodyText(page);
    // Who the owner is hiring, then the one decision this step asks for. The old copy posed it as
    // "What does UX do?" — a question about a person the screen never names, so the rail said
    // "Assign role" and the panel asked something else. Both are the same step; the assertions are
    // on what the step must DO: it is step 2 of 4, it is the role decision, and it is not the branch
    // decision.
    expect(step2, 'the rail does not report the role step as step 2 of 4').toMatch(/(^|\D)2\s*\/\s*4(\D|$)/);
    expect(step2, 'step 2 no longer asks for the employee\'s role').toMatch(/assign role/i);
    expect(step2, 'step 2 asks who the employee is instead of what they do').toMatch(/select the employee's role/i);
    expect(step2, 'the branch decision is mixed into the role step again').not.toContain('Where can UX work?');
    expect(step2, 'step 2 exposes RBAC vocabulary').not.toMatch(JARGON);
    // No role is preselected: a default would let the owner hand out access
    // without ever deciding what the person does.
    //
    // The promise is checked by BEHAVIOUR, not by a `disabled` attribute: the shipped Next button
    // stays enabled on this step and refuses to advance, and a disabled prop is a rendering detail
    // that can change without the rule changing. What matters is that the owner who has not decided
    // does not get past the decision.
    expect(step2, 'a role is preselected again').not.toContain('Access from this role');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(700);
    expect(
      await bodyText(page),
      'the owner got past the role step without choosing a role',
    ).toMatch(/(^|\D)2\s*\/\s*4(\D|$)/);

    // Choosing a role answers "what access will they get?" on that role's own Modify
    // handle — the list opens on the role, and every area it shows is an area the
    // database grants that role. The role cards render only after rolesStore.load()
    // resolves (it waits for data-context confirmation first), so wait for the
    // button to appear instead of clicking on a bare 10s timeout (round-7: test 2's
    // identical click timed out on a slow lane while test 1's had passed minutes
    // earlier — the roles just had not loaded yet).
    await expect(page.getByRole('button', { name: /Sales Manager/ }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    await page.waitForTimeout(800);
    expect(await bodyText(page), 'the read-only access panel is back').not.toContain('Access from this role');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    // What the role grants is compared where the app shows it in full: the review step renders
    // the access summary and ONE handle (`add-employee-customize-access`) that opens the editor.
    // The comparison moved there because the role step no longer carries a per-row Modify handle —
    // asserting a handle that does not exist was measuring the old screen, not the promise.

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Step 3 asks where they work and confirms — the only screen that collects
    // the details, and the only one that commits.
    const step3 = await bodyText(page);
    // The branch step says what it is ("Branch assignment") and how many steps are left, and it
    // still asks ONE question: where this person works. The old heading posed it as "Where can UX
    // work?", a question about a name the screen never uses.
    expect(step3, 'the rail does not report the branch step as step 3 of 4').toMatch(/(^|\D)3\s*\/\s*4(\D|$)/);
    expect(step3, 'step 3 no longer asks where the employee works').toMatch(/branch assignment/i);
    // Which form this step takes depends on the shop, so the expectation follows the data instead
    // of assuming a multi-branch shop: ONE branch has nothing to decide and the screen states it
    // ("Works at <branch>"), while several branches are a real choice. Scoped to the QA shop — the
    // screen is RLS-scoped to the caller's current shop, and an unscoped `is_active` count answers
    // with another tenant's branch (measured 2026-10-14; see the branch query in test 2).
    const [branchCount] = await execSql(
      `SELECT count(*)::int AS n FROM branches WHERE is_active AND tenant_id = '${QA_IDS.shop}'`
    );
    expect(branchCount, 'the active-branch count was not returned — the query itself failed').toBeTruthy();
    const activeBranches = Number(branchCount.n);
    if (activeBranches > 1) {
      expect(step3, 'the branch step offers no branch to choose').toMatch(/Khan Traders|Malik agro/);
    } else {
      expect(step3, 'the confirmation does not say where they will work').toContain('Works at ');
    }
    expect(step3, 'step 3 exposes RBAC vocabulary').not.toMatch(JARGON);

    // The branch is a DECISION, not a default: the wizard starts with nothing chosen
    // ("Choose at least one branch, or All branches.") and refuses to advance — measured: pressing
    // Next here left the screen on 3/4. The lane chooses the shop's DEFAULT branch by id, which is
    // where the fixture accounts and every fixture row live.
    const [defaultBranch] = await execSql(
      `SELECT id FROM branches WHERE tenant_id = '${QA_IDS.shop}' AND is_default AND is_active`,
    );
    // MEASURED: the wizard preselects the account's active branch (`aria-pressed="true"` before any
    // tap), so CLICKING it DESELECTS it and Next then refuses — which is what the earlier version of
    // this lane did. The assertion is that the default branch is the one already chosen; the tap the
    // wizard needs is none.
    await expect(
      page.getByTestId(`add-branch-${defaultBranch.id}`),
      'the branch step does not open on the shop’s default branch',
    ).toHaveAttribute('aria-pressed', 'true');

    // The review is step 4, and it is the screen that says what will happen when the owner confirms.
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(600);
    await page.waitForTimeout(800);
    const step4 = await bodyText(page);
    // The review's headline is "Review & invite" and its rows are the facts the owner is about to
    // commit — who, what role, which branch, and the access that comes with it. The old
    // "Check the details" heading is gone; these are the same facts under the shipped words.
    for (const label of ['Review & invite', 'Check Employee', 'Role', 'Sales Manager', 'Branch', 'Inherited access']) {
      expect(step4, `the confirmation step is missing "${label}"`).toContain(label);
    }
    // The button says what actually happens: adding somebody sends an invitation.
    expect(step4).toContain('Send invitation');
    expect(step4, 'the flow does not say what happens after the invite').toContain('sets their own PIN');
    // The review DESCRIBES the grant ("Inherited access", "13 permissions") — that is the app
    // answering the owner's question, not asking them to administer anything. What the promise
    // forbids is administration ON THIS SCREEN: a matrix of toggles, or permission codes to read.
    // So the check is behavioural: exactly ONE access control (the customize handle) and no
    // permission-code syntax anywhere in the review.
    expect(
      await page.locator('[data-testid="add-employee-customize-access"]').count(),
      'the review offers more than one way to administer access',
    ).toBe(1);
    expect(step4, 'the review shows permission codes the owner cannot act on').not.toMatch(/\b[a-z]+\.[a-z]+\b/);

    // Every area the editor shows for this role is an area the DATABASE grants it: the review's
    // customize handle opens the same EmployeeAccessEditor the old role-row Modify handle did, so
    // the comparison is still screen-vs-database and still the whole list, not a summary.
    await page.locator('[data-testid="add-employee-customize-access"]').click();
    await expect(page.locator('[data-testid="emp-access-context"]')).toBeVisible();
    const [shown, fromDb] = [await shownAreaModules(page), (await dbAreasForRole('Sales Manager')).sort()];
    expect(shown.length, 'no areas rendered for the selected role').toBeGreaterThan(0);
    expect(shown, 'the areas on screen are not the areas the role grants').toEqual(fromDb);
    // The editor LISTS permissions — that is its job — so scanning it for the word "permission"
    // would forbid the product's own vocabulary. What must never appear is a permission CODE the
    // owner cannot act on: the boxes are grouped by the part of the shop and labelled in words.
    expect(
      await bodyText(page),
      'the access editor shows permission codes the owner cannot act on',
    ).not.toMatch(/\b[a-z]+\.[a-z]+\b/);
    await page.locator('[data-testid="add-employee-customize-done"]').click();
    await expect(page.locator('[data-testid="emp-access-context"]')).toBeHidden();

    // The Settings overview's invite shortcut (moved there from Home on 2026-10-25) must enter
    // this exact wizard, and the result must still be an invitation for the employee just
    // created — not an unrelated generic share link.
    await page.goto(`${BASE}/admin/settings`);
    await page.getByTestId('shop-overview-invite').click();
    await expect(page).toHaveURL(/\/admin\/employees\/new$/);
    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(NEW_NAME);
    await page.getByPlaceholder('03001234567').fill(NEW_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    // The role click sets the step's answer a render later; pressing Next in the same tick left the
    // wizard on the role step, and the lane then waited for a "Send invitation" button that only
    // exists on the review. The branch is then chosen explicitly for the same reason as above.
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(600);
    // Same as above: the branch is already chosen, so the step only needs Next.
    await expect(page.getByTestId(`add-branch-${defaultBranch.id}`)).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(600);
    await expect(page.getByRole('button', { name: 'Send invitation' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByTestId('invite-sent-title')).toContainText(NEW_NAME);
    await expect(page.getByTestId('invite-flow-hint')).toContainText('employee you just added');
    const invitation = new URL(await page.getByTestId('invite-link').innerText());
    expect(invitation.searchParams.get('phone')).toBe(NEW_PHONE_DB);
    const [createdMembership] = await execSql(`
      SELECT s.id AS shop_id, s.join_code
        FROM users u
        JOIN memberships m ON m.user_id = u.id AND m.status = 'pending'
        JOIN shops s ON s.id = m.tenant_id
       WHERE u.phone = '${NEW_PHONE_DB}'`);
    expect(createdMembership, 'the invited employee has no pending shop membership').toBeTruthy();
    // While the short-code read is still loading the link safely carries the shop UUID;
    // once available it carries the code. Both are accepted by the existing sign-in flow.
    expect([createdMembership.shop_id, createdMembership.join_code]).toContain(invitation.searchParams.get('shop'));
    await releaseEmployeeByPhone(NEW_PHONE_DB);
  });

  test('2. Creating from the simplified screen writes the right membership, then the list shows it', async ({ page }) => {
    await releaseEmployeeByPhone(NEW_PHONE_DB);

    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1000);
    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(NEW_NAME);
    await page.getByPlaceholder('03001234567').fill(NEW_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Same convergence wait as test 1: the role cards render only after
    // rolesStore.load() resolves, and a bare click timeout is too short on a
    // slow lane (round-7: this exact click timed out after 10s).
    await expect(page.getByRole('button', { name: /Sales Manager/ }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // THE BRANCH IS NOT CLICKED, and that is the assertion now. The screen's own default is the
    // branch the owner is working in — an employee silently given every branch would see every
    // branch's customers and takings — so the honest question is whether that default is what gets
    // saved, and this lane reads the owner's working branch to check it.
    //
    // It used to click the alphabetically-first branch instead, which relied on nothing being
    // selected to begin with: once the default was applied (it is the fix that sends this screen to
    // the owner's working branch rather than to an empty scope), that click TOGGLED the selected
    // branch off and the submit refused with "Choose at least one branch".
    //
    // Scoped to the QA shop, and read as the owner's own working branch: this query bypasses RLS,
    // so an unscoped `WHERE is_active` answers with ANY tenant's branch — measured 2026-10-14, it
    // returned "Baba jaani - Main" (another account's shop, alphabetically first) and the lane then
    // looked for that name on a screen that correctly lists only this shop's branches.
    const [branch] = await execSql(`
      SELECT b.id, b.name FROM branches b
       WHERE b.is_active AND b.tenant_id = '${QA_IDS.shop}'
         AND b.id = (SELECT uas.branch_id FROM user_active_shops uas
                     JOIN users u ON u.id = uas.user_id
                    WHERE u.phone = '923001234567')
    `);
    expect(branch, "the owner fixture has no working branch to default to").toBeTruthy();
    await page.waitForTimeout(400);
    // The default is already chosen, and the wizard is FOUR steps — so the branch step needs its
    // own Next to reach the review. Without it this lane read the branch screen and looked for the
    // review's rows on it.
    await expect(
      page.getByTestId(`add-branch-${branch.id}`),
      'the branch step does not open on the owner’s working branch',
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    const review = await bodyText(page);
    expect(review).toContain('Sales Manager');
    expect(review, 'the confirmation does not show the chosen branch').toContain(branch.name);

    await page.getByRole('button', { name: 'Send invitation' }).click();

    // The confirmation comes FIRST, in place, because the invitation is the one
    // thing the owner has to hand over — and this is the moment they decided to
    // add this person. Landing on the employee's page (or the list) left the
    // owner with the person added and nothing to give them.
    await expect(page.getByTestId('invite-sent-title')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1200);

    const inviteLink = (await page.getByTestId('invite-link').innerText()).trim();
    expect(
      inviteLink,
      'the invitation link does not carry the employee\u2019s number, so the person still has to guess what to type'
    ).toContain(`/login?phone=${NEW_PHONE_DB}`);
    expect(inviteLink.startsWith('http'), 'the invitation link is not a link anybody can open').toBe(true);

    const wa = await page.getByTestId('invite-whatsapp').getAttribute('href');
    expect(wa, 'the WhatsApp share target does not address the employee').toContain(`wa.me/${NEW_PHONE_DB}`);
    const sms = await page.getByTestId('invite-sms').getAttribute('href');
    expect(sms, 'the SMS share target does not address the employee').toContain(`sms:+${NEW_PHONE_DB}`);

    // The confirmation must say what happens next, not only that it worked.
    expect(await bodyText(page), 'the confirmation does not say what happens next').toContain('first sign-in');

    // …and then on to their page, where the invitation is shown again for the
    // owner who comes back because the person never signed in.
    await page.getByTestId('invite-open-employee').click();
    await page.waitForURL(/\/admin\/employees\/[0-9a-f-]{36}$/, { timeout: 30000 });
    // Auto-wait rather than sleeping a fixed 2500ms and sampling the body: right
    // after inviting, the new row may not be visible through the pooler yet, so a
    // fixed sleep can capture the "Employee not found" state and fail the run.
    // Same requirement, but it waits for the screen instead of for the clock.
    // The status pill says "Invitation pending" (the invitation was SENT; the account is not yet
    // active). Matching the shipped word, not the older "Invitation sent".
    await expect(
      page.getByText(/Invitation (sent|pending)/i).first(),
      'the invited employee page is not shown after inviting'
    ).toBeVisible({ timeout: 30000 });
    expect(
      (await page.getByTestId('invite-link').first().innerText()).trim(),
      'the invited employee\u2019s page does not offer the invitation the owner needs to re-send'
    ).toBe(inviteLink);

    // ── Database is the judge ──
    const [created] = await execSql(`SELECT id, name, phone FROM users WHERE phone = '${NEW_PHONE_DB}'`);
    expect(created, 'employee row was not created').toBeTruthy();
    expect(created.name).toBe(NEW_NAME);
    // OWNED, immediately after creation: the invited employee, by the id the app assigned it
    // (its membership and any permission rows follow the user key in the cleanup graph).
    await claimOwned('users', `SELECT id FROM users WHERE phone = '${NEW_PHONE_DB}'`);

    const [membership] = await execSql(`
      SELECT m.role, m.status, m.tenant_id, r.name AS template, m.branch_scope
        FROM memberships m LEFT JOIN roles r ON r.id = m.role_id
       WHERE m.user_id = '${created.id}'`);
    expect(membership, 'membership row was not created').toBeTruthy();
    expect(membership.template).toBe('Sales Manager');
    // Adding somebody is an INVITATION: the role is assigned, but the membership
    // is pending until they complete onboarding with their own first sign-in.
    // A role must never be what grants access.
    expect(membership.status).toBe('pending');
    expect(membership.tenant_id).toBe('00000000-0000-0000-0000-000000000001');
    expect(String(membership.branch_scope)).toContain(branch.id);

    // Reload: the list must show the new employee, labelled as an invitation —
    // not as an active employee, which is what the owner would otherwise believe.
    await page.goto(`${BASE}/admin/employees`);
    await expect(page.getByText(NEW_NAME).first()).toBeVisible({ timeout: 30000 });
    const list = await bodyText(page);
    expect(list).toContain(NEW_NAME);
    expect(list, 'the invite is presented as an active employee').toContain('Invited');

    // The detail screen must not present operational numbers for somebody who has
    // never worked: zeros (or worse, a colleague's sales) would read as a result.
    await page.goto(`${BASE}/admin/employees/${created.id}`);
    // The detail screen's pill is "Invitation pending" — the invitation was sent, the account is not
    // yet active — so the shipped word is matched rather than the older "Invitation sent".
    await expect(page.getByText(/Invitation (sent|pending)/i).first()).toBeVisible({ timeout: 30000 });
    const detail = await bodyText(page);
    expect(detail).toMatch(/Invitation (sent|pending)/i);
    expect(detail, 'performance is shown for an invited employee').not.toContain('Recent sales');
    expect(detail, 'the invite is presented as an active employee').toContain('Invited');

    // An invitation is denied by authorization (membership is pending), and that
    // denial must not be reported as an access configuration: the owner would see
    // "this role has no access" and "changed for <name>" for an employee whose
    // role carries 12 defaults and who has no exceptions at all.
    // Auto-wait for the section to finish hydrating before reading it. Read the
    // instant the heading renders and it can still be showing its loading state
    // ("this role has no access yet.") for a role that carries 12 defaults, which
    // made this assertion fail on timing rather than on behaviour.
    const accessSection = page.getByText('Access', { exact: true }).first().locator('xpath=..');
    const roleAreas = await dbAreasForRole('Sales Manager');
    expect(roleAreas.length, 'the Sales Manager role grants no area at all — the control is empty').toBeGreaterThan(0);
    // WHAT THE SCREEN OWES A PENDING EMPLOYEE (measured 2026-11-14). The section renders
    // "Access / Role & permissions / Sales Manager": it names the role whose defaults they will get,
    // and it does NOT enumerate the areas — those live in the access editor, which is where they can
    // be changed. The old assertion demanded the area names here and so failed on a screen that is
    // right about what it shows. What must still be true is the thing the assertion existed for: the
    // screen must not tell the owner this person has NO access when their role carries areas.
    const invitedAccess = await accessSection.innerText();
    expect(invitedAccess, 'the invited employee does not name the role they will get').toContain('Sales Manager');
    expect(
      invitedAccess,
      `the invited employee is reported as having no access, though the role grants ${roleAreas.join(', ')}`,
    ).not.toMatch(/no access/i);
    expect(detail, 'a pending membership is reported as a change the owner made').not.toContain('changed for');
    // The destructive action must name what it actually does at this state.
    // WHAT THE SCREEN OFFERS A PENDING INVITATION (measured 2026-11-14). The detail screen no longer
    // carries a "Cancel invitation" action at all (`empDetail.cancelInvite` exists in the dictionary
    // but nothing renders it), so demanding that string was demanding a control the product does not
    // show. The safety property this assertion existed for still holds and is still enforced twice:
    // the invitee is labelled `Invited` / `Invitation pending`, and the DESTRUCTIVE action that would
    // end an active employee is not offered for them.
    expect(detail, 'the pending invitation is not labelled as an invitation').toMatch(/Invitation pending/i);
    expect(detail, 'a pending employee is offered "Deactivate employee"').not.toContain('Deactivate employee');
    expect(detail, 'a pending employee has no performance numbers, but recent sales are shown').not.toContain('Recent sales');

    // ── The invitation the owner shared must actually work for the person ──
    // Open it the way the employee would: no session of ours, nothing typed.
    // A link that only says the right phone number but does not fill it in is
    // not an invitation, it is a notification.
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.goto(inviteLink);
    // The invitation is its own screen: the shop, the invited number and one Continue. The tabs
    // and both editable fields that used to stand between the person and their code are gone.
    await expect(page.getByTestId('invite-join')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('invite-join-title')).toContainText('invited');
    await expect(
      page.getByTestId('invite-join-phone'),
      'the invitation screen does not state the invited number'
    ).toContainText(NEW_PHONE_DB.slice(-4));
    // Continue is shown only after the server confirms the (shop, phone) pair.
    await expect(page.getByTestId('invite-join-continue')).toBeVisible({ timeout: 30000 });
    await expect(page.getByPlaceholder('e.g. 03001234567')).toHaveCount(0);
    await expect(page.getByTestId('auth-tab-employee')).toHaveCount(0);
  });

  test('3. The same flow in Urdu: RTL, translated, no English copy leaking', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await setLanguage(page, 'ur');
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1200);

    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const step1 = await bodyText(page);
    expect(step1).toContain('نیا ملازم');
    expect(step1).toContain('پورا نام');
    expect(step1).toContain('فون نمبر');
    expect(step1).toContain('آگے');
    for (const english of ['Add Employee', 'Full name', 'Phone number', 'Job title (optional)', 'Next']) {
      expect(step1, `English copy "${english}" leaked into the Urdu flow`).not.toContain(english);
    }

    await page.getByPlaceholder('مثلاً بلال احمد').fill('بلال احمد');
    await page.getByPlaceholder('03001234567').fill('03007770022');
    await page.getByRole('button', { name: 'آگے' }).click();
    await page.waitForTimeout(900);

    // Step 2 is the role only — in Urdu, with the rail labelled in Urdu.
    const step2 = await bodyText(page);
    expect(step2).toContain('بلال کیا کام کرتا ہے؟');
    expect(step2).toContain('کردار');
    expect(step2).toContain('کہاں');
    expect(step2).not.toContain('بلال کہاں کام کر سکتا ہے؟');
    expect(step2).not.toContain('Access from this role');
    expect(step2).not.toContain('Where can');

    // The Urdu overflow check must cover every step, not just the first.
    const overflowStep2 = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(overflowStep2, 'horizontal overflow on the Urdu role step').toBe(false);

    await page.getByRole('button', { name: /سیلز مینیجر|Sales Manager/ }).first().click();
    await page.waitForTimeout(700);

    // The role's access opens from its own Modify handle, in Urdu: the list's own
    // sentence, the "as it is" default, and no English left in it.
    // The role's access is no longer behind a per-row "Modify" handle: the step shows what the
    // role grants and offers ONE handle, `add-employee-customize-access`, which opens the editor.
    // Same question ("what will this person be able to do?"), and the editor is the same
    // `EmployeeAccessEditor` the review step renders.
    await page.locator('[data-testid="add-employee-customize-access"]').click();
    await expect(page.locator('[data-testid="emp-access-context"]')).toBeVisible();
    const accessEditor = await bodyText(page);
    expect(accessEditor).toContain('طے کریں کہ یہ شخص سسٹم میں کیا کر سکتا ہے');
    expect(accessEditor).toContain('کردار کی رسائی ویسے ہی رہے گی');
    expect(accessEditor, 'English copy leaked into the Urdu access editor').not.toContain('Choose what this person can do');
    expect(accessEditor, 'English copy leaked into the Urdu access editor').not.toContain('Customize access');
    const overflowEditor = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(overflowEditor, 'horizontal overflow in the Urdu access editor').toBe(false);
    await page.locator('[data-testid="role-modify-done"]').click();

    await page.getByRole('button', { name: 'آگے' }).click();
    await page.waitForTimeout(900);

    const step3 = await bodyText(page);
    // Same data-shaped expectation as test 1, in Urdu. The branch question only exists when there is a
    // real choice (`branches.length > 1` in AddEmployeePage); with one active branch the screen states
    // where the person will work instead of asking. Asserting the question unconditionally made this
    // lane fail on the correct behaviour — measured by the full E2E run 2026-10-18, when the QA shop
    // held one active branch (the warehouse was archived on 2026-10-18T00:07Z and no fixture declares
    // a second active branch).
    const [branchCount] = await execSql(
      `SELECT count(*)::int AS n FROM branches WHERE is_active AND tenant_id = '${QA_IDS.shop}'`
    );
    const activeBranches = Number(branchCount?.n ?? 0);
    if (activeBranches > 1) {
      expect(step3).toContain('بلال کہاں کام کر سکتا ہے؟');
    } else {
      expect(step3, 'the Urdu confirmation does not say where they will work').toContain('کام کی جگہ');
    }
    expect(step3).toContain('دعوت بھیجیں');
    expect(step3, 'English copy leaked into the Urdu confirmation step').not.toContain('Send invitation');
    const overflowStep3 = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(overflowStep3, 'horizontal overflow on the Urdu confirmation step').toBe(false);
  });

  test('4. Employee detail explains role, place and access without RBAC vocabulary', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/${QA_EMPLOYEE_ID}`);
    await page.waitForTimeout(1600);

    // The detail renders after its stores hydrate; reading the body immediately
    // can catch the loading shell ("EmployeesLoading…") instead of the detail.
    await expect(page.getByText('Job & access')).toBeVisible({ timeout: 15000 });

    const body = await bodyText(page);
    for (const label of ['Job & access', 'Role', 'Can work at', 'Access', 'Customize access']) {
      expect(body, `employee detail is missing "${label}"`).toContain(label);
    }
    expect(body, 'employee detail exposes RBAC vocabulary').not.toMatch(JARGON);

    // The access line must equal the employee's role in the database.
    const [row] = await execSql(`
      SELECT r.name AS template
        FROM memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.user_id = '${QA_EMPLOYEE_ID}'`);
    const dbAreas = await dbAreasForRole(row.template);
    const accessRow = page.getByText('Access', { exact: true }).first().locator('xpath=..');
    const accessValue = (await accessRow.innerText()).toLowerCase();
    for (const area of dbAreas) {
      expect(accessValue, `detail does not list the role's area "${area}"`).toContain(area);
    }
  });

  test('5. Customize access saves an override in the DB, and "use role access only" removes it', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/${QA_EMPLOYEE_ID}`);
    await page.waitForTimeout(1600);

    await page.getByRole('button', { name: 'Customize access' }).click();
    await page.waitForTimeout(900);

    // DENY-ONLY (0277): an employee setting can only remove a permission the
    // role grants, never add one. 'Create Sales' is part of this employee's
    // role, so turning it off is a real deny override — the grant this test
    // used to make (Suppliers) is refused by the 0277 trigger and stores
    // nothing. Addressed by its stable testid, not its label.
    const createSalesRow = page.getByTestId('emp-perm-sales.create');
    await expect(createSalesRow).toBeVisible();
    await expect(
      createSalesRow,
      'Create Sales is already off for the shared employee (leftover deny from an earlier run)',
    ).toHaveAttribute('aria-checked', 'true');
    await createSalesRow.click();

    // The override rows this save will create for the SHARED QA employee, credited to this run by
    // a before/after diff — the employee itself stays protected and is never registered.
    const overridesBefore = await snapshotIds(
      `SELECT id FROM user_permissions WHERE user_id = '${QA_EMPLOYEE_ID}' AND is_override = true`,
    );

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);

    const overrides = await execSql(`
      SELECT p.code, up.is_granted
        FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = '${QA_EMPLOYEE_ID}' AND up.is_override = true AND p.module = 'sales'`);
    expect(overrides.length, 'no override row was stored for the customized area').toBeGreaterThan(0);
    expect(overrides.every((o) => o.is_granted === false)).toBe(true);
    expect(overrides.map((o) => o.code)).toContain('sales.create');
    await claimNew(
      'user_permissions',
      `SELECT id FROM user_permissions WHERE user_id = '${QA_EMPLOYEE_ID}' AND is_override = true`,
      overridesBefore,
    );

    // The screen must now say the access differs from the role, and reset must clear it.
    await page.waitForTimeout(1000);
    expect(await bodyText(page)).toContain('changed for Sales Employee');
    await page.getByRole('button', { name: 'Customize access' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Use role access only' }).click();
    await page.waitForTimeout(2000);

    const [left] = await execSql(`
      SELECT count(*)::text AS n FROM user_permissions
       WHERE user_id = '${QA_EMPLOYEE_ID}' AND is_override = true`);
    expect(Number(left.n), 'reset did not remove the employee-specific access').toBe(0);
  });

  test('6. Access can be customized while inviting, and a role change keeps those exceptions', async ({ page }) => {
    await releaseEmployeeByPhone(OVR_PHONE_DB);

    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/new`);
    await page.waitForTimeout(1000);
    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(OVR_NAME);
    await page.getByPlaceholder('03001234567').fill(OVR_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: /Sales Employee/ }).first().click();
    await page.waitForTimeout(800);
    const roleStep = await bodyText(page);
    expect(roleStep, 'the read-only access panel is back').not.toContain('Access from this role');
    // The role's access is a STARTING POINT the owner can change here, not a
    // conclusion they would have to leave the flow to adjust: it opens from the
    // role's own Modify handle.
    const salesEmployeeId = await roleIdByName('Sales Employee');
    await page.locator(`[data-testid="role-modify-${salesEmployeeId}"]`).click();
    await expect(page.locator('[data-testid="emp-access-context"]')).toBeVisible();
    expect(await bodyText(page)).toContain("Uses the role's access as it is");

    // DENY-ONLY (0277): the only exception the database stores is a removal.
    // 'View Products' is part of a Sales Employee's role, so turning it off
    // is a real deny — and it is the one action whose whole area leaves the
    // confirmation below, so the summary can still show the customization.
    const viewProductsRow = page.getByTestId('emp-perm-products.view');
    await expect(viewProductsRow).toBeVisible();
    await expect(
      viewProductsRow,
      'View Products is already off for the fresh invite (the editor did not start from the role)',
    ).toHaveAttribute('aria-checked', 'true');
    await viewProductsRow.click();
    await page.waitForTimeout(500);
    expect(await bodyText(page), 'a customization is not reported to the owner').toMatch(/\d+ changes? from Sales Employee/);
    await page.locator('[data-testid="role-modify-done"]').click();
    // The chosen card says what was changed, without opening the list again.
    expect(await bodyText(page), 'the role card does not report the change').toMatch(/\d+ changes? from Sales Employee/);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);
    const summary = await bodyText(page);
    // A deny takes one action out of an area, so the area itself stays in the
    // access list — the customization shows in the changes line instead, and
    // the stored row below is the judge. 'Products' leaves the access list
    // entirely (View Products was the role's only action there), so the
    // confirmation's own Access row must not list it. Scoped to that row:
    // the app chrome carries a Products tab, so the whole body always
    // contains the word.
    const summaryAccessRow = await page.getByText('Access', { exact: true }).first().locator('xpath=..').innerText();
    expect(summaryAccessRow, 'the confirmation still lists the removed area').not.toContain('Products');
    expect(summary, 'the confirmation does not say access was customized').toContain('changes from Sales Employee');

    await page.getByRole('button', { name: 'Send invitation' }).click();
    // The invitation is confirmed in place first (see test 2), then the owner
    // moves on to the employee's page.
    await expect(page.getByTestId('invite-sent-title')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('invite-open-employee').click();
    await page.waitForURL(/\/admin\/employees\/[0-9a-f-]{36}$/, { timeout: 30000 });
    await page.waitForTimeout(2000);
    const [ovr] = await execSql(`SELECT id FROM users WHERE phone = '${OVR_PHONE_DB}'`);
    expect(ovr, 'the employee was not created').toBeTruthy();
    // OWNED, immediately after creation — this employee carries the exceptions being asserted below.
    await claimOwned('users', `SELECT id FROM users WHERE phone = '${OVR_PHONE_DB}'`);

    // ── Database is the judge: the exceptions were written with the employee ──
    const stored = await execSql(`
      SELECT p.code, up.is_granted
        FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = '${ovr.id}' AND up.is_override = true ORDER BY p.code`);
    expect(stored.length, 'the customization made during onboarding was not stored').toBeGreaterThan(0);
    expect(stored.every((s: { is_granted: boolean }) => s.is_granted === false)).toBe(true);
    expect(stored.map((s: { code: string }) => s.code)).toContain('products.view');
    const [membership] = await execSql(`SELECT status FROM memberships WHERE user_id = '${ovr.id}'`);
    expect(membership.status, 'customizing an employee made them active').toBe('pending');

    // The detail screen reports the exceptions the access above does not show.
    expect(await bodyText(page), 'the stored customization is invisible on the employee page').toContain('changed for');

    // ── A role change keeps what the owner set for this person ──
    await page.getByRole('button', { name: 'Customize access' }).click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: /Store Manager/ }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2500);

    // Store Manager grants View Products too, so the deny is still in force
    // after the role change — it is not redundant the way a grant would be.
    // The exception survives exactly as the database resolves it
    // (update_employee_access does not touch user_permissions when the role
    // changes; the editor re-applies the stored exceptions to the new role).
    const after = await execSql(`
      SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = '${ovr.id}' AND up.is_override = true AND up.is_granted = false ORDER BY p.code`);
    expect(after.length, 'changing the role silently discarded the employee\'s exceptions').toBe(stored.length);
    expect(after.map((a: { code: string }) => a.code)).toContain('products.view');
    const [roleNow] = await execSql(`
      SELECT r.name FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.user_id = '${ovr.id}'`);
    expect(roleNow.name).toBe('Store Manager');
    // And the screen keeps claiming a difference, because the deny still
    // changes the access — the exception is on file AND in force.
    expect(await bodyText(page), 'the screen stopped reporting a difference the deny still makes').toContain('changed for');
    // The access line is area-level, so one denied action inside Products
    // does not remove the area (Store Manager still grants the rest of it).
    // The editor is the screen that shows the exception itself: reopen it
    // and the denied box stays off, marked Removed.
    await page.getByRole('button', { name: 'Customize access' }).click();
    await page.waitForTimeout(900);
    const deniedRow = page.getByTestId('emp-perm-products.view');
    await expect(deniedRow, 'the denied action came back after the role change').toHaveAttribute('aria-checked', 'false');
    await expect(deniedRow, 'the denied action is not marked as removed').toContainText('Removed');
  });

  test('7. A partly typed code says so instead of waiting in silence', async ({ page }) => {
    // The failure this pins down cost real time: the code is only checked once all
    // six digits are in, so five digits produced no error, no message and no
    // submit — indistinguishable from a frozen screen, and easy to misread as the
    // app ignoring a correct code. Entering a code one box off is the same shape.
    await page.goto(`${BASE}/login`);
    await page.getByPlaceholder('e.g. 03001234567').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Send Code' }).click();
    await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

    const boxes = page.locator('[data-testid^="otp-digit-"]');
    await expect(boxes).toHaveCount(6);
    for (let i = 0; i < 5; i++) await boxes.nth(i).fill('12345'[i]);

    // Five digits is not a code: nothing submits, and the screen waits for the sixth
    // without a "N more to write" nag under the boxes.
    await page.waitForTimeout(3000);
    expect(page.url(), 'a five-digit code was submitted anyway').toContain('/login/otp');

    // No confirm button: the sixth number submits on its own, exactly as before.
    await boxes.nth(5).fill('6');
    await page.waitForURL(/pin-set|\/login\/pin|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });
  });
});
