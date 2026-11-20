import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import { pkToday } from "@/lib/pkDate";
import { useAppBack } from "@/hooks/useAppBack";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import {
  useSearchFilters,
  type SearchPayFilter,
  type SearchPeriod,
  type SearchSort,
  type SearchStockFilter,
} from "@/stores/searchFiltersStore";
import { Building2, Check, ChevronRight, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The search screen's filters, on a screen of their own (owner, 2026-11-17).
 *
 * The owner asked for a filter that opens, rather than a pill row that keeps growing: what a
 * shopkeeper narrows by is not the same list as what a developer finds cheap to render — the
 * period, the person, the member of staff, whether the money came in, and how much stock is left.
 *
 * EACH QUESTION IS DRAWN AS WHAT IT IS (owner, 2026-11-19). The first version put six identical
 * chip rows under six headings, so "When", "Payment" and "Order" looked like the same control and
 * the eye had nothing to group by. Now a contiguous span of time is a segmented track, a person is
 * a door to their own list, a single choice with a reason attached is a radio row, and small
 * mutually-exclusive levels are tiles. One section = one shape.
 *
 * GREEN IS A 10% WASH, NOT A FILL. The brand appears only as a tinted selected state and a tinted
 * check; the chips and the one call to action are neutral ink, so the screen reads as a form rather
 * than a field of green buttons.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-5">
      <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{title}</p>
      {children}
    </section>
  );
}

/** The selected treatment on this screen: 10% brand wash, brand ink, a hairline of the same. */
const SELECTED: CSSProperties = {
  background: "rgba(132,204,22,0.10)",
  color: "var(--brand-dark)",
  border: "1px solid rgba(132,204,22,0.30)",
};
const RESTING: CSSProperties = {
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  border: "1px solid transparent",
};

