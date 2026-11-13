/**
 * The assistant's permission wall — proved against the real database.
 *
 * The assistant is on the app's own sign-in now, so the thing that has to stay true is the same
 * thing as before: whoever is signed in gets their own data and nothing else, and an employee is
 * never handed a figure their account cannot see in the app. This file is the port's proof, and it
 * is deliberately runnable with no model key — the security-critical half must not depend on a
 * paid API being reachable.
 *
 * The code under test is the SAME module the edge function deploys (`supabase/functions/assistant`),
 * so a passing lane here is evidence about the shipped path rather than about a copy of it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { makeClient, runTool, toolsFor } from "../../supabase/functions/assistant/tools.mjs";
import { askDeterministic, guardMoneyTopic, verifyFigures } from "../../supabase/functions/assistant/providers.mjs";

// The repository's own QA identities (tests/setup/fixtures.ts): the shop owner and the sales
// employee. Nothing assistant-specific — the lane proves the assistant on the same two people the
// rest of the app is tested with.
const OWNER_PHONE = "923001234567";
const EMPLOYEE_PHONE = "923001122334";

function qaEnv() {
  const env: Record<string, string> = {};
  const file = path.resolve(__dirname, "../../.env.qa");
  // A CI checkout has no .env.qa — its QA credentials arrive as repository secrets, already in
  // the process environment. Read the file only when it exists, locally, and let the process
  // environment fill in (and win over) what it provided.
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.includes("=")) continue;
      const key = line.split("=")[0].trim();
      env[key] = line.split("=").slice(1).join("=").trim().replace(/^\[|\]$/g, "");
    }
  }
  for (const key of [
    "QA_SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "QA_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value.replace(/^\[|\]$/g, "");
  }
  return env;
}

/** The app's own derivation (src/lib/auth.ts): one credential per phone number. */
function credentialsFor(phone: string) {
  const digits = String(phone).replace(/[^0-9]/g, "");
  const e164 = digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
  return { e164, email: `user-${e164}@agrishop.auth.local`, password: `AgriShop-${e164}-2026!` };
}

type Session = {
  phone: string;
  userId: string;
  permissions: string[];
  client: ReturnType<typeof makeClient>;
  ctx: Record<string, unknown>;
};

async function signIn(baseUrl: string, anonKey: string, phone: string): Promise<Session> {
  const { e164, email, password } = credentialsFor(phone);
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.msg || `sign-in failed (${res.status})`);
  const client = makeClient({ baseUrl, anonKey, accessToken: json.access_token });
  const permissions = await client.myPermissions();
  const [access, activeBranch, allowedBranches] = await Promise.all([
    client.rpc("get_my_access_context").catch(() => null),
    client.rpc("current_branch_id").catch(() => null),
    client.rpc("allowed_branch_scope").catch(() => null),
  ]);
  const experience =
    access?.experience === "owner" || access?.experience === "co_owner" || access?.experience === "employee"
      ? access.experience
      : "employee";
  const seeAllBranches = experience === "owner";
  return {
    phone: e164,
    userId: json.user?.id,
    permissions,
    client,
    ctx: {
      client,
      permissions,
      shell: experience === "employee" ? "employee" : "admin",
      role: experience,
      userId: json.user?.id,
      experience,
      branchId: typeof activeBranch === "string" ? activeBranch : null,
      branchScope: seeAllBranches ? null : Array.isArray(allowedBranches) ? allowedBranches : [],
      seeAllBranches,
    },
  };
}

let env: Record<string, string>;
let owner: Session;
let employee: Session;

beforeAll(async () => {
  env = qaEnv();
  const baseUrl = env.QA_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.QA_SUPABASE_ANON_KEY;
  expect(baseUrl, "QA_SUPABASE_URL missing from the environment and .env.qa").toBeTruthy();
  expect(anonKey, "QA_SUPABASE_ANON_KEY missing from the environment and .env.qa").toBeTruthy();
  owner = await signIn(baseUrl, anonKey, OWNER_PHONE);
  employee = await signIn(baseUrl, anonKey, EMPLOYEE_PHONE);
  employee.ctx = { ...employee.ctx, shell: "employee", role: "employee" };
});

