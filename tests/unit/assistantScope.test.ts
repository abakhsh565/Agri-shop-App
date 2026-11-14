import { describe, expect, it, vi } from "vitest";

import { TOOLS_BY_NAME, runTool } from "../../supabase/functions/assistant/tools.mjs";

function fakeClient(granted: string[] = ["sales.view", "activity.view"]) {
  const calls: Array<{ table: string; query: string }> = [];
  const client = {
    select: vi.fn(async (table: string, query = "") => {
      calls.push({ table, query });
      return [];
    }),
    rpc: vi.fn(async () => null),
    hasPermission: vi.fn(async (code: string) => code !== "reports.view" && granted.includes(code)),
    myPermissions: vi.fn(async () => granted),
  };
  return { client, calls };
}

function ctxFor(overrides: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient();
  return {
    calls,
    ctx: {
      client,
      permissions: ["sales.view", "activity.view"],
      shell: "admin",
      role: "employee",
      userId: "user-1",
      experience: "co_owner",
      branchId: "branch-a",
      branchScope: ["branch-a"],
      seeAllBranches: false,
      ...overrides,
    },
  };
}

describe("the assistant's branch boundary", () => {
  it("asks the database for a co-owner's active branch, not every branch", async () => {
    const { ctx, calls } = ctxFor();
    await runTool("sales_summary", ctx, { range: "today" });
    expect(calls[0]?.table).toBe("sales");
    expect(calls[0]?.query).toContain("branch_id=eq.branch-a");
  });

  it("does not add a branch predicate for the owner", async () => {
    const { ctx, calls } = ctxFor({
      experience: "owner",
      role: "owner",
      seeAllBranches: true,
      branchId: "branch-a",
    });
    await runTool("sales_summary", ctx, { range: "today" });
    expect(calls[0]?.query).not.toContain("branch_id=");
  });

  it("scopes activity and never reads sales without sales.view", async () => {
    const { ctx, calls } = ctxFor({
      permissions: ["activity.view"],
      experience: "employee",
      branchId: "branch-b",
      branchScope: ["branch-b"],
    });
    const result = await runTool("employee_activity", ctx, { range: "today" });
    expect(result.facts.canSeeSales).toBe(false);
    expect(calls.some((call) => call.table === "sales")).toBe(false);
    const activity = calls.find((call) => call.table === "activity_log");
    expect(activity?.query).toContain("branch_id=eq.branch-b");
  });

  it("fails closed when a restricted account has no readable branch", async () => {
    const { ctx } = ctxFor({ branchId: null, branchScope: [] });
    await expect(runTool("sales_summary", ctx, { range: "today" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuses cost before it reads a single sales or cost row", async () => {
    const { ctx, calls } = ctxFor({ permissions: ["reports.view"] });
    const tool = TOOLS_BY_NAME.get("profit_summary");
    await expect(tool.run(ctx, { range: "today" })).rejects.toThrow(/cannot see cost or profit/i);
    expect(calls).toEqual([]);
  });
});
