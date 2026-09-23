import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { supabase } from "@/lib/supabase";

import type { Purchase } from "@/types";
import { useT } from "@/lib/i18n";

export default function PurchaseDetailPage() {
  const t = useT();
  const { purchaseId } = useParams();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!purchaseId) return;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("purchases")
          .select("*, purchase_items(*)")
          .eq("id", purchaseId)
          .single();
        if (!error && data) {
          setPurchase({
            id: data.id,
            purchaseNumber: data.purchase_number,
            companyId: data.company_id,
            companyName: data.company_name ?? "",
            items: (data.purchase_items ?? []).map((it: any) => ({
              id: it.id,
              purchaseId: it.purchase_id,
              productId: it.product_id,
              productName: it.product_name,
              variantId: it.variant_id,
              variantName: it.variant_name,
              qty: it.qty,
              costPrice: it.unit_price,
              lineTotal: it.line_total,
            })),
            totalAmount: data.total_amount,
            amountPaid: data.amount_paid,
            outstandingPayable: data.amount_due,
            paymentMethod: data.payment_method,
            note: data.note,
            createdAt: data.created_at,
            createdBy: data.created_by ?? "",
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [purchaseId]);

  if (loading) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("purchases.detailTitle")} />
        <div className="flex-1 pt-4">
          <SkeletonList rows={3} tile={false} />
        </div>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("purchases.detailTitle")} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("purchase.notFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("purchases.detailTitle")} />

      <div className="flex flex-col gap-4 p-4">
        {/* Header card */}
        <div className="ds-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{purchase.purchaseNumber}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatDateTime(purchase.createdAt)}</p>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("common.supplier")}: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{purchase.companyName}</span></p>
          {purchase.note && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{t("admin.note")}: {purchase.note}</p>}
        </div>

        {/* Items */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("purchase.itemsPurchased")}</p>
          <ListCard>
            {purchase.items.map((item) => (
              <ListRow
                key={item.id}
                title={item.productName}
                meta={`${item.variantName} × ${item.qty}`}
                trailing={
                  <div className="text-end shrink-0 ms-3">
                    <p className="ds-row-strong">{formatCurrency(item.lineTotal)}</p>
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{formatCurrency(item.costPrice)}/unit</p>
                  </div>
                }
              />
            ))}
          </ListCard>
        </div>

        {/* Payment summary */}
        <div className="ds-card">
          <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>{t("purchase.paymentSummary")}</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("saleReview.totalAmount")}</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(purchase.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.paid")}</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(purchase.amountPaid)}</span>
            </div>
            {purchase.outstandingPayable > 0 && (
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("purchase.outstandingPayable")}</span>
                <span className="text-sm font-bold" style={{ color: "var(--error)" }}>{formatCurrency(purchase.outstandingPayable)}</span>
              </div>
            )}
            <div className="border-t my-1" style={{ borderColor: "var(--divider)" }} />
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sale.paymentMethod")}</span>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{purchase.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
