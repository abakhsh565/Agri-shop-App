import { useState, useMemo, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { formatCurrency } from "@/lib/formatters";
import type { ReturnItem, Sale } from "@/types";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { rpcProcessReturn } from "@/lib/db";
import { AlertTriangle } from "lucide-react";
import { notifyReturnProcessed } from "@/lib/notifications";

interface EditableReturnItem extends ReturnItem {
  editedUnitPrice: number;
}

export default function ReturnConfirmPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { addToast } = useUIStore();
  const t = useT();
  const currentUser = useAuthStore((s) => s.user);

  const rawReturnItems: ReturnItem[] = state?.returnItems ?? [];
  const returnTotal: number = state?.returnTotal ?? 0;
  const sale: Sale | undefined = state?.sale;

  // Initialize editable items with original prices as defaults
  const [items, setItems] = useState<EditableReturnItem[]>(
    () => rawReturnItems.map((it) => ({
      ...it,
      editedUnitPrice: it.unitPrice,
    }))
  );

  const [resolution, setResolution] = useState<"refund_cash" | "credit_note">("refund_cash");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  // One confirm = one return. `loading` only disables the button after React
  // re-renders, so a double tap gets two calls through first; the ref stops the
  // second synchronously, and the key is minted once per attempt and HELD, so
  // both taps carry the same key and the database records one return.
  const submittingRef = useRef(false);
  const submissionKeyRef = useRef<string | null>(null);

  // Calculate live refund total from edited prices
  const liveTotal = useMemo(
    () => items.reduce((sum, it) => sum + it.editedUnitPrice * (it.qtyToReturn ?? 0), 0),
    [items]
  );

  function updatePrice(index: number, priceStr: string) {
    const parsed = parseFloat(priceStr);
    const price = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, editedUnitPrice: price } : it))
    );
  }

  async function handleConfirm() {
    if (submittingRef.current) return;
    if (!reason.trim()) {
      addToast("Please enter a return reason", "error");
      return;
    }
    submittingRef.current = true;
    if (!submissionKeyRef.current) submissionKeyRef.current = `ret-${saleId}-${crypto.randomUUID()}`;
    setLoading(true);
    try {
      // Enrich each return item with productId/variantId from the original sale
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

      // The attempt's key: both taps of one confirm carry the same one.
      const idempotencyKey = submissionKeyRef.current;

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
      // Done: this attempt's key retires, so the next return is a new return.
      submissionKeyRef.current = null;
      navigate(`/employee/sales/${saleId}/return/success`, { state: { result }, replace: true });
    } catch (e) {
      // The key is KEPT on failure: the return may have been recorded and only the
      // answer lost, so the retry must return that one, not process a second.
      addToast(e instanceof Error ? e.message : "Could not process return.", "error");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={t("returns.confirm")} />

        {/* Estimated refund */}
        <div
          className="mx-4 mt-3 rounded-[var(--radius-card)] p-4 text-center"
          style={{ border: "1px solid var(--divider)" }}
        >
          <p className="text-10 uppercase" style={{ color: "var(--text-secondary)" }}>
            {t("returns.estimatedRefund")}
          </p>
          <p
            className="text-28 font-bold mt-1"
            style={{ color: "var(--text-primary)" }}
          >
            {formatCurrency(liveTotal)}
          </p>
        </div>

        <div className="flex flex-col gap-4 p-4 mt-1">
          {/* Mandatory Return Reason */}
          <div>
            <p
              className="text-xs font-bold uppercase mb-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("returns.reason")}<span style={{ color: "#ef4444" }}>*</span>
            </p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("returns.reasonPlaceholder")}
              className="w-full h-11 rounded-full px-4 text-sm outline-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
            {!reason.trim() && (
              <p className="text-11 mt-1 ms-4" style={{ color: "var(--text-secondary)" }}>
                {t("returns.reasonRequired")}
              </p>
            )}
          </div>

          {/* Items with editable prices */}
          <div>
            <p
              className="text-xs font-bold uppercase mb-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("admin.returningItems")}
            </p>
            <div
              className="rounded-[var(--radius-card)] overflow-hidden"
              style={{ border: "1px solid var(--divider)" }}
            >
              {items.map((item, i) => (
                <div
                  key={item.saleItemId}
                  className="p-4"
                  style={{
                    borderBottom:
                      i < items.length - 1 ? "1px solid var(--divider)" : "none",
                  }}
                >
                  <p
                    className="text-sm font-bold mb-1"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {item.productName} {item.variantName} × {item.qtyToReturn}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Price/unit:
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={item.editedUnitPrice}
                      onChange={(e) => updatePrice(i, e.target.value)}
                      className="w-24 h-8 rounded-[var(--radius-tile)] px-3 text-xs font-bold outline-none text-center"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--divider)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <span
                      className="text-xs font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      = {formatCurrency(item.editedUnitPrice * (item.qtyToReturn ?? 0))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Resolution method */}
          <div>
            <p
              className="text-xs font-bold uppercase mb-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("admin.resolutionMethod")}
            </p>
            <div className="flex gap-2">
              {(
                [
                  { key: "refund_cash", label: t("return.refundCash") },
                  { key: "credit_note", label: t("return.creditNote") },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setResolution(opt.key)}
                  className="flex-1 h-12 rounded-full text-sm font-medium transition-colors"
                  style={{
                    background:
                      resolution === opt.key
                        ? "var(--text-primary)"
                        : "transparent",
                    color:
                      resolution === opt.key
                        ? "var(--background)"
                        : "var(--text-secondary)",
                    border:
                      resolution === opt.key
                        ? "none"
                        : "1px solid var(--divider)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Info banner */}
          <div
            className="rounded-[var(--radius-card)] p-4 flex gap-3"
            style={{ border: "1px solid var(--divider)" }}
          >
            <AlertTriangle
              size={16}
              className="shrink-0 mt-0.5"
              style={{ color: "var(--text-secondary)" }}
            />
            <div>
              <p
                className="text-xs font-bold uppercase mb-1"
                style={{ color: "var(--text-primary)" }}
              >
                {t("admin.refundProcessing")}
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {formatCurrency(liveTotal)} will be{" "}
                {resolution === "refund_cash"
                  ? t("return.returnedDirectly")
                  : t("return.addedAsCreditNote")}{" "}
                {sale
                  ? t("common.originalInvoiceKept", { customer: sale.customerName, invoice: sale.saleNumber })
                  : t("common.toTheCustomer")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <Button
          fullWidth
          size="lg"
          onClick={handleConfirm}
          loading={loading}
          disabled={!reason.trim()}
        >
          {t("returns.confirm")}
        </Button>
      </div>
    </div>
  );
}
