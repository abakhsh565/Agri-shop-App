import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { useCartStore } from "@/stores/cartStore";
import { useSalesStore } from "@/stores/salesStore";
import { useAuthStore } from "@/stores/authStore";
import { formatCurrency, getCreditHealth, getCreditHealthColor } from "@/lib/formatters";
import { Plus } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import ScanButton from "@/components/ui/ScanButton";
import { checkAndNotifyLowStock } from "@/lib/notifications";

export default function CartPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { customer, items, updateQty, removeItem, subtotal, clearCart } = useCartStore();
  const { addToast } = useUIStore();
  const createSale = useSalesStore((s) => s.createSale);
  const { user } = useAuthStore();

  const [paymentType, setPaymentType] = useState<"full" | "partial">("full");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [dueDate, setDueDate] = useState(customer?.dueDate ?? "");
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);

  // Show cart even without customer — user can scan products first, select customer later

  // PRD §38.3: When last item is removed, redirect to product selection
  // Skip redirect while completing sale to avoid overriding success navigation
  // Use useEffect to avoid race condition with Zustand store sync
  useEffect(() => {
    if (items.length === 0 && !completingRef.current) {
      navigate(`${base}/sale/products`, { replace: true });
    }
  }, [items.length, base, navigate]);

  // While redirecting, render nothing
  if (items.length === 0 && !completingRef.current) return null;

  const total = subtotal();
  const parsedAmount = amountReceived === "" ? null : Number(amountReceived);
  const amountPaid = paymentType === "full" ? total : Math.min(parsedAmount ?? 0, total);
  const creditAfterSale = (customer?.outstandingBalance ?? 0) + (paymentType === "full" ? 0 : total - amountPaid);
  const creditHealth = customer ? getCreditHealth(creditAfterSale, customer.creditLimit) : "good" as const;
  const creditOverLimit = customer ? customer.creditLimit > 0 && creditAfterSale > customer.creditLimit : false;

  async function handleCompleteSale() {
    if (!items.length) { addToast("Add at least one product", "warning"); return; }
    if (!customer) { addToast("Please select a customer first", "warning"); navigate(`${base}/sale`, { state: { fromCart: true } }); return; }
    if (paymentType === "partial" && amountTouched && parsedAmount !== null && parsedAmount < 0) { addToast("Amount cannot be negative", "warning"); return; }

    setCompleting(true);
    completingRef.current = true;
    try {
      const outstandingBalance = total - amountPaid;
      const sale = await createSale({
        customerId: customer!.id,
        customerName: customer!.name,
        customerPhone: customer!.phone,
        customerAddress: customer!.address,
        employeeId: user?.id ?? "",
        employeeName: user?.name ?? "Staff",
        items: items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          variantId: it.variantId,
          variantName: it.variantName,
          qty: it.qty,
          unitPrice: it.unitPrice,
          unitSize: it.unitSize,
          baseUnit: it.baseUnit,
          lineTotal: it.lineTotal,
        })),
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
        amountPaid,
        outstandingBalance,
        paymentMethod,
        paymentType,
      });
      // Check for low stock after sale
      const products = useProductsStore.getState().products;
      for (const it of items) {
        const product = products.find((p) => p.id === it.productId);
        if (product) {
          const variant = product.variants.find((v) => v.id === it.variantId);
          if (variant) {
            checkAndNotifyLowStock(product.id, product.name, product.stockQty, variant.lowStockThreshold);
          }
        }
      }
      // Save due date to customer if partial/credit and date was set
      if (paymentType === "partial" && dueDate) {
        try {
          const { updateDueDate } = await import("@/stores/customersStore").then(m => m.useCustomersStore.getState());
          await updateDueDate(customer!.id, dueDate);
        } catch {}
      }
      // Navigate first, then clear cart — clearing first causes the <Navigate>
      // guard in this component to fire and redirect away from the success page.
      navigate(`${base}/sale/success`, { state: { sale }, replace: true });
      clearCart();
    } catch (e) {
      completingRef.current = false;
      addToast(e instanceof Error ? e.message : "Failed to complete sale", "error");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="flex flex-col bg-white w-full min-h-full">
      <StatusBar />
      <NavHeader title="Review & Payment" />

      {/* Customer strip — two states */}
      {!customer ? (
        <button
          onClick={() => navigate(`${base}/sale`, { state: { fromCart: true } })}
          className="mx-4 mt-3 rounded-xl p-4 flex items-center justify-between transition-opacity active:opacity-70"
          style={{ background: "var(--surface-2)", border: "1.5px dashed var(--divider)" }}
        >
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full flex items-center justify-center" style={{ background: "var(--muted)" }}>
              <Plus size={18} style={{ color: "var(--text-secondary)" }} />
            </div>
            <div className="text-start">
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Select Customer</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Required before completing sale</p>
            </div>
          </div>
          <span className="text-xs font-semibold" style={{ color: "var(--brand-dark)" }}>Choose →</span>
        </button>
      ) : (
        <>
          <div className="mx-4 mt-3 bg-[#f5f5f5] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-black">{customer.name}</p>
              <span className="text-xs" style={{ color: getCreditHealthColor(creditHealth) }}>
                Credit Health: {creditHealth === "good" ? "Good" : creditHealth === "warning" ? "Warning" : "Over Limit"}
              </span>
            </div>
            <div className="flex gap-8">
              <div>
                <p className="text-[10px] text-[#888] uppercase">Outstanding Credit</p>
                <p className="text-sm font-bold text-black">{formatCurrency(customer.outstandingBalance)}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#888] uppercase">Credit Limit</p>
                <p className="text-sm font-bold text-black">{formatCurrency(customer.creditLimit)}</p>
              </div>
            </div>
          </div>
          {creditOverLimit && (
            <div className="mx-4 mt-2 bg-[#fef2f2] border border-[#ef4444] rounded-xl p-3">
              <p className="text-xs text-[#ef4444] font-medium">⚠ This sale will exceed {customer.name}'s credit limit.</p>
            </div>
          )}
        </>
      )}

      {/* Cart items */}
      <div className="px-4 pt-4">
        <div className="flex flex-col">
            {items.map((item, i) => (
              <div key={item.variantId} className={`py-4 ${i < items.length - 1 ? "border-b border-[#e5e5e5]" : ""}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-black">{item.productName}</p>
                    <p className="text-xs text-[#888]">
                      {item.variantName} · {formatCurrency(item.unitPrice)} × {item.qty}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-black">{formatCurrency(item.lineTotal)}</p>
                    <QuantityCounter
                      qty={item.qty}
                      onChange={(q) => updateQty(item.variantId, q)}
                      max={item.maxQty}
                      step={item.qtyStep}
                      deleteOnOne
                      onDelete={() => removeItem(item.variantId)}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => navigate(`${base}/sale/products`)}
            className="flex-1 h-12 rounded-xl border border-black flex items-center justify-center gap-2 text-sm font-medium text-black"
          >
            <Plus size={16} />
            Add More
          </button>
          <ScanButton
            onScan={(code) => {
              const product = useProductsStore.getState().findByBarcode(code);
              if (!product) {
                addToast(`No product found for "${code}"`, "error");
                return;
              }
              if (product.stockQty <= 0) {
                addToast(`${product.name} is out of stock`, "warning");
                return;
              }
              const inStock = product.variants.filter((v) => Math.floor(product.stockQty / v.unitSize) > 0);
              if (inStock.length === 0) {
                addToast(`${product.name} is out of stock`, "warning");
                return;
              }
              if (inStock.length === 1) {
                const v = inStock[0];
                const maxU = Math.floor(product.stockQty / v.unitSize);
                useCartStore.getState().addItem({
                  productId: product.id,
                  productName: product.name,
                  variantId: v.id,
                  variantName: v.name,
                  qty: v.qtyStep,
                  unitPrice: v.sellingPrice,
                  lineTotal: v.sellingPrice * v.qtyStep,
                  maxQty: maxU,
                  qtyStep: v.qtyStep,
                  unitSize: v.unitSize,
                  baseUnit: product.baseUnit,
                });
                addToast(`${product.name} (${v.name}) added`, "success");
              } else {
                navigate(`${base}/sale/products/${product.id}`);
              }
            }}
            label="Scan"
            size="lg"
          />
        </div>
      </div>

      {/* Payment type */}
      <div className="px-4 pt-5">
        <p className="text-xs font-bold text-black uppercase mb-3">Payment Type</p>
        <div className="flex gap-2">
          {[{ key: "full", label: "Full Payment" }, { key: "partial", label: "Partial / Credit" }].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPaymentType(opt.key as "full" | "partial")}
              className={`flex-1 h-11 rounded-full text-sm font-medium transition-colors ${
                paymentType === opt.key ? "bg-[#22c55e] text-white" : "border border-[#e5e5e5] text-[#888]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Payment method — moved from SaleReviewPage */}
      <div className="px-4 pt-4">
        <p className="text-xs font-bold text-black uppercase mb-3">Payment Method</p>
        <div className="flex gap-2">
          {[{ key: "cash", label: "Cash" }, { key: "bank_transfer", label: "Bank Transfer" }].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPaymentMethod(opt.key as "cash" | "bank_transfer")}
              className={`flex-1 h-11 rounded-full text-sm font-medium transition-colors ${
                paymentMethod === opt.key ? "bg-black text-white" : "border border-[#e5e5e5] text-[#888]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Amount received for partial */}
      {paymentType === "partial" && (
        <div className="px-4 pt-4">
          <p className="text-xs font-bold text-black uppercase mb-2">Amount Received</p>
          <input
            type="number"
            inputMode="numeric"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            placeholder="Enter amount (0 for credit)"
            className="w-full h-12 rounded-[24px] border border-[#e5e5e5] px-4 text-sm text-black placeholder:text-[#888] outline-none"
            onFocus={() => setAmountTouched(true)}
          />
          <p className="text-xs font-bold text-black uppercase mb-2 mt-4">Payment Due Date</p>
          <p className="text-[12px] text-[#888] mb-2">Optional. When should the customer pay the outstanding amount?</p>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full h-12 rounded-[24px] border border-[#e5e5e5] px-4 text-sm text-black outline-none"
          />
        </div>
      )}

      {/* Summary box */}
      {items.length > 0 && (
        <div className="mx-4 mt-5 border border-[#e5e5e5] rounded-xl p-4 bg-[#f9f9f9]">
          <div className="flex justify-between py-1">
            <span className="text-sm text-[#888]">Subtotal</span>
            <span className="text-sm font-medium text-black">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-sm text-[#888]">Paid</span>
            <span className="text-sm font-medium text-black">{formatCurrency(amountPaid)}</span>
          </div>
          {paymentType === "partial" && amountPaid < total && (
            <div className="flex justify-between py-1">
              <span className="text-sm text-[#888]">Outstanding</span>
              <span className="text-sm font-medium text-[#ef4444]">{formatCurrency(total - amountPaid)}</span>
            </div>
          )}
          <div className="border-t border-[#e5e5e5] my-2" />
          <div className="flex justify-between py-1">
            <span className="text-sm font-bold text-black">Total</span>
            <span className="text-sm font-bold text-black">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {/* Complete Sale — instead of Proceed to Review */}
      <div className="p-4 pb-6">
        {!customer ? (
          <Button
            onClick={() => navigate(`${base}/sale`, { state: { fromCart: true } })}
            className="w-full"
          >
            Select Customer to Continue
          </Button>
        ) : (
          <Button
            onClick={handleCompleteSale}
            disabled={completing || items.length === 0}
            className="w-full"
          >
            {completing ? "Processing…" : `Complete Sale · ${formatCurrency(total)}`}
          </Button>
        )}
      </div>
    </div>
  );
}
