import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pkToday } from "@/lib/pkDate";
import type { FinanceMethod } from "@/lib/financeEntries";

/**
 * Salary is a recurring expense, not a second payroll book.
 *
 * The schedule lives in `employee_compensations`; the rows it posts are ordinary
 * `finance_entries` rows linked through `finance_recurrences`. That means the Money statement,
 * the expense totals, the recurring strip and the employee's payment history all read the same
 * facts. Creating a schedule never posts money by itself: the first row appears on its first pay
 * date, when the owner next opens the money book.
 */

export type SalaryUnit = "day" | "week" | "month" | "year";
export type SalaryEndMode = "never" | "date" | "payments";

export interface SalaryDraft {
  amount: string;
  payEvery: string;
  payUnit: SalaryUnit;
  payDay: string;
  startsOn: string;
  endMode: SalaryEndMode;
  endsOn: string;
  totalPayments: string;
  method: FinanceMethod;
  addToExpenses: boolean;
}

export function emptySalaryDraft(): SalaryDraft {
  return {
    amount: "",
    payEvery: "1",
    payUnit: "month",
    payDay: "1",
    startsOn: pkToday(),
    endMode: "never",
    endsOn: "",
    totalPayments: "",
    method: "cash",
    addToExpenses: true,
  };
}

export interface SalaryDraftErrors {
  amount?: string;
  payDay?: string;
  startsOn?: string;
  endsOn?: string;
  totalPayments?: string;
}

/** The same validation the screen and the store share; the database validates again. */
export function validateSalaryDraft(draft: SalaryDraft): SalaryDraftErrors {
  const errors: SalaryDraftErrors = {};
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = "salary.errAmount";
  const every = Number(draft.payEvery);
  if (!Number.isFinite(every) || every < 1 || every > 60) errors.amount = "salary.errEvery";
  if (draft.payUnit === "month") {
    const day = Number(draft.payDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) errors.payDay = "salary.errPayDay";
  }
  if (!draft.startsOn) errors.startsOn = "salary.errStart";
  if (draft.endMode === "date") {
    if (!draft.endsOn) errors.endsOn = "salary.errEnd";
    else if (draft.startsOn && draft.endsOn < draft.startsOn) errors.endsOn = "salary.errEndBeforeStart";
  }
  if (draft.endMode === "payments") {
    const total = Number(draft.totalPayments);
    if (!Number.isInteger(total) || total < 1) errors.totalPayments = "salary.errPayments";
  }
  return errors;
}

