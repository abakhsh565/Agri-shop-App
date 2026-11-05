/**
 * A returning employee needs the phone they can prove, never a shop code they were never asked
 * to remember.
 *
 * The old screen had an optional shop-code field because the pair (shop, phone) was checked
 * before the code. The unified phone door removes that question entirely: the number is
 * resolved on the server, the code proves it, and the pending membership is listed for an
 * explicit decision. This guard keeps a shop code or a self-service request from returning.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const login = fs.readFileSync(path.join(ROOT, "src/pages/auth/LoginPage.tsx"), "utf8");
const otp = fs.readFileSync(path.join(ROOT, "src/pages/auth/OTPVerifyPage.tsx"), "utf8");
const auth = fs.readFileSync(path.join(ROOT, "src/lib/auth.ts"), "utf8");
const lookup = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/0201_the_pre_login_lookup_answers_for_the_number_only.sql"),
  "utf8",
);

describe("employee recovery after reinstall", () => {
  it("does not ask for a shop code at the door", () => {
    expect(login).not.toContain("shopId");
    expect(login).not.toContain("resolveShopCode");
    expect(login).not.toContain("auth.shopCode");
  });

  it("clears any stale invitation claim and resolves the person on the server", () => {
    expect(login).toContain("rememberInviteShop(null)");
    expect(login).toContain("checkPhoneRegistration");
    expect(auth).toContain("get_my_invitations");
    expect(auth).toContain("pendingInvitations");
  });

  it("stops at an explicit invitation decision before any workspace", () => {
    expect(otp).toContain("pendingInvitations");
    expect(otp).toContain("/login/invitations");
    expect(otp).toContain("verifyOTPAndResolveUser");
    expect(auth).toContain("completeOnboardingIfInvited");
  });

  it("does not invent an account when the phone is unknown", () => {
    expect(auth).not.toContain("supabase.auth.signUp");
    expect(login).toContain("/login/not-registered");
    expect(login).not.toContain("/login/request-access");
  });

  it("keeps membership resolution server-side and scoped to the proved number", () => {
    expect(lookup).toContain("public.app_current_user_id() IS DISTINCT FROM v_user_id");
    expect(lookup).toContain("'tenant_id', m.tenant_id");
    expect(lookup).toContain("'membership_status', m.status");
    expect(lookup).toContain("'branch_scope', m.branch_scope");
  });
});
