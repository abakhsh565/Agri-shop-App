import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { formatCurrency } from "@/lib/formatters";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { Plus, ChevronRight, Building2 } from "lucide-react";
import SearchBar from "@/components/ui/SearchBar";

// Simple hash color from company name
function hashColor(name: string) {
  const colors = ["#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#06b6d4"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
  return colors[h];
}

export default function CompaniesListPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const [search, setSearch] = useState("");

  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const products = useProductsStore((s) => s.products);

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  function productCount(companyName: string) {
    return products.filter((p) => p.company === companyName).length;
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("admin.companies")} />

      {/* Search */}
      <div className="px-4 pb-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("common.search")}
        />
      </div>

      {ready && filtered.length === 0 && (
        <div className="flex flex-col items-center py-20 gap-2">
          <Building2 size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {search ? t("companies.noMatch") : t("companies.empty")}
          </p>
        </div>
      )}

      <div className="flex flex-col mx-4 gap-2 pb-24">
        {filtered.map((company) => {
          const color = hashColor(company.name);
          const pCount = productCount(company.name);
          const hasPayable = company.outstandingPayable > 0;

          return (
            <button
              key={company.id}
              onClick={() => navigate(`/admin/companies/${company.id}`)}
              className="flex items-center gap-3 rounded-[var(--radius-card)] p-4 text-start transition-opacity active:opacity-70"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              {/* Logo circle */}
              {company.logoUrl ? (
                <img
                  src={company.logoUrl}
                  alt={company.name}
                  className="size-11 rounded-full object-cover shrink-0"
                />
              ) : (
                <div
                  className="size-11 rounded-full flex items-center justify-center font-bold text-16 shrink-0"
                  style={{ background: color + "22", color }}
                >
                  {company.name ? company.name.charAt(0) : "?"}
                </div>
              )}

              {/* Info */}
              <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                  {company.name}
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {pCount} {pCount !== 1 ? t("company.products") : t("company.product")}
                </p>
                {hasPayable ? (
                  <p className="text-xs font-semibold" style={{ color: "#ef4444" }}>
                    {formatCurrency(company.outstandingPayable)} {t("company.due")}
                  </p>
                ) : (
                  <p className="text-xs font-semibold" style={{ color: "#16a34a" }}>
                    {t("admin.noPayable")}
                  </p>
                )}
              </div>

              <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Floating Add Company */}
      <div
        className="fixed left-0 right-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
          <button
            onClick={() => navigate("/admin/companies/new")}
            className="pointer-events-auto ps-4 pe-5 rounded-full flex items-center gap-2 text-sm font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> {t("admin.addCompany")}
          </button>
        </div>
      </div>
    </div>
  );
}
