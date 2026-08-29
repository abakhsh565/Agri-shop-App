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
import { Phone, User, MapPin, PackagePlus, Wallet, ShoppingCart } from "lucide-react";

export default function CompanyDetailPage() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const { language } = useThemeStore();
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
      <NavHeader title="Company" />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Company not found</p>
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

      {company.logoUrl && (
        <div className="flex justify-center pt-3">
          <img src={company.logoUrl} alt={company.name} className="size-16 rounded-full object-cover"
            style={{ border: "1px solid var(--divider)" }} />
        </div>
      )}

      {/* Financial summary (admin-only, PRD §19) */}
      <div className="px-4 pt-3">
        <div className="rounded-[16px] p-5" style={{ background: company.outstandingPayable > 0 ? "var(--brand)" : "var(--surface-2)", border: company.outstandingPayable > 0 ? "none" : "1px solid var(--divider)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: company.outstandingPayable > 0 ? "rgba(0,0,0,0.55)" : "var(--text-secondary)" }}>
            Current Payable
          </p>
          <p className="text-[30px] font-bold" style={{ color: company.outstandingPayable > 0 ? "#0a0a0a" : "var(--text-primary)" }}>
            {formatCurrency(company.outstandingPayable)}
          </p>
        </div>
      </div>

      {/* Quick Actions — Order Stock + Record Payment */}
      <div className="px-4 pt-3 flex gap-2">
        <button
          onClick={() => navigate(`/admin/purchases/new?companyId=${company.id}`)}
          className="flex-1 h-12 rounded-full text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          <ShoppingCart size={16} /> Order Stock
        </button>
        <button
          onClick={() => navigate(`/admin/payments/supplier/${company.id}`)}
          className="flex-1 h-12 rounded-full text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
        >
          <Wallet size={16} /> Record Payment
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <div className="rounded-[14px] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Total Purchased</p>
          <p className="text-base font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{formatCurrency(company.totalPurchases)}</p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Total Paid</p>
          <p className="text-base font-bold mt-0.5" style={{ color: "var(--brand-dark)" }}>{formatCurrency(totalPaid)}</p>
        </div>
      </div>

      {/* Contact */}
      {(company.contactPerson || company.phone || company.address) && (
        <div className="px-4 pt-5">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>Contact</p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {company.contactPerson && <ContactRow icon={User} value={company.contactPerson} />}
            {company.phone && <ContactRow icon={Phone} value={company.phone} />}
            {company.address && <ContactRow icon={MapPin} value={company.address} last />}
          </div>
        </div>
      )}

      {/* Products supplied */}
      <div className="px-4 pt-5">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>
          Products Supplied ({products.length})
        </p>
        {products.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>No products linked to this supplier yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <span key={p.id} className="text-xs font-medium px-3 py-1.5 rounded-full"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}>
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Purchase history */}
      <div className="px-4 pt-5 pb-6">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>Purchase History</p>
        {purchases.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>No purchases recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {purchases.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-[14px] p-3.5"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-[9px] flex items-center justify-center shrink-0"
                    style={{ background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}>
                    <PackagePlus size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{p.purchaseNumber}</p>
                    <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{formatDate(p.createdAt)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.totalAmount)}</p>
                  {p.outstandingPayable > 0 && (
                    <p className="text-[11px]" style={{ color: "var(--error)" }}>{formatCurrency(p.outstandingPayable)} payable</p>
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
      <Icon size={16} style={{ color: "var(--brand)" }} />
      <span className="text-sm" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
