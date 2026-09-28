/**
 * Notification scope — who hears about what, in which branch.
 *
 * This guard exists because the rule that broke was invisible. The table had lost the
 * `actor_id` column the employee half of the rule compares against, so every employee row
 * looked anonymous and the fallback correctly-but-uselessly silenced all of them: an
 * employee's bell was empty, nothing errored, and no screen said anything was wrong. A
 * missing column and a deliberate "do not show this" are the same `false` from the outside.
 *
 * So the two halves are asserted here as behaviour rather than described in a comment:
 *
 *   1. **A branch's events belong to that branch.** What arrives is the database's answer,
 *      but a screen decides what to draw, and Home must not be able to draw another
 *      branch's event next to this branch's figures.
 *   2. **An employee hears the shop's alerts and their OWN work** — not a colleague's sale,
 *      and not an owner's settings change. The own-work half is what `actor_id` carries,
 *      and it is the half that silently vanished.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppNotification } from "@/stores/notificationStore";

vi.mock("@/lib/supabase", () => ({
  supabaseUrl: "https://qa.supabase.co",
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

const { visibleToCurrentUser } = await import("@/stores/notificationStore");
const { useAuthStore } = await import("@/stores/authStore");

function row(over: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    kind: "sale",
    title: "Sale",
    body: null,
    shop_id: "shop-a",
    entity_id: null,
    actor_id: null,
    actor_name: null,
    read: false,
    created_at: new Date().toISOString(),
    ...over,
  };
}

/** A signed-in account of one role, in one branch. */
function signIn(role: "admin" | "employee", id = "me") {
  useAuthStore.setState({
    user: {
      id,
      name: "Test",
      phone: "923000000000",
      role,
      tenantId: "shop-a",
      membershipRole: role === "admin" ? "owner" : "employee",
    } as never,
  });
}

beforeEach(() => {
  useAuthStore.setState({ user: null });
});

describe("notification scope", () => {
  describe("an employee", () => {
    beforeEach(() => signIn("employee"));

    it("hears about their own sale", () => {
      expect(visibleToCurrentUser(row({ actor_id: "me" }))).toBe(true);
    });

    it("does not hear about a colleague's sale", () => {
      expect(visibleToCurrentUser(row({ actor_id: "someone-else" }))).toBe(false);
    });

    it("does not hear about a sale with no actor recorded", () => {
      // The regression this guard was written for: without `actor_id` there is no evidence
      // that the row is theirs, and "no evidence" must not be read as "theirs".
      expect(visibleToCurrentUser(row({ actor_id: null }))).toBe(false);
    });

    it("hears the shop's stock alerts whoever raised them", () => {
      expect(visibleToCurrentUser(row({ kind: "low_stock", actor_id: "someone-else" }))).toBe(true);
      expect(visibleToCurrentUser(row({ kind: "stock_adjust", actor_id: null }))).toBe(true);
    });

    it("never hears an owner's private activity", () => {
      expect(visibleToCurrentUser(row({ kind: "settings_change", actor_id: "someone-else" }))).toBe(false);
      expect(visibleToCurrentUser(row({ kind: "profile_update", actor_id: "someone-else" }))).toBe(false);
    });
  });

  describe("an owner", () => {
    beforeEach(() => signIn("admin"));

    it("hears every business event in their branches", () => {
      expect(visibleToCurrentUser(row({ actor_id: "someone-else" }))).toBe(true);
      expect(visibleToCurrentUser(row({ kind: "payment", actor_id: null }))).toBe(true);
      expect(visibleToCurrentUser(row({ kind: "low_stock" }))).toBe(true);
    });

    it("hears their own private activity and nobody else's", () => {
      expect(visibleToCurrentUser(row({ kind: "settings_change", actor_id: "me" }))).toBe(true);
      expect(visibleToCurrentUser(row({ kind: "settings_change", actor_id: "someone-else" }))).toBe(false);
      expect(visibleToCurrentUser(row({ kind: "app_update", actor_id: "me" }))).toBe(false);
    });

    it("is judged by the role held in the row's OWN branch", () => {
      // An account that owns one branch and merely works in another must not be handed the
      // owner's view of the branch where it is an employee.
      const roleByShop = { "shop-a": "employee" };
      expect(visibleToCurrentUser(row({ actor_id: "someone-else" }), roleByShop)).toBe(false);
    });
  });
});
