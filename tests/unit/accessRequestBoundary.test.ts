/**
 * Self-request access is retired.
 *
 * Employees are onboarded by an owner adding them. The public request route, the owner inbox,
 * the request client and the anonymous RPC are all gone; the historical table remains. This
 * guard fails if any of those doors is reopened, or if history is deleted to make the removal
 * look cleaner than it is.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(ROOT, relative));

const router = read("src/router/index.tsx");
const login = read("src/pages/auth/LoginPage.tsx");
const notifications = read("src/pages/admin/notifications/AdminNotificationsPage.tsx");
const store = read("src/stores/notificationStore.ts");
const original = read("supabase/migrations/0243_an_access_request_reaches_who_can_act.sql");
const retirement = read("supabase/migrations/0288_retire_employee_self_request.sql");

describe("self-request screens and routes are gone", () => {
  it("has no public request route or page", () => {
    expect(router).not.toContain("/login/request-access");
    expect(exists("src/pages/auth/RequestAccessPage.tsx")).toBe(false);
    expect(login).not.toContain("/login/request-access");
    expect(login).not.toContain("auth.askToJoin");
  });

  it("has no owner or Co-Owner request inbox", () => {
    expect(router).not.toContain("EmployeeAccessRequestsPage");
    expect(router).not.toContain("EmployeeAccessRequestDetailPage");
    expect(exists("src/pages/admin/employees/EmployeeAccessRequestsPage.tsx")).toBe(false);
    expect(exists("src/pages/admin/employees/EmployeeAccessRequestDetailPage.tsx")).toBe(false);
    expect(exists("src/lib/employeeAccessRequests.ts")).toBe(false);
  });

  it("forwards the retired address instead of treating it as an employee id", () => {
    const oldPaths = router
      .split("\n")
      .filter((line) => line.includes("employees/requests"));
    expect(oldPaths.length).toBeGreaterThan(0);
    expect(oldPaths.every((line) => line.includes("<Navigate"))).toBe(true);
  });

  it("does not leave a notification that opens a deleted screen", () => {
    expect(notifications).not.toContain("employee_access_request");
    expect(store).toContain('RETIRED_KINDS = new Set(["employee_access_request"])');
    expect(store).not.toContain("MANAGER_KINDS");
  });
});

describe("the anonymous endpoint is closed", () => {
  it("revokes execution from anon and authenticated", () => {
    expect(retirement).toContain(
      "REVOKE EXECUTE ON FUNCTION public.request_employee_access(text, text, text)",
    );
    expect(retirement).toContain("FROM PUBLIC, anon, authenticated;");
  });

  it("retires the table without deleting its history", () => {
    expect(retirement).not.toMatch(/DROP\s+TABLE/i);
    expect(retirement).not.toMatch(/DELETE\s+FROM\s+public\.employee_access_requests/i);
    expect(retirement).toContain("COMMENT ON TABLE public.employee_access_requests");
  });

  it("keeps the historical table server-owned", () => {
    expect(original).toContain("CREATE TABLE IF NOT EXISTS public.employee_access_requests");
    expect(original).toContain(
      "ALTER TABLE public.employee_access_requests ENABLE ROW LEVEL SECURITY",
    );
    expect(original).toContain(
      "REVOKE ALL ON TABLE public.employee_access_requests FROM PUBLIC, anon, authenticated",
    );
    expect(original).not.toMatch(/CREATE POLICY[^;]*employee_access_requests/i);
  });
});
