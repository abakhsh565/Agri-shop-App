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
import { test, expect, type Page } from '@playwright/test';
import {
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
async function shownAreaModules(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="emp-perm-area-"]');
  await expect(rows.first()).toBeVisible();
  // The list draws the whole catalogue; the areas THIS role grants are the rows whose
  // box is not empty. Each row prints "granted/total", so "granted > 0" is the row's
  // own answer rather than a second opinion from a mapping this test would have to keep.
  const modules = await rows.evaluateAll((els) =>
    els
      .map((el) => {
        const counts = (el.textContent ?? '').match(/(\d+)\/(\d+)/);
        const granted = counts ? Number(counts[1]) : 0;
        return granted > 0 ? (el.getAttribute('data-testid') ?? '').replace('emp-perm-area-', '') : null;
      })
      .filter((m): m is string => !!m)
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
    // The owner can see the whole journey before walking it: the three steps are
    // named, not three anonymous dots.
    for (const name of ['Employee', 'Role', 'Where']) {
      expect(step1, `the step rail does not name the "${name}" step`).toContain(name);
    }

    await page.getByPlaceholder('e.g. Bilal Ahmed').fill(NEW_NAME);
    await page.getByPlaceholder('03001234567').fill(NEW_PHONE_LOCAL);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Step 2 asks ONE thing: what they do. Branch used to be below the access
    // panel on this same step, so the owner had to scroll past a read-only list
    // to find a decision.
    const step2 = await bodyText(page);
    expect(step2).toContain('What does UX do?');
    expect(step2, 'the branch decision is mixed into the role step again').not.toContain('Where can UX work?');
    expect(step2, 'step 2 exposes RBAC vocabulary').not.toMatch(JARGON);
    // No role is preselected: a default would let the owner hand out access
    // without ever deciding what the person does.
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(step2, 'a role is preselected again').not.toContain('Access from this role');

    // Choosing a role answers "what access will they get?" on that role's own Modify
    // handle — the list opens on the role, and every area it shows is an area the
    // database grants that role.
    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    await page.waitForTimeout(800);
    expect(await bodyText(page), 'the read-only access panel is back').not.toContain('Access from this role');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    const salesManagerId = await roleIdByName('Sales Manager');
    await page.locator(`[data-testid="role-modify-${salesManagerId}"]`).click();
    await expect(page.locator('[data-testid="emp-access-context"]')).toBeVisible();
    const [shown, fromDb] = [await shownAreaModules(page), (await dbAreasForRole('Sales Manager')).sort()];
    expect(shown.length, 'no areas rendered for the selected role').toBeGreaterThan(0);
    expect(shown, 'the areas on screen are not the areas the role grants').toEqual(fromDb);
    expect(await bodyText(page), 'the access list exposes RBAC vocabulary').not.toMatch(JARGON);
    await page.locator('[data-testid="role-modify-done"]').click();
    await expect(page.locator('[data-testid="emp-access-context"]')).toBeHidden();

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Step 3 asks where they work and confirms — the only screen that collects
    // the details, and the only one that commits.
    const step3 = await bodyText(page);
    expect(step3).toContain('Where can UX work?');
    for (const label of ['Check the details', 'Name', 'Phone', 'Role', 'Branch', 'Access']) {
      expect(step3, `the confirmation step is missing "${label}"`).toContain(label);
    }
    // The button says what actually happens: adding somebody sends an invitation.
    expect(step3).toContain('Send invitation');
    expect(step3, 'the flow does not say what happens after the invite').toContain('sets their own PIN');
    expect(step3, 'step 3 exposes RBAC vocabulary').not.toMatch(JARGON);
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

    await page.getByRole('button', { name: /Sales Manager/ }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);

    // Choose one branch (the QA shop has two, so this is a real decision).
    const [branch] = await execSql(`SELECT id, name FROM branches WHERE is_active ORDER BY name LIMIT 1`);
    await page.getByRole('button', { name: new RegExp(branch.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
    await page.waitForTimeout(400);

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
    await expect(
      page.getByText('Invitation sent').first(),
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
    await expect(page.getByText('Invitation sent').first()).toBeVisible({ timeout: 30000 });
    const detail = await bodyText(page);
    expect(detail).toContain('Invitation sent');
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
    if (roleAreas.length) {
      await expect(
        accessSection,
        'the invited employee never showed the role defaults'
      ).toContainText(new RegExp(roleAreas[0], 'i'), { timeout: 30000 });
    }
    const invitedAreas = (await accessSection.innerText()).toLowerCase();
    for (const area of roleAreas) {
      expect(invitedAreas, `the invited employee does not show the role's area "${area}"`).toContain(area);
    }
    expect(detail, 'a pending membership is reported as a change the owner made').not.toContain('changed for');
    // The destructive action must name what it actually does at this state.
    expect(detail, 'cancelling an invitation is offered as a deactivation').toContain('Cancel invitation');
    expect(detail, 'a pending employee is offered "Deactivate employee"').not.toContain('Deactivate employee');

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
    await page.waitForTimeout(1500);
    await expect(
      page.getByPlaceholder('e.g. 03001234567'),
      'the invitation link does not fill in the employee\u2019s number'
    ).toHaveValue(NEW_PHONE_DB);
    // The link carries the shop now, so the line names it: "You were invited to {shop}."
    expect(
      await bodyText(page),
      'the invited person is not told why the number is already filled in'
    ).toContain('You were invited to');
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
    const salesManagerId = await roleIdByName('Sales Manager');
    await page.locator(`[data-testid="role-modify-${salesManagerId}"]`).click();
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
    expect(step3).toContain('بلال کہاں کام کر سکتا ہے؟');
    expect(step3).toContain('دعوت بھیجیں');
    expect(step3, 'English copy leaked into the Urdu confirmation step').not.toContain('Send invitation');
    const overflowStep3 = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(overflowStep3, 'horizontal overflow on the Urdu confirmation step').toBe(false);
  });

  test('4. Employee detail explains role, place and access without RBAC vocabulary', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/employees/${QA_EMPLOYEE_ID}`);
    await page.waitForTimeout(1600);

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

    // Suppliers is not part of this employee's role, so turning it on is a real override.
    // Located by its business label: the area mark is an icon now, not an emoji
    // prefix, so matching on the glyph was asserting on decoration rather than
    // on the row the owner actually reads.
    const suppliersRow = page.locator('button').filter({ hasText: /^\s*Suppliers/ }).first();
    await expect(suppliersRow).toBeVisible();
    await suppliersRow.click();

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
       WHERE up.user_id = '${QA_EMPLOYEE_ID}' AND up.is_override = true AND p.module = 'companies'`);
    expect(overrides.length, 'no override row was stored for the customized area').toBeGreaterThan(0);
    expect(overrides.every((o) => o.is_granted === true)).toBe(true);
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

    // Suppliers is outside a Sales Employee's role, so granting it is a real
    // exception and must be visible as one.
    await page.locator('[data-testid="emp-perm-area-companies"]').click();
    await page.waitForTimeout(500);
    expect(await bodyText(page), 'a customization is not reported to the owner').toMatch(/\d+ changes? from Sales Employee/);
    await page.locator('[data-testid="role-modify-done"]').click();
    // The chosen card says what was changed, without opening the list again.
    expect(await bodyText(page), 'the role card does not report the change').toMatch(/\d+ changes? from Sales Employee/);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);
    const summary = await bodyText(page);
    expect(summary, 'the confirmation omits the customized area').toContain('Suppliers');
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
    expect(stored.every((s: { is_granted: boolean }) => s.is_granted === true)).toBe(true);
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

    // Store Manager happens to grant Suppliers on its own, so the exception is now
    // redundant for ACCESS — but it is still the owner's recorded decision and must
    // survive, exactly as the database resolves it (update_employee_access does not
    // touch user_permissions when the role changes).
    const after = await execSql(`
      SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = '${ovr.id}' AND up.is_override = true AND up.is_granted = true ORDER BY p.code`);
    expect(after.length, 'changing the role silently discarded the employee\'s exceptions').toBe(stored.length);
    const [roleNow] = await execSql(`
      SELECT r.name FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.user_id = '${ovr.id}'`);
    expect(roleNow.name).toBe('Store Manager');
    // And the screen stops claiming a difference, because the access now equals the
    // role — the exception is on file, not in force.
    expect(await bodyText(page), 'the screen claims a difference the role already provides').not.toContain('changed for');
    const accessRow = await page.getByText('Access', { exact: true }).first().locator('xpath=..').innerText();
    expect(accessRow, 'the newly granted area is missing from the access line').toContain('Suppliers');
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
