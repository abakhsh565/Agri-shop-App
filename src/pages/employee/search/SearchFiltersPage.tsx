import { useMemo, useState, type ReactNode } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import Photo from "@/components/ui/Photo";
import Button from "@/components/ui/Button";
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
import { Check } from "lucide-react";

/**
 * The search screen's filters, on a screen of their own (owner, 2026-11-17).
 *
 * The owner asked for a filter that opens, rather than a pill row that keeps growing: what a
 * shopkeeper narrows by is not the same list as what a developer finds cheap to render — the
 * period, the person, the member of staff, whether the money came in, and how much stock is left.
 * Each is one question with a small, named set of answers, so each gets a chip row and the whole
 * thing stays scannable in one screenful.
 *
 * The choices are written straight into the shared store, so Apply is a way back rather than a
 * commit step; Reset is the one action that has to undo something. That is why there is no
 * "discard" — leaving by the back arrow keeps what was chosen, which is what a filter screen
 * entered twice in a row is usually for.
 */
/** One question and its answers, drawn the same way six times. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-5">
      <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{title}</p>
      {children}
    </section>
  );
}

export default function SearchFiltersPage() {
  const back = useAppBack();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const isAdmin = base !== "/employee";

  const filters = useSearchFilters();
  const customers = useCustomersStore((s) => s.customers);
  const companies = useCompaniesStore((s) => s.companies);
  const employees = useEmployeesStore((s) => s.employees);

  const [personSearch, setPersonSearch] = useState("");

  /** Customers first, then suppliers: a sale is narrowed by a buyer far more often than a vendor. */
  const people = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    const list = [
      ...customers
        .filter((c) => !c.isArchived)
        .map((c) => ({
          id: c.id,
          name: c.name,
          hint: c.phone,
          imageUrl: c.imageUrl,
          kind: t("search.customers"),
        })),
      ...companies.map((c) => ({
        id: c.id,
        name: c.name,
        hint: c.contactPerson || c.phone || "",
        // A supplier has no portrait in this app; the row falls back to its initial.
        imageUrl: undefined as string | undefined,
        kind: t("search.companies"),
      })),
    ];
    const matched = q
      ? list.filter((p) => p.name.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q))
      : list;
    return matched.slice(0, 40);
  }, [customers, companies, personSearch, t]);

  const PERIODS: { key: SearchPeriod; label: string }[] = [
    { key: "any", label: t("search.periodAny") },
    { key: "today", label: t("search.periodToday") },
    { key: "week", label: t("search.periodWeek") },
    { key: "month", label: t("search.periodMonth") },
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

  const chip = (selected: boolean) => ({
    background: selected ? "var(--brand)" : "var(--surface-2)",
    color: selected ? "#0a0a0a" : "var(--text-secondary)",
  });

  return (
    <div
      className="flex flex-col w-full min-h-full pb-24"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("search.filtersTitle")} />

      <Section title={t("search.filterPeriod")}>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => filters.set({ period: key })}
              aria-pressed={filters.period === key}
              className="h-8 px-4 rounded-full text-xs font-medium transition-colors"
              style={chip(filters.period === key)}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("search.filterPerson")}>
        <SearchBar
          value={personSearch}
          onChange={(e) => setPersonSearch(e.target.value)}
          onClear={() => setPersonSearch("")}
          placeholder={t("search.filterPersonHint")}
        />
        <div className="mt-2 rounded-[var(--radius-tile)] overflow-hidden" style={{ background: "var(--tone-card)" }}>
          {people.length === 0 ? (
            <p className="px-4 py-4 text-12" style={{ color: "var(--text-secondary)" }}>
              {t("search.filterNoPeople")}
            </p>
          ) : (
            <div className="max-h-[220px] overflow-y-auto">
              {people.map((p) => {
                const selected = filters.personId === p.id;
                return (
                  <button
                    key={`${p.kind}-${p.id}`}
                    type="button"
                    onClick={() =>
                      filters.set(
                        selected
                          ? { personId: null, personName: null }
                          : { personId: p.id, personName: p.name },
                      )
                    }
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-start"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                  >
                    <div
                      className="size-8 rounded-full overflow-hidden flex items-center justify-center text-11 font-bold shrink-0"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      <Photo
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-full h-full object-cover"
                        fallback={p.name.charAt(0).toUpperCase()}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-13 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                      <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                        {p.kind}{p.hint ? ` · ${p.hint}` : ""}
                      </p>
                    </div>
                    {selected && <Check size={15} style={{ color: "var(--brand-dark)" }} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {isAdmin && employees.length > 0 && (
        <Section title={t("search.filterEmployee")}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => filters.set({ employeeId: null, employeeName: null })}
              className="h-8 px-4 rounded-full text-xs font-medium"
              style={chip(!filters.employeeId)}
            >
              {t("search.anyone")}
            </button>
            {employees.filter((e) => e.isActive).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => filters.set({ employeeId: e.id, employeeName: e.name })}
                className="h-8 px-4 rounded-full text-xs font-medium max-w-[180px] truncate"
                style={chip(filters.employeeId === e.id)}
              >
                {e.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title={t("search.filterPay")}>
        <div className="flex flex-wrap gap-2">
          {PAYS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => filters.set({ pay: key })}
              className="h-8 px-4 rounded-full text-xs font-medium"
              style={chip(filters.pay === key)}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("search.filterStock")}>
        <div className="flex flex-wrap gap-2">
          {STOCKS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => filters.set({ stock: key })}
              className="h-8 px-4 rounded-full text-xs font-medium"
              style={chip(filters.stock === key)}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("search.filterSort")}>
        <div className="flex flex-wrap gap-2">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => filters.set({ sort: key })}
              className="h-8 px-4 rounded-full text-xs font-medium"
              style={chip(filters.sort === key)}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

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
        <div className="flex-1">
          <Button fullWidth onClick={back}>{t("search.applyFilters")}</Button>
        </div>
      </div>
    </div>
  );
}
