import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { fetchPurchases } from "@/lib/db";
import type { Purchase } from "@/types";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { Phone, User, MapPin, PackagePlus, Wallet, ShoppingCart } from "lucide-react";

export default function CompanyDetailPage() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";

  const companies = useCompaniesStore((s) => s.companies);
  const allProducts = useProductsStore((s) => s.products);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  const company = companies.find((c) => c.id === companyId);

  useEffect(() => {
    if (!companyId) return;
    fetchPurchases().then((all) =>
      setPurchases(
        all
          .filter((p) => p.companyId === companyId)
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      ),
    );
  }, [companyId]);

  if (!company) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title={t("company.title")} />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("company.notFound")}</p>
      </div>
    </div>
  );

  const products = allProducts.filter((p) => p.company === company.name);
  const totalPaid = company.totalPurchases - company.outstandingPayable;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={company.name} />

      {/* Logo + Name hero */}
      <div className="flex flex-col items-center pt-4 pb-1">
        {company.logoUrl ? (
          <img src={company.logoUrl} alt={company.name} className="size-[72px] rounded-[18px] object-cover"
            style={{ border: "2px solid var(--divider)" }} />
        ) : (
          <div className="size-[72px] rounded-[18px] flex items-center justify-center text-2xl font-bold"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "2px solid var(--divider)" }}>
            {company.name ? company.name.charAt(0) : "?".toUpperCase()}
          </div>
        )}
      </div>

      {/* Financial summary — clean white card */}
      <div className="px-5 pt-4">
        <div className="rounded-[18px] p-6 text-center" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
          <p className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
            {t("company.currentPayable")}
          </p>
          <p className="text-[34px] font-extrabold mt-1 tracking-tight" style={{ color: company.outstandingPayable > 0 ? "var(--error, #ef4444)" : "var(--text-primary)" }}>
            {formatCurrency(company.outstandingPayable)}
          </p>
        </div>
      </div>

      {/* Quick Actions — dark primary CTA */}
      <div className="px-5 pt-4 flex gap-3">
        <button
          onClick={() => navigate(`/admin/purchases/new?companyId=${company.id}`)}
          className="flex-1 h-[46px] rounded-[14px] text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{ background: "#1a1a1a", color: "#fff" }}
        >
          <ShoppingCart size={16} /> {t("company.orderStock")}
        </button>
        <button
          onClick={() => navigate(`/admin/payments/supplier/${company.id}`)}
          className="flex-1 h-[46px] rounded-[14px] text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{ background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
        >
          <Wallet size={16} /> {t("company.recordPayment")}
        </button>
      </div>

      {/* Totals — clean side-by-side cards */}
      <div className="px-5 pt-4 flex gap-3">
        <div className="flex-1 rounded-[16px] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{t("company.totalPurchased")}</p>
          <p className="text-[15px] font-bold mt-1" style={{ color: "var(--text-primary)" }}>{formatCurrency(company.totalPurchases)}</p>
        </div>
        <div className="flex-1 rounded-[16px] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{t("company.totalPaid")}</p>
          <p className="text-[15px] font-bold mt-1" style={{ color: "var(--brand-dark, #16a34a)" }}>{formatCurrency(totalPaid)}</p>
        </div>
      </div>

      {/* Contact — clean card */}
      {(company.contactPerson || company.phone || company.address) && (
        <div className="px-5 pt-6">
          <p className="text-[12px] font-semibold mb-2.5" style={{ color: "var(--text-secondary)" }}>{t("company.contact")}</p>
          <div className="rounded-[16px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {company.contactPerson && <ContactRow icon={User} value={company.contactPerson} />}
            {company.phone && <ContactRow icon={Phone} value={company.phone} />}
            {company.address && <ContactRow icon={MapPin} value={company.address} last />}
          </div>
        </div>
      )}

      {/* Products supplied — clean chips */}
      <div className="px-5 pt-6">
        <p className="text-[12px] font-semibold mb-2.5" style={{ color: "var(--text-secondary)" }}>
          {t("company.productsSupplied", { count: String(products.length) })}
        </p>
        {products.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("company.noProducts")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <span key={p.id} className="text-[12px] font-medium px-3.5 py-[7px] rounded-full"
                style={{ background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}>
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Purchase history — clean list cards */}
      <div className="px-5 pt-6 pb-8">
        <p className="text-[12px] font-semibold mb-2.5" style={{ color: "var(--text-secondary)" }}>{t("company.purchaseHistory")}</p>
        {purchases.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("company.noPurchases")}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {purchases.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-[16px] p-4"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{ background: "rgba(132,204,22,0.12)", color: "var(--brand-dark, #16a34a)" }}>
                    <PackagePlus size={16} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{p.purchaseNumber}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatDate(p.createdAt)}</p>
                  </div>
                </div>
                <div className="text-end">
                  <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.totalAmount)}</p>
                  {p.outstandingPayable > 0 && (
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--error, #ef4444)" }}>{formatCurrency(p.outstandingPayable)} {t("company.payable")}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, value, last }: { icon: typeof Phone; value: string; last?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5"
      style={{ borderBottom: last ? "none" : "1px solid var(--divider)", background: "var(--surface)" }}>
      <div className="size-7 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "rgba(132,204,22,0.1)" }}>
        <Icon size={14} style={{ color: "var(--brand-dark, #16a34a)" }} />
      </div>
      <span className="text-[13px]" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
