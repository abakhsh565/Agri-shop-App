import { describe, expect, it } from "vitest";
import { OWNER_ROWS, rowsOnScreen, whereIs, type Screen } from "@/lib/ownerRows";

/**
 * The rule this file guards: **one row per destination.**
 *
 * Settings and the owner suite each used to carry their own copy of Employees, Companies,
 * Inventory, Roles and Crop configuration. The same tap existed twice on two screens, the two
 * copies could disagree about a label or a route, and there was no way to tell which one the
 * shopkeeper had actually used. They now come from one catalogue and each screen renders a
 * filter over it — so the property worth pinning is not "the catalogue has these rows" but
 * "whatever the owner does, every row is on exactly one screen".
 *
 * A future task that gave Settings its own hardcoded Employees row again, or that made `move`
 * write to both screens, would break the partition and be caught here.
 */

const SCREENS: Screen[] = ["settings", "suite"];

describe("owner rows — one row per destination", () => {
  it("splits the catalogue into two disjoint sets that cover it exactly", () => {
    const settings = rowsOnScreen({}, "settings");
    const suite = rowsOnScreen({}, "suite");

    expect(settings.length + suite.length).toBe(OWNER_ROWS.length);

    const ids = [...settings, ...suite].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(OWNER_ROWS.map((r) => r.id)));
  });

  it("holds the partition for every arrangement the owner can build", () => {
    // Every row moved to Settings; every row moved to the suite; and every alternating
    // arrangement — 2^n combinations is small enough to enumerate honestly rather than sample.
    const combinations = 1 << OWNER_ROWS.length;
    for (let mask = 0; mask < combinations; mask++) {
      const chosen: Record<string, Screen> = {};
      OWNER_ROWS.forEach((row, i) => {
        chosen[row.id] = mask & (1 << i) ? "settings" : "suite";
      });

      const settings = rowsOnScreen(chosen, "settings");
      const suite = rowsOnScreen(chosen, "suite");
      const ids = [...settings, ...suite].map((r) => r.id);

      expect(settings.length + suite.length).toBe(OWNER_ROWS.length);
      expect(new Set(ids).size).toBe(OWNER_ROWS.length);

      for (const row of OWNER_ROWS) {
        const onSettings = settings.some((r) => r.id === row.id);
        const onSuite = suite.some((r) => r.id === row.id);
        expect(onSettings !== onSuite).toBe(true);
        expect(onSettings).toBe(chosen[row.id] === "settings");
      }
    }
  });

  it("gives every row a place to live and a way back to it", () => {
    for (const row of OWNER_ROWS) {
      // A row with no default would have no home on a fresh device.
      expect(["settings", "suite"]).toContain(row.defaultScreen);
      // The anchor is the guided tour's only handle on the row; a row without one is a row
      // the tour cannot point at, wherever it currently sits.
      expect(row.anchor).toMatch(/^(more|settings):/);
      // Either it opens a screen, or the screens know to open a sheet for it.
      expect(row.path === null || row.path.startsWith("/")).toBe(true);
    }
  });

  it("resolves a row from its default until the owner says otherwise", () => {
    const chosen = { roles: "settings" as Screen };

    expect(whereIs({}, "roles")).toBe("suite");
    expect(whereIs(chosen, "roles")).toBe("settings");

    expect(rowsOnScreen({}, "suite").some((r) => r.id === "roles")).toBe(true);
    expect(rowsOnScreen(chosen, "suite").some((r) => r.id === "roles")).toBe(false);
    expect(rowsOnScreen(chosen, "settings").some((r) => r.id === "roles")).toBe(true);
  });

  it("keeps an unknown id on a screen rather than losing it", () => {
    // A stale persisted arrangement naming a row that no longer exists must not take another
    // row's place or throw.
    const chosen = { "row-that-was-removed": "settings" as Screen };
    expect(SCREENS).toContain(whereIs(chosen, "row-that-was-removed"));
    expect(rowsOnScreen(chosen, "settings").length).toBe(
      OWNER_ROWS.filter((r) => r.defaultScreen === "settings").length
    );
  });

  it("ships the shop's work in the suite and the phone's own rows in Settings", () => {
    // The shipped arrangement, as a fact rather than a comment: this is what a fresh device
    // shows, and moving a row is the owner's choice on top of it.
    const suite = rowsOnScreen({}, "suite").map((r) => r.id);
    const settings = rowsOnScreen({}, "settings").map((r) => r.id);

    expect(suite).toEqual(["employees", "companies", "roles", "inventory", "crops"]);
    expect(settings).toEqual(["notifications", "activity"]);
  });
});
