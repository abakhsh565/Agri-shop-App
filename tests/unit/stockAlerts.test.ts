import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOCK_ALERT_SETTINGS,
  effectiveThreshold,
  isAlertDue,
  parseSettings,
  QUIET_DAYS,
} from "@/lib/stockAlerts";

/**
 * The rule this file guards: **a product that stays low is not re-announced.**
 *
 * `checkAndNotifyLowStock` used to create a notification on every call, and it is called
 * once per product per sale — so a shop selling ten packs in an afternoon got ten
 * identical "Low stock" notices for the same product. An alert nobody reads is worse than
 * no alert, because it trains the shop to ignore the screen that also carries the notices
 * it must not ignore.
 *
 * The boundary cases are pinned rather than sampled: a clock rule that is off by one
 * second silently reverts to the noisy behaviour for a shop that is busy.
 */

const NOW = new Date("2026-09-27T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("stock alerts — when a product is announced", () => {
  it("says nothing at all while stock is above the line", () => {
    // The caller returns before asking, so `isAlertDue` is never consulted. Stated here
    // because it is half the rule and the half that keeps a quiet shop quiet.
    expect(effectiveThreshold(20, 10)).toBe(20);
  });

  it("announces the crossing once, then stays quiet while it stays low", () => {
    const crossed = { lastAlertAt: null, frequency: "on_cross" as const, crossed: true, now: NOW };
    expect(isAlertDue(crossed)).toBe(true);

    // Every later sale from the same low level is the same news.
    expect(isAlertDue({ ...crossed, crossed: false })).toBe(false);
    expect(isAlertDue({ ...crossed, lastAlertAt: hoursAgo(1), crossed: false })).toBe(false);

    // But a real second crossing is a second piece of news, and is said — the promise is
    // "tell me when it crosses", not "tell me once and then never mention it again".
    expect(isAlertDue({ ...crossed, lastAlertAt: hoursAgo(1), crossed: true })).toBe(true);
  });

  it("re-announces once stock has recovered and dipped again", () => {
    // Recovery is the caller's observation: it was above the line before this sale.
    expect(
      isAlertDue({
        lastAlertAt: hoursAgo(48),
        frequency: "on_cross",
        crossed: true,
        now: NOW,
      })
    ).toBe(true);
  });

  it("reads an unobserved previous level as a first sighting, not a crossing", () => {
    // Older callers do not pass the previous level. Guessing "crossed" there would restore
    // the noisy behaviour for exactly the callers that know least.
    expect(isAlertDue({ lastAlertAt: null, frequency: "on_cross", now: NOW })).toBe(true);
    expect(isAlertDue({ lastAlertAt: hoursAgo(1), frequency: "on_cross", now: NOW })).toBe(false);
  });

  it("holds the day and three-day windows to their boundary", () => {
    expect(QUIET_DAYS.daily).toBe(1);
    expect(QUIET_DAYS.every_3_days).toBe(3);

    expect(isAlertDue({ lastAlertAt: hoursAgo(23), frequency: "daily", now: NOW })).toBe(false);
    expect(isAlertDue({ lastAlertAt: hoursAgo(24), frequency: "daily", now: NOW })).toBe(true);

    expect(isAlertDue({ lastAlertAt: hoursAgo(71), frequency: "every_3_days", now: NOW })).toBe(false);
    expect(isAlertDue({ lastAlertAt: hoursAgo(72), frequency: "every_3_days", now: NOW })).toBe(true);
  });

  it("alerts when it has never alerted before, whatever the frequency", () => {
    for (const frequency of ["on_cross", "daily", "every_3_days"] as const) {
      expect(isAlertDue({ lastAlertAt: null, frequency, now: NOW })).toBe(true);
    }
  });

  it("treats an unreadable timestamp as no previous alert rather than silence", () => {
    // Going silent because a date could not be parsed is the failure that hides itself.
    expect(isAlertDue({ lastAlertAt: "not a date", frequency: "daily", now: NOW })).toBe(true);
    expect(isAlertDue({ lastAlertAt: "not a date", frequency: "on_cross", crossed: true, now: NOW })).toBe(true);
  });
});

describe("stock alerts — the number a product is judged by", () => {
  it("lets a product's own number win over the shop's", () => {
    expect(effectiveThreshold(3, 20)).toBe(3);
    expect(effectiveThreshold(0, 20)).toBe(0);
  });

  it("falls back to the shop's number, not a fourth hardcoded five", () => {
    expect(effectiveThreshold(null, 20)).toBe(20);
    expect(effectiveThreshold(undefined, 20)).toBe(20);
    // A value that is not a usable number is a missing value, not a zero.
    expect(effectiveThreshold(Number.NaN, 20)).toBe(20);
  });
});

describe("stock alerts — reading the shop's policy back", () => {
  it("keeps a policy the database actually stored", () => {
    expect(parseSettings({ threshold: 25, frequency: "every_3_days" }))
      .toEqual({ threshold: 25, frequency: "every_3_days" });
  });

  it("answers with the shipped policy for anything it cannot trust", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_STOCK_ALERT_SETTINGS);
    expect(parseSettings({ threshold: -5, frequency: "weekly" })).toEqual(DEFAULT_STOCK_ALERT_SETTINGS);
    expect(parseSettings({ threshold: "20", frequency: "daily" }))
      .toEqual({ threshold: 20, frequency: "daily" });
    // A negative number would mean "alert below zero", which can never fire.
    expect(parseSettings({ threshold: -1 }).threshold).toBe(DEFAULT_STOCK_ALERT_SETTINGS.threshold);
  });
});
