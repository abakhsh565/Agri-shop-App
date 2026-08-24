import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { useCartStore } from "@/stores/cartStore";
import { formatCurrency, getCreditHealth, getCreditHealthColor } from "@/lib/formatters";
import { Plus } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import EmptyState from "@/components/ui/EmptyState";
import { useShellBase } from "@/lib/useShellBase";

export default function CartPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { customer, items, updateQty, removeItem, subtotal, clearCart } = useCartStore();
  const { addToast } = useUIStore();
  const [paymentType, setPaymentType] = useState<"full" | "partial">("full");
  const [amountReceived, setAmountReceived] = useState("");

  if (!customer) return <Navigate to={`${base}/sale`} replace />;

  const total = subtotal();
  const creditAfterSale = customer.outstandingBalance + (paymentType === "full" ? 0 : total - Number(amountReceived || 0));
  const creditHealth = getCreditHealth(creditAfterSale, customer.creditLimit);
  const creditOverLimit = customer.creditLimit > 0 && creditAfterSale > customer.creditLimit;

  function handleProceed() {
    if (!items.length) { addToast("Add at least one product", "warning"); return; }
    navigate(`${base}/sale/review`);
  }

  return (
    <div className="flex flex-col bg-white w-full min-h-full">
      <StatusBar />
      <NavHeader title="Review & Payment" backTo={`${base}/sale`} />

      {/* Customer strip */}
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

      {/* Cart items */}
      <div className="px-4 pt-4">
        {items.length === 0 ? (
          <EmptyState icon="🛒" title="Cart is empty" subtitle="Add products to start a sale" />
        ) : (
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
                      deleteOnOne
                      onDelete={() => removeItem(item.variantId)}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => navigate(`${base}/sale/products`)}
          className="w-full h-12 rounded-xl border border-black flex items-center justify-center gap-2 mt-3 text-sm font-medium text-black"
        >
          <Plus size={16} />
          Add More Products
        </button>
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
                paymentType === opt.key ? "bg-black text-white" : "border border-[#e5e5e5] text-[#888]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {paymentType === "partial" && (
        <div className="px-4 pt-4">
          <p className="text-xs font-bold text-black uppercase mb-2">Amount Received</p>
          <input
            type="number"
            inputMode="numeric"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            placeholder="Enter amount"
            className="w-full h-12 rounded-[24px] border border-black px-4 text-sm text-black placeholder:text-[#888] outline-none"
          />
        </div>
      )}

      {/* Summary box */}
      {items.length > 0 && (
        <div className="mx-4 mt-5 bg-black rounded-xl p-4">
          <div className="flex justify-between py-1">
            <span className="text-sm text-white/70">Subtotal</span>
            <span className="text-sm text-white">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-sm text-white/70">Sales Tax (0%)</span>
            <span className="text-sm text-white">Rs. 0</span>
          </div>
          <div className="border-t border-white/20 my-2" />
          <div className="flex justify-between py-1">
            <span className="text-base font-bold text-white">Total Amount</span>
            <span className="text-base font-bold text-white">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <div className="p-4 mt-2">
        <Button
          fullWidth
          size="lg"
          onClick={handleProceed}
          disabled={!items.length}
        >
          Proceed to Payment
        </Button>
      </div>
    </div>
  );
}
