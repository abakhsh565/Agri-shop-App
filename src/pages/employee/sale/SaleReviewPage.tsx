import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { useCartStore } from "@/stores/cartStore";
import { useAuthStore } from "@/stores/authStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useSalesStore } from "@/stores/salesStore";
import { useShellBase } from "@/lib/useShellBase";

export default function SaleReviewPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { customer, items, subtotal, clearCart } = useCartStore();
  const { user } = useAuthStore();
  const t = useT();
  const createSale = useSalesStore((s) => s.createSale);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!customer || !items.length) return <Navigate to={`${base}/sale/cart`} replace />;

  const total = subtotal();
  const paid = amountPaid ? Math.min(Number(amountPaid), total) : total;
  const outstanding = total - paid;
  const paymentType = outstanding > 0 ? (paid > 0 ? "partial" : "credit") : "full";

  async function handleComplete() {
    setLoading(true);
    setError(null);
    try {
      const newSale = await createSale({
        customerId: customer!.id,
        customerName: customer!.name,
        employeeId: user?.id ?? "",
        employeeName: user?.name?.split(" ")[0] ?? "Staff",
        items: items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId,
          variantName: item.variantName,
          qty: item.qty,
          unitPrice: item.unitPrice,
          unitSize: item.unitSize,
          baseUnit: item.baseUnit,
          lineTotal: item.lineTotal,
        })),
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
        amountPaid: paid,
        outstandingBalance: outstanding,
        paymentType,
        paymentMethod,
      });
      clearCart();
      navigate(`${base}/sale/success`, { state: { sale: newSale }, replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the sale. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col bg-white w-full min-h-full">
      <StatusBar />
      <NavHeader title={t("saleReview.confirmSale")} />

      <div className="flex flex-col gap-4 p-4">
        {/* Customer */}
        <div className="border border-[#e5e5e5] rounded-xl p-4">
          <p className="text-sm font-bold text-black">{customer.name}</p>
          <p className="text-xs text-[#888]">{t("saleReview.outstanding")} {formatCurrency(customer.outstandingBalance)}</p>
        </div>

        {/* Items */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold text-[#888] uppercase">{t("saleReview.items")}</p>
          <div className="border border-[#e5e5e5] rounded-xl overflow-hidden">
            {items.map((item, i) => (
              <div key={item.variantId} className={`flex justify-between p-4 ${i < items.length - 1 ? "border-b border-[#e5e5e5]" : ""}`}>
                <div>
                  <p className="text-sm font-bold text-black">{item.productName}</p>
                  <p className="text-xs text-[#888]">{item.variantName} · {formatCurrency(item.unitPrice)} × {item.qty}</p>
                </div>
                <p className="text-sm font-bold text-black">{formatCurrency(item.lineTotal)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Payment method */}
        <div>
          <p className="text-xs font-bold text-[#888] uppercase mb-2">{t("saleReview.paymentMethod")}</p>
          <div className="flex gap-2">
            {[{ key: "cash", label: "Cash" }, { key: "bank_transfer", label: "Bank Transfer" }].map((m) => (
              <button
                key={m.key}
                onClick={() => setPaymentMethod(m.key as "cash" | "bank_transfer")}
                className={`flex-1 h-11 rounded-full text-sm font-medium transition-colors ${
                  paymentMethod === m.key ? "bg-[#22c55e] text-white" : "border border-[#e5e5e5] text-[#888]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amount paid */}
        <div>
          <p className="text-xs font-bold text-[#888] uppercase mb-2">{t("saleReview.amountReceived")}</p>
          <input
            type="number"
            inputMode="numeric"
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            placeholder={formatCurrency(total)}
            className="w-full h-12 rounded-[24px] border border-black px-4 text-sm text-black placeholder:text-[#888] outline-none"
          />
          {outstanding > 0 && (
            <p className="text-xs text-[#888] mt-1">{t("saleReview.outstandingAfter")} {formatCurrency(outstanding)}</p>
          )}
        </div>

        {/* Summary card */}
        <div className="border border-[#e5e5e5] rounded-xl p-4 bg-[#f9f9f9]">
          <div className="flex justify-between py-1">
            <span className="text-sm text-[#888]">{t("sale.subtotal")}</span>
            <span className="text-sm font-medium text-black">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-sm text-[#888]">{t("saleReview.salesTax")}</span>
            <span className="text-sm font-medium text-black">{formatCurrency(0)}</span>
          </div>
          <div className="border-t border-[#e5e5e5] my-2" />
          <div className="flex justify-between py-1">
            <span className="text-base font-bold text-black">{t("saleReview.totalAmount")}</span>
            <span className="text-base font-bold text-black">{formatCurrency(total)}</span>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}

        <Button fullWidth size="lg" onClick={handleComplete} loading={loading}>
          {t("saleReview.completeSale")}
        </Button>
      </div>
    </div>
  );
}
