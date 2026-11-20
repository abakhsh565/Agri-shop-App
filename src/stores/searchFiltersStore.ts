import { create } from "zustand";

/**
 * The search screen's filters, kept outside it because the filter screen is a screen of its own.
 *
 * The owner asked for the filter to be a place you go to, not a strip of pills that has to guess
 * how many dimensions a shop actually needs (owner, 2026-11-17). Six dimensions is already more
 * than a pill row can hold honestly, so the choices live on their own screen and this store is the
 * one copy both screens read.
 *
 * Deliberately not persisted: a filter is a question about right now, and a shop that reopened the
 * app tomorrow expecting last week's answer would be looking at a screen it did not ask for.
 */
/**
 * The same six windows the ledgers use (owner, 2026-11-19): a day, a week, a month, three
 * months, a year, or a hand-picked range. The filter screen draws them as the ledger's tab strip
 * so "last month" means one thing everywhere in the app, not a track of pills here and a strip of
 * tabs there. `any` is the unfiltered state, reached by tapping the chosen tab again.
 */
export type SearchPeriod = "any" | "today" | "week" | "month" | "quarter" | "year" | "custom";
export type SearchPayFilter = "any" | "paid" | "credit";
export type SearchStockFilter = "any" | "in" | "low" | "out";
export type SearchSort = "relevance" | "recent" | "amount" | "name";

export interface SearchFilters {
  period: SearchPeriod;
  /** The hand-picked window, `YYYY-MM-DD`, used only while `period` is "custom". */
  customFrom: string | null;
  customTo: string | null;
  /** A customer or a supplier, by id. One id, because a name search already covers both lists. */
  personId: string | null;
  personName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  pay: SearchPayFilter;
  stock: SearchStockFilter;
  sort: SearchSort;
}

interface SearchFilterState extends SearchFilters {
  set: (patch: Partial<SearchFilters>) => void;
  reset: () => void;
}

const EMPTY: SearchFilters = {
  period: "any",
  customFrom: null,
  customTo: null,
  personId: null,
  personName: null,
  employeeId: null,
  employeeName: null,
  pay: "any",
  stock: "any",
  sort: "relevance",
};

export const useSearchFilters = create<SearchFilterState>()((set) => ({
  ...EMPTY,
  set: (patch) => set(patch),
  reset: () => set(EMPTY),
}));

/** How many choices are narrowing the list — the number the filter button shows. */
export function countActiveFilters(f: SearchFilters): number {
  let n = 0;
  if (f.period !== "any") n += 1;
  if (f.personId) n += 1;
  if (f.employeeId) n += 1;
  if (f.pay !== "any") n += 1;
  if (f.stock !== "any") n += 1;
  if (f.sort !== "relevance") n += 1;
  return n;
}

/**
 * The window a period covers, in local time. A `null` end means "and everything after it", which
 * is what every rolling preset answers; only a hand-picked range has a real last day, and it ends
 * at the last millisecond of that day so a record entered at 23:59 is inside it.
 */
export function periodWindow(
  period: SearchPeriod,
  customFrom?: string | null,
  customTo?: string | null,
  now = new Date(),
): { from: Date | null; to: Date | null } {
  if (period === "any") return { from: null, to: null };
  if (period === "custom") {
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00`) : null,
      to: customTo ? new Date(`${customTo}T23:59:59.999`) : null,
    };
  }
  if (period === "today") {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: null };
  }
  const days = period === "week" ? 7 : period === "month" ? 30 : period === "quarter" ? 90 : 365;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: null };
}
