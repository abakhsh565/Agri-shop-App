import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Co-Owner — local development browser lane.
 *
 * LOCAL ONLY, BY CONSTRUCTION. Every navigation is loopback, the database client is loopback, and
 * `beforeAll` refuses unless the running Vite module reports MODE=development and the local
 * Supabase URL. It does not read `.env.qa`, take the QA lock or touch staging/production.
 *
 * One controlled identity is used for the whole journey. The spec owns only that identity and the
 * grant it creates; it never truncates a business table.
 */

const BASE = process.env.COOWNER_LOCAL_URL || "http://127.0.0.1:5175";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER_PHONE = "03001234567";
const CO_PHONE = "03008880001";
const CO_PHONE_FORMS = [CO_PHONE, `92${CO_PHONE.slice(1)}`];
const CO_NAME = "QA Co-Owner E2E";
const EMPLOYEE_PHONE = "03007654321";
const SHOP_ID = "00000000-0000-0000-0000-000000000001";
const ASSIGNED_BRANCH = "00000000-0000-0000-0000-000000000002";
const UNASSIGNED_BRANCH = "b17fd67c-44ff-4977-bbb4-79b96abf2edb";
const PIN = "4321";
const OTP = "123456";

let db: Client;

async function localDb() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

async function setLanguage(page: Page, language: "en" | "ur") {
  await page.evaluate((lang) => {
    localStorage.setItem("agrishop-theme", JSON.stringify({ state: { theme: "light", language: lang }, version: 0 }));
  }, language);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dir))
    .toBe(language === "ur" ? "rtl" : "ltr");
}

async function login(page: Page, phone: string, side: "owner" | "employee" = "owner") {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("agri_auth");
    for (const key of Object.keys(localStorage)) if (/^sb-/.test(key)) localStorage.removeItem(key);
  });
  await page.goto(`${BASE}/login`);
  if (side === "employee") {
    await page.getByTestId("auth-tab-employee").click();
    await page.getByTestId("shop-id-input").fill(SHOP_ID);
  }
  await page.getByPlaceholder("e.g. 03001234567").fill(phone);
  await page.getByRole("button", { name: "Send Code" }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 25000 });
  const boxes = page.locator('[data-testid^="otp-digit-"]');
  await expect(boxes).toHaveCount(6);
  await boxes.first().click();
  await page.keyboard.type(OTP);
  for (let i = 0; i < OTP.length; i++) await expect(boxes.nth(i)).toHaveValue(OTP[i]);
  await page.waitForURL(/account-ready|pin-set|\/admin\/dashboard|\/employee\/dashboard|\/co-owner/, { timeout: 35000 });
  if (page.url().includes("account-ready")) {
    await page.getByTestId("account-ready-pin").click();
    await page.waitForURL(/pin-set/, { timeout: 25000 });
  }
  if (page.url().includes("pin-set")) {
    for (const digit of PIN) await page.getByRole("button", { name: digit, exact: true }).first().click();
    await page.waitForTimeout(350);
    for (const digit of PIN) await page.getByRole("button", { name: digit, exact: true }).first().click();
    await page.waitForTimeout(900);
    const done = page.getByTestId("pin-done-open");
    if (await done.count()) await done.click();
  }
  await page.waitForTimeout(1400);
}

async function directApi(page: Page, branchId: string) {
  return page.evaluate(async ({ assigned, unassigned }) => {
    const mod: any = await import(/* @vite-ignore */ "/src/lib/supabase.ts");
    const supabase = mod.supabase;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    const url = supabase.supabaseUrl;
    const key = supabase.supabaseKey;
    const sales = await supabase.from("sales").select("id,branch_id").limit(500);
    const other = await fetch(
      `${url}/rest/v1/sales?select=id,branch_id&branch_id=eq.${unassigned}&limit=5`,
      { headers: { apikey: key, Authorization: `Bearer ${token}` } },
    );
    return {
      token: Boolean(token),
      sales: (sales.data ?? []) as Array<{ id: string; branch_id: string | null }>,
      salesError: sales.error?.message ?? null,
      otherStatus: other.status,
      otherRows: (await other.json().catch(() => [])) as unknown[],
      dashboard: await supabase.rpc("get_co_owner_dashboard", { p_branch_id: assigned, p_range: "month" }),
    };
  }, { assigned: branchId, unassigned: UNASSIGNED_BRANCH });
}