describe("the assistant runs as the person who is signed in", () => {
  it("signs in with the app's own credentials, not an assistant-only account", () => {
    // Both sessions are ordinary app users: the same rows, the same RLS, the same permissions the
    // app's own screens read.
    expect(owner.userId).toBeTruthy();
    expect(employee.userId).toBeTruthy();
    expect(owner.userId).not.toBe(employee.userId);
  });

  it("gives the owner the full set and the employee a shop-floor set with no reports", () => {
    expect(owner.permissions.length).toBeGreaterThanOrEqual(30);
    expect(owner.permissions).toContain("reports.view");
    expect(employee.permissions).not.toContain("reports.view");
    expect(employee.permissions).toContain("sales.view");
  });

  it("gives the owner all branches and restricts the employee to the active branch", () => {
    expect(owner.ctx.seeAllBranches).toBe(true);
    expect(employee.ctx.seeAllBranches).toBe(false);
    expect(employee.ctx.branchId).toBeTruthy();
  });

  it("never offers the employee a profit tool", () => {
    const ownerTools = toolsFor(owner.permissions).map((t: any) => t.name);
    const employeeTools = toolsFor(employee.permissions).map((t: any) => t.name);
    expect(ownerTools).toContain("profit_summary");
    expect(employeeTools).not.toContain("profit_summary");
  });

  it("refuses profit to the employee through the gate", async () => {
    await expect(runTool("profit_summary", employee.ctx, { range: "today" })).rejects.toMatchObject({
      refused: true,
      permission: "reports.view",
    });
  });

  it("refuses profit even when the tool body is called directly", async () => {
    // The model-hallucinated-tool-call case: skipping `runTool` entirely must still be refused,
    // because the body re-asks the database before it reads a single cost column.
    const { TOOLS_BY_NAME } = await import("../../supabase/functions/assistant/tools.mjs");
    const tool = TOOLS_BY_NAME.get("profit_summary");
    await expect(tool.run(employee.ctx, { range: "today" })).rejects.toThrow(/cannot see cost or profit/i);
  });

  it("answers the owner's profit question and never leaks a figure to the employee", async () => {
    const asOwner = await askDeterministic("how much profit did I make this month", owner.ctx);
    expect(asOwner.refused).toBeFalsy();
    expect(String(asOwner.answer)).toMatch(/profit/i);

    const asEmployee = await askDeterministic("how much profit did I make this month", employee.ctx);
    expect(asEmployee.refused).toBe(true);
    expect(String(asEmployee.answer)).not.toMatch(/\d{1,3}(,\d{3})+/);
  });

  it("sets aside a money sentence the account cannot back with a tool", () => {
    // Found while using it, not while reading it: an employee asked for profit, had no profit
    // tool, and the model — reaching for the one tool it did have, sales — answered "no sales were
    // recorded today, so the profit is zero". True by luck on an empty day, and exactly the
    // sentence that is wrong on a busy one, because revenue is not profit. An instruction to the
    // model is not a boundary, so the sentence is checked after the model has spoken.
    const drafted = { answer: "Your profit today was 1,250 rupees, on a margin of 12 percent.", speak: "" };
    const forEmployee = guardMoneyTopic(drafted, employee.ctx);
    expect(forEmployee.refused).toBe(true);
    expect(String(forEmployee.answer)).not.toMatch(/\d/);
    expect(guardMoneyTopic(drafted, owner.ctx)).toBe(drafted);
  });
});

describe("the answer carries its detail as a widget, in the chat", () => {
  it("returns the sales card to an account that may see sales", async () => {
    const answer = await askDeterministic("what are today's sales", employee.ctx);
    expect(answer.refused).toBeFalsy();
    const widgets: any[] = (answer as any).widgets ?? [];
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets[0].tool).toBe("sales_summary");
    expect(widgets[0].facts).toHaveProperty("period");
  });

  it("carries no card at all with a refusal — nothing to show means nothing shown", async () => {
    const refused = await askDeterministic("how much profit did I make today", employee.ctx);
    expect(refused.refused).toBe(true);
    expect((refused as any).widgets ?? []).toEqual([]);
  });

  it("says the figure it was given, and only figures it was given", async () => {
    const answer = await askDeterministic("what are today's sales", owner.ctx);
    const widgets: any[] = (answer as any).widgets ?? [];
    if (!widgets.length) return; // nothing to compare in an empty shop
    const figures = new Set<number>();
    const walk = (value: unknown) => {
      if (value == null) return;
      if (typeof value === "number") figures.add(value);
      else if (typeof value === "string") {
        for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) figures.add(Number(m[0].replace(/,/g, "")));
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach(walk);
    };
    walk(widgets[0].facts);
    for (const m of String(answer.answer).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*rupees/g)) {
      expect(figures.has(Number(m[1].replace(/,/g, ""))), `spoke ${m[1]} rupees, which the facts do not contain`).toBe(true);
    }
  });
});

describe("a figure the model invented is never repeated", () => {
  it("flags a number the tools did not return", () => {
    const facts = { customers: [{ name: "Yaqoob", owes: "11,050", creditLimit: "5,000" }] };
    expect(verifyFigures("Yaqoob owes 11,050 rupees, against a limit of 5,000 rupees.", facts).ok).toBe(true);
    const invented = verifyFigures("Yaqoob owes 11,050 rupees, against a limit of 20,000 rupees.", facts);
    expect(invented.ok).toBe(false);
    expect(invented.invented).toContain("20,000");
  });
});
