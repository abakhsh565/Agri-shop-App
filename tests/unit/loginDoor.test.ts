/**
 * ONE DOOR.
 *
 * The old rule asked a person to say whether they were an owner or an employee before the
 * server had identified them. The screen is now exactly one phone question. This guard keeps
 * the role tabs, the old wrong-door refusals, and the employee self-request exit from returning.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/pages/auth/LoginPage.tsx"),
  "utf-8",
);

describe("One sign-in door", () => {
  it("never asks the person to choose a role", () => {
    expect(source).not.toContain("auth-tab-owner");
    expect(source).not.toContain("auth-tab-employee");
    expect(source).not.toContain("auth.wrongDoorOwner");
    expect(source).not.toContain("auth.wrongDoorEmployee");
  });

  it("checks the account before spending a verification code", () => {
    const check = source.indexOf("checkPhoneRegistration");
    const send = source.indexOf("sendOTP(");
    expect(check).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(check).toBeLessThan(send);
  });

  it("keeps only the phone exit, and no recovery door", () => {
    expect(source).toContain("/login/not-registered");
    expect(source).not.toContain("/login/request-access");
    expect(source).not.toContain("auth.forgotPin");
    // The Agri-ID / recovery-key door is gone (owner's instruction, 2026-11-14): a forgotten
    // number is handled by registering again, not by proving ownership of a second identifier.
    expect(source).not.toContain("/login/recover");
    expect(source).not.toContain("auth.forgotNumber");
  });
});