export default function SearchFiltersPage() {
  const back = useAppBack();
  const base = useShellBase();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const isAdmin = base !== "/employee";

  const filters = useSearchFilters();
  const [rangeOpen, setRangeOpen] = useState(false);
  const customers = useCustomersStore((s) => s.customers);
  const companies = useCompaniesStore((s) => s.companies);
  const employees = useEmployeesStore((s) => s.employees);

  /** The chosen person can be either book; the row that owns it is the one that names it. */
  const chosen = useMemo(() => {
    if (!filters.personId) return { kind: null as "customer" | "supplier" | null, name: "" };
    if (customers.some((c) => c.id === filters.personId)) {
      return { kind: "customer" as const, name: filters.personName ?? "" };
    }
    if (companies.some((c) => c.id === filters.personId)) {
      return { kind: "supplier" as const, name: filters.personName ?? "" };
    }
    return { kind: null as "customer" | "supplier" | null, name: filters.personName ?? "" };
  }, [filters.personId, filters.personName, customers, companies]);

  /**
   * The ledgers' own six windows, in the ledgers' own words (owner, 2026-11-19). Copying the
   * labels rather than writing a second set is the point: "3M" on the sales history and "3M" here
   * have to mean the same ninety days, and a filter screen that called it "Last quarter" would be
   * a second definition to keep in step.
   */
  const PERIODS: { key: SearchPeriod; label: string }[] = [
    { key: "today", label: t("history.period1d") },
    { key: "week", label: t("history.period1w") },
    { key: "month", label: t("history.period1m") },
    { key: "quarter", label: t("history.period3m") },
    { key: "year", label: t("history.period1y") },
    { key: "custom", label: t("history.custom") },
  ];

  const PAYS: { key: SearchPayFilter; label: string }[] = [
    { key: "any", label: t("search.payAny") },
    { key: "paid", label: t("search.payPaid") },
    { key: "credit", label: t("search.payCredit") },
  ];

  const STOCKS: { key: SearchStockFilter; label: string }[] = [
    { key: "any", label: t("search.stockAny") },
    { key: "in", label: t("products.inStock") },
    { key: "low", label: t("products.lowStock") },
    { key: "out", label: t("products.outOfStock") },
  ];

  const SORTS: { key: SearchSort; label: string }[] = [
    { key: "relevance", label: t("search.sortRelevance") },
    { key: "recent", label: t("search.sortRecent") },
    { key: "amount", label: t("search.sortAmount") },
    { key: "name", label: t("search.sortName") },
  ];

  /** A person is a door, not a chip: the answer, then the screen that holds the whole list. */
  function PersonDoor({
    kind,
    icon: Icon,
    label,
    chosenName,
    testId,
  }: {
    kind: "customer" | "supplier";
    icon: LucideIcon;
    label: string;
    chosenName: string;
    testId: string;
  }) {
    const isChosen = chosen.kind === kind;
    return (
      <div className="flex items-center" style={{ borderBottom: "1px solid var(--divider)" }}>
        <button
          type="button"
          onClick={() => navigate(`${base}/search/filters/people?kind=${kind}`)}
          data-testid={testId}
          className="flex-1 min-w-0 flex items-center gap-3 ps-4 py-3 text-start ds-pressable"
        >
          <span
            className="size-9 rounded-full flex items-center justify-center shrink-0"
            style={isChosen ? SELECTED : RESTING}
          >
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-13 font-semibold block" style={{ color: "var(--text-primary)" }}>{label}</span>
            <span className="text-11 block truncate" style={{ color: isChosen ? "var(--brand-dark)" : "var(--text-secondary)" }}>
              {isChosen && chosenName ? chosenName : t("search.personAny")}
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
        </button>
        {isChosen && (
          <button
            type="button"
            onClick={() => filters.set({ personId: null, personName: null })}
            aria-label={t("common.clear")}
            data-testid={`${testId}-clear`}
            className="shrink-0 me-3 size-8 rounded-full flex items-center justify-center ds-pressable"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full pb-24"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("search.filtersTitle")} />

      {/* When — the ledgers' tab strip, to the pixel (owner, 2026-11-19: "add this date same
          filter on that screen"): one row, the chosen window underlined. It is the same six
          choices, in the same order, as `/history/sales`, so a window looks identical wherever it
          is chosen.

          Tapping the chosen window again clears it back to any time — the strip has no seventh
          slot for "Any time" at phone width, and a window that cannot be undone would be a filter
          you have to reset the whole form to escape. */}
      <div className="px-4 pt-4" data-testid="filter-periods" role="group" aria-label={t("search.filterPeriod")}>
        <div className="flex items-stretch justify-between" style={{ borderBottom: "1px solid var(--divider)" }}>
          {PERIODS.map(({ key, label }) => {
            const active = filters.period === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (key === "custom") {
                    setRangeOpen(true);
                    return;
                  }
                  filters.set({ period: active ? "any" : key });
                }}
                aria-pressed={active}
                data-testid={`filter-period-${key}`}
                className="relative flex-1 h-11 text-13 font-semibold"
                style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
                    style={{ background: "var(--text-primary)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {filters.period === "custom" && filters.customFrom && filters.customTo && (
          <p className="pt-2 text-11" style={{ color: "var(--text-secondary)" }} data-testid="filter-period-custom-value">
            {filters.customFrom} – {filters.customTo}
          </p>
        )}
      </div>

      {/* Who — two doors, each opening the whole book of that kind. */}
      <Section title={t("search.filterPerson")}>
        <ListCard>
          <PersonDoor
            kind="customer"
            icon={Users}
            label={t("search.customers")}
            chosenName={chosen.name}
            testId="filter-person-customer"
          />
          <PersonDoor
            kind="supplier"
            icon={Building2}
            label={t("search.supplier")}
            chosenName={chosen.name}
            testId="filter-person-supplier"
          />
        </ListCard>
      </Section>

      {/* Handled by — people again, so a row with a name and a tick, not a pill of initials. */}
      {isAdmin && employees.length > 0 && (
        <Section title={t("search.filterEmployee")}>
          <ListCard>
            <button
              type="button"
              onClick={() => filters.set({ employeeId: null, employeeName: null })}
              className="w-full flex items-center gap-3 px-4 py-3 text-start ds-pressable"
              data-testid="filter-employee-any"
            >
              <span className="size-8 rounded-full flex items-center justify-center shrink-0" style={RESTING}>
                <Users size={14} />
              </span>
              <span className="flex-1 text-13 font-medium" style={{ color: "var(--text-primary)" }}>{t("search.anyone")}</span>
              {!filters.employeeId && <Check size={15} style={{ color: "var(--brand-dark)" }} />}
            </button>
            {employees.filter((e) => e.isActive).map((employee) => {
              const active = filters.employeeId === employee.id;
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => filters.set({ employeeId: employee.id, employeeName: employee.name })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-start ds-pressable"
                  data-testid={`filter-employee-${employee.id}`}
                >
                  <span
                    className="size-8 rounded-full flex items-center justify-center shrink-0 text-11 font-bold"
                    style={active ? SELECTED : RESTING}
                  >
                    {employee.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0 text-13 font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {employee.name}
                  </span>
                  {active && <Check size={15} style={{ color: "var(--brand-dark)" }} />}
                </button>
              );
            })}
          </ListCard>
        </Section>
      )}

      {/* Payment — three equal tiles: the three answers are a state, not a list of names. */}
      <Section title={t("search.filterPay")}>
        <div className="grid grid-cols-3 gap-2">
          {PAYS.map(({ key, label }) => {
            const active = filters.pay === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => filters.set({ pay: key })}
                aria-pressed={active}
                className="h-12 rounded-[var(--radius-tile)] text-12 font-semibold ds-pressable"
                style={active ? SELECTED : RESTING}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Stock — four levels as tiles, because they are quantities on one scale, not names. */}
      <Section title={t("search.filterStock")}>
        <div className="grid grid-cols-2 gap-2">
          {STOCKS.map(({ key, label }) => {
            const active = filters.stock === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => filters.set({ stock: key })}
                aria-pressed={active}
                className="h-11 rounded-[var(--radius-tile)] text-12 font-semibold ds-pressable"
                style={active ? SELECTED : RESTING}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Order — one answer with a reason, so a radio row says why it is the answer. */}
      <Section title={t("search.filterSort")}>
        <ListCard>
          {SORTS.map(({ key, label }) => {
            const active = filters.sort === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => filters.set({ sort: key })}
                aria-pressed={active}
                className="w-full flex items-center gap-3 px-4 py-3 text-start ds-pressable"
                data-testid={`filter-sort-${key}`}
              >
                <span
                  className="size-4 rounded-full shrink-0 flex items-center justify-center"
                  style={{
                    border: active ? "5px solid var(--brand)" : "1.5px solid var(--divider)",
                    background: "var(--surface)",
                  }}
                />
                <span className="flex-1 text-13 font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
              </button>
            );
          })}
        </ListCard>
      </Section>

      {/* The hand-picked window asks in the sheet the ledgers already use, so a range is entered
          the same way on both screens and a half-typed one is discarded on close. */}
      <DateRangeSheet
        open={rangeOpen}
        from={filters.customFrom ?? ""}
        to={filters.customTo ?? ""}
        max={pkToday()}
        onClose={() => setRangeOpen(false)}
        onApply={(from, to) => {
          filters.set({ period: "custom", customFrom: from, customTo: to });
          setRangeOpen(false);
        }}
        onClear={() => {
          filters.set({ period: "any", customFrom: null, customTo: null });
          setRangeOpen(false);
        }}
      />

      <div
        className="fixed start-0 end-0 bottom-0 max-w-[480px] mx-auto p-4 flex gap-2"
        style={{ background: "var(--background)", borderTop: "1px solid var(--divider)" }}
      >
        <button
          type="button"
          onClick={() => filters.reset()}
          className="h-12 px-5 rounded-[var(--radius-tile)] text-sm font-semibold ds-pressable"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
          {t("search.resetFilters")}
        </button>
        {/* Neutral ink, not brand green: the one call to action on a form should read as the
            answer, and green belongs to the selected state above it (owner, 2026-11-19). */}
        <button
          type="button"
          onClick={back}
          className="flex-1 h-12 rounded-[var(--radius-tile)] text-sm font-semibold ds-pressable"
          style={{ background: "var(--text-primary)", color: "var(--background)" }}
        >
          {t("search.applyFilters")}
        </button>
      </div>
    </div>
  );
}
