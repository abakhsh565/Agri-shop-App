import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";

/**
 * The shop's stock-alert policy — when it is warned, and how loudly.
 *
 * This is the one place that knows the answer. Before it, three screens each guessed
 * separately (`variants[0]?.lowStockThreshold ?? 5`, `?? 5`, and a hidden form default of
 * `"5"`), so the same product could be called low by one screen and fine by another, and
 * the shop's own number — `app_settings.low_stock_threshold_default`, seeded since
 * migration 0009 — was read by nothing at all.
 *
 * The two levels an owner has:
 *
 *   • the **shop's number**, set once, which is what a new product starts at and what
 *     `applyToAllProducts` writes onto products created before the number was chosen;
 *   • a **product's own number**, set on the product form, which wins where it is set —
 *     a fast-moving pack and a slow one are not the same risk.
 *
 * The policy lives in the database, not on the device: it is a rule about the shop, so it
 * has to hold for the owner's phone and the employee's at the same time.
 */

export type AlertFrequency = "on_cross" | "daily" | "every_3_days";

/** Every frequency the database accepts. A word outside this set is refused server-side. */
export const ALERT_FREQUENCIES: AlertFrequency[] = ["on_cross", "daily", "every_3_days"];

export interface StockAlertSettings {
  /** Stock at or below this is low. */
  threshold: number;
  frequency: AlertFrequency;
}

/** What a shop that has never opened the setting gets — the same answer the database gives. */
export const DEFAULT_STOCK_ALERT_SETTINGS: StockAlertSettings = {
  threshold: 10,
  frequency: "on_cross",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long the same product stays quiet after being alerted about.
 *
 * `on_cross` is not "never again" — it is "not again until it has been above the line and
 * come back down", which the caller establishes by comparing against the last alert it
 * saw. The other two are plain clocks. `every_3_days` exists because a daily reminder for
 * a slow-moving line is noise an owner stops reading, and an alert nobody reads is worse
 * than no alert: it trains the shop to ignore the screen.
 */
export const QUIET_DAYS: Record<AlertFrequency, number | null> = {
  on_cross: null,
  daily: 1,
  every_3_days: 3,
};

export interface AlertDueInput {
  /** When this product was last alerted about, or `null` if never. */
  lastAlertAt: Date | string | null | undefined;
  frequency: AlertFrequency;
  /**
   * Did this change take the stock from above the line to at or below it? Only the
   * caller knows the level before the sale, so only the caller can answer this.
   * `undefined` means the previous level was not observed. */
  crossed?: boolean;
  now?: Date;
}

/**
 * Is a fresh alert due?
 *
 * Pure, and takes `now` rather than reading the clock, so the rule can be tested at a
 * boundary instead of trusted.
 *
 * "Only when it crosses" is not a clock at all — it is the moment the shop's stock goes
 * from fine to low. Ten packs sold in an afternoon cross the line once, so the shop hears
 * about it once. This is the fix for the old rule, which alerted on *every* sale that left
 * stock at or below the threshold and so taught the shop to stop reading the screen.
 *
 * The other two are plain clocks, and "never alerted before" is always due. A timestamp
 * that cannot be parsed is treated as "no previous alert": refusing to alert because a date
 * was unreadable would be the silent failure, not the safe one.
 */
export function isAlertDue({
  lastAlertAt,
  frequency,
  crossed,
  now = new Date(),
}: AlertDueInput): boolean {
  const quietDays = QUIET_DAYS[frequency];
  if (quietDays === null) {
    // With no observed previous level, the only crossing we can be sure of is the first
    // time we ever see this product low.
    return crossed ?? !lastAlertAt;
  }
  if (!lastAlertAt) return true;

  const last = lastAlertAt instanceof Date ? lastAlertAt : new Date(lastAlertAt);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= quietDays * MS_PER_DAY;
}

/**
 * The number a product is actually judged by.
 *
 * A product's own threshold is a decision; the shop's is the fallback for a product that
 * has none. The fallback is written as `??` rather than a numeric default so that a
 * genuinely missing value is visibly the shop's number rather than a fourth hardcoded 5.
 */
export function effectiveThreshold(
  variantThreshold: number | null | undefined,
  shopThreshold: number,
): number {
  return typeof variantThreshold === "number" && Number.isFinite(variantThreshold)
    ? variantThreshold
    : shopThreshold;
}

/** Normalise anything the database might answer into the policy we expect. */
export function parseSettings(raw: unknown): StockAlertSettings {
  const value = (raw ?? {}) as Partial<Record<string, unknown>>;
  const threshold = Number(value.threshold);
  const frequency = String(value.frequency ?? "");
  return {
    threshold: Number.isFinite(threshold) && threshold >= 0
      ? Math.floor(threshold)
      : DEFAULT_STOCK_ALERT_SETTINGS.threshold,
    frequency: (ALERT_FREQUENCIES as string[]).includes(frequency)
      ? (frequency as AlertFrequency)
      : DEFAULT_STOCK_ALERT_SETTINGS.frequency,
  };
}

function actorPayload() {
  const actorId = useAuthStore.getState().user?.id;
  return { actorId, userId: actorId };
}

/**
 * The shop's policy. A failure answers with the defaults rather than throwing: every
 * caller is drawing a screen, and a screen that will not render because a preference could
 * not be read is worse than one drawn with the shipped defaults.
 */
export async function loadStockAlertSettings(): Promise<StockAlertSettings> {
  const { data, error } = await supabase.rpc("get_stock_alert_settings", {
    payload: actorPayload(),
  });
  if (error) {
    if (import.meta.env.DEV) console.error("[StockAlerts] read failed:", error.message);
    return DEFAULT_STOCK_ALERT_SETTINGS;
  }
  return parseSettings(data);
}

/** Save the policy. Throws, so the sheet can say the change did not happen. */
export async function saveStockAlertSettings(
  settings: StockAlertSettings,
): Promise<StockAlertSettings> {
  const { data, error } = await supabase.rpc("set_stock_alert_settings", {
    payload: { ...actorPayload(), threshold: settings.threshold, frequency: settings.frequency },
  });
  if (error) throw new Error(error.message);
  return parseSettings(data);
}

/**
 * Put the shop's number on every product that predates it, and answer how many changed.
 *
 * Deliberately a separate, owner-pressed action rather than a migration backfill: every
 * threshold in the table today is the column's own default of 5, which no human ever
 * chose, so rewriting them silently would change what the shop's alerts *mean* while the
 * owner watched a screen that said nothing had happened.
 */
export async function applyThresholdToAllProducts(threshold: number): Promise<number> {
  const { data, error } = await supabase.rpc("apply_stock_threshold_to_all", {
    payload: { ...actorPayload(), threshold },
  });
  if (error) throw new Error(error.message);
  return Number((data as { updated?: number } | null)?.updated ?? 0);
}
