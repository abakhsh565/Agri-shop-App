import { useState, useMemo } from "react";
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
import { formatCurrency } from "@/lib/formatters";
import { Search, X, Package, Users, ShoppingCart, Building2, UserCog } from "lucide-react";

type FilterType = "all" | "product" | "customer" | "sale" | "employee" | "company";

interface SearchResult {
  id: string;
  type: FilterType;
  title: string;
  subtitle: string;
  badge?: string;
  path: string;
}

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

const FILTER_CHIPS: { key: FilterType; label: string; icon: any }[] = [
  { key: "all",      label: "All",       icon: Search },
  { key: "product",  label: "Products",  icon: Package },
  { key: "customer", label: "Customers", icon: Users },
  { key: "sale",     label: "Sales",     icon: ShoppingCart },
];

const ADMIN_EXTRA_FILTERS = [
  { key: "employee" as FilterType, label: "Employees", icon: UserCog },
  { key: "company"  as FilterType, label: "Companies", icon: Building2 },
];

export default function SearchPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const isAdmin = base === "/admin";
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

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

  const results: SearchResult[] = useMemo(() => {
    if (!q) return [];

    const items: SearchResult[] = [];

    // Products
    if (activeFilter === "all" || activeFilter === "product") {
      products
        .filter((p) => p.name.toLowerCase().includes(q) || p.company.toLowerCase().includes(q))
        .forEach((p) => {
          const totalStock = p.stockQty;
          items.push({
            id: p.id,
            type: "product",
            title: p.name,
            subtitle: `${p.company} · ${p.variants.length} variants`,
            badge: `${totalStock} units`,
            path: isAdmin ? `/admin/products/${p.id}` : `${base}/products/${p.id}`,
          });
        });
    }

    // Customers
    if (activeFilter === "all" || activeFilter === "customer") {
      customers
        .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
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
      sales
        .filter(
          (s) =>
            s.customerName.toLowerCase().includes(q) ||
            s.saleNumber.toLowerCase().includes(q) ||
            s.employeeName.toLowerCase().includes(q) ||
            formatCurrency(s.totalAmount).toLowerCase().includes(q)
        )
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
        .filter((e) => e.name.toLowerCase().includes(q) || e.phone?.includes(q))
        .forEach((e) => {
          items.push({
            id: e.id,
            type: "employee",
            title: e.name,
            subtitle: e.jobTitle || "Employee",
            badge: e.isActive ? undefined : "Inactive",
            path: `/admin/employees/${e.id}`,
          });
        });
    }

    // Companies (admin only)
    if (isAdmin && (activeFilter === "all" || activeFilter === "company")) {
      companies
        .filter((c) => c.name.toLowerCase().includes(q) || c.phone?.includes(q))
        .forEach((c) => {
          items.push({
            id: c.id,
            type: "company",
            title: c.name,
            subtitle: c.contactPerson || "Supplier",
            badge: c.outstandingPayable > 0 ? formatCurrency(c.outstandingPayable) : undefined,
            path: `/admin/companies/${c.id}`,
          });
        });
    }

    return items;
  }, [q, activeFilter, products, customers, sales, employees, companies, isAdmin, base]);

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
        { label: "Products",  path: "/admin/products",  icon: Package },
        { label: "Customers", path: "/admin/customers", icon: Users },
        { label: "Sales",     path: "/admin/sales",     icon: ShoppingCart },
        { label: "Employees", path: "/admin/employees", icon: UserCog },
        { label: "Companies", path: "/admin/companies", icon: Building2 },
      ]
    : [
        { label: "Products",  path: `${base}/products`,  icon: Package },
        { label: "Customers", path: `${base}/customers`, icon: Users },
        { label: "Sales",     path: `${base}/sales`,     icon: ShoppingCart },
      ];

  const ALL_FILTERS = isAdmin
    ? [...FILTER_CHIPS, ...ADMIN_EXTRA_FILTERS]
    : FILTER_CHIPS;

  const SECTION_LABELS: Record<FilterType, string> = {
    all: "Results",
    product: "Products",
    customer: "Customers",
    sale: "Sales",
    employee: "Employees",
    company: "Companies",
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
          onClick={() => navigate(-1)}
          className="text-sm font-medium shrink-0"
          style={{ color: "var(--text-primary)" }}
        >
          ←
        </button>
        <div
          className="flex-1 flex items-center gap-2 h-11 rounded-full px-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <Search size={14} style={{ color: "var(--text-secondary)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAdmin ? "Search products, customers, sales, employees..." : "Search products, customers, sales..."}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {query && (
            <button onClick={() => setQuery("")}>
              <X size={14} style={{ color: "var(--text-secondary)" }} />
            </button>
          )}
        </div>
      </div>

      {/* Filter pills — only show when searching */}
      {q && (
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
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
      )}

      {/* Quick access — when no query */}
      {!q && (
        <div className="px-4 pt-2">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Quick Access
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
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
          </p>
          {Array.from(grouped.entries()).map(([type, items]) => (
            <div key={type} className="mb-4">
              <p className="text-[11px] font-bold uppercase mb-2 tracking-wider flex items-center gap-2" style={{ color: "var(--brand-dark)" }}>
                {SECTION_LABELS[type]}
                <span className="text-[10px] font-normal" style={{ color: "var(--text-secondary)" }}>
                  ({items.length})
                </span>
              </p>
              <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
                {items.map((r, i) => (
                  <button
                    key={r.id + r.type}
                    onClick={() => navigate(r.path)}
                    className="flex items-center justify-between px-4 py-3.5 w-full text-left transition-opacity active:opacity-70"
                    style={{
                      borderBottom: i < items.length - 1 ? "1px solid var(--divider)" : "none",
                      background: "var(--background)",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {r.type === "product" ? (
                        <div
                          className="size-9 rounded-[10px] shrink-0 flex items-center justify-center text-[11px] font-bold"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                        >
                          <Package size={15} />
                        </div>
                      ) : r.type === "customer" ? (
                        <div
                          className="size-9 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                          style={{ background: initBgColor(r.title), color: "#fff" }}
                        >
                          {r.title.charAt(0).toUpperCase()}
                        </div>
                      ) : r.type === "sale" ? (
                        <div
                          className="size-9 rounded-full shrink-0 flex items-center justify-center"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <ShoppingCart size={14} style={{ color: "var(--text-secondary)" }} />
                        </div>
                      ) : r.type === "employee" ? (
                        <div
                          className="size-9 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                          style={{ background: initBgColor(r.title), color: "#fff" }}
                        >
                          {r.title.charAt(0).toUpperCase()}
                        </div>
                      ) : (
                        <div
                          className="size-9 rounded-[10px] shrink-0 flex items-center justify-center"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <Building2 size={14} style={{ color: "var(--text-secondary)" }} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{r.title}</p>
                        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{r.subtitle}</p>
                      </div>
                    </div>
                    {r.badge && (
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                      >
                        {r.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No results */}
      {q && results.length === 0 && (
        <div className="flex flex-col items-center gap-2 pt-16 text-center px-6">
          <div className="size-14 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
            <Search size={22} style={{ color: "var(--text-secondary)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>No results for "{query}"</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Try a different keyword or switch the filter
          </p>
        </div>
      )}
    </div>
  );
}
