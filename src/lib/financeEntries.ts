import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pkMonthStartOf } from "@/lib/pkDate";
import type { I18nKey } from "@/lib/i18n";

/**
 * Recorded money that is not a sale: income, expense and drawings.
 *
 * WHY NOTHING HERE TOUCHES THE STORES. A sale moves stock and belongs to the sales ledger; a
 * sale's cash is already read by Home, Sales and the branch overview. Rent, a cash delivery, the
 * owner taking money out — the three things this file records — have no stock and no customer,
 * and summing them into a "revenue" store would let one screen's profit mean something another
 * screen's does not. The one ledger is `finance_entries` (0254), and this file is its only door.
 *
 * AN EXPENSE IS NOT A DRAWING. The period can answer "the shop spent 12,000" and "the owner took
 * 20,000" separately, because they are different facts and netting them would hide both.
 *
 * THE SERVER DECIDES, NOT THIS FILE. `record_finance_entry` is owner-only, refuses a future day
 * and derives the shop and branch from the session; the checks here are for fast feedback, not
 * for authority.
 */

export type FinanceEntryKind = "income" | "expense" | "drawing";

export type FinanceMethod = "cash" | "bank" | "easypaisa" | "jazzcash";

/**
 * How often a recorded amount repeats. `none` is a one-off row and is the default everywhere.
 *
 * The cadence is deliberately small: day, week, month. A rent bill is monthly, a delivery every
 * two weeks, a daily wage every day. Anything more expressive ("the last working day") would be a
 * calendar rule the database could not post honestly without a holiday table it does not have.
 */
export type RepeatUnit = "none" | "day" | "week" | "month";

/** The words for a cadence, for the picker and for a row's badge. */
export const REPEAT_KEY: Record<RepeatUnit, I18nKey> = {
  none: "finance.repeat.none",
  day: "finance.repeat.day",
  week: "finance.repeat.week",
  month: "finance.repeat.month",
};

export interface FinanceTotals {
  income: number;
  expense: number;
  drawing: number;
}

export const EMPTY_TOTALS: FinanceTotals = { income: 0, expense: 0, drawing: 0 };

/**
 * The words for a stored category and method.
 *
 * They live beside the ledger rather than on the form because the form and the ledger that lists
 * what the form wrote must read the same strings — a category renamed on one screen and not the
 * other would describe the same row two ways.
 */
export const CATEGORY_KEY: Record<string, I18nKey> = {
  sales: "finance.cat.sales",
  other_income: "finance.cat.otherIncome",
  investment: "finance.cat.investment",
  loan_received: "finance.cat.loanReceived",
  stock_purchase: "finance.cat.stockPurchase",
  rent: "finance.cat.rent",
  utilities: "finance.cat.utilities",
  salaries: "finance.cat.salaries",
  transport: "finance.cat.transport",
  maintenance: "finance.cat.maintenance",
  other_expense: "finance.cat.otherExpense",
  personal_use: "finance.cat.personalUse",
  owner_pay: "finance.cat.ownerPay",
  other_drawing: "finance.cat.otherDrawing",
};

export const METHOD_KEY: Record<FinanceMethod, I18nKey> = {
  cash: "finance.method.cash",
  bank: "finance.method.bank",
  easypaisa: "finance.method.easypaisa",
  jazzcash: "finance.method.jazzcash",
};

/** What each kind calls itself when it is listed, as opposed to on the form's tabs. */
export const KIND_LABEL_KEY: Record<FinanceEntryKind, I18nKey> = {
  income: "finance.ledger.income",
  expense: "finance.ledger.expense",
  drawing: "finance.ledger.drawing",
};

