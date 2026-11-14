import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pkToday } from "@/lib/pkDate";
import type { RepeatUnit } from "@/lib/financeEntries";

/**
 * The owner's own payment diary: one payment, one date, an optional cadence.
 *
 * WHY THIS IS NOT THE CREDIT BOOK'S REMINDERS. `reminder_configs` schedules chasing a customer's
 * balance and the engine turns those into messages. This is the other direction — a note to the
 * owner ("collect Kasim's payment on the 28th"), which may have no customer at all. Keeping them
 * apart is what stops a private note from being sent to somebody.
 *
 * THREE KINDS, ONE SYSTEM (0257). A reminder can be about a customer paying the business, the
 * business paying a supplier, or a payment with no record behind it. The kind decides which party
 * the sheet asks for; the database refuses a customer reminder with no customer, and refuses a
 * customer that belongs to another business.
 *
 * NO SCHEDULER IS CLAIMED. The app has no background job that runs while it is closed, so the
 * screen shows the reminder and marks the one that is due today. Nothing here says a notification
 * was delivered, because none was.
 *
 * The next occurrence is derived, never stored: the database keeps the day the reminder started
 * and its cadence, and `nextOccurrence` advances that day to today or later. Two screens (and a
 * test) read the same function, so the label cannot drift from the rule.
 */

export type PaymentReminderKind = "customer" | "supplier" | "general";
export type PaymentReminderStatus = "upcoming" | "completed" | "cancelled";

export interface PaymentReminder {
  id: string;
  title: string;
  /** The printed label: the customer's or supplier's own name, or the typed name of a general note. */
  person: string | null;
  amount: number | null;
  /** PK day, `YYYY-MM-DD`. */
  dueOn: string;
  /** `HH:MM`, 24-hour. */
  dueTime: string;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
  kind: PaymentReminderKind;
  status: PaymentReminderStatus;
  notes: string | null;
  customerId: string | null;
  companyId: string | null;
  /** Resolved by the database, so a card never prints a stale name after a rename. */
  customerName: string | null;
  companyName: string | null;
  createdByName: string | null;
}

interface RawReminder {
  id: string;
  title: string;
  person: string | null;
  amount: number | string | null;
  due_on: string;
  due_time: string;
  repeat_every: number | string | null;
  repeat_unit: string | null;
  kind: string | null;
  status: string | null;
  notes: string | null;
  customer_id: string | null;
  company_id: string | null;
  customer_name: string | null;
  company_name: string | null;
  created_by_name: string | null;
}

// The pure calendar arithmetic lives in repeatSchedule (tested without a client); the screens
// keep importing it from here, where the reminder's own shape is named.
export { addMonths, nextOccurrence, reminderWhen, sortReminders } from "@/lib/repeatSchedule";

/**
 * One read, two views. The cash screen and the supplier book ask for what is still owed; the
 * reminder book also shows what the owner closed, because "what did I finish" is a question the
 * book exists to answer. `includeClosed` is one named flag rather than two near-identical hooks.
 */
function useReminderRows(includeClosed: boolean): {
  rows: PaymentReminder[] | null;
  failed: boolean;
  retry: () => void;
} {
  const [rows, setRows] = useState<PaymentReminder[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void supabase
      .rpc("get_payment_reminders", { p_include_closed: includeClosed })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          // 0256/0257 missing (an environment that has not caught up) draws no diary, never a
          // false "nothing to pay": the section is simply absent.
          setRows([]);
          setFailed(true);
          return;
        }
        setRows(
          ((data as RawReminder[] | null) ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            person: row.person,
            amount: row.amount == null ? null : Number(row.amount),
            dueOn: row.due_on,
            dueTime: (row.due_time ?? "09:00").slice(0, 5),
            repeatEvery: Number(row.repeat_every ?? 1),
            repeatUnit: (row.repeat_unit ?? "none") as RepeatUnit,
            kind: (row.kind ?? "general") as PaymentReminderKind,
            status: (row.status ?? "upcoming") as PaymentReminderStatus,
            notes: row.notes,
            customerId: row.customer_id,
            companyId: row.company_id,
            customerName: row.customer_name,
            companyName: row.company_name,
            createdByName: row.created_by_name,
          })),
        );
      });
    return () => {
      live = false;
    };
  }, [attempt, includeClosed]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, failed, retry };
}

/** What is still owed: the cash screen's list and the supplier plate. */
export function usePaymentReminders(): {
  rows: PaymentReminder[] | null;
  failed: boolean;
  retry: () => void;
} {
  return useReminderRows(false);
}

/** Everything, including legacy rows closed before Done started deleting the reminder. */
export function usePaymentReminderBook(): {
  rows: PaymentReminder[] | null;
  failed: boolean;
  retry: () => void;
} {
  return useReminderRows(true);
}

/** The name a card prints: the linked record's own name first, then the typed label. */
export function reminderParty(reminder: Pick<PaymentReminder, "customerName" | "companyName" | "person">): string | null {
  return reminder.customerName ?? reminder.companyName ?? reminder.person;
}

export interface SavePaymentReminderInput {
  /** Present when editing; absent when creating. */
  id?: string | null;
  title: string;
  kind: PaymentReminderKind;
  customerId?: string | null;
  companyId?: string | null;
  /** Only written for a general reminder; the database uses the record's name otherwise. */
  person?: string;
  amount?: number | null;
  dueOn: string;
  dueTime: string;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
  notes?: string | null;
}

export async function savePaymentReminder(input: SavePaymentReminderInput): Promise<string> {
  const { data, error } = await supabase.rpc("save_payment_reminder", {
    p_title: input.title.trim(),
    p_person: input.kind === "general" ? input.person?.trim() || null : null,
    p_amount: input.amount ?? null,
    p_due_on: input.dueOn,
    p_due_time: input.dueTime || "09:00",
    p_repeat_every: input.repeatUnit === "none" ? 1 : Math.max(1, input.repeatEvery || 1),
    p_repeat_unit: input.repeatUnit,
    p_id: input.id ?? null,
    p_kind: input.kind,
    p_customer_id: input.kind === "customer" ? input.customerId ?? null : null,
    p_company_id: input.kind === "supplier" ? input.companyId ?? null : null,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Done, dropped, or owed again. Never a payment: it records the owner's decision only. */
export async function setPaymentReminderStatus(
  id: string,
  status: PaymentReminderStatus,
): Promise<void> {
  const { error } = await supabase.rpc("set_payment_reminder_status", {
    p_id: id,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

export async function deletePaymentReminder(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_payment_reminder", { p_id: id });
  if (error) throw new Error(error.message);
}

/** Today in the shop's timezone, named once so every caller reads the same day. */
export const reminderToday = pkToday;
