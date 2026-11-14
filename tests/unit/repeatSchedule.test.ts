import { describe, expect, it } from "vitest";
import {
  addMonths,
  nextOccurrence,
  reminderWhen,
  sortReminders,
} from "../../src/lib/repeatSchedule";

/**
 * The day a repeating reminder next falls on.
 *
 * The label on a reminder card is the only thing the owner sees before deciding to pay or collect,
 * so this arithmetic is not decoration: a monthly rent reminder that silently skipped February, or
 * a late one-off that walked itself into the future, would read as a correct date while being
 * wrong. These tests pin the three shapes that can go wrong — a short month, a cadence older than
 * today, and a one-off that is late.
 */
describe("the repeat calendar", () => {
  it("clamps a month instead of rolling into the next one", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
  });

  it("advances a monthly rule to today or later without skipping a month", () => {
    expect(nextOccurrence("2026-01-15", 1, "month", "2026-03-10")).toBe("2026-03-15");
    // Past the 15th, so March's occurrence has happened and April's is next.
    expect(nextOccurrence("2026-01-15", 1, "month", "2026-03-20")).toBe("2026-04-15");
    // A short month clamps the day and the next one is computed from the clamped date.
    expect(nextOccurrence("2026-01-31", 1, "month", "2026-03-01")).toBe("2026-03-28");
  });

  it("honours a multi-week cadence", () => {
    expect(nextOccurrence("2026-10-01", 2, "week", "2026-10-20")).toBe("2026-10-29");
    expect(nextOccurrence("2026-10-01", 2, "week", "2026-10-29")).toBe("2026-10-29");
  });

  it("leaves a late one-off in the past, where it can be seen as late", () => {
    const late = reminderWhen({ dueOn: "2026-10-01", repeatEvery: 1, repeatUnit: "none" }, "2026-10-30");
    expect(late.on).toBe("2026-10-01");
    expect(late.late).toBe(true);
    expect(late.dueToday).toBe(false);

    const today = reminderWhen({ dueOn: "2026-10-30", repeatEvery: 1, repeatUnit: "none" }, "2026-10-30");
    expect(today.dueToday).toBe(true);
    expect(today.late).toBe(false);
  });

  it("sorts the late one first, then by the next day and time", () => {
    const rows = [
      { id: "c", dueOn: "2026-11-05", repeatEvery: 1, repeatUnit: "month" as const, dueTime: "09:00" },
      { id: "a", dueOn: "2026-10-01", repeatEvery: 1, repeatUnit: "none" as const, dueTime: "09:00" },
      { id: "b", dueOn: "2026-10-30", repeatEvery: 1, repeatUnit: "none" as const, dueTime: "17:30" },
      { id: "d", dueOn: "2026-10-30", repeatEvery: 1, repeatUnit: "none" as const, dueTime: "08:00" },
    ];
    expect(sortReminders(rows, "2026-10-30").map((row) => row.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("does not loop forever on an impossible rule", () => {
    const yearsAgo = "2000-01-01";
    const next = nextOccurrence(yearsAgo, 1, "day", "2026-10-30");
    // The 500-step ceiling is reached long before 2026, so the answer is a real date, not a hang.
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(next < "2026-10-30").toBe(true);
  });
});
