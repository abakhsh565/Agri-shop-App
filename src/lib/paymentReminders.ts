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
 * NO SCHEDULER IS CLAIMED. The app has no background job that runs while it is closed, so the
 * screen shows the reminder and marks the one that is due today. Nothing here says a notification
 * was delivered, because none was.
 *
 * The next occurrence is derived, never stored: the database keeps the day the reminder started
 * and its cadence, and `nextOccurrence` advances that day to today or later. Two screens (and a
 * test) read the same function, so the label cannot drift from the rule.
 */

export interface PaymentReminder {
  id: string;
  title: string;
  person: string | null;
  amount: number | null;
  /** PK day, `YYYY-MM-DD`. */
  dueOn: string;
  /** `HH:MM`, 24-hour. */
  dueTime: string;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
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
  created_by_name: string | null;
}

// The pure calendar arithmetic lives in repeatSchedule (tested without a client); the screen
// keeps importing it from here, where the reminder's own shape is named.
export { addMonths, nextOccurrence, reminderWhen, sortReminders } from "@/lib/repeatSchedule";

export function usePaymentReminders(): {
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
      .rpc("get_payment_reminders")
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          // 0256 missing (an environment that has not caught up) draws no diary, never a false
          // "nothing to pay": the section is simply absent.
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
            createdByName: row.created_by_name,
          })),
        );
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, failed, retry };
}

export interface SavePaymentReminderInput {
  /** Present when editing; absent when creating. */
  id?: string | null;
  title: string;
  person?: string;
  amount?: number | null;
  dueOn: string;
  dueTime: string;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
}

export async function savePaymentReminder(input: SavePaymentReminderInput): Promise<string> {
  const { data, error } = await supabase.rpc("save_payment_reminder", {
    p_title: input.title.trim(),
    p_person: input.person?.trim() || null,
    p_amount: input.amount ?? null,
    p_due_on: input.dueOn,
    p_due_time: input.dueTime || "09:00",
    p_repeat_every: input.repeatUnit === "none" ? 1 : Math.max(1, input.repeatEvery || 1),
    p_repeat_unit: input.repeatUnit,
    p_id: input.id ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deletePaymentReminder(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_payment_reminder", { p_id: id });
  if (error) throw new Error(error.message);
}

/** Today in the shop's timezone, named once so every caller reads the same day. */
export const reminderToday = pkToday;
