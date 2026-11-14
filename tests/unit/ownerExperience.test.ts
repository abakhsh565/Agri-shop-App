import { describe, expect, it } from "vitest";
import type { User } from "@/types";
import { experienceOf, homePathForUser, isCoOwner } from "@/lib/experience";

/**
 * The owner's own shop is not a role assignment.
 *
 * Measured 2026-11-14: the QA shop's owner had `is_original_owner = true` and a membership pointing
 * at the system role "Store Manager"; the tenant held no Owner role at all, so the server answered
 * `experience: "employee"` and the owner was refused `/admin/companies/new` and the account-deletion
 * sheet. Option (B), chosen by the product owner: the ownership flag is authoritative in the client.
 *
 * These assertions are deliberately two-directional — the flag must WIN where it is true, and it must
 * not become a way for an ordinary member to inherit the Owner shell where it is false.
 */
function user(overrides: Partial<User>): User {
  return {
    id: "10000000-0000-0000-0000-000000000001",
    name: "Owner",
    phone: "923009999999",
    role: "admin",
    isOriginalOwner: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    membershipRole: "employee",
    ...overrides,
  } as User;
}

describe("experienceOf — the original owner is authoritative", () => {
  it("resolves the owner to the owner experience even when the server says employee", () => {
    const owner = user({ isOriginalOwner: true, experience: "employee", membershipRole: "admin" });
    expect(experienceOf(owner)).toBe("owner");
  });

  it("resolves the owner to the owner experience even when the membership role is not an owner", () => {
    const owner = user({ isOriginalOwner: true, membershipRole: "employee" });
    expect(experienceOf(owner)).toBe("owner");
  });

  it("wins over a stale admin membership with no server answer at all", () => {
    const owner = user({ isOriginalOwner: true, membershipRole: "admin" });
    expect(experienceOf(owner)).toBe("owner");
  });

  it("takes the owner to the owner shell, not the employee one", () => {
    const owner = user({ isOriginalOwner: true, experience: "employee", membershipRole: "employee" });
    expect(homePathForUser(owner)).toBe("/admin/dashboard");
  });

  it("does not promote an ordinary member who is not the original owner", () => {
    expect(experienceOf(user({ isOriginalOwner: false, membershipRole: "employee" }))).toBe("employee");
    expect(experienceOf(user({ isOriginalOwner: false, membershipRole: "admin" }))).toBe("employee");
    expect(experienceOf(user({ isOriginalOwner: false, experience: "employee", membershipRole: "owner" }))).toBe(
      "employee",
    );
  });

  it("keeps a Co-Owner a Co-Owner", () => {
    const coOwner = user({ isOriginalOwner: false, experience: "co_owner", membershipRole: "owner" });
    expect(experienceOf(coOwner)).toBe("co_owner");
    expect(isCoOwner(coOwner)).toBe(true);
    expect(homePathForUser(coOwner)).toBe("/admin/dashboard");
  });

  it("still answers employee for nobody signed in", () => {
    expect(experienceOf(null)).toBe("employee");
    expect(experienceOf(undefined)).toBe("employee");
    expect(isCoOwner(undefined)).toBe(false);
    expect(homePathForUser(null)).toBe("/employee/dashboard");
  });
});
