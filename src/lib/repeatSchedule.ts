import type { RepeatUnit } from "@/lib/financeEntries";

/**
 * The calendar arithmetic behind a repeat, on its own.
 *
 * WHY IT IS SEPARATE FROM THE DATA LAYER. The next day a reminder falls on is a pure question
 * with an edge (a month that is shorter than the day, a rule written months ago) that deserves a
 * test without a database, a session or a browser client in the way. The screen and the test read
 * this one function, so the label on the card cannot drift from the rule the database holds.
 *
 * Months are clamped, not rolled: 31 January plus one month is 28/29 February, the way Postgres
 * answers `date + interval '1 month'` and the way a rent reminder is actually understood. Rolling
 * into March would silently skip February's rent.
 */

export interface RepeatLike {
  dueOn: string;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
  dueTime?: string;
}

const DAY_MS = 86_400_000;

/** The day `day + months`, clamped to the end of the target month. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDate = Math.min(date, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, targetDate)).toISOString().slice(0, 10);
}

function addOnce(day: string, every: number, unit: RepeatUnit): string {
  if (unit === "day") {
    return new Date(new Date(`${day}T00:00:00Z`).getTime() + every * DAY_MS).toISOString().slice(0, 10);
  }
  if (unit === "week") {
    return new Date(new Date(`${day}T00:00:00Z`).getTime() + every * 7 * DAY_MS).toISOString().slice(0, 10);
  }
  return addMonths(day, every);
}

/**
 * The next day this rule falls on, on or after `today`.
 *
 * A one-off in the past stays in the past: the reminder is late, and moving its date forward would
 * quietly erase that. A repeating one advances by whole cadences until it reaches today, so a
 * monthly reminder written in January reads today's month rather than January's. The 500-step
 * guard is a ceiling on a broken rule, not a cadence.
 */
export function nextOccurrence(dueOn: string, every: number, unit: RepeatUnit, today: string): string {
  if (unit === "none" || !dueOn) return dueOn;
  const step = Math.max(1, Math.floor(every) || 1);
  let next = dueOn;
  let guard = 0;
  while (next < today && guard < 500) {
    next = addOnce(next, step, unit);
    guard += 1;
  }
  return next;
}

/** What the card says: the next day, whether it is today, and whether a one-off is late. */
export function reminderWhen(
  reminder: Pick<RepeatLike, "dueOn" | "repeatEvery" | "repeatUnit">,
  today: string,
): { on: string; dueToday: boolean; late: boolean } {
  const on = nextOccurrence(reminder.dueOn, reminder.repeatEvery, reminder.repeatUnit, today);
  return { on, dueToday: on === today, late: reminder.repeatUnit === "none" && reminder.dueOn < today };
}

/** Earliest next occurrence first; a late one-off sits at the top, where it can be acted on. */
export function sortReminders<T extends RepeatLike>(rows: T[], today: string): T[] {
  return [...rows].sort((a, b) => {
    const left = reminderWhen(a, today).on;
    const right = reminderWhen(b, today).on;
    if (left !== right) return left < right ? -1 : 1;
    return (a.dueTime ?? "").localeCompare(b.dueTime ?? "");
  });
}
