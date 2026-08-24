import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { supabase } from "@/lib/supabase";
import type { Purchase } from "@/types";

export default function PurchaseDetailPage() {
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
              costPrice: it.cost_price,
              lineTotal: it.line_total,
            })),
            totalAmount: data.total_amount,
            amountPaid: data.amount_paid,
            outstandingPayable: data.outstanding_payable,
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
        <NavHeader title="Purchase Detail" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title="Purchase Detail" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Purchase not found</p>
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
      <NavHeader title="Purchase Detail" />

      <div className="flex flex-col gap-4 p-4">
        {/* Header card */}
        <div className="rounded-[14px] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{purchase.purchaseNumber}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatDateTime(purchase.createdAt)}</p>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Supplier: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{purchase.companyName}</span></p>
          {purchase.note && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Note: {purchase.note}</p>}
        </div>

        {/* Items */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Items Purchased</p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {purchase.items.map((item, i) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < purchase.items.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.productName}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{item.variantName} × {item.qty}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(item.lineTotal)}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{formatCurrency(item.costPrice)}/unit</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment summary */}
        <div className="rounded-[14px] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>Payment Summary</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Total Amount</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(purchase.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Paid</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(purchase.amountPaid)}</span>
            </div>
            {purchase.outstandingPayable > 0 && (
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Outstanding Payable</span>
                <span className="text-sm font-bold" style={{ color: "var(--error)" }}>{formatCurrency(purchase.outstandingPayable)}</span>
              </div>
            )}
            <div className="border-t my-1" style={{ borderColor: "var(--divider)" }} />
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Payment Method</span>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{purchase.paymentMethod === "cash" ? "Cash" : "Bank Transfer"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
