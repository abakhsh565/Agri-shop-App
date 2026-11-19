import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, Check, ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import Photo from "@/components/ui/Photo";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useAppBack } from "@/hooks/useAppBack";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { matchesSearch } from "@/lib/searchText";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useSearchFilters } from "@/stores/searchFiltersStore";

type SortKey = "name" | "nameDesc" | "owed" | "recent";

/**
 * Everyone on the shop's books, for one filter question.
 *
 * The filter screen used to inline forty people in a 220px scroller, which is not a
 * place to shop for a customer: the list could not be sorted, "most owed" was
 * unreachable, and the section itself was dwarfed by the six questions around it.
 * Choosing a customer (or a supplier) is its own task, so it gets its own screen —
 * the whole height of the phone, one search, a sort, and every account with its own
 * picture. The filter screen keeps only the answer.
 */
export default function SearchPersonPickerPage() {
  const back = useAppBack();
  const t = useT();
  const [params] = useSearchParams();
  const kind: "customer" | "supplier" = params.get("kind") === "supplier" ? "supplier" : "customer";

  const filters = useSearchFilters();
  const customers = useCustomersStore((s) => s.customers);
  const companies = useCompaniesStore((s) => s.companies);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [sortOpen, setSortOpen] = useState(false);

  const SORTS: { key: SortKey; label: string }[] = [
    { key: "name", label: t("search.sortName") },
    { key: "nameDesc", label: t("search.sortNameDesc") },
    { key: "owed", label: t("search.sortOwed") },
    { key: "recent", label: t("search.sortRecent") },
  ];

  const people = useMemo(() => {
    const list =
      kind === "customer"
        ? customers
            .filter((c) => !c.isArchived)
            .map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              imageUrl: c.imageUrl,
              balance: c.outstandingBalance,
              createdAt: c.createdAt,
            }))
        : companies.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.contactPerson || c.phone || "",
            imageUrl: c.logoUrl,
            balance: c.outstandingPayable,
            createdAt: c.createdAt,
          }));

    const matched = list.filter((person) =>
      matchesSearch(query, [person.name, person.phone]),
    );

    return matched.sort((a, b) => {
      if (sort === "nameDesc") return b.name.localeCompare(a.name);
      if (sort === "owed") return b.balance - a.balance;
      if (sort === "recent") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return a.name.localeCompare(b.name);
    });
  }, [kind, customers, companies, query, sort]);

  function choose(person: { id: string; name: string }) {
    filters.set({ personId: person.id, personName: person.name });
    back();
  }

  function clear() {
    filters.set({ personId: null, personName: null });
    back();
  }

  const title = kind === "customer" ? t("search.chooseCustomer") : t("search.chooseSupplier");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)" }}
      data-testid={`person-picker-${kind}`}
    >
      <StatusBar />
      <NavHeader title={title} />

      <div className="px-4 pt-2 flex items-center gap-2">
        <SearchBar
          containerClass="flex-1 min-w-0"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("search.filterPersonHint")}
          aria-label={t("search.filterPersonHint")}
          data-testid="person-picker-search"
        />
        <button
          type="button"
          onClick={() => setSortOpen((open) => !open)}
          aria-label={t("search.filterSort")}
          aria-expanded={sortOpen}
          data-testid="person-picker-sort"
          className="size-10 rounded-full flex items-center justify-center shrink-0 ds-pressable"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
          <ArrowDownWideNarrow size={16} />
        </button>
      </div>

      {sortOpen && (
        <div className="px-4 pt-2">
          <ListCard>
            {SORTS.map((option) => (
              <ListRow
                key={option.key}
                title={option.label}
                testId={`person-sort-${option.key}`}
                onClick={() => {
                  setSort(option.key);
                  setSortOpen(false);
                }}
                trailing={
                  sort === option.key ? (
                    <Check size={15} style={{ color: "var(--brand-dark)" }} />
                  ) : undefined
                }
              />
            ))}
          </ListCard>
        </div>
      )}

      <div className="px-4 pt-3 pb-8">
        <button
          type="button"
          onClick={clear}
          data-testid="person-picker-any"
          className="w-full flex items-center justify-between px-4 h-12 rounded-[var(--radius-tile)] mb-2 ds-pressable"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
          <span className="text-13 font-semibold">{t("search.personAny")}</span>
          {!filters.personId && <Check size={15} style={{ color: "var(--brand-dark)" }} />}
        </button>

        {people.length === 0 ? (
          <p className="px-1 py-8 text-12 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("search.filterNoPeople")}
          </p>
        ) : (
          <ListCard>
            {people.map((person) => {
              const selected = filters.personId === person.id;
              return (
                <ListRow
                  key={person.id}
                  testId={`person-picker-${person.id}`}
                  onClick={() => choose(person)}
                  tile={
                    <div
                      className="size-10 rounded-full overflow-hidden flex items-center justify-center text-12 font-bold shrink-0"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      <Photo
                        src={person.imageUrl}
                        alt={person.name}
                        className="w-full h-full object-cover"
                        fallback={person.name.charAt(0).toUpperCase()}
                      />
                    </div>
                  }
                  trailing={
                    <div className="flex items-center gap-2 shrink-0">
                      {person.balance > 0 && (
                        <span className="text-11 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {formatCurrency(person.balance)}
                        </span>
                      )}
                      {selected ? (
                        <Check size={15} style={{ color: "var(--brand-dark)" }} />
                      ) : (
                        <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} />
                      )}
                    </div>
                  }
                >
                  <div className="min-w-0">
                    <p className="text-13 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {person.name}
                    </p>
                    <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                      {person.phone || (kind === "customer" ? t("search.customers") : t("search.companies"))}
                    </p>
                  </div>
                </ListRow>
              );
            })}
          </ListCard>
        )}
      </div>

      {/* The footer carries the one answer already chosen, so the screen can be left without
          picking a new person and still say what the filter currently is. */}
      <div className="mt-auto px-4 pb-6">
        <button
          type="button"
          onClick={back}
          className="w-full h-12 rounded-full text-13 font-semibold ds-pressable"
          style={{ background: "var(--text-primary)", color: "var(--background)" }}
        >
          {t("search.applyFilters")}
        </button>
      </div>
    </div>
  );
}
