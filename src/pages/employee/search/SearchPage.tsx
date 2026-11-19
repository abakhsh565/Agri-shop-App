import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { useCustomersStore } from "@/stores/customersStore";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { useAppBack } from "@/hooks/useAppBack";
import { formatCurrency, productLowStockThreshold } from "@/lib/formatters";
import {
  ArrowLeftRight,
  Building2,
  ChevronLeft,
  LayoutGrid,
  Package,
  ReceiptText,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Undo2,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import {
  countActiveFilters,
  periodStart,
  useSearchFilters,
} from "@/stores/searchFiltersStore";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { hasPermission } from "@/lib/tenantContext";
import { APP_DESTINATIONS, destinationKeywords } from "@/lib/appSearchIndex";
import { matchesSearch } from "@/lib/searchText";
import { searchDocuments } from "@/lib/globalSearch";

type FilterType =
  | "all"
  | "product"
  | "customer"
  | "sale"
  | "employee"
  | "company"
  | "module"
  | "invoice"
  | "purchase"
  | "payment"
  | "return"
  | "stock";

interface SearchResult {
  id: string;
  type: FilterType;
  title: string;
  subtitle: string;
  badge?: string;
  path: string;
}

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

const FILTER_CHIPS_BASE: { key: FilterType; labelKey: string; icon: any }[] = [
  { key: "all",      labelKey: "search.all",       icon: Search },
  { key: "product",  labelKey: "search.products",  icon: Package },
  { key: "customer", labelKey: "search.customers", icon: Users },
  { key: "sale",     labelKey: "search.sales",     icon: ShoppingCart },
  { key: "module",   labelKey: "search.modules",   icon: LayoutGrid },
  { key: "invoice",  labelKey: "search.invoices",  icon: ReceiptText },
  { key: "purchase", labelKey: "search.purchases", icon: Truck },
  { key: "payment",  labelKey: "search.payments",  icon: Wallet },
];

const ADMIN_EXTRA_FILTERS_BASE = [
  { key: "employee" as FilterType, labelKey: "search.employees", icon: UserCog },
  { key: "company"  as FilterType, labelKey: "search.companies", icon: Building2 },
];

export default function SearchPage() {
  const navigate = useNavigate();
  const back = useAppBack();
  const base = useShellBase();
  // Co-Owners get the wider catalogue too; every route they open has its own permission gate.
  const isAdmin = base !== "/employee";
  const teamBase = base === "/co-owner" ? `${base}/team` : `${base}/employees`;
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();

  const FILTER_CHIPS = FILTER_CHIPS_BASE.map((f) => ({ ...f, label: t(f.labelKey as any) }));
  const ADMIN_EXTRA_FILTERS = ADMIN_EXTRA_FILTERS_BASE.map((f) => ({ ...f, label: t(f.labelKey as any) }));

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [docResults, setDocResults] = useState<SearchResult[]>([]);
  // `searchDocuments` is called from an effect; a ref keeps the translator out of its deps so a
  // new function identity each render cannot restart the request.
  const translate = useRef(t);
  translate.current = t;
  // The narrowing that is not a result type — period, person, staff, payment, stock. It lives on
  // its own screen and in its own store, so this screen only has to apply it.
  const filters = useSearchFilters();
  const activeFilterCount = countActiveFilters(filters);

  const { user } = useAuthStore();
  const products = useProductsStore((s) => s.products);
  const customers = useCustomersStore((s) => s.customers);
  const allSales = useSalesStore((s) => s.sales);
  const employees = useEmployeesStore((s) => s.employees);
  const companies = useCompaniesStore((s) => s.companies);

  // Employee sees only their own sales
  const sales = isAdmin
    ? allSales
    : allSales.filter((s) => s.employeeId === user?.id || s.employeeName === user?.name);

  const q = query.toLowerCase().trim();

  /** Every screen and setting, matched by its English and Urdu names and its shop synonyms. */
  const moduleResults: SearchResult[] = useMemo(() => {
    if (!q || base === "/co-owner") return [];
    return APP_DESTINATIONS.filter((entry) => {
      if (entry.adminOnly && !isAdmin) return false;
      if (entry.employeeOnly && isAdmin) return false;
      if (entry.permission && !hasPermission(entry.permission)) return false;
      return matchesSearch(q, destinationKeywords(entry));
    })
      .slice(0, 12)
      .map((entry) => ({
        id: `module-${entry.id}`,
        type: "module" as FilterType,
        title: language === "ur" ? entry.ur : entry.en,
        subtitle: t("search.screen"),
        path: `${base}${!isAdmin && entry.employeePath ? entry.employeePath : entry.path}`,
      }));
  }, [q, base, isAdmin, language, t]);

  /** The books that live only in the database: bills, purchases, refunds, payments, stock. */
  useEffect(() => {
    let alive = true;
    if (q.length < 2) {
      setDocResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchDocuments(query, { base, isAdmin, t: translate.current })
        .then((hits) => {
          if (!alive) return;
          setDocResults(
            hits.map((hit) => ({
              id: hit.id,
              type: hit.group,
              title: hit.title,
              subtitle: hit.subtitle,
              badge: hit.badge,
              path: hit.path,
            })),
          );
        })
        .catch(() => {
          if (alive) setDocResults([]);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, query, base, isAdmin]);

  const results: SearchResult[] = useMemo(() => {
    // A filter is a question of its own: a period with no keyword still answers "what came in
    // today", which is the reason the filter screen exists.
    if (!q && activeFilterCount === 0) return [];

    const startsAt = periodStart(filters.period);
    const inPeriod = (iso: string | null | undefined) =>
      !startsAt || (!!iso && new Date(iso) >= startsAt);

    const items: SearchResult[] = [];

    // Products
    if (activeFilter === "all" || activeFilter === "product") {
      products
        .filter((p) => matchesSearch(query, [p.name, p.company]))
        .filter((p) => {
          if (filters.stock === "any") return true;
          if (filters.stock === "in") return p.stockQty > 0;
          if (filters.stock === "low") return p.stockQty > 0 && p.stockQty <= productLowStockThreshold(p.variants);
          return p.stockQty <= 0;
        })
        .forEach((p) => {
          const totalStock = p.stockQty;
          items.push({
            id: p.id,
            type: "product",
            title: p.name,
            subtitle: `${p.company || t('search.unknownSupplier')} · ${p.variants.length} ${t('products.variants')}`,
            badge: `${totalStock} ${t('common.units')}`,
            path: `${base}/products/${p.id}`,
          });
        });
    }

    // Customers
    if (activeFilter === "all" || activeFilter === "customer") {
      customers
        .filter((c) => matchesSearch(query, [c.name, c.phone]))
        .filter((c) => !filters.personId || c.id === filters.personId)
        .forEach((c) => {
          items.push({
            id: c.id,
            type: "customer",
            title: c.name,
            subtitle: c.phone,
            badge: c.outstandingBalance > 0 ? formatCurrency(c.outstandingBalance) : undefined,
            path: `${base}/customers/${c.id}`,
          });
        });
    }

    // Sales
    if (activeFilter === "all" || activeFilter === "sale") {
      [
        ...sales.filter((s) =>
          matchesSearch(query, [s.customerName, s.saleNumber, s.employeeName, s.note, formatCurrency(s.totalAmount)]),
        ),
      ]
        .filter((s) => inPeriod(s.createdAt))
        .filter((s) => !filters.personId || s.customerId === filters.personId)
        .filter((s) => !filters.employeeId || s.employeeId === filters.employeeId)
        .filter((s) =>
          filters.pay === "any"
            ? true
            : filters.pay === "credit"
              ? s.outstandingBalance > 0
              : s.outstandingBalance <= 0,
        )
        .sort((a, b) => {
          if (filters.sort === "amount") return b.totalAmount - a.totalAmount;
          if (filters.sort === "name") return (a.customerName ?? "").localeCompare(b.customerName ?? "");
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .forEach((s) => {
          items.push({
            id: s.id,
            type: "sale",
            title: `${s.customerName} · ${s.saleNumber}`,
            subtitle: `${s.employeeName} · ${new Date(s.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}`,
            badge: formatCurrency(s.totalAmount),
            path: `${base}/sales/${s.id}`,
          });
        });
    }

    // Employees (admin only)
    if (isAdmin && (activeFilter === "all" || activeFilter === "employee")) {
      employees
        .filter((e) => matchesSearch(query, [e.name, e.phone, e.jobTitle]))
        .filter((e) => !filters.employeeId || e.id === filters.employeeId)
        .forEach((e) => {
          items.push({
            id: e.id,
            type: "employee",
            title: e.name,
            subtitle: e.jobTitle || t("search.employee"),
            badge: e.isActive ? undefined : t("search.inactive"),
            path: `${teamBase}/${e.id}`,
          });
        });
    }

    // Companies (admin only)
    if (isAdmin && (activeFilter === "all" || activeFilter === "company")) {
      companies
        .filter((c) => matchesSearch(query, [c.name, c.phone, c.contactPerson]))
        .filter((c) => !filters.personId || c.id === filters.personId)
        .forEach((c) => {
          items.push({
            id: c.id,
            type: "company",
            title: c.name,
            subtitle: c.contactPerson || t("search.supplier"),
            badge: c.outstandingPayable > 0 ? formatCurrency(c.outstandingPayable) : undefined,
            path: `${base}/companies/${c.id}`,
          });
        });
    }

    // Records before rooms: a bill number should answer with the bill, not with the screens that
    // happen to mention invoices.
    const extras = [...docResults, ...moduleResults].filter(
      (hit) =>
        activeFilter === "all" ||
        hit.type === activeFilter ||
        (activeFilter === "sale" && hit.type === "return") ||
        (activeFilter === "product" && hit.type === "stock"),
    );
    return [...items, ...extras];
  }, [
    q,
    activeFilter,
    products,
    customers,
    sales,
    employees,
    companies,
    isAdmin,
    base,
    filters,
    activeFilterCount,
    moduleResults,
    docResults,
  ]);

  // Group results by type
  const grouped = useMemo(() => {
    const map = new Map<FilterType, SearchResult[]>();
    for (const r of results) {
      const arr = map.get(r.type) ?? [];
      arr.push(r);
      map.set(r.type, arr);
    }
    return map;
  }, [results]);

  const QUICK_ACCESS = isAdmin
    ? [
        { label: t("search.products"),  path: `${base}/products`,  icon: Package },
        { label: t("search.customers"), path: `${base}/customers`, icon: Users },
        { label: t("search.sales"),     path: `${base}/sales`,     icon: ShoppingCart },
        { label: t("search.employees"), path: teamBase,            icon: UserCog },
        { label: t("search.companies"), path: `${base}/companies`, icon: Building2 },
      ]
    : [
        { label: t("search.products"),  path: `${base}/products`,  icon: Package },
        { label: t("search.customers"), path: `${base}/customers`, icon: Users },
        { label: t("search.sales"),     path: `${base}/sales`,     icon: ShoppingCart },
      ];

  const ALL_FILTERS = isAdmin
    ? [...FILTER_CHIPS, ...ADMIN_EXTRA_FILTERS]
    : FILTER_CHIPS;

  const SECTION_LABELS: Record<FilterType, string> = {
    all: t("search.results"),
    product: t("search.products"),
    customer: t("search.customers"),
    sale: t("search.sales"),
    employee: t("search.employees"),
    company: t("search.companies"),
    module: t("search.modules"),
    invoice: t("search.invoices"),
    purchase: t("search.purchases"),
    payment: t("search.payments"),
    return: t("search.returns"),
    stock: t("search.stock"),
  };

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-3">
        <button
          onClick={back}
          className="size-9 rounded-full flex items-center justify-center shrink-0 active:opacity-70"
          style={{ background: "var(--surface-2)" }}
        >
          <ChevronLeft size={18} style={{ color: "var(--text-primary)" }} />
        </button>
        <SearchBar
          containerClass="flex-1 min-w-0"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={isAdmin ? t("search.placeholderAdmin") : t("search.placeholderEmployee")}
        />
      </div>

      {/* Result-type pills, then the door to the rest of the narrowing. The type is what is on
          this screen's one row; period, person, staff, payment and stock are a screen of their
          own, because six more chips here would be a wall rather than a row. */}
      {(q || activeFilterCount > 0) && (
        <div className="flex items-center gap-2 px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
            {ALL_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                className="shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors"
                style={{
                  background: activeFilter === key ? "var(--brand)" : "var(--surface-2)",
                  color: activeFilter === key ? "#0a0a0a" : "var(--text-secondary)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate(`${base}/search/filters`)}
            data-testid="search-filters"
            className="shrink-0 h-8 px-3 rounded-full flex items-center gap-1.5 text-xs font-semibold"
            style={{
              background: activeFilterCount > 0 ? "var(--text-primary)" : "var(--surface-2)",
              color: activeFilterCount > 0 ? "var(--background)" : "var(--text-primary)",
            }}
          >
            <SlidersHorizontal size={13} />
            {t("search.filters")}
            {activeFilterCount > 0 && (
              <span
                className="min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-10 font-bold"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Quick access — when nothing is being looked for yet */}
      {!q && activeFilterCount === 0 && (
        <div className="px-4 pt-2">
          <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("search.quickAccess")}
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACCESS.map(({ label, path, icon: Icon }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="flex items-center gap-2 h-9 px-4 rounded-full text-xs font-medium transition-colors"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results — grouped by category */}
      {q && results.length > 0 && (
        <div className="px-4 pt-2 pb-24">
          <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            {t(results.length === 1 ? "search.resultOne" : "search.resultsFor")
              .replace("{count}", String(results.length))
              .replace("{query}", query)}
          </p>
          {Array.from(grouped.entries()).map(([type, items]) => (
            <div key={type} className="mb-4">
              <p className="ds-section-label mb-2 flex items-center gap-2" style={{ color: "var(--brand-dark)" }}>
                {SECTION_LABELS[type]}
                <span className="text-10 font-normal" style={{ color: "var(--text-secondary)" }}>
                  ({items.length})
                </span>
              </p>
              <ListCard>
                {items.map((r) => (
                  <ListRow
                    key={r.id + r.type}
                    onClick={() => navigate(r.path)}
                    tile={
                      r.type === "customer" || r.type === "employee" ? (
                        <div
                          className="size-9 rounded-full shrink-0 flex items-center justify-center text-11 font-bold"
                          style={{ background: initBgColor(r.title), color: "#fff" }}
                        >
                          {r.title.charAt(0).toUpperCase()}
                        </div>
                      ) : (
                        <div
                          className="size-9 rounded-[var(--radius-tile)] shrink-0 flex items-center justify-center"
                          style={{ background: "var(--surface-2)" }}
                        >
                          {r.type === "product" ? (
                            <Package size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "sale" ? (
                            <ShoppingCart size={14} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "invoice" ? (
                            <ReceiptText size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "purchase" ? (
                            <Truck size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "payment" ? (
                            <Wallet size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "module" ? (
                            <LayoutGrid size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "return" ? (
                            <Undo2 size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : r.type === "stock" ? (
                            <ArrowLeftRight size={15} style={{ color: "var(--text-secondary)" }} />
                          ) : (
                            <Building2 size={14} style={{ color: "var(--text-secondary)" }} />
                          )}
                        </div>
                      )}
                    trailing={r.badge ? (
                      <span
                        className="text-11 font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                      >
                        {r.badge}
                      </span>
                    ) : undefined}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{r.title}</p>
                      <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{r.subtitle}</p>
                    </div>
                  </ListRow>
                ))}
              </ListCard>
            </div>
          ))}
        </div>
      )}

      {/* A filter with no keyword: say what the list is, not what was typed. */}
      {!q && activeFilterCount > 0 && results.length > 0 && (
        <div className="px-4 pt-2 pb-24">
          <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("search.filteredResults", { count: results.length })}
          </p>
          {Array.from(grouped.entries()).map(([type, items]) => (
            <div key={type} className="mb-4">
              <p className="ds-section-label mb-2 flex items-center gap-2" style={{ color: "var(--brand-dark)" }}>
                {SECTION_LABELS[type]}
                <span className="text-10 font-normal" style={{ color: "var(--text-secondary)" }}>({items.length})</span>
              </p>
              <ListCard>
                {items.map((r) => (
                  <ListRow
                    key={r.id + r.type}
                    onClick={() => navigate(r.path)}
                    trailing={r.badge ? (
                      <span
                        className="text-11 font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                      >
                        {r.badge}
                      </span>
                    ) : undefined}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{r.title}</p>
                      <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{r.subtitle}</p>
                    </div>
                  </ListRow>
                ))}
              </ListCard>
            </div>
          ))}
        </div>
      )}

      {/* No results */}
      {(q || activeFilterCount > 0) && results.length === 0 && (
        <div className="flex flex-col items-center gap-2 pt-16 text-center px-6">
          <div className="size-14 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
            <Search size={22} style={{ color: "var(--text-secondary)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {q
              ? t("search.noResults", `No results for "${query}"`).replace("{query}", query)
              : t("search.filterNoResults")}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("search.tryDifferent")}
          </p>
        </div>
      )}
    </div>
  );
}
