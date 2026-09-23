import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { fetchPurchases } from "@/lib/db";
import type { Purchase } from "@/types";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { PackagePlus, Package } from "lucide-react";

export default function AdminPurchasesPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPurchases()
      .then((all) =>
        setPurchases(
          [...all].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const totalPayable = purchases.reduce((s, p) => s + p.outstandingPayable, 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("purchases.listTitle")} />

      {/* Payable summary */}
      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4 flex items-center justify-between"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <div>
            <p className="text-10 font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
              {t("purchases.outstandingSupplier")}
            </p>
            <p className="text-xl font-bold mt-0.5" style={{ color: totalPayable > 0 ? "var(--error)" : "var(--brand-dark)" }}>
              {formatCurrency(totalPayable)}
            </p>
          </div>
          <button
            onClick={() => navigate("/admin/payments")}
            className="text-xs font-bold px-3 py-1.5 rounded-full"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            {t("purchases.paySuppliers")}
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={4} tile />
      ) : purchases.length === 0 ? (
        <EmptyState icon={Package} title={t("purchases.noStockIns")} subtitle={t("purchases.noStockInsDesc")} />
      ) : (
        <div className="flex flex-col px-4 gap-3 pt-4 pb-24">
          {purchases.map((p) => {
            const units = p.items.reduce((s, it) => s + it.qty, 0);
            const unpaid = p.outstandingPayable > 0;
            return (
              <div
                key={p.id}
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="size-9 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                      style={{ background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}
                    >
                      <PackagePlus size={17} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{p.companyName}</p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {p.purchaseNumber} · {formatDate(p.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={unpaid
                      ? { background: "rgba(245,158,11,0.15)", color: "var(--warning)" }
                      : { background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}
                  >
                    {unpaid ? t("purchases.payableTag") : t("common.paidTag")}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid var(--divider)" }}>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {t("common.itemsCount", { count: p.items.length })} · {t("common.unitsCount", { count: units })}
                  </span>
                  <div className="text-end">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.totalAmount)}</p>
                    {unpaid && (
                      <p className="text-11" style={{ color: "var(--error)" }}>
                        {formatCurrency(p.outstandingPayable)} {t("common.payable")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating primary action */}
      <div
        className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
          <button
            onClick={() => navigate("/admin/purchases/new")}
            className="pointer-events-auto ps-4 pe-5 rounded-full flex items-center gap-2 text-sm font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <PackagePlus size={20} strokeWidth={2.5} /> {t("purchase.record")}
          </button>
        </div>
      </div>
    </div>
  );
}
