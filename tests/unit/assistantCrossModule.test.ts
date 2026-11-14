import { describe, expect, it, vi } from "vitest";

import { runTool, toolsFor } from "../../supabase/functions/assistant/tools.mjs";

type Call = { kind: "select"; table: string; query: string } | { kind: "rpc"; fn: string; args: Record<string, unknown> };

function setup(options: {
  permissions?: string[];
  tables?: Record<string, unknown[]>;
  rpcData?: Record<string, unknown>;
  branchId?: string | null;
  branchScope?: string[] | null;
  seeAllBranches?: boolean;
  experience?: string;
} = {}) {
  const permissions = options.permissions ?? [
    "sales.view",
    "purchases.view",
    "payments.view",
    "employees.view",
    "inventory.view",
    "customers.view",
    "products.view",
  ];
  const calls: Call[] = [];
  const rpcData = options.rpcData ?? {};
  const tables = options.tables ?? {};
  const client = {
    select: vi.fn(async (table: string, query = "") => {
      calls.push({ kind: "select", table, query });
      return tables[table] ?? [];
    }),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ kind: "rpc", fn, args });
      return rpcData[fn] ?? null;
    }),
    hasPermission: vi.fn(async (code: string) => permissions.includes(code)),
    myPermissions: vi.fn(async () => permissions),
  };
  return {
    calls,
    client,
    ctx: {
      client,
      permissions,
      shell: "admin",
      role: options.experience ?? "co_owner",
      userId: "user-1",
      experience: options.experience ?? "co_owner",
      branchId: options.branchId === undefined ? "branch-a" : options.branchId,
      branchScope: options.branchScope === undefined ? ["branch-a"] : options.branchScope,
      seeAllBranches: options.seeAllBranches ?? false,
    },
  };
}

describe("cross-module assistant tools", () => {
  it("shows only the branches the database returns, with money fields gated by role", async () => {
    const { ctx } = setup({
      permissions: ["sales.view"],
      rpcData: {
        get_my_branches: [
          {
            branch_id: "branch-a",
            name: "Main Branch",
            address: "Lahore",
            is_current: true,
            is_main: true,
            employee_count: 3,
            product_count: 12,
            sales_total: 25000,
            inventory_value: 90000,
            credit_outstanding: 4000,
          },
        ],
      },
    });
    const result = await runTool("branch_overview", ctx, {});
    expect(result.facts.count).toBe(1);
    expect(result.facts.branches[0]).toMatchObject({ name: "Main Branch", address: "Lahore" });
    expect(result.facts.branches[0]).toHaveProperty("salesTotal", "25,000");
    // Inventory cost and customer credit are not in the facts for a sales-only account.
    expect(result.facts.branches[0]).not.toHaveProperty("inventoryValue");
    expect(result.facts.branches[0]).not.toHaveProperty("creditOutstanding");
  });

  it("scopes purchases to the active branch for a restricted account", async () => {
    const { ctx, calls } = setup({ permissions: ["purchases.view"] });
    const result = await runTool("purchases_overview", ctx, { range: "month" });
    expect(result.facts.scope).toBe("current branch");
    expect(calls.find((c) => c.kind === "select" && c.table === "purchases")?.query).toContain(
      "branch_id=eq.branch-a",
    );
  });

  it("lets the owner ask for one branch's sales, and records that branch in the answer", async () => {
    const { ctx, calls } = setup({
      seeAllBranches: true,
      experience: "owner",
      branchScope: null,
      rpcData: { get_my_branches: [{ branch_id: "branch-b", name: "Harbour Branch", is_current: false }] },
    });
    const result = await runTool("sales_summary", ctx, { range: "today", branch: "Harbour" });
    expect(result.facts.scope).toBe("Harbour Branch");
    expect(result.facts.branchName).toBe("Harbour Branch");
    expect(calls.find((c) => c.kind === "select" && c.table === "sales")?.query).toContain(
      "branch_id=eq.branch-b",
    );
  });

  it("keeps the owner's business-wide finance view free of a branch predicate, but scopes current", async () => {
    const { ctx, calls } = setup({
      seeAllBranches: true,
      experience: "owner",
      branchScope: null,
      rpcData: { get_my_branches: [{ branch_id: "branch-a", name: "Main", is_current: true }] },
    });
    await runTool("finance_overview", ctx, { range: "month", scope: "all" });
    const allQuery = calls.find((c) => c.kind === "select" && c.table === "finance_entries")?.query;
    expect(allQuery).not.toContain("branch_id=");

    calls.length = 0;
    await runTool("finance_overview", ctx, { range: "month", scope: "current" });
    const currentQuery = calls.find((c) => c.kind === "select" && c.table === "finance_entries")?.query;
    expect(currentQuery).toContain("branch_id=eq.branch-a");
  });

  it("refuses an employee outside the caller's branch before calling the performance RPC", async () => {
    const { ctx, calls } = setup({
      permissions: ["employees.view"],
      branchScope: ["branch-a"],
      rpcData: {
        get_shop_members: [
          {
            id: "employee-b",
            name: "Ali",
            phone: "923001112223",
            role: "employee",
            membership_role: "employee",
            membership_status: "active",
            is_active: true,
            branch_scope: ["branch-b"],
            job_title: "Sales",
          },
        ],
      },
    });
    await expect(runTool("employee_performance", ctx, { name: "Ali" })).rejects.toMatchObject({
      status: 403,
    });
    expect(calls.some((c) => c.kind === "rpc" && c.fn === "get_employee_performance")).toBe(false);
  });

  it("refuses the employee directory without the employees permission", async () => {
    const { ctx, calls } = setup({ permissions: [] });
    await expect(runTool("employee_directory", ctx, {})).rejects.toMatchObject({
      refused: true,
      permission: "employees.view",
    });
    expect(calls).toEqual([]);
  });

  it("does not offer purchase or finance tools to a sales-only employee", () => {
    const names = toolsFor(["sales.view", "inventory.view"]).map((tool: { name: string }) => tool.name);
    expect(names).not.toContain("purchases_overview");
    expect(names).not.toContain("finance_overview");
    expect(names).not.toContain("employee_directory");
    expect(names).toContain("inventory_overview");
    expect(names).toContain("branch_overview");
  });
});
