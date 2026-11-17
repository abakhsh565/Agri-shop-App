import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import LogoTile from "@/components/ui/LogoTile";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { ChevronRight, Plus } from "lucide-react";

/**
 * Who a delivery came from — a screen, not a sheet (owner, 2026-11-17).
 *
 * The supplier used to be chosen in a bottom sheet over the purchase form, which hid the very
 * thing the choice is about: the shop's suppliers, with their marks and what is still owed to
 * them. A sheet is right for one small answer; this is a book to read down.
 *
 * A purchase is money owed to a SUPPLIER, and `purchases.company_id` points at the supplier book.
 * That is why this screen lists suppliers only: a customer is a different ledger (money owed to
 * the shop), and offering them here would produce a purchase nobody could pay against.
 */
export default function SelectSupplierPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? companies.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q),
        )
      : companies;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, search]);

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("supplier.selectSupplier")} />

      <div className="px-4 pt-2 pb-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("supplier.searchSupplier")}
        />
        <button
          type="button"
          onClick={() => navigate(`${base}/companies/new`)}
          className="w-full h-11 mt-2 rounded-[var(--radius-tile)] flex items-center justify-center gap-2 ds-pressable"
          style={{ background: "#2c2c2a", color: "var(--brand)" }}
        >
          <Plus size={16} />
          <span className="text-sm font-semibold">{t("supplier.addNew")}</span>
        </button>
      </div>

      {ready && filtered.length === 0 ? (
        <p className="px-4 py-8 text-center text-13" style={{ color: "var(--text-secondary)" }}>
          {t("supplier.noMatches")}
        </p>
      ) : (
        <div className="px-4 flex flex-col gap-2 pb-6">
          {filtered.map((company) => (
            <button
              key={company.id}
              type="button"
              onClick={() => navigate(`${base}/purchases/new?companyId=${company.id}`, { replace: true })}
              className="rounded-[var(--radius-tile)] p-3 flex items-center gap-3 text-start ds-pressable"
              style={{ background: "var(--tone-card)", border: "1px solid var(--divider)" }}
            >
              <LogoTile name={company.name} src={company.logoUrl} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                  {company.name}
                </p>
                <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                  {company.phone || company.contactPerson || t("supplier.supplier")}
                </p>
              </div>
              {company.outstandingPayable > 0 && (
                <span className="text-11 font-semibold shrink-0" style={{ color: "var(--error)" }}>
                  {formatCurrency(company.outstandingPayable)}
                </span>
              )}
              <ChevronRight size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