async function cleanupTestIdentity() {
  const user = await db.query("select id from public.users where phone = any($1::text[]) and name = $2", [CO_PHONE_FORMS, CO_NAME]);
  const id = user.rows[0]?.id as string | undefined;
  if (!id) return;
  await db.query("begin");
  try {
    await db.query("delete from public.co_owner_approval_requests where requested_by = $1", [id]);
    await db.query("delete from public.co_owner_branch_scopes where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_supplier_scopes where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_department_scopes where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_record_scopes where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_permissions where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_dashboards where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_authorities where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_assignable_roles where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_scope_settings where grant_id in (select id from public.co_owner_grants where user_id=$1)", [id]);
    await db.query("delete from public.co_owner_grants where user_id = $1", [id]);
    await db.query("delete from public.user_permissions where user_id = $1", [id]);
    await db.query("delete from public.memberships where user_id = $1", [id]);
    await db.query("delete from public.audit_events where user_id = $1", [id]);
    await db.query("delete from auth.users where id = $1", [id]);
    await db.query("delete from public.users where id = $1", [id]);
    await db.query("commit");
  } catch {
    await db.query("rollback");
  }
}

test.describe("Co-Owner local acceptance and scope", () => {
  test.beforeAll(async () => {
    const identity = await fetch(`${BASE}/src/lib/envGuard.ts`).then((r) => r.text());
    expect(identity, "the lane must target the local development server").toContain('"MODE": "development"');
    expect(identity, "the lane must target the local Supabase stack").toContain("http://127.0.0.1:54321");
    db = await localDb();
    const target = await db.query("select current_database() db, inet_server_addr()::text host");
    expect(target.rows[0]?.db).toBe("postgres");
    await cleanupTestIdentity();
  });

  test.afterAll(async () => {
    if (db) {
      await cleanupTestIdentity().catch(() => undefined);
      await db.end();
    }
  });

  test("owner invites, invitee accepts, scoped access works, owner revokes", async ({ browser }) => {
    test.setTimeout(240000);
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ownerPage = await ownerContext.newPage();
    await login(ownerPage, OWNER_PHONE);

    // ── Owner creates the invitation through the real wizard ─────────────────────────────────
    await ownerPage.goto(`${BASE}/admin/settings/hub/people/co-owners/new`);
    await expect(ownerPage.getByTestId("co-owner-wizard")).toBeVisible();
    await ownerPage.getByTestId("co-owner-phone").fill(CO_PHONE);
    await ownerPage.getByTestId("co-owner-name").fill(CO_NAME);
    await ownerPage.getByTestId("co-owner-next").click();
    await ownerPage.getByTestId(`co-owner-branch-${ASSIGNED_BRANCH}`).click();
    await ownerPage.getByTestId("co-owner-next").click();

    // Every module permission the UI offers is selected, so a denied action below is a real
    // authorization decision rather than an accidentally un-granted permission.
    for (let guard = 0; guard < 20; guard++) {
      const selectAll = ownerPage.getByRole("button", { name: "Select all" });
      if (!(await selectAll.count())) break;
      await selectAll.first().click();
    }
    await ownerPage.getByTestId("co-owner-next").click();
    await ownerPage.getByTestId("co-owner-next").click(); // authorities: start restricted
    for (const label of ["Sales overview", "Revenue analysis", "Expense analysis", "Profit and loss", "Customer outstanding", "Inventory position", "Supplier payables", "Team performance", "Money movements", "Action needed"]) {
      const choice = ownerPage.getByRole("button", { name: label, exact: true });
      if (await choice.count()) await choice.first().click();
    }
    await ownerPage.getByTestId("co-owner-next").click();
    await ownerPage.getByTestId("co-owner-next").click();
    await ownerPage.getByTestId("co-owner-save").click();
    await expect(ownerPage).toHaveURL(/\/admin\/settings\/hub\/people\/co-owners$/, { timeout: 30000 });

    const grant = (await db.query(
      "select g.id, g.user_id, g.status, m.status membership_status from public.co_owner_grants g join public.memberships m on m.id = g.membership_id where g.user_id = (select id from public.users where phone = any($1::text[]) and name=$2) order by g.created_at desc limit 1",
      [CO_PHONE_FORMS, CO_NAME],
    )).rows[0];
    expect(grant?.status).toBe("invited");
    expect(grant?.membership_status).toBe("pending");

    // Make the grant deterministic for the access checks: all widgets, one branch, one supplier and
    // one customer assignment, sale-void approval required.
    await db.query("delete from public.co_owner_dashboards where grant_id=$1", [grant.id]);
    await db.query("insert into public.co_owner_dashboards (grant_id, widget_key, visible) select $1, key, true from public.dashboard_widgets", [grant.id]);
    await db.query("delete from public.co_owner_authorities where grant_id=$1", [grant.id]);
    await db.query("insert into public.co_owner_authorities (grant_id, authority_code, mode) select $1, code, case when code='sales.void' then 'approval_required' else 'restricted' end from public.co_owner_authority_catalog", [grant.id]);
    await db.query("delete from public.co_owner_supplier_scopes where grant_id=$1", [grant.id]);
    await db.query("delete from public.co_owner_record_scopes where grant_id=$1", [grant.id]);
    await db.query("update public.co_owner_scope_settings set suppliers_mode='selected', records_mode='selected', departments_mode='none', brands_mode='none' where grant_id=$1", [grant.id]);
    await db.query("insert into public.co_owner_supplier_scopes (grant_id, company_id) select $1, id from public.companies where shop_id=$2 order by name limit 1", [grant.id, SHOP_ID]);
    const assignedCompany = (await db.query("select company_id from public.co_owner_supplier_scopes where grant_id=$1", [grant.id])).rows[0].company_id;
    await db.query("insert into public.co_owner_record_scopes (grant_id, entity_type, entity_id) select $1, 'customer', id from public.customers where shop_id=$2 order by name limit 1", [grant.id, SHOP_ID]);
    const assignedCustomer = (await db.query("select entity_id from public.co_owner_record_scopes where grant_id=$1", [grant.id])).rows[0].entity_id;

    // ── The invited identity signs in but cannot reach or read business data ─────────────────
    const coContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const coPage = await coContext.newPage();
    // A Co-Owner keeps role='employee'; the employee door is the supported sign-in door for that
    // role and the explicit grant/acceptance is what opens the Co-Owner experience.
    await login(coPage, CO_PHONE, "employee");
    await expect(coPage).toHaveURL(/\/co-owner\/accept/, { timeout: 30000 });
    await expect(coPage.getByText("Al Rehman Traders").first()).toBeVisible();
    await expect(coPage.getByText("Al Rehman Traders", { exact: true }).first()).toBeVisible();

    const pendingSales = await coPage.evaluate(async () => {
      const { supabase } = await import(/* @vite-ignore */ "/src/lib/supabase.ts");
      const result = await supabase.from("sales").select("id").limit(5);
      return { count: result.data?.length ?? 0, error: result.error?.message ?? null };
    });
    expect(pendingSales.count, "a pending invitee must read no sales").toBe(0);
    await coPage.goto(`${BASE}/co-owner/dashboard`);
    await expect(coPage.getByTestId("co-owner-access-ended")).toBeVisible();
    await expect(coPage.getByTestId("co-owner-dashboard")).toHaveCount(0);
    await coPage.goto(`${BASE}/co-owner/accept`);

    // Mobile Urdu RTL acceptance summary, measured not just rendered.
    await coPage.setViewportSize({ width: 390, height: 844 });
    await setLanguage(coPage, "ur");
    await expect(coPage.getByTestId("co-owner-invitation-accept")).toBeVisible();
    const rtlAccept = await coPage.evaluate(() => ({
      dir: document.documentElement.dir,
      viewport: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      label: document.querySelector('[data-testid="co-owner-invitation-accept"]')?.getBoundingClientRect().width ?? 0,
      labelBottom: document.querySelector('[data-testid="co-owner-invitation-accept"]')?.getBoundingClientRect().bottom ?? 0,
    }));
    expect(rtlAccept.dir).toBe("rtl");
    expect(rtlAccept.scrollWidth, "acceptance screen overflows horizontally in Urdu mobile").toBeLessThanOrEqual(rtlAccept.viewport + 1);
    expect(rtlAccept.label).toBeGreaterThan(200);
    expect(rtlAccept.labelBottom, "the accept action is below the mobile viewport").toBeLessThanOrEqual(rtlAccept.viewportHeight + 1);
    await coPage.screenshot({ path: "tests/e2e/results/co-owner-accept-mobile-ur.png", fullPage: true });
    await setLanguage(coPage, "en");
    await coPage.setViewportSize({ width: 1280, height: 900 });

    // ── Explicit acceptance ────────────────────────────────────────────────────────────────
    // The controlled device is already PIN-ready; PIN onboarding has its own lane. The
    // authenticated session and server-side acceptance below are real.
    await coPage.evaluate((userId) => localStorage.setItem(`agri_pin_set_${userId}`, "1"), grant.user_id);
    await coPage.getByTestId("co-owner-invitation-accept").click();
    await expect(coPage).toHaveURL(/\/co-owner\/dashboard/, { timeout: 30000 });
    await expect(coPage.getByTestId("co-owner-dashboard")).toBeVisible();

    const active = (await db.query("select status, activated_at from public.co_owner_grants where id=$1", [grant.id])).rows[0];
    expect(active.status).toBe("active");
    expect(active.activated_at).toBeTruthy();

    // dashboard: all-branches plus the assigned branch filter
    await expect(coPage.getByTestId("co-owner-all-branches")).toBeVisible();
    await coPage.getByTestId("co-owner-all-branches").click();
    await coPage.waitForTimeout(700);
    await coPage.getByRole("button", { name: "Al Rehman Traders", exact: true }).last().click();
    await coPage.waitForTimeout(900);
    await expect(coPage.getByTestId("co-owner-dashboard")).toBeVisible();

    await coPage.screenshot({ path: "tests/e2e/results/co-owner-dashboard-desktop-en.png", fullPage: true });
    await coPage.setViewportSize({ width: 390, height: 844 });
    await setLanguage(coPage, "ur");
    await expect(coPage.getByTestId("co-owner-all-branches")).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () => {
        const text = await coPage.getByTestId("co-owner-dashboard").innerText();
        return /لوڈ ہو رہا/.test(text);
      }, { timeout: 30000, message: "the Urdu dashboard never finished loading" })
      .toBe(false);
    const urDashboard = await coPage.evaluate(() => ({
      dir: document.documentElement.dir,
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(urDashboard.dir).toBe("rtl");
    expect(urDashboard.scrollWidth).toBeLessThanOrEqual(urDashboard.viewport + 1);
    await coPage.screenshot({ path: "tests/e2e/results/co-owner-dashboard-mobile-ur.png", fullPage: true });
    await setLanguage(coPage, "en");
    await coPage.setViewportSize({ width: 1280, height: 900 });

    // ── Direct RPC and PostgREST: branch boundary is server-side ───────────────────────────
    const api = await directApi(coPage, ASSIGNED_BRANCH);
    expect(api.token).toBe(true);
    expect(api.salesError).toBeNull();
    expect(api.sales.length).toBeGreaterThan(0);
    expect(new Set(api.sales.map((s) => s.branch_id))).toEqual(new Set([ASSIGNED_BRANCH]));
    expect(api.otherRows, "PostgREST returned the unassigned branch").toHaveLength(0);
    expect(api.otherStatus).toBe(200);
    expect(api.dashboard.error).toBeNull();
    expect(api.dashboard.data).toBeTruthy();
    expect((api.dashboard.data as any)?.empty).not.toBe("no_branches");

    // supplier and customer scopes through direct PostgREST
    const scopedRows = await coPage.evaluate(async ({ company, customer }) => {
      const { supabase } = await import(/* @vite-ignore */ "/src/lib/supabase.ts");
      const companies = await supabase.from("companies").select("id").limit(50);
      const customers = await supabase.from("customers").select("id").limit(50);
      const { data: session } = await supabase.auth.getSession();
      const headers = { apikey: supabase.supabaseKey, Authorization: `Bearer ${session.session?.access_token ?? ""}` };
      const companyRest = await fetch(`${supabase.supabaseUrl}/rest/v1/companies?select=id&limit=50`, { headers });
      const customerRest = await fetch(`${supabase.supabaseUrl}/rest/v1/customers?select=id&limit=50`, { headers });
      return {
        companyIds: (companies.data ?? []).map((r: any) => r.id),
        customerIds: (customers.data ?? []).map((r: any) => r.id),
        companyRest: await companyRest.json(),
        customerRest: await customerRest.json(),
        expectedCompany: company,
        expectedCustomer: customer,
      };
    }, { company: assignedCompany, customer: assignedCustomer });
    expect(scopedRows.companyIds).toEqual([assignedCompany]);
    expect(scopedRows.customerIds).toEqual([assignedCustomer]);
    expect((scopedRows.companyRest as any[]).map((r) => r.id)).toEqual([assignedCompany]);
    expect((scopedRows.customerRest as any[]).map((r) => r.id)).toEqual([assignedCustomer]);

    // ── Module routes stay under /co-owner and render ─────────────────────────────────────
    const routes: Array<[string, string | null]> = [
      ["/co-owner/sales", "sales-summary"],
      ["/co-owner/products", null],
      ["/co-owner/inventory/stockvalues", "stock-management-page"],
      ["/co-owner/customers", null],
      ["/co-owner/purchases", null],
      ["/co-owner/companies", null],
      ["/co-owner/reports", "reports-gross-sales"],
      ["/co-owner/team", null],
      ["/co-owner/approvals", "co-owner-approvals"],
      ["/co-owner/notifications", null],
      ["/co-owner/search", null],
    ];
    for (const [path, selector] of routes) {
      await coPage.goto(`${BASE}${path}`);
      await expect(coPage).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      await expect(coPage).not.toHaveURL(/\/admin/);
      await expect.poll(async () => (await coPage.locator("body").innerText()).trim().length).toBeGreaterThan(20);
      if (selector) await expect(coPage.getByTestId(selector)).toBeVisible();
    }

    const sale = (await db.query("select id from public.sales where shop_id=$1 and branch_id=$2 order by created_at desc limit 1", [SHOP_ID, ASSIGNED_BRANCH])).rows[0];
    expect(sale?.id).toBeTruthy();
    await coPage.goto(`${BASE}/co-owner/sales/${sale.id}`);
    await expect(coPage).not.toHaveURL(/\/admin/);
    await expect.poll(async () => (await coPage.locator("body").innerText()).trim().length).toBeGreaterThan(20);

    // ── Direct URL separation ──────────────────────────────────────────────────────────────
    await coPage.goto(`${BASE}/admin/dashboard`);
    await expect(coPage).not.toHaveURL(/\/admin\/dashboard/);
    await coPage.goto(`${BASE}/employee/dashboard`);
    await expect(coPage).not.toHaveURL(/\/employee\/dashboard/);

    // ── Approval: self-approval refused; revocation cancels the pending request ───────────
    const request = await coPage.evaluate(async (saleId) => {
      const { supabase } = await import(/* @vite-ignore */ "/src/lib/supabase.ts");
      const result = await supabase.rpc("request_co_owner_approval", {
        p_action_code: "sale.void",
        p_entity_type: "sale",
        p_entity_id: saleId,
        p_payload: { saleId, reason: "QA E2E" },
      });
      return { data: result.data, error: result.error?.message ?? null };
    }, sale.id);
    expect(request.error).toBeNull();
    expect(request.data).toBeTruthy();
    const pendingApproval = (await db.query("select id,status from public.co_owner_approval_requests where grant_id=$1 order by created_at desc limit 1", [grant.id])).rows[0];
    expect(pendingApproval.status).toBe("pending");
    const selfApproval = await coPage.evaluate(async (requestId) => {
      const { supabase } = await import(/* @vite-ignore */ "/src/lib/supabase.ts");
      const result = await supabase.rpc("decide_co_owner_approval", { p_request_id: requestId, p_approve: true, p_note: null });
      return { data: result.data, error: result.error?.message ?? null };
    }, pendingApproval.id);
    expect(selfApproval.error, "a Co-Owner must not execute their own request").toBeTruthy();

    // ── Owner revokes through the owner UI; stale session stops immediately ───────────────
    await ownerPage.goto(`${BASE}/admin/settings/hub/people/co-owners/${grant.id}`);
    await expect(ownerPage.getByTestId("co-owner-detail")).toBeVisible();
    await ownerPage.getByTestId("co-owner-revoke").click();
    await ownerPage.getByTestId("co-owner-revoke-confirm").click();
    await expect(ownerPage.getByText(/Revoked|منسوخ/)).toBeVisible({ timeout: 20000 });

    const revokedGrant = (await db.query("select status, revoked_at from public.co_owner_grants where id=$1", [grant.id])).rows[0];
    expect(revokedGrant.status).toBe("revoked");
    expect(revokedGrant.revoked_at).toBeTruthy();
    const cancelled = (await db.query("select status from public.co_owner_approval_requests where id=$1", [pendingApproval.id])).rows[0];
    expect(cancelled.status).toBe("cancelled");

    await coPage.reload();
    await expect.poll(async () => (await coPage.locator("body").innerText())).toMatch(/ended|ختم|sign in|لاگ ان/i);
    const afterRevoke = await coPage.evaluate(async () => {
      const { supabase } = await import(/* @vite-ignore */ "/src/lib/supabase.ts");
      const result = await supabase.from("sales").select("id").limit(5);
      const dashboard = await supabase.rpc("get_co_owner_dashboard", { p_branch_id: null, p_range: "month" });
      return { count: result.data?.length ?? 0, dashboardError: dashboard.error?.message ?? null };
    });
    expect(afterRevoke.count, "a revoked Co-Owner still reads sales").toBe(0);
    expect(afterRevoke.dashboardError).toBeTruthy();

    // ── Owner remains in the owner experience ────────────────────────────────────────────
    await ownerPage.goto(`${BASE}/admin/dashboard`);
    await expect(ownerPage).toHaveURL(/\/admin\/dashboard/);
    await ownerPage.goto(`${BASE}/employee/dashboard`);
    await expect(ownerPage).not.toHaveURL(/\/employee\/dashboard/);

    // ── Employee regression in a fresh context ──────────────────────────────────────────
    const employeeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const employeePage = await employeeContext.newPage();
    await login(employeePage, EMPLOYEE_PHONE, "employee");
    await expect(employeePage).toHaveURL(/\/employee\/dashboard/, { timeout: 30000 });
    await employeePage.goto(`${BASE}/admin/dashboard`);
    await expect(employeePage).not.toHaveURL(/\/admin\/dashboard/);
    await employeePage.goto(`${BASE}/co-owner/dashboard`);
    await expect(employeePage.getByTestId("co-owner-access-ended")).toBeVisible();
    await expect(employeePage.getByTestId("co-owner-dashboard")).toHaveCount(0);
    await employeeContext.close();

    await employeeContext.close().catch(() => undefined);
    await coContext.close();
    await ownerContext.close();
  });
});
