import { useRef, useState } from "react";
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
  // A tap that lands twice must not become two sales. The ref blocks the second
  // handler synchronously (state updates are too late for a double tap), and the
  // key makes the database the authority: a retry of the SAME attempt returns the
  // sale that already exists. The key is retired after success so the next sale is
  // a new one.
  const submittingRef = useRef(false);
  const submissionKeyRef = useRef<string | null>(null);

  if (!customer || !items.length) return <Navigate to={`${base}/sale/cart`} replace />;

  const total = subtotal();
  const paid = amountPaid ? Math.min(Number(amountPaid), total) : total;
  const outstanding = total - paid;
  const paymentType = outstanding > 0 ? (paid > 0 ? "partial" : "credit") : "full";

  async function handleComplete() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (!submissionKeyRef.current) submissionKeyRef.current = crypto.randomUUID();
    setLoading(true);
    setError(null);
    try {
      const newSale = await createSale({
        idempotencyKey: submissionKeyRef.current,
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
      // Done: this attempt's key retires, so the next sale is a new sale.
      submissionKeyRef.current = null;
      clearCart();
      navigate(`${base}/sale/success`, { state: { sale: newSale }, replace: true });
    } catch (e) {
      // Keep the key: if the failure was the response going missing rather than the
      // sale, retrying with the same key returns that sale instead of duplicating it.
      setError(e instanceof Error ? e.message : t("errors.completeSaleFailed"));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col bg-background w-full min-h-full">
      <StatusBar />
      <NavHeader title={t("saleReview.confirmSale")} />

      <div className="flex flex-col gap-4 p-4">
        {/* Customer */}
        <div className="border border-border rounded-[var(--radius-tile)] p-4">
          <p className="text-sm font-bold text-foreground">{customer.name}</p>
          <p className="text-xs text-caption">{t("saleReview.outstanding")} {formatCurrency(customer.outstandingBalance)}</p>
        </div>

        {/* Items */}
        <div className="flex flex-col gap-1">
          <p className="ds-section-label text-caption">{t("saleReview.items")}</p>
          <div className="border border-border rounded-[var(--radius-tile)] overflow-hidden">
            {items.map((item, i) => (
              <div key={item.variantId} className={`flex justify-between p-4 ${i < items.length - 1 ? "border-b border-border" : ""}`}>
                <div>
                  <p className="text-sm font-bold text-foreground">{item.productName}</p>
                  <p className="text-xs text-caption">{item.variantName} · {formatCurrency(item.unitPrice)} × {item.qty}</p>
                </div>
                <p className="text-sm font-bold text-foreground">{formatCurrency(item.lineTotal)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Payment method */}
        <div>
          <p className="ds-section-label text-caption mb-2">{t("saleReview.paymentMethod")}</p>
          <div className="flex gap-2">
            {[{ key: "cash", label: "Cash" }, { key: "bank_transfer", label: "Bank Transfer" }].map((m) => (
              <button
                key={m.key}
                onClick={() => setPaymentMethod(m.key as "cash" | "bank_transfer")}
                className={`flex-1 h-11 rounded-full text-sm font-medium transition-colors ${
                  paymentMethod === m.key ? "bg-[#22c55e] text-white" : "border border-border text-caption"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amount paid */}
        <div>
          <p className="ds-section-label text-caption mb-2">{t("saleReview.amountReceived")}</p>
          <input
            type="number"
            inputMode="numeric"
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            placeholder={formatCurrency(total)}
            className="w-full h-12 rounded-[var(--radius-input)] border border-border-control px-4 text-sm text-foreground placeholder:text-caption outline-none"
          />
          {outstanding > 0 && (
            <p className="text-xs text-caption mt-1">{t("saleReview.outstandingAfter")} {formatCurrency(outstanding)}</p>
          )}
        </div>

        {/* Summary card */}
        <div className="border border-border rounded-[var(--radius-tile)] p-4 bg-[#f9f9f9]">
          <div className="flex justify-between py-1">
            <span className="text-sm text-caption">{t("sale.subtotal")}</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-sm text-caption">{t("saleReview.salesTax")}</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(0)}</span>
          </div>
          <div className="border-t border-border my-2" />
          <div className="flex justify-between py-1">
            <span className="text-base font-bold text-foreground">{t("saleReview.totalAmount")}</span>
            <span className="text-base font-bold text-foreground">{formatCurrency(total)}</span>
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
