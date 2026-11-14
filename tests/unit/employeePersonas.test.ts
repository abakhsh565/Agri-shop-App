import { describe, expect, it } from "vitest";
import { resolveEmployeeWorkspace } from "@/lib/employeeWorkspace";
import {
  DASHBOARD_WIDGET_HINTS,
  RESPONSIBILITY_LEVELS,
  ROLE_CATEGORIES,
  ROLE_TEMPLATES,
  type RoleTemplate,
} from "@/lib/roleTemplates";

function hasFrom(template: RoleTemplate) {
  return (code: string) => template.permissions.includes(code);
}

function template(name: string): RoleTemplate {
  const found = ROLE_TEMPLATES.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing template: ${name}`);
  return found;
}

describe("employee persona templates", () => {
  it("has unique ids and names", () => {
    expect(new Set(ROLE_TEMPLATES.map((t) => t.id)).size).toBe(ROLE_TEMPLATES.length);
    expect(new Set(ROLE_TEMPLATES.map((t) => t.name)).size).toBe(ROLE_TEMPLATES.length);
  });

  it("only references implemented categories, levels and dashboards", () => {
    const categories = new Set(ROLE_CATEGORIES.map((category) => category.value));
    const levels = new Set(RESPONSIBILITY_LEVELS.map((level) => level.value));
    const widgets = new Set(Object.keys(DASHBOARD_WIDGET_HINTS));

    for (const entry of ROLE_TEMPLATES) {
      expect(categories.has(entry.category), `${entry.name} category`).toBe(true);
      expect(levels.has(entry.level), `${entry.name} level`).toBe(true);
      expect(entry.permissions.length, `${entry.name} permissions`).toBeGreaterThan(0);
      expect(entry.dashboards.length, `${entry.name} dashboards`).toBeGreaterThan(0);
      expect(new Set(entry.permissions).size, `${entry.name} duplicate permission`).toBe(entry.permissions.length);
      expect(new Set(entry.dashboards).size, `${entry.name} duplicate dashboard`).toBe(entry.dashboards.length);
      for (const dashboard of entry.dashboards) {
        expect(widgets.has(dashboard), `${entry.name} references ${dashboard}`).toBe(true);
      }
    }
  });

  it("never turns a template into owner authority", () => {
    for (const entry of ROLE_TEMPLATES) {
      expect(entry.permissions, entry.name).not.toContain("*");
      expect(entry.permissions, entry.name).not.toContain("settings.edit");
      expect(entry.permissions, entry.name).not.toContain("employees.manage");
    }
  });

  it("covers the justified business personas without duplicates", () => {
    expect(ROLE_TEMPLATES.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "Sales Employee",
        "Sales Supervisor",
        "Sales Manager",
        "Store Manager",
        "Inventory Clerk",
        "Inventory Manager",
        "Finance Employee",
        "Finance Manager",
        "Purchase Officer",
        "Purchase Manager",
        "Credit & Customer Officer",
      ]),
    );
  });

  it("keeps finance reading the sales it reports on", () => {
    for (const name of ["Finance Employee", "Finance Manager"]) {
      expect(template(name).permissions, name).toContain("sales.view");
      expect(template(name).permissions, name).toContain("payments.view");
    }
  });

  it("routes a purchase officer to purchasing, not finance", () => {
    const officer = template("Purchase Officer");
    expect(resolveEmployeeWorkspace(hasFrom(officer))).toBe("purchases");
  });

  it("routes each workspace from work permissions, not its label", () => {
    expect(resolveEmployeeWorkspace(hasFrom(template("Sales Employee")))).toBe("sales");
    expect(resolveEmployeeWorkspace(hasFrom(template("Sales Manager")))).toBe("sales");
    expect(resolveEmployeeWorkspace(hasFrom(template("Inventory Clerk")))).toBe("products");
    expect(resolveEmployeeWorkspace(hasFrom(template("Inventory Manager")))).toBe("products");
    expect(resolveEmployeeWorkspace(hasFrom(template("Finance Employee")))).toBe("finance");
    expect(resolveEmployeeWorkspace(hasFrom(template("Finance Manager")))).toBe("finance");
    expect(resolveEmployeeWorkspace(hasFrom(template("Purchase Manager")))).toBe("purchases");
    expect(resolveEmployeeWorkspace(hasFrom(template("Credit & Customer Officer")))).toBe("customers");
    expect(resolveEmployeeWorkspace(hasFrom(template("Store Manager")))).toBe("products");
  });
});