/** One window, and the month before it, as plain PK days. */
export interface MonthWindow {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

/**
 * The month a PK day falls in, plus the month before it.
 *
 * Both months are calendar months in Karachi, and the previous window ends the day before this
 * one starts: the trend is comparing two closed periods, not two rolling 30-day stretches that
 * would overlap by a day and flatter the newer number.
 */
export function monthWindow(day: string): MonthWindow {
  const from = pkMonthStartOf(day, 0);
  const prevFrom = pkMonthStartOf(day, -1);
  const prevTo = new Date(new Date(`${from}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const nextFrom = pkMonthStartOf(day, 1);
  const to = new Date(new Date(`${nextFrom}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to, prevFrom, prevTo };
}

/**
 * What the business kept: net sales minus cost of goods minus recorded expenses.
 *
 * This is the Finance screen's own figure and it says so. The Sales report's "profit" is
 * measured on recorded sales and recorded COGS only — it has never subtracted a rent bill,
 * because that ledger did not exist when it was written. Subtracting one and not the other is
 * the drift this function prevents: the hero and the performance rows both call it, so the
 * number at the top and the arithmetic under it cannot disagree.
 */
export function netProfitOf(
  netSales: number | null,
  cogs: number | null,
  expenses: number | null,
): number | null {
  if (netSales == null || cogs == null || expenses == null) return null;
  return Math.round((netSales - cogs - expenses) * 100) / 100;
}

/**
 * The change against the previous period, in whole percent, or null when there is nothing to
 * compare against. A previous period of zero or less is NOT "infinitely better": it is a first
 * month, and printing a percentage there would invent a baseline.
 */
export function trendPercent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

interface RawTotals {
  income: number | string | null;
  expense: number | string | null;
  drawing: number | string | null;
}

const toTotals = (row: RawTotals | null | undefined): FinanceTotals => ({
  income: Number(row?.income ?? 0),
  expense: Number(row?.expense ?? 0),
  drawing: Number(row?.drawing ?? 0),
});

/**
 * The three totals for one window, read when the window changes.
 *
 * `totals` is null until the answer lands, so a caller cannot draw "no expenses" while the read
 * is still in flight — the two look identical in a zero. `failed` is its own state: a function
 * the database does not have yet is an unread period, not an empty one.
 */
export function useFinanceTotals(from: string, to: string): {
  totals: FinanceTotals | null;
  failed: boolean;
  retry: () => void;
} {
  const [totals, setTotals] = useState<FinanceTotals | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setTotals(null);
    setFailed(false);
    void supabase
      .rpc("get_finance_totals", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setFailed(true);
          return;
        }
        const rows = (data as RawTotals[] | null) ?? [];
        setTotals(toTotals(rows[0]));
      });
    return () => {
      live = false;
    };
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { totals, failed, retry };
}

export interface FinanceEntryRow {
  id: string;
  kind: FinanceEntryKind;
  amount: number;
  occurredOn: string;
  category: string;
  method: string;
  counterparty: string | null;
  note: string | null;
  createdAt: string;
  /** Who wrote the row, from the database's own users table — null when the account is gone. */
  createdByName: string | null;
  /** The cadence this row was posted from, when it was not typed by hand. */
  recurrenceId: string | null;
  repeatEvery: number | null;
  repeatUnit: RepeatUnit | null;
}

interface RawEntry {
  id: string;
  kind: FinanceEntryKind;
  amount: number | string | null;
  occurred_on: string;
  category: string | null;
  method: string | null;
  counterparty: string | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  recurrence_id: string | null;
  repeat_every: number | null;
  repeat_unit: string | null;
}

/**
 * The rows behind the totals, for one window.
 *
 * Same gate and same branch as `useFinanceTotals`, so the ledger screen can only list rows the
 * overview already counted. `rows` stays null until the answer lands — an unread ledger and an
 * empty one are different facts and must not both draw "nothing recorded".
 */
export function useFinanceEntries(from: string, to: string): {
  rows: FinanceEntryRow[] | null;
  failed: boolean;
  retry: () => void;
} {
  const [rows, setRows] = useState<FinanceEntryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    void supabase
      .rpc("get_finance_entries", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setFailed(true);
          return;
        }
        setRows(
          ((data as RawEntry[] | null) ?? []).map((row) => ({
            id: row.id,
            kind: row.kind,
            amount: Number(row.amount ?? 0),
            occurredOn: row.occurred_on,
            category: row.category ?? "",
            method: row.method ?? "",
            counterparty: row.counterparty,
            note: row.note,
            createdAt: row.created_at,
            createdByName: row.created_by_name,
            recurrenceId: row.recurrence_id,
            repeatEvery: row.repeat_every,
            repeatUnit: row.repeat_unit as RepeatUnit | null,
          })),
        );
      });
    return () => {
      live = false;
    };
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, failed, retry };
}

