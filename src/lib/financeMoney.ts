import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { I18nKey } from "@/lib/i18n";

/**
 * The money statement — every ledger's movements in one read-only list.
 *
 * WHY IT IS A READ AND NOT A MERGED TABLE. A sale moves stock and creates a debt; a supplier
 * payment settles a bill; an expense has no stock and no customer. They are different facts with
 * different owners, and copying them into one table would create a second version of each that
 * could disagree with the first. The database union (0262) answers one question — what money
 * actually moved in this branch, in this window — and the app never writes through it.
 *
 * WHAT COUNTS AS MOVEMENT. Sales' paid part, later customer payments, refunds, supplier payments,
 * and recorded income/expense/drawings. Not a credit sale's unpaid balance, not a purchase's bill,
 * not a voided sale. The SQL says so once; this file does not re-decide it.
 *
 * PROFEIT IS SOMEWHERE ELSE. `net` here is money in minus money out — a cash movement, not profit,
 * and the screen says so. The Finance hub's net profit keeps its own arithmetic (net sales − COGS −
 * recorded expenses), because the two answer different questions.
 */

export type MoneySource =
  | "sale"
  | "customer_payment"
  | "refund"
  | "supplier_payment"
  | "finance_income"
  | "finance_expense"
  | "finance_drawing";

export type MoneyDirection = "in" | "out";

export interface MoneyMovement {
  /** Stable across reads: the source plus the row's own id. */
  id: string;
  source: MoneySource;
  refId: string;
  occurredOn: string;
  direction: MoneyDirection;
  amount: number;
  method: string | null;
  party: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export const MONEY_SOURCE_KEY: Record<MoneySource, I18nKey> = {
  sale: "money.source.sale",
  customer_payment: "money.source.customerPayment",
  refund: "money.source.refund",
  supplier_payment: "money.source.supplierPayment",
  finance_income: "money.source.income",
  finance_expense: "money.source.expense",
  finance_drawing: "money.source.drawing",
};

export interface MoneyTotals {
  moneyIn: number;
  moneyOut: number;
  net: number;
  entries: number;
}

interface RawMovement {
  source: string;
  ref_id: string;
  occurred_on: string;
  direction: string;
  amount: number | string | null;
  method: string | null;
  party: string | null;
  reference: string | null;
  note: string | null;
  created_at: string;
}

function isSource(value: string): value is MoneySource {
  return value in MONEY_SOURCE_KEY;
}

/**
 * The window's movements, newest first.
 *
 * `rows` is null until the answer lands: an unread statement and an empty one must not both draw
 * "no money moved". A failed read is its own state, because a function the database does not have
 * yet is not a quiet month.
 */
export function useMoneyStatement(from: string, to: string): {
  rows: MoneyMovement[] | null;
  failed: boolean;
  retry: () => void;
} {
  const [rows, setRows] = useState<MoneyMovement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    void supabase
      .rpc("get_money_statement", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setFailed(true);
          return;
        }
        const list = ((data as RawMovement[] | null) ?? [])
          .filter((row) => isSource(row.source))
          .map((row) => ({
            id: `${row.source}:${row.ref_id}`,
            source: row.source as MoneySource,
            refId: row.ref_id,
            occurredOn: row.occurred_on,
            direction: row.direction === "in" ? ("in" as const) : ("out" as const),
            amount: Number(row.amount ?? 0),
            method: row.method,
            party: row.party,
            reference: row.reference,
            note: row.note,
            createdAt: row.created_at,
          }));
        setRows(list);
      });
    return () => {
      live = false;
    };
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, failed, retry };
}

interface RawTotals {
  money_in: number | string | null;
  money_out: number | string | null;
  net: number | string | null;
  entries: number | string | null;
}

/** The three figures at the top of the statement, aggregated from the same rows. */
export function useMoneyTotals(from: string, to: string): {
  totals: MoneyTotals | null;
  failed: boolean;
  retry: () => void;
} {
  const [totals, setTotals] = useState<MoneyTotals | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setTotals(null);
    setFailed(false);
    void supabase
      .rpc("get_money_totals", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setFailed(true);
          return;
        }
        const row = ((data as RawTotals[] | null) ?? [])[0];
        setTotals({
          moneyIn: Number(row?.money_in ?? 0),
          moneyOut: Number(row?.money_out ?? 0),
          net: Number(row?.net ?? 0),
          entries: Number(row?.entries ?? 0),
        });
      });
    return () => {
      live = false;
    };
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { totals, failed, retry };
}

/** Where a movement can be read in the ledger it came from. */
export function moneySourcePath(base: string, source: MoneySource): string {
  switch (source) {
    case "sale":
    case "refund":
      return `${base}/sales`;
    case "customer_payment":
      return `${base}/customers/payments`;
    case "supplier_payment":
      return `${base}/purchases/payments`;
    default:
      return `${base}/settings/hub/finance/entries`;
  }
}
