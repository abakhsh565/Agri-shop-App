import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { fetchPurchases } from "@/lib/db";
import { useCompaniesStore } from "@/stores/companiesStore";
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

  // The suppliers, for the header's figure — see `owedToSuppliers` below.
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);

  useEffect(() => {
    fetchPurchases()
      .then((all) =>
        setPurchases(
          [...all].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  /**
   * What the shop owes suppliers, taken from the one figure that means it:
   * `companies.outstanding_payable` — the balance `record_supplier_payment` reduces, and the one
   * the signals engine, the Payments screen and the archive guard all read.
   *
   * This header used to sum the rows below, and that is a different question. A delivery carries its
   * OWN residual (`purchases.amount_due` = `total - paid` at the moment it was recorded), and nothing
   * allocates a later payment to a delivery — `supplier_payments` has no `purchase_id` — so the sum
   * kept reporting "Rs. 96,000 to pay" for a delivery whose supplier balance was already settled.
   * Exactly the computation Payments makes, so the two screens cannot describe the same debt
   * differently again; the row below now says which number it is.
   */
  const owedToSuppliers = companies
    .filter((c) => c.outstandingPayable > 0)
    .reduce((sum, c) => sum + c.outstandingPayable, 0);

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
          style={{ background: "var(--tone-card)" }}
        >
          <div>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("purchases.outstandingSupplier")}
            </p>
            {companiesReady ? (
              <p className="text-xl font-bold mt-0.5" style={{ color: owedToSuppliers > 0 ? "var(--error)" : "var(--brand-dark)" }}>
                {formatCurrency(owedToSuppliers)}
              </p>
            ) : (
              // The figure comes from a shell-level read. Until it answers, wait rather than show a
              // delivery-derived number under a label that means the suppliers' balance.
              <Skeleton w="120px" h="26px" className="mt-1" />
            )}
          </div>
          <button
            onClick={() => navigate("/admin/payments")}
            className="text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
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
                style={{ background: "var(--tone-card)" }}
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
                        {formatCurrency(p.outstandingPayable)} {t("purchases.unpaidOnDelivery")}
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