export interface RecordFinanceInput {
  kind: FinanceEntryKind;
  amount: number;
  category: string;
  method: FinanceMethod;
  /** PK day (`YYYY-MM-DD`); omitted means the database uses today. */
  occurredOn?: string;
  counterparty?: string;
  note?: string;
  /** `none` (the default) writes one row; anything else also starts a cadence. */
  repeatUnit?: RepeatUnit;
  repeatEvery?: number;
}

/**
 * Writes one row and returns its id.
 *
 * The caller already has an idempotency story on this screen: the save button disables while the
 * request is in flight (`reentrancyGuard`), so a double tap cannot author two rows; the database
 * cannot dedupe two identical rent entries, because two identical rent entries are legal.
 */
export async function recordFinanceEntry(input: RecordFinanceInput): Promise<string> {
  const { data, error } = await supabase.rpc("record_finance_entry", {
    p_kind: input.kind,
    p_amount: input.amount,
    p_category: input.category,
    p_method: input.method,
    p_occurred_on: input.occurredOn ?? null,
    p_counterparty: input.counterparty?.trim() || null,
    p_note: input.note?.trim() || null,
    p_repeat_every: input.repeatUnit && input.repeatUnit !== "none" ? input.repeatEvery ?? 1 : 1,
    p_repeat_unit: input.repeatUnit && input.repeatUnit !== "none" ? input.repeatUnit : "none",
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Writes every occurrence that has fallen due since the last time somebody looked.
 *
 * There is no scheduler behind this app, so "repeating" is a rule the database holds and this
 * call is what makes it real: it runs when an owner opens the ledger, and the rows it writes are
 * dated the day they fell due, not the day they were posted. Returns how many rows this call
 * wrote, so a caller can refresh only when something changed.
 *
 * Owner-only at the database; an employee's call is refused and the caller treats that as zero.
 */
export async function postDueFinanceEntries(): Promise<number> {
  const { data, error } = await supabase.rpc("post_due_finance_entries");
  if (error) return 0;
  return Number(data ?? 0);
}

export interface FinanceRecurrence {
  id: string;
  kind: FinanceEntryKind;
  amount: number;
  category: string;
  method: string;
  counterparty: string | null;
  note: string | null;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
  nextOn: string;
  endsOn: string | null;
}

interface RawRecurrence {
  id: string;
  kind: FinanceEntryKind;
  amount: number | string | null;
  category: string | null;
  method: string | null;
  counterparty: string | null;
  note: string | null;
  repeat_every: number | string | null;
  repeat_unit: string;
  next_on: string;
  ends_on: string | null;
}

/** The active cadences of the branch on screen, beside the rows they post into. */
export function useFinanceRecurrences(from: string, to: string): {
  rows: FinanceRecurrence[] | null;
  retry: () => void;
} {
  const [rows, setRows] = useState<FinanceRecurrence[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void supabase
      .rpc("get_finance_recurrences")
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          // A database without 0255 draws no repeating strip rather than an error: the rows above
          // are still the ledger, and nothing here is required to read them.
          setRows([]);
          return;
        }
        setRows(
          ((data as RawRecurrence[] | null) ?? []).map((row) => ({
            id: row.id,
            kind: row.kind,
            amount: Number(row.amount ?? 0),
            category: row.category ?? "",
            method: row.method ?? "",
            counterparty: row.counterparty,
            note: row.note,
            repeatEvery: Number(row.repeat_every ?? 1),
            repeatUnit: (row.repeat_unit ?? "month") as RepeatUnit,
            nextOn: row.next_on,
            endsOn: row.ends_on,
          })),
        );
      });
    return () => {
      live = false;
    };
    // `from`/`to` are part of the read's identity on the screen; the function itself is not
    // windowed, but keeping them here means the strip reloads with the list beside it.
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, retry };
}

/** Stops a cadence. Rows it already wrote stay, because stopping a plan is not un-spending money. */
export async function stopFinanceRecurrence(id: string): Promise<void> {
  const { error } = await supabase.rpc("stop_finance_recurrence", { p_id: id });
  if (error) throw new Error(error.message);
}