export function salaryHasErrors(errors: SalaryDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

export interface SalaryInput {
  employeeId: string;
  branchId?: string | null;
  amount: number;
  payEvery: number;
  payUnit: SalaryUnit;
  payDay?: number | null;
  startsOn: string;
  endsOn?: string | null;
  totalPayments?: number | null;
  method: FinanceMethod;
  addToExpenses: boolean;
}

/** Save or replace one employee's schedule. Owner-only at the database. */
export async function saveEmployeeSalary(input: SalaryInput): Promise<string | null> {
  const { data, error } = await supabase.rpc("upsert_employee_salary", {
    payload: {
      employeeId: input.employeeId,
      branchId: input.branchId ?? null,
      amount: input.amount,
      payEvery: input.payEvery,
      payUnit: input.payUnit,
      payDay: input.payUnit === "month" ? input.payDay ?? null : null,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      totalPayments: input.totalPayments ?? null,
      method: input.method,
      addToExpenses: input.addToExpenses,
      add_to_expenses: input.addToExpenses,
    },
  });
  if (error) throw new Error(error.message);
  return (data as { recurrenceId?: string | null } | null)?.recurrenceId ?? null;
}

export interface SalaryPayment {
  id: string;
  amount: number;
  occurredOn: string;
  method: string;
  note: string | null;
  createdAt: string;
}

export interface EmployeeSalary {
  employeeId: string;
  employeeName: string | null;
  compensationId: string;
  amount: number;
  payEvery: number;
  payUnit: SalaryUnit;
  payDay: number | null;
  startsOn: string;
  endsOn: string | null;
  totalPayments: number | null;
  method: string;
  addToExpenses: boolean;
  isActive: boolean;
  nextOn: string | null;
  recurrenceId: string | null;
  history: SalaryPayment[];
}

interface RawSalary {
  employeeId: string;
  employeeName: string | null;
  compensationId: string;
  amount: number | string;
  payEvery: number | string;
  payUnit: SalaryUnit;
  payDay: number | string | null;
  startsOn: string;
  endsOn: string | null;
  totalPayments: number | string | null;
  method: string;
  addToExpenses: boolean;
  isActive: boolean;
  nextOn: string | null;
  recurrenceId: string | null;
  history: Array<{
    id: string;
    amount: number | string;
    occurredOn: string;
    method: string;
    note: string | null;
    createdAt: string;
  }>;
}

function salaryFromRaw(raw: RawSalary): EmployeeSalary {
  return {
    employeeId: raw.employeeId,
    employeeName: raw.employeeName,
    compensationId: raw.compensationId,
    amount: Number(raw.amount ?? 0),
    payEvery: Number(raw.payEvery ?? 1),
    payUnit: raw.payUnit,
    payDay: raw.payDay == null ? null : Number(raw.payDay),
    startsOn: raw.startsOn,
    endsOn: raw.endsOn,
    totalPayments: raw.totalPayments == null ? null : Number(raw.totalPayments),
    method: raw.method,
    addToExpenses: raw.addToExpenses,
    isActive: raw.isActive,
    nextOn: raw.nextOn,
    recurrenceId: raw.recurrenceId,
    history: (raw.history ?? []).map((row) => ({
      id: row.id,
      amount: Number(row.amount ?? 0),
      occurredOn: row.occurredOn,
      method: row.method,
      note: row.note,
      createdAt: row.createdAt,
    })),
  };
}

export function useEmployeeSalary(employeeId: string | null | undefined): {
  salary: EmployeeSalary | null;
  failed: boolean;
  loading: boolean;
  retry: () => void;
} {
  const [salary, setSalary] = useState<EmployeeSalary | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!employeeId) {
      setSalary(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setFailed(false);
    void supabase.rpc("get_employee_salary", { p_employee_id: employeeId }).then(({ data, error }) => {
      if (!live) return;
      setLoading(false);
      if (error) {
        setFailed(true);
        return;
      }
      const raw = data as RawSalary | null;
      setSalary(raw ? salaryFromRaw(raw) : null);
    });
    return () => {
      live = false;
    };
  }, [employeeId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { salary, failed, loading, retry };
}

export interface SalaryOverviewRow {
  employeeId: string;
  employeeName: string;
  amount: number;
  payEvery: number;
  payUnit: SalaryUnit;
  payDay: number | null;
  startsOn: string;
  endsOn: string | null;
  addToExpenses: boolean;
  nextOn: string | null;
  recurrenceId: string | null;
}

export interface SalaryOverview {
  rows: SalaryOverviewRow[];
  activeCount: number;
  nextOn: string | null;
}

/** The Finance widget's read: what the branch has promised, and when the next pay date is. */
export function useSalaryOverview(): {
  overview: SalaryOverview | null;
  failed: boolean;
  retry: () => void;
} {
  const [overview, setOverview] = useState<SalaryOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void supabase.rpc("get_salary_overview").then(({ data, error }) => {
      if (!live) return;
      if (error) {
        setFailed(true);
        return;
      }
      setOverview(data as SalaryOverview);
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { overview, failed, retry };
}

/** A weekly, daily or yearly amount expressed as a monthly commitment, for the widget. */
export function monthlyEquivalent(row: Pick<SalaryOverviewRow, "amount" | "payEvery" | "payUnit">): number {
  const every = Math.max(1, row.payEvery);
  const perMonth =
    row.payUnit === "month" ? 1 :
    row.payUnit === "year" ? 1 / 12 :
    row.payUnit === "week" ? 52 / 12 :
    365.25 / 12;
  return Math.round((row.amount * perMonth) / every * 100) / 100;
}

export function salaryUnitKey(unit: SalaryUnit): string {
  return `salary.unit.${unit}`;
}

export function salaryFrequencyKey(unit: SalaryUnit): string {
  return `salary.every.${unit}`;
}
