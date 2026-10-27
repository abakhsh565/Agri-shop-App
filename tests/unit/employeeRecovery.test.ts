/**
 * A returning employee recovers with the phone they can prove — not a shop code they
 * were never asked to remember.
 *
 * WHY A GUARD. The shop code is a (shop, number) claim check, not the account identity.
 * Requiring it at the door stranded an employee who reinstalled the app or cleared local
 * data: the membership still existed, the number still worked, and there was no way to
 * name the shop. The fix is deliberately client-side. Leave the field blank, spend the
 * code on the phone, and let `lookup_user_by_phone` resolve the account once the session
 * proves the number; 0201 scopes that answer to the proved identity. The screen must not
 * reintroduce a hard requirement, must not keep a stale shop from an earlier attempt, and
 * must keep the claim check when a code IS supplied.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const login = fs.readFileSync(path.join(ROOT, "src/pages/auth/LoginPage.tsx"), "utf8");
const auth = fs.readFileSync(path.join(ROOT, "src/lib/auth.ts"), "utf8");
const lookup = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/0201_the_pre_login_lookup_answers_for_the_number_only.sql",
  ),
  "utf8",
);

describe("employee recovery after reinstall", () => {
  it("never refuses a code-less employee sign-in", () => {
    expect(login).not.toContain("auth.errShopCodeRequired");
    // The shop claim check is conditional on a code actually being typed.
    expect(login).toMatch(
      /const typed = shopId\.trim\(\);\s*\n\s*let claimedShop = "";\s*\n\s*if \(typed\) \{/,
    );
  });

  it("clears a remembered shop when the field is blank", () => {
    // A stale pair from an earlier attempt would be re-checked at the code screen and
    // refuse the very sign-in this path enables.
    expect(login).toMatch(/rememberInviteShop\(claimedShop \|\| null\)/);
  });

  it("still pair-checks a code that is supplied", () => {
    const start = login.indexOf("if (typed) {");
    const end = login.indexOf("rememberInviteShop(claimedShop || null)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const typedBlock = login.slice(start, end);
    expect(typedBlock).toContain("resolveShopCode(typed)");
    expect(typedBlock).toContain("resolveInvite(claimedShop, cleanPhone)");
    expect(typedBlock).toContain("auth.errNotInvited");
  });

  it("keeps membership resolution on the server, after the phone is proved", () => {
    // The invitation is optional at the door; the profile read is not. 0201 answers a
    // caller only after the session's own subject matches the account, and that answer
    // carries the tenant/membership/branch context this screen depends on.
    expect(auth).toContain("inviteShopId?: string | null");
    expect(lookup).toContain("public.app_current_user_id() IS DISTINCT FROM v_user_id");
    expect(lookup).toContain("'tenant_id', m.tenant_id");
    expect(lookup).toContain("'membership_status', m.status");
    expect(lookup).toContain("'branch_scope', m.branch_scope");
  });

  it("does not invent an account when the phone is unknown", () => {
    // The recovery path ends at the existing invitation/access-request doors, never at
    // a client-side signUp. A fresh identity would not be the membership's user id.
    expect(auth).not.toContain("supabase.auth.signUp");
    expect(login).toContain("/login/request-access");
    expect(login).toContain("auth.askToJoin");
  });
});
