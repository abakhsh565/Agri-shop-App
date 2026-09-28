import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PIN_HOUR_MS,
  PIN_MONTH_MS,
  PIN_WEEK_MS,
  pinWindowFor,
  pinWindowAllowed,
  markPhoneVerified,
  phoneVerifiedAt,
  pinAllowedOnThisDevice,
  rememberLastProfile,
  lastUsedProfile,
  forgetLastProfile,
  forgetPhoneVerification,
} from "../../src/lib/loginWindow";
import type { User } from "../../src/types";

/**
 * The owner's rule, held in one place: after a code has confirmed a number, the PIN opens the
 * account for an hour, a week, or up to a month — and a month is where it stops.
 *
 * What this file is really protecting is the ANCHOR. The window has to be measured from the
 * last accepted code, so it survives the app being closed and the person signing out (that is
 * the whole point of the rule), and only a new code restarts it. If a later change anchors it
 * on, say, the last PIN entry, every boundary below becomes unreachable and the month never
 * expires — a failure that looks like nothing at all until a lost phone is still opening.
 */

const USER: User = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Kamran Khan",
  phone: "923001234567",
  role: "admin",
  isOriginalOwner: true,
  isActive: true,
  firstLoginAt: null,
  lastLoginAt: null,
  deactivatedAt: null,
  deactivatedBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: null,
  tenantId: "00000000-0000-0000-0000-000000000001",
  membershipRole: "owner",
  membershipStatus: "active",
  permissions: ["sales.create", "products.manage"],
};

const at = (iso: string) => new Date(iso);

describe("how long a PIN stands in for a phone code", () => {
  it("is measured from the last confirmed number, and names each stretch", () => {
    const now = at("2026-09-28T12:00:00.000Z");
    const before = (ms: number) => new Date(now.getTime() - ms);

    expect(pinWindowFor(before(PIN_HOUR_MS - 1000), now)).toBe("hour");
    expect(pinWindowFor(before(PIN_HOUR_MS), now)).toBe("week");
    expect(pinWindowFor(before(PIN_WEEK_MS - 1000), now)).toBe("week");
    expect(pinWindowFor(before(PIN_WEEK_MS), now)).toBe("month");
    expect(pinWindowFor(before(PIN_MONTH_MS - 1000), now)).toBe("month");
    // The wall. One millisecond later and the number itself has to be confirmed again.
    expect(pinWindowFor(before(PIN_MONTH_MS), now)).toBe("expired");
    expect(pinWindowFor(before(60 * 24 * PIN_HOUR_MS), now)).toBe("expired");
  });

  it("has never confirmed anything when there is no record", () => {
    expect(pinWindowFor(null)).toBe("never");
    expect(pinWindowFor(undefined)).toBe("never");
  });

  it("does not expire a working PIN because the clock moved backwards", () => {
    // A phone with a wrong date, or a restored backup, must not be read as "a month passed".
    expect(pinWindowFor(at("2026-10-28T12:00:00.000Z"), at("2026-09-28T12:00:00.000Z"))).toBe("hour");
  });

  it("is an hour, a week and a month — the stretches the owner named", () => {
    // Stated in days, not derived from the constants under test: shortening one of them to
    // make a failing boundary pass would otherwise go unnoticed.
    expect(PIN_HOUR_MS).toBe(60 * 60 * 1000);
    expect(PIN_WEEK_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(PIN_MONTH_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("lets the PIN in for the three named stretches and no further", () => {
    expect(pinWindowAllowed("hour")).toBe(true);
    expect(pinWindowAllowed("week")).toBe(true);
    expect(pinWindowAllowed("month")).toBe(true);
    expect(pinWindowAllowed("expired")).toBe(false);
    // Nothing was ever recorded here, so there is nothing that says this number was confirmed.
    expect(pinWindowAllowed("never")).toBe(false);
  });
});

describe("the record the device keeps", () => {
  beforeEach(() => {
    localStorage.clear();
    forgetLastProfile();
  });

  it("remembers a confirmation and then refuses the PIN once a month has passed", async () => {
    expect(await pinAllowedOnThisDevice(USER.id)).toBe(false);

    await markPhoneVerified(USER.id, new Date(Date.now() - 3 * PIN_HOUR_MS));
    expect(await pinAllowedOnThisDevice(USER.id)).toBe(true);
    expect(pinWindowFor(await phoneVerifiedAt(USER.id))).toBe("week");

    // 31 days, written out: a real month of not being asked for a code is too long.
    await markPhoneVerified(USER.id, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    expect(await pinAllowedOnThisDevice(USER.id)).toBe(false);

    forgetPhoneVerification(USER.id);
    expect(await phoneVerifiedAt(USER.id)).toBeNull();
  });

  it("keeps the last-used account, and keeps no rights with it", async () => {
    await rememberLastProfile(USER);
    const last = await lastUsedProfile();
    expect(last?.user.id).toBe(USER.id);
    expect(last?.user.name).toBe("Kamran Khan");
    expect(last?.user.phone).toBe("923001234567");
    // Rights are re-read from the server on every entry; a remembered list would be a stale
    // claim about what someone may do.
    expect(last && "permissions" in last.user).toBe(false);

    forgetLastProfile();
    expect(await lastUsedProfile()).toBeNull();
  });

  it("is not fooled by a record that is not one of ours", async () => {
    localStorage.setItem("agri_last_profile", JSON.stringify({ user: { name: "no id" } }));
    expect(await lastUsedProfile()).toBeNull();
    localStorage.setItem("agri_last_profile", "not json at all");
    expect(await lastUsedProfile()).toBeNull();
  });
});

describe("every door asks the same question", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the launch and the keypad both refuse a PIN past its month", () => {
    // Two doors, because a keypad left open overnight is a door too.
    expect(read("src/pages/auth/SplashPage.tsx")).toMatch(/pinAllowedOnThisDevice/);
    expect(read("src/pages/auth/PINLoginPage.tsx")).toMatch(/pinAllowedOnThisDevice/);
  });

  it("a code is the only thing that starts the clock", () => {
    // If a second place started (or restarted) the window, the month would mean nothing.
    const callers = fs
      .readdirSync(path.join(process.cwd(), "src/pages/auth"))
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /markPhoneVerified/.test(read(`src/pages/auth/${f}`)));
    expect(callers).toEqual(["OTPVerifyPage.tsx"]);
  });

  it("the launch knows the account it last served, so a PIN door can be drawn", () => {
    const splash = read("src/pages/auth/SplashPage.tsx");
    expect(splash).toMatch(/lastUsedProfile/);
    expect(splash).toMatch(/rememberLastProfile/);
  });
});
