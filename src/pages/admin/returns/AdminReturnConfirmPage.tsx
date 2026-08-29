import { useState, useMemo } from "react";
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
import { notifyReturnProcessed } from "@/lib/notifications";

interface EditableReturnItem extends ReturnItem {
  editedUnitPrice: number;
}

export default function AdminReturnConfirmPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { addToast } = useUIStore();
  const currentUser = useAuthStore((s) => s.user);

  const rawReturnItems: ReturnItem[] = state?.returnItems ?? [];
  const sale: Sale | undefined = state?.sale;

  const [items, setItems] = useState<EditableReturnItem[]>(
    () => rawReturnItems.map((it) => ({ ...it, editedUnitPrice: it.unitPrice }))
  );

  const [resolution, setResolution] = useState<"refund_cash" | "credit_note">("refund_cash");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const liveTotal = useMemo(
    () => items.reduce((sum, it) => sum + it.editedUnitPrice * (it.qtyToReturn ?? 0), 0),
    [items]
  );

  function updatePrice(index: number, priceStr: string) {
    const parsed = parseFloat(priceStr);
    const price = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, editedUnitPrice: price } : it)));
  }

  async function handleConfirm() {
    if (!reason.trim()) {
      addToast("Please enter a return reason", "error");
      return;
    }
    setLoading(true);
    try {
      const rpcItems = items.map((it) => {
        const src = sale?.items.find((si) => si.id === it.saleItemId);
        return {
          saleItemId: it.saleItemId,
          productId: src?.productId,
          productName: it.productName,
          variantId: src?.variantId,
          variantName: it.variantName,
          qty: Number(it.qtyToReturn),
          unitPrice: Number(it.editedUnitPrice),
          restock: true,
        };
      });

      const idempotencyKey = `ret-${saleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const rpcResult = await rpcProcessReturn({
        saleId,
        customerId: sale?.customerId ?? undefined,
        customerName: sale?.customerName ?? "Customer",
        resolution,
        reason: reason.trim(),
        idempotencyKey,
        processedBy: currentUser?.id,
        processedByName: currentUser?.name,
        items: rpcItems,
      });

      const result = {
        refundAmount: rpcResult.totalRefund,
        returnNumber: rpcResult.returnNumber,
        resolution,
        reason: reason.trim(),
        customerName: sale?.customerName ?? "Customer",
        saleId: saleId ?? "",
        saleNumber: sale?.saleNumber ?? "",
        itemsReturned: items.reduce((s, i) => s + (i.qtyToReturn ?? 0), 0),
        processedAt: new Date().toISOString(),
        processedBy: currentUser?.name ?? "—",
      };
      notifyReturnProcessed(sale?.customerName ?? "Customer", rpcResult.totalRefund, saleId ?? "");
      navigate(`/admin/sales/${saleId}/return/success`, { state: { result }, replace: true });
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Could not process return.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col w-full min-h-full justify-between" style={{ background: "var(--background)" }}>
      <div>
        <StatusBar />
        <NavHeader title="Confirm Return" />

        <div className="mx-4 mt-3 rounded-[14px] p-4 text-center" style={{ border: "1px solid var(--divider)" }}>
          <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Estimated Refund</p>
          <p className="text-[28px] font-bold mt-1" style={{ color: "var(--text-primary)" }}>{formatCurrency(liveTotal)}</p>
        </div>

        <div className="flex flex-col gap-4 p-4 mt-1">
          {/* Mandatory Return Reason */}
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
              Return Reason <span style={{ color: "#ef4444" }}>*</span>
            </p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer changed mind, defective product..."
              className="w-full h-11 rounded-full px-4 text-sm outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
            />
            {!reason.trim() && (
              <p className="text-[11px] mt-1 ml-4" style={{ color: "var(--text-secondary)" }}>
                Reason is required to process return
              </p>
            )}
          </div>

          {/* Items with editable prices */}
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: "var(--text-secondary)" }}>Returning Items</p>
            <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
              {items.map((item, i) => (
                <div key={item.saleItemId} className="p-4" style={{ borderBottom: i < items.length - 1 ? "1px solid var(--divider)" : "none" }}>
                  <p className="text-sm font-bold mb-1" style={{ color: "var(--text-primary)" }}>
                    {item.productName} {item.variantName} × {item.qtyToReturn}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Price/unit:</span>
                    <input
                      type="number" min="0" step="1"
                      value={item.editedUnitPrice}
                      onChange={(e) => updatePrice(i, e.target.value)}
                      className="w-24 h-8 rounded-lg px-3 text-xs font-bold outline-none text-center"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
                    />
                    <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      = {formatCurrency(item.editedUnitPrice * (item.qtyToReturn ?? 0))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Resolution method */}
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: "var(--text-secondary)" }}>Resolution Method</p>
            <div className="flex gap-2">
              {([ { key: "refund_cash" as const, label: "Refund Cash" }, { key: "credit_note" as const, label: "Credit Note" } ]).map((opt) => (
                <button key={opt.key} onClick={() => setResolution(opt.key)}
                  className="flex-1 h-12 rounded-full text-sm font-medium transition-colors"
                  style={{
                    background: resolution === opt.key ? "var(--text-primary)" : "transparent",
                    color: resolution === opt.key ? "var(--background)" : "var(--text-secondary)",
                    border: resolution === opt.key ? "none" : "1px solid var(--divider)",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Info banner */}
          <div className="rounded-[14px] p-4 flex gap-3" style={{ border: "1px solid var(--divider)" }}>
            <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
            <div>
              <p className="text-xs font-bold uppercase mb-1" style={{ color: "var(--text-primary)" }}>Refund Processing</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {formatCurrency(liveTotal)} will be{" "}
                {resolution === "refund_cash" ? "returned directly to customer" : "added as credit note"}{" "}
                {sale ? `${sale.customerName}. Original invoice ${sale.saleNumber} remains preserved.` : "to the customer."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <Button fullWidth size="lg" onClick={handleConfirm} loading={loading} disabled={!reason.trim()}>
          Confirm Return
        </Button>
      </div>
    </div>
  );
}
