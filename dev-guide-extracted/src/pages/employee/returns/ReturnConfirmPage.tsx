import { useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { formatCurrency } from "@/lib/formatters";
import type { ReturnItem, Sale } from "@/types";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { rpcProcessReturn } from "@/lib/db";
import { AlertTriangle } from "lucide-react";

export default function ReturnConfirmPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { addToast } = useUIStore();
  const currentUser = useAuthStore((s) => s.user);

  const returnItems: ReturnItem[] = state?.returnItems ?? [];
  const returnTotal: number = state?.returnTotal ?? 0;
  const sale: Sale | undefined = state?.sale;

  const [resolution, setResolution] = useState<"refund_cash" | "credit_note">("refund_cash");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      // Enrich each return item with productId/variantId from the original sale.
      const items = returnItems.map((it) => {
        const src = sale?.items.find((si) => si.id === it.saleItemId);
        return {
          saleItemId: it.saleItemId,
          productId: src?.productId,
          productName: it.productName,
          variantId: src?.variantId,
          variantName: it.variantName,
          qty: Number(it.qtyToReturn),
          unitPrice: Number(it.unitPrice),
          restock: true,
        };
      });

      const rpcResult = await rpcProcessReturn({
        saleId,
        customerId: sale?.customerId ?? null,
        customerName: sale?.customerName ?? "Customer",
        resolution,
        items,
      });

      const result = {
        refundAmount: rpcResult.totalRefund,
        returnNumber: rpcResult.returnNumber,
        resolution,
        customerName: sale?.customerName ?? "Customer",
        saleId: saleId ?? "",
        saleNumber: sale?.saleNumber ?? "",
        itemsReturned: returnItems.reduce((s, i) => s + i.qtyToReturn, 0),
        processedAt: new Date().toISOString(),
        processedBy: currentUser?.name ?? "—",
      };
      navigate(`/employee/sales/${saleId}/return/success`, { state: { result }, replace: true });
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Could not process return.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col bg-white w-full min-h-full justify-between">
      <div>
        <StatusBar />
        <NavHeader title="Confirm Return" backLabel="Select Items" backTo={`/employee/sales/${saleId}/return`} />

        {/* Estimated refund */}
        <div className="mx-4 mt-3 border border-[#e5e5e5] rounded-xl p-4 text-center">
          <p className="text-[10px] text-[#888] uppercase">Estimated Refund</p>
          <p className="text-[28px] font-bold text-black mt-1">{formatCurrency(returnTotal)}</p>
        </div>

        <div className="flex flex-col gap-4 p-4 mt-1">
          {/* Items */}
          <div>
            <p className="text-xs font-bold text-[#888] uppercase mb-2">Returning Items</p>
            <div className="border border-[#e5e5e5] rounded-xl overflow-hidden">
              {returnItems.map((item, i) => (
                <div key={item.saleItemId} className={`flex justify-between p-4 ${i < returnItems.length - 1 ? "border-b border-[#e5e5e5]" : ""}`}>
                  <span className="text-sm text-black">
                    {item.productName} {item.variantName} × {item.qtyToReturn}
                  </span>
                  <span className="text-sm font-bold text-black">{formatCurrency(item.refundAmount)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Resolution method */}
          <div>
            <p className="text-xs font-bold text-[#888] uppercase mb-2">Resolution Method</p>
            <div className="flex gap-2">
              {[{ key: "refund_cash", label: "Refund Cash" }, { key: "credit_note", label: "Credit Note" }].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setResolution(opt.key as "refund_cash" | "credit_note")}
                  className={`flex-1 h-12 rounded-full text-sm font-medium transition-colors ${
                    resolution === opt.key ? "bg-black text-white" : "border border-[#e5e5e5] text-[#888]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Info banner */}
          <div className="border border-[#e5e5e5] rounded-xl p-4 flex gap-3">
            <AlertTriangle size={16} className="text-black shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-black uppercase mb-1">Refund Processing</p>
              <p className="text-xs text-[#888]">
                {formatCurrency(returnTotal)} will be{" "}
                {resolution === "refund_cash" ? "returned directly to customer" : "added as credit note"}{" "}
                {sale ? `${sale.customerName}. Original invoice ${sale.saleNumber} remains preserved.` : "to the customer."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <Button fullWidth size="lg" onClick={handleConfirm} loading={loading}>
          Confirm Return
        </Button>
      </div>
    </div>
  );
}
