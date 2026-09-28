import { describe, expect, it } from "vitest";
import { parseInviteLink, inviteSearchParams } from "@/lib/deepLink";

/**
 * WHAT THIS PROTECTS
 *
 *   An invitation link has to reach the sign-in screen with the pair intact, and there are
 *   two shapes it can arrive as: the app's own scheme (`agrishop://login?…`), and — once the
 *   app is served from a verified domain — an https App Link. Both are parsed here, and the
 *   schemes put the route in different places: with `agrishop://login` the ROUTE parses as the
 *   host, because that is what a custom-scheme URL looks like to `new URL`. Reading `.pathname`
 *   for the app scheme yields "" and the invitee would land nowhere, which is why the shape
 *   difference is asserted rather than assumed.
 */
describe("invitation deep links", () => {
  it("reads the app scheme, where the route parses as the host", () => {
    expect(parseInviteLink("agrishop://login?phone=923001234567&shop=abc")).toEqual({
      path: "/login",
      phone: "923001234567",
      shop: "abc",
    });
  });

  it("reads an https App Link, where the route is the pathname", () => {
    expect(
      parseInviteLink("https://app.agrishop.pk/login?phone=923001234567&shop=abc"),
    ).toEqual({ path: "/login", phone: "923001234567", shop: "abc" });
  });

  it("keeps the whole pair, because the pair is what gets checked", () => {
    const target = parseInviteLink("agrishop://login?phone=923008888888&shop=00000000-0000-0000-0000-000000000001");
    expect(target?.phone).toBe("923008888888");
    expect(target?.shop).toBe("00000000-0000-0000-0000-000000000001");
    expect(inviteSearchParams(target!)).toBe(
      "phone=923008888888&shop=00000000-0000-0000-0000-000000000001",
    );
  });

  it("refuses a link that says nothing about who is invited", () => {
    // Opening sign-in for a link carrying nothing would be a worse answer than leaving the
    // invitee where they are, so these are ignored rather than half-applied.
    expect(parseInviteLink("agrishop://login")).toBeNull();
    expect(parseInviteLink("https://app.agrishop.pk/login")).toBeNull();
    expect(parseInviteLink("")).toBeNull();
  });

  it("refuses a malformed link instead of guessing at it", () => {
    expect(parseInviteLink("not a url")).toBeNull();
    expect(parseInviteLink("://login?phone=1")).toBeNull();
  });

  it("accepts a link carrying only one half of the pair", () => {
    // A caller with no active shop produces a number-only link (see appInvite.inviteLink);
    // it still pre-fills the field, it just cannot be pair-checked.
    expect(parseInviteLink("agrishop://login?phone=923001234567")).toEqual({
      path: "/login",
      phone: "923001234567",
      shop: "",
    });
  });

  it("builds a query string from only what the link actually carried", () => {
    expect(inviteSearchParams({ path: "/login", phone: "923001234567", shop: "" })).toBe(
      "phone=923001234567",
    );
  });
});
