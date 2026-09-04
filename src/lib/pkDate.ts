/**
 * Pakistan timezone date utilities.
 *
 * All date comparisons in the app must use Pakistan local time (Asia/Karachi, UTC+5).
 * Using toISOString().split("T")[0] extracts the UTC date, which can differ from the
 * Pakistan date between midnight and 5 AM PKT.
 *
 * These helpers ensure consistent Pakistan-local-date behavior everywhere.
 */

const PKT = "Asia/Karachi";

/** Format a Date as YYYY-MM-DD in Pakistan local time. */
export function pkDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: PKT });
}

/** Extract the Pakistan local date (YYYY-MM-DD) from any ISO timestamp string. */
export function pkDateFromISO(isoStr: string): string {
  return pkDate(new Date(isoStr));
}

/** Get today's date as YYYY-MM-DD in Pakistan time. */
export function pkToday(): string {
  return pkDate(new Date());
}

/** Get yesterday's date as YYYY-MM-DD in Pakistan time. */
export function pkYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return pkDate(d);
}

/** Get the Sunday (start of week) as YYYY-MM-DD in Pakistan time. */
export function pkWeekStart(): string {
  const nowPkt = new Date(new Date().toLocaleString("en-US", { timeZone: PKT }));
  const dayOfWeek = nowPkt.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const sunday = new Date(nowPkt);
  sunday.setDate(nowPkt.getDate() - dayOfWeek);
  return pkDate(sunday);
}

/** Get the first day of the current month as YYYY-MM-DD in Pakistan time. */
export function pkMonthStart(): string {
  return pkToday().substring(0, 7) + "-01";
}
