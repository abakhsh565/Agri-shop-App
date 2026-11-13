/**
 * The business facts behind Home's Quick Alerts.
 *
 * Home is a triage surface, not a second ledger. Every number here is derived from the
 * authoritative row that owns it — credit requests, reminder logs, business crop settings and
 * customer crops — so a Quick Alert can never tell a different story from the screen it opens.
 */

import type { CropConfig, Customer } from "@/types";
import type { LocalCreditRequest } from "@/lib/localGroupRegistry";
import { calculatePaymentStatus } from "@/lib/reminderEngine";
import { pkDate, pkDateFromISO } from "@/lib/pkDate";

/** How far ahead a harvest season becomes an alert on Home. */
export const HARVEST_ALERT_DAYS = 30;

export interface HarvestWindow {
  crop: CropConfig;
  /** The next occurrence of this crop's harvest, as a Pakistan-local YYYY-MM-DD date. */
  date: string;
  days: number;
  /** Every active customer recorded against this crop. */
  allFarmers: Customer[];
  /** The subset that still owes money — the people a harvest follow-up is about. */
  farmers: Customer[];
  outstanding: number;
}

export interface SentTodaySummary {
  total: number;
  whatsapp: number;
  sms: number;
  other: number;
  customers: number;
}

export interface CreditOverrideEvent {
  request: LocalCreditRequest;
  customer: Customer;
  approvedAmount: number;
}

function daysBetweenPk(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * The same red-account judgement the Credit Overrides list and its detail screen use:
 * a live customer with money owed, at 80% or more of the limit, or whose payment behaviour has
 * already reached the high-risk band. Keeping it here means Home cannot invent a red flag.
 */
export function isFlaggedRed(customer: Customer, now = new Date()): boolean {
  if (customer.isArchived || customer.outstandingBalance <= 0) return false;
  if (customer.creditLimit > 0 && customer.outstandingBalance / customer.creditLimit >= 0.8) {
    return true;
  }
  return calculatePaymentStatus(customer, now) === "high_risk";
}

/**
 * The most recent approved credit-limit change that left a customer flagged red.
 * A request is the record of the conversation (asked → granted); the customer row is the
 * current result. Both are needed, so the event is returned together rather than rebuilt
 * from one side.
 */
export function latestRedCreditOverride(
  requests: LocalCreditRequest[],
  customers: Customer[],
  now = new Date(),
): CreditOverrideEvent | null {
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const approved = requests
    .filter((request) => request.status === "approved" && request.reviewedAt)
    .sort(
      (a, b) =>
        new Date(b.reviewedAt ?? 0).getTime() - new Date(a.reviewedAt ?? 0).getTime(),
    );

  for (const request of approved) {
    const customer = customersById.get(request.customerId);
    if (!customer || !isFlaggedRed(customer, now)) continue;
    return {
      request,
      customer,
      approvedAmount: request.approvedLimit ?? request.requestedLimit,
    };
  }
  return null;
}

function nextHarvestDate(crop: CropConfig, today: string): string {
  const year = Number(today.slice(0, 4));
  const month = String(crop.harvestMonth).padStart(2, "0");
  const day = String(crop.harvestDay || 1).padStart(2, "0");
  let date = `${year}-${month}-${day}`;
  if (date <= today) date = `${year + 1}-${month}-${day}`;
  return date;
}

/**
 * The nearest harvest season in the requested window.
 *
 * A harvest is a season, not a due date: the next occurrence is used once this year's date has
 * passed. The farmers are those recorded against the crop; `farmers` narrows that to the people
 * with money still owed, because those are the follow-ups the shop must prepare.
 */
export function nextHarvestWindow(
  crops: CropConfig[],
  customers: Customer[],
  cropsByCustomer: Record<string, string[]>,
  now = new Date(),
  maxDays = HARVEST_ALERT_DAYS,
): HarvestWindow | null {
  const today = pkDate(now);
  let best: HarvestWindow | null = null;

  for (const crop of crops) {
    if (!crop?.name || !crop.harvestMonth) continue;
    const date = nextHarvestDate(crop, today);
    const days = daysBetweenPk(today, date);
    if (days <= 0 || days > maxDays) continue;
    if (best && days >= best.days) continue;

    const allFarmers = customers.filter(
      (customer) =>
        !customer.isArchived &&
        (cropsByCustomer[customer.id] ?? []).includes(crop.name),
    );
    const farmers = allFarmers.filter((customer) => customer.outstandingBalance > 0);
    best = {
      crop,
      date,
      days,
      allFarmers,
      farmers,
      outstanding: farmers.reduce((sum, customer) => sum + customer.outstandingBalance, 0),
    };
  }

  return best;
}

/** The first moment of today in Pakistan time, in the ISO form reminder_logs stores. */
export function pkDayStartISO(now = new Date()): string {
  return new Date(`${pkDate(now)}T00:00:00+05:00`).toISOString();
}

/**
 * What was actually sent today. "Sent" is a reminder log row, never a scheduled occurrence:
 * the Action Center may have many due reminders, but only these rows prove a customer was
 * contacted. The channel split is kept because WhatsApp and SMS are different promises.
 */
export function summariseSentToday(
  logs: Array<{ channel?: string | null; customerId?: string | null; sentAt: string }>,
  now = new Date(),
): SentTodaySummary {
  const today = pkDate(now);
  const todays = logs.filter((log) => pkDateFromISO(log.sentAt) === today);
  let whatsapp = 0;
  let sms = 0;
  let other = 0;
  const customers = new Set<string>();

  for (const log of todays) {
    const channel = (log.channel ?? "").toLowerCase();
    if (channel === "whatsapp") whatsapp += 1;
    else if (channel === "sms") sms += 1;
    else other += 1;
    if (log.customerId) customers.add(log.customerId);
  }

  return { total: todays.length, whatsapp, sms, other, customers: customers.size };
}
