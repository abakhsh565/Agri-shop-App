import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * The period read behind the reports that are about more than one branch.
 *
 * `get_branch_period_report` answers one window for every branch this account may read: gross
 * sales, refunds, net sales, recorded COGS and profit. It is a database read on purpose — the
 * session's own sales feed is scoped to the branch it is working in, so a client-side grouping
 * could only ever draw one branch and call it the business.
 *
 * A figure is `number | null`, and null means "not readable", never zero. `unknown_lines` says
 * how many sale lines in that branch had no recorded cost: while it is above zero, `profit` is a
 * floor, and the screen says so instead of presenting it as exact.
 */
export interface BranchPeriodReport {
  branchId: string;
  branchName: string;
  isCurrent: boolean;
  grossSales: number | null;
  returns: number | null;
  netSales: number | null;
  cogs: number | null;
  unknownLines: number;
  profit: number | null;
}

/** The same window's cash, per branch. A null column means the caller may not read it. */
export interface BranchCash {
  branchId: string;
  branchName: string;
  isCurrent: boolean;
  cashTaken: number | null;
  received: number | null;
  paid: number | null;
}

interface RawBranchPeriodReport {
  branch_id: string;
  branch_name: string;
  is_current: boolean;
  gross_sales: number | string | null;
  returns: number | string | null;
  net_sales: number | string | null;
  cogs: number | string | null;
  unknown_lines: number | string | null;
  profit: number | string | null;
}

interface RawBranchCash {
  branch_id: string;
  branch_name: string;
  is_current: boolean;
  cash_taken: number | string | null;
  received: number | string | null;
  paid: number | string | null;
}

const numberOrNull = (value: number | string | null | undefined): number | null =>
  value == null ? null : Number(value);

/**
 * One window per branch, read once.
 *
 * `rows` is null until the answer lands, so a caller cannot mistake "still reading" for "no
 * branches" — the two look identical in a list of zeros. `failed` is a state of its own for the
 * same reason: an RPC that is not deployed yet must not be drawn as a quiet period.
 */
export function useBranchPeriodReport(from: string, to: string): {
  rows: BranchPeriodReport[] | null;
  failed: boolean;
  retry: () => void;
} {
  const [rows, setRows] = useState<BranchPeriodReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    void supabase
      .rpc("get_branch_period_report", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setFailed(true);
          return;
        }
        const mapped = ((data as RawBranchPeriodReport[] | null) ?? []).map((row) => ({
          branchId: row.branch_id,
          branchName: row.branch_name,
          isCurrent: Boolean(row.is_current),
          grossSales: numberOrNull(row.gross_sales),
          returns: numberOrNull(row.returns),
          netSales: numberOrNull(row.net_sales),
          cogs: numberOrNull(row.cogs),
          unknownLines: Number(row.unknown_lines ?? 0),
          profit: numberOrNull(row.profit),
        }));
        setRows(mapped);
      });
    return () => {
      live = false;
    };
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, failed, retry };
}

/** The cash answer for the same window. Nulls are permissions, not empty tills. */
export function useBranchCash(from: string, to: string): {
  rows: BranchCash[] | null;
  failed: boolean;
  retry: () => void;
} {
  const [rows, setRows] = useState<BranchCash[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    void supabase
      .rpc("get_branch_cash", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setFailed(true);
          return;
        }
        const mapped = ((data as RawBranchCash[] | null) ?? []).map((row) => ({
          branchId: row.branch_id,
          branchName: row.branch_name,
          isCurrent: Boolean(row.is_current),
          cashTaken: numberOrNull(row.cash_taken),
          received: numberOrNull(row.received),
          paid: numberOrNull(row.paid),
        }));
        setRows(mapped);
      });
    return () => {
      live = false;
    };
  }, [from, to, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { rows, failed, retry };
}
