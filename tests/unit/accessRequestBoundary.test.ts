/**
 * An access request is a note, not a grant.
 *
 * The login screen runs before any session exists, so the request RPC is one of
 * the few anon-callable writes in the app. The danger is not the request itself;
 * it is a future edit that lets the request create membership, exposes the
 * requester's phone to every shop member, or opens the table to the client. This
 * guard reads the SQL and the client and fails on each of those.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/0243_an_access_request_reaches_who_can_act.sql"),
  "utf8",
);
const client = fs.readFileSync(
  path.join(ROOT, "src/lib/employeeAccessRequests.ts"),
  "utf8",
);
const store = fs.readFileSync(
  path.join(ROOT, "src/stores/notificationStore.ts"),
  "utf8",
);
const login = fs.readFileSync(
  path.join(ROOT, "src/pages/auth/LoginPage.tsx"),
  "utf8",
);

/** The body of one function, from its CREATE to its closing `$$;`. */
function body(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", start);
  expect(end, `${name} has no closing $$;`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("access-request table", () => {
  it("is server-owned: RLS on, no policies, every client grant revoked", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.employee_access_requests");
    expect(migration).toContain("ALTER TABLE public.employee_access_requests ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.employee_access_requests FROM PUBLIC, anon, authenticated",
    );
    // A policy would be a second door beside the RPCs. There must not be one.
    expect(migration).not.toMatch(/CREATE POLICY[^;]*employee_access_requests/i);
  });

  it("keeps one open request per number per business and a status the UI can trust", () => {
    expect(migration).toContain("employee_access_requests_one_pending");
    expect(migration).toMatch(/WHERE status = 'pending'/);
    expect(migration).toMatch(/status\s+text NOT NULL DEFAULT 'pending'/);
    expect(migration).toContain("CHECK (status IN ('pending', 'approved', 'dismissed'))");
  });
});

describe("request_employee_access", () => {
  const fn = body("request_employee_access");

  it("is definer-scoped and callable anonymously, and nothing else is", () => {
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("SET search_path = public");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.request_employee_access(text, text, text) TO anon, authenticated",
    );
  });

  it("records a request and a generic notification, never access", () => {
    expect(fn).toContain("INSERT INTO public.employee_access_requests");
    expect(fn).toContain("INSERT INTO public.notifications");
    expect(fn).toContain("'employee_access_request'");
    // The one thing this function must never do. Membership is created by the
    // owner's existing invitation path, not by an unauthenticated request.
    expect(fn).not.toMatch(/INSERT INTO public\.(memberships|users)\b/i);
    expect(fn).not.toMatch(/UPDATE public\.(memberships|users)\b/i);
  });

  it("is idempotent and rate-limited before it can fill an owner's inbox", () => {
    expect(fn).toContain("v_existing_id");
    expect(fn).toContain("r.status = 'pending'");
    expect(fn).toContain("interval '24 hours'");
    expect(fn).toContain("rate_limited");
  });

  it("does not return the shop name or the owner's identity", () => {
    expect(fn).not.toMatch(/jsonb_build_object\([^)]*shopName/i);
    expect(fn).not.toContain("v_owner_id");
  });
});

describe("owner and manager RPCs", () => {
  for (const fn of [
    "list_employee_access_requests",
    "get_employee_access_request",
    "mark_employee_access_request_added",
    "dismiss_employee_access_request",
  ]) {
    it(`${fn} is authenticated-only`, () => {
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated;`),
      );
    });
  }

  it("each read and write begins with employees.manage", () => {
    for (const fn of [
      "list_employee_access_requests",
      "get_employee_access_request",
      "mark_employee_access_request_added",
      "dismiss_employee_access_request",
    ]) {
      expect(body(fn), `${fn} has no employees.manage gate`).toContain(
        "authorize_business_action('employees.manage')",
      );
    }
  });

  it("linking an employee requires the same business and the same phone", () => {
    const fn = body("mark_employee_access_request_added");
    expect(fn).toContain("m.tenant_id = v_tenant");
    expect(fn).toContain("public.canonical_phone(u.phone) = v_row.requester_phone");
    expect(fn).toContain("'EMPLOYEE_DOES_NOT_MATCH_REQUEST'");
  });
});

describe("the app uses the RPCs, not the table", () => {
  it("the client never selects the request table directly", () => {
    expect(client).not.toMatch(/\.from\(\s*["']employee_access_requests["']\s*\)/);
    expect(client).toContain('supabase.rpc("request_employee_access"');
    expect(client).toContain('supabase.rpc("list_employee_access_requests"');
  });

  it("the notification is shown to owners and employees.manage holders", () => {
    expect(store).toContain('MANAGER_KINDS = new Set(["employee_access_request"])');
    expect(store).toContain('hasPermission("employees.manage")');
  });

  it("the login screen reaches the request page", () => {
    expect(login).toContain("/login/request-access");
  });
});
