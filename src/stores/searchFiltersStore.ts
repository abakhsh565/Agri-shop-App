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
export type SearchPeriod = "any" | "today" | "week" | "month";
export type SearchPayFilter = "any" | "paid" | "credit";
export type SearchStockFilter = "any" | "in" | "low" | "out";
export type SearchSort = "relevance" | "recent" | "amount" | "name";

export interface SearchFilters {
  period: SearchPeriod;
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

/** The first moment this period starts at, or null for "any time". */
export function periodStart(period: SearchPeriod, now = new Date()): Date | null {
  if (period === "any") return null;
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = period === "week" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
