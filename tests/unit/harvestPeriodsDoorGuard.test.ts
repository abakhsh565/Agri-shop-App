import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The harvest-period door stays open, and its value reaches the scheduler.
 *
 * Three separate things have to be true for a "Before harvest season" reminder to be
 * configurable, and each has already been false at once:
 *
 *   1. A screen must open the crops + harvest month/day editor. The editor existed, but its only
 *      caller's `setShowBusinessSettings` was declared and never used, so the sheet was unreachable
 *      and nothing in the app could say when a crop comes off.
 *   2. That editor must save the row the scheduler reads — `business_settings` with
 *      `setting_key = 'crops'`. It wrote localStorage only, so a configured harvest period never
 *      left the device, and the reminder engine, which reads the table, saw no crops at all.
 *   3. The insert must name the shop. `business_settings.shop_id` is NOT NULL, the RLS policy is
 *      `shop_id = current_shop_id()`, and a first save on a shop with no row was refused with 403
 *      until the payload carried the tenant.
 *
 * A source guard is the honest shape here: these are wiring facts about three files, and no unit
 * test of a pure function can see a missing button or a save that goes to the wrong store.
 */
const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("harvest periods — the door, the store, and the shop", () => {
  it("Business settings opens the harvest-period editor", () => {
    const page = read("src/pages/admin/settings/AdminSettingsPage.tsx");
    expect(page, "the settings page no longer renders the editor").toContain("<BusinessSettingsSheet");
    expect(page, "nothing sets showBusinessSettings, so the editor has no door").toMatch(
      /setShowBusinessSettings\(true\)/,
    );
    expect(page, "the row that opens it lost its test id").toContain("settings-harvest-periods");
  });

  it("the editor reads and writes the row the reminder engine schedules against", () => {
    const sheet = read("src/components/ui/BusinessSettingsSheet.tsx");
    expect(sheet, "the sheet no longer loads the saved crops").toContain("loadBusinessSettings(");
    expect(sheet, "the sheet no longer saves the crops").toContain("saveBusinessSettings(");
    expect(
      sheet,
      "the sheet keeps a device-local copy instead of the database row, so the engine cannot see it",
    ).not.toMatch(/localStorage\.setItem\(\s*settingsKey\(\)/);
    expect(sheet, "the harvest section must be reachable with no crops chosen yet").toContain(
      "settings.harvestPeriods.empty",
    );
  });

  it("the insert names the shop, because shop_id is NOT NULL under an RLS policy", () => {
    const engine = read("src/lib/reminderEngine.ts");
    const insert = /from\("business_settings"\)\s*\n?\s*\.insert\(\{([\s\S]{0,400}?)\}\)/m.exec(engine);
    expect(insert, "the crops insert is gone").toBeTruthy();
    expect(insert![1], "the crops insert does not send shop_id, so a first save answers 403").toContain(
      "shop_id:",
    );
  });

  it("a harvest-anchored reminder resolves its date from the crop's month and day", () => {
    const engine = read("src/lib/reminderEngine.ts");
    expect(engine, "the harvest anchor stopped reading the crop config").toContain(
      'config.anchor === "before_harvest"',
    );
    expect(engine, "the harvest date no longer comes from the configured month/day").toContain(
      "crop.harvestMonth",
    );
  });
});
