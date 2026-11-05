import { beforeEach, describe, expect, it } from "vitest";
import {
  backTarget,
  clearNav,
  navDepth,
  navigateBack,
  recordNavigation,
  updateCurrentPath,
} from "../../src/lib/navContext";
import { resolveRouteMeta } from "../../src/lib/navigation";

/**
 * The Back arrow walks a module-scoped journey for child screens. At a module root it uses
 * browser history when available, so a hub opened from More returns to More; only a cold entry
 * falls back to the workspace board. A contextual link into another module starts its own context.
 */
beforeEach(() => clearNav());

function pressBack(pathname: string, search = "") {
  const visits: { to: string; options?: { replace?: boolean; state?: unknown } }[] = [];
  const handled = navigateBack(
    { pathname, search },
    (to, options) => visits.push({ to, options }),
  );
  return { handled, visits };
}

describe("module-aware back navigation", () => {
  it("retraces the reader's in-module path, then crosses the module-root boundary to the board", () => {
    recordNavigation("/admin/sales", "/admin/dashboard", "push");
    recordNavigation("/admin/sales/customer", "/admin/sales", "push");
    recordNavigation("/admin/sales/customer/products", "/admin/sales/customer", "push");

    expect(backTarget("/admin/sales/customer/products")).toBe("/admin/sales/customer");
    expect(pressBack("/admin/sales/customer/products").visits[0].to).toBe("/admin/sales/customer");
    expect(pressBack("/admin/sales/customer").visits[0].to).toBe("/admin/sales");
    expect(pressBack("/admin/sales").visits[0].to).toBe("/admin/dashboard");
    expect(pressBack("/admin/dashboard").handled).toBe(false);
  });

  it("starts a fresh context on a cross-module link and never leaks the source module", () => {
    recordNavigation("/admin/sales", "/admin/dashboard", "push");
    recordNavigation("/admin/sales/s1", "/admin/sales", "push");
    // A related supplier record opened from the sale detail.
    recordNavigation("/admin/companies/c1", "/admin/sales/s1", "push");

    expect(navDepth()).toBe(1);
    expect(backTarget("/admin/companies/c1")).toBe("/admin/companies");
    expect(pressBack("/admin/companies/c1").visits[0].to).toBe("/admin/companies");
    expect(pressBack("/admin/companies").visits[0].to).toBe("/admin/dashboard");
  });

  it("derives canonical parents for a direct deep link, refresh or new tab", () => {
    expect(pressBack("/admin/customers/c1/payments", "?tab=history").visits[0].to)
      .toBe("/admin/customers/c1");
    clearNav();
    expect(pressBack("/admin/customers/c1").visits[0].to).toBe("/admin/customers");
    expect(pressBack("/admin/customers").visits[0].to).toBe("/admin/dashboard");
  });

  it("sends a cold-entry module root to the authorized workspace board", () => {
    expect(resolveRouteMeta("/admin/purchases").moduleRootPath).toBe("/admin/purchases");
    expect(pressBack("/admin/purchases").visits[0].to).toBe("/admin/dashboard");
    expect(pressBack("/employee/products").visits[0].to).toBe("/employee/dashboard");
    expect(pressBack("/co-owner/team").visits[0].to).toBe("/co-owner/dashboard");
  });

  it("uses history -1 at a module root so the screen it came from is kept", () => {
    const visits: (string | number)[] = [];
    const handled = navigateBack(
      { pathname: "/admin/settings/hub/purchases", search: "" },
      (to) => { visits.push(to); },
      undefined,
      true,
    );

    expect(handled).toBe(true);
    expect(visits).toEqual([-1]);
  });

  it("lets a replaced form hand its place to the saved record", () => {
    recordNavigation("/admin/purchases", "/admin/dashboard", "push");
    recordNavigation("/admin/purchases/new", "/admin/purchases", "push");
    recordNavigation("/admin/purchases/42", "/admin/purchases/new", "replace");

    expect(navDepth()).toBe(2);
    expect(backTarget("/admin/purchases/42")).toBe("/admin/purchases");
  });

  it("resets at each module switch, even after revisiting the same module", () => {
    recordNavigation("/admin/sales", "/admin/dashboard", "push");
    recordNavigation("/admin/sales/s1", "/admin/sales", "push");
    recordNavigation("/admin/companies", "/admin/sales/s1", "push");
    recordNavigation("/admin/companies/c1", "/admin/companies", "push");
    recordNavigation("/admin/purchases/p1", "/admin/companies/c1", "push");

    expect(navDepth()).toBe(1);
    expect(pressBack("/admin/purchases/p1").visits[0].to).toBe("/admin/purchases");
    expect(pressBack("/admin/purchases").visits[0].to).toBe("/admin/dashboard");
  });

  it("keeps filters and list state on the previous step", () => {
    recordNavigation("/admin/customers", "/admin/dashboard", "push");
    updateCurrentPath("/admin/customers?q=ali&page=2", { scroll: 420 });
    recordNavigation("/admin/customers/c1", "/admin/customers?q=ali&page=2", "push");

    expect(backTarget("/admin/customers/c1")).toBe("/admin/customers?q=ali&page=2");
    expect(pressBack("/admin/customers/c1").visits[0].options?.state).toEqual({ scroll: 420 });
  });

  it("does not create history steps for query-only filter changes", () => {
    recordNavigation("/admin/customers?page=1", "/admin/dashboard", "push");
    updateCurrentPath("/admin/customers?page=2");
    updateCurrentPath("/admin/customers?page=3");

    expect(navDepth()).toBe(1);
  });

  it("does not duplicate a step when the same route is recorded twice", () => {
    recordNavigation("/admin/sales", "/admin/dashboard", "push");
    recordNavigation("/admin/sales/s1", "/admin/sales", "push");
    recordNavigation("/admin/sales/s1", "/admin/sales", "push");

    expect(navDepth()).toBe(2);
  });

  it("treats Settings section hubs as module roots, not Settings children", () => {
    expect(resolveRouteMeta("/admin/settings/hub/finance")).toMatchObject({
      moduleId: "finance",
      moduleRootPath: "/admin/settings/hub/finance",
      parentRoute: "/admin/dashboard",
      entryType: "module-root",
    });
    expect(resolveRouteMeta("/admin/settings/hub/finance/money")).toMatchObject({
      moduleId: "finance",
      moduleRootPath: "/admin/settings/hub/finance",
      parentRoute: "/admin/settings/hub/finance",
      entryType: "child",
    });
    expect(resolveRouteMeta("/admin/settings/hub/people")).toMatchObject({
      moduleId: "people",
      moduleRootPath: "/admin/settings/hub/people",
      entryType: "module-root",
    });
    expect(resolveRouteMeta("/admin/settings/roles")).toMatchObject({
      moduleId: "people",
      moduleRootPath: "/admin/settings/hub/people",
      parentRoute: "/admin/settings/hub/people",
      entryType: "child",
    });
    expect(resolveRouteMeta("/admin/settings/roles/new").parentRoute).toBe("/admin/settings/roles");

    expect(pressBack("/admin/settings/hub/finance").visits[0].to).toBe("/admin/dashboard");
    clearNav();
    expect(pressBack("/admin/settings/hub/finance/money").visits[0].to)
      .toBe("/admin/settings/hub/finance");
  });

  it("classifies each workspace and module root from one metadata source", () => {
    expect(resolveRouteMeta("/admin/inventory/new")).toMatchObject({
      workspaceId: "admin",
      moduleId: "inventory",
      moduleRootPath: "/admin/inventory/catalogue",
      parentRoute: "/admin/inventory/catalogue",
      entryType: "child",
    });
    expect(resolveRouteMeta("/admin/employees/e1/role")).toMatchObject({
      moduleRootPath: "/admin/employees",
      parentRoute: "/admin/employees/e1",
      entryType: "child",
    });
    expect(resolveRouteMeta("/employee/dashboard")).toMatchObject({
      workspaceId: "employee",
      entryType: "board",
      isBoard: true,
    });
    expect(resolveRouteMeta("/co-owner/finance")).toMatchObject({
      workspaceId: "co-owner",
      entryType: "module-root",
      moduleRootPath: "/co-owner/finance",
    });
  });
});
