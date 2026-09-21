import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { PaymentBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { supabase } from "@/lib/supabase";
import { ChevronRight, Trash2, Share2, Download, RotateCcw, Clock } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface ReturnRecord {
  id: string;
  returnNumber: string;
  totalRefund: number;
  resolution: string;
  reason: string | null;
  processedByName: string;
  createdAt: string;
  items: {
    productName: string;
    variantName: string;
    qty: number;
    unitPrice: number;
  }[];
}

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function AdminSaleDetailPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const voidingRef = useRef(false);
  const [isVoided, setIsVoided] = useState(false);

  const liveSales = useSalesStore((s) => s.sales);
  const updateNote = useSalesStore((s) => s.updateNote);
  const { addToast } = useUIStore();
  const customers = useCustomersStore((s) => s.customers);
  const sale = liveSales.find((s) => s.id === saleId);
  const customer = sale ? customers.find((c) => c.id === sale.customerId) : null;
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Return history
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(true);

  useEffect(() => { if (sale) setNote(sale.note ?? ""); }, [sale?.id]);

  // Fetch return history
  useEffect(() => {
    if (!saleId) return;
    async function fetchReturnHistory() {
      try {
        const { data: returnRows } = await supabase
          .from("returns")
          .select("id, return_number, total_refund, resolution, reason, processed_by_name, created_at")
          .eq("sale_id", saleId!)
          .order("created_at", { ascending: false });

        if (!returnRows || returnRows.length === 0) {
          setReturns([]);
          setLoadingReturns(false);
          return;
        }

        const returnIds = returnRows.map((r: any) => r.id);
        const { data: returnItemRows } = await supabase
          .from("return_items")
          .select("return_id, product_name, variant_name, qty, unit_price")
          .in("return_id", returnIds);

        const itemsByReturn: Record<string, any[]> = {};
        for (const ri of (returnItemRows ?? [])) {
          const rid = (ri as any).return_id;
          if (!itemsByReturn[rid]) itemsByReturn[rid] = [];
          itemsByReturn[rid].push(ri);
        }

        setReturns(
          returnRows.map((r: any) => ({
            id: r.id,
            returnNumber: r.return_number,
            totalRefund: Number(r.total_refund),
            resolution: r.resolution,
            reason: r.reason,
            processedByName: r.processed_by_name ?? "—",
            createdAt: r.created_at,
            items: (itemsByReturn[r.id] ?? []).map((it: any) => ({
              productName: it.product_name,
              variantName: it.variant_name,
              qty: it.qty,
              unitPrice: Number(it.unit_price),
            })),
          }))
        );
      } catch {} finally {
        setLoadingReturns(false);
      }
    }
    fetchReturnHistory();
  }, [saleId]);

  // Returned qty map
  const returnedQtyMap: Record<string, number> = {};
  for (const ret of returns) {
    for (const ri of ret.items) {
      const key = `${ri.productName}-${ri.variantName}`;
      returnedQtyMap[key] = (returnedQtyMap[key] ?? 0) + ri.qty;
    }
  }

  // 30-day check
  const isWithinReturnWindow = sale
    ? (Date.now() - new Date(sale.createdAt).getTime()) <= 30 * 24 * 60 * 60 * 1000
    : false;

  const totalReturned = returns.reduce((s, r) => s + r.totalRefund, 0);

  if (!sale) return (
    <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "var(--text-secondary)" }}>{t("saleDetail.saleNotFound")}</p>
    </div>
  );

  const COST_RATIO = 0.7;
  const baseCost = sale.items.reduce((s, item) => s + item.lineTotal * COST_RATIO, 0);
  const netProfit = sale.totalAmount - baseCost;

  async function handleSaveNote() {
    if (note === (sale?.note ?? "")) return;
    setSavingNote(true);
    try {
      await updateNote(sale!.id, note);
      addToast(t("saleDetail.noteSaved"), "success");
    } catch {
      addToast(t("saleDetail.couldNotSaveNote"), "error");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleShare() {
    const { renderReceiptBlob } = await import("@/lib/receiptRenderer");
    const blob = await renderReceiptBlob({
      saleNumber: sale!.saleNumber, customerName: sale!.customerName,
      customerPhone: sale!.customerPhone ?? "", employeeName: sale!.employeeName,
      paymentMethod: sale!.paymentMethod ?? "cash", paymentType: sale!.paymentType ?? "full",
      createdAt: sale!.createdAt, totalAmount: sale!.totalAmount, amountPaid: sale!.amountPaid,
      outstandingBalance: sale!.outstandingBalance, subtotal: sale!.subtotal,
      items: sale!.items.map((it) => ({ productName: it.productName, variantName: it.variantName, qty: it.qty, unitPrice: it.unitPrice })),
    }, t);
    if (!blob) { addToast(t("saleDetail.failedReceipt"), "error"); return; }
    const fileName = `receipt-${sale!.saleNumber}.png`;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const base64 = await new Promise<string>((resolve) => { const r = new FileReader(); r.onloadend = () => resolve((r.result as string).split(",")[1]); r.readAsDataURL(blob); });
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
      const fileUri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: t("saleSuccess.saleReceipt"), dialogTitle: t("saleSuccess.shareReceipt"), url: fileUri.uri, files: [fileUri.uri] });
      return;
    } catch {}
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: t("saleSuccess.saleReceipt"), files: [file] }); return; } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url); addToast(t("saleDetail.receiptImageSaved"), "success");
  }

  async function handleDownload() {
    const { renderReceiptBlob } = await import("@/lib/receiptRenderer");
    const blob = await renderReceiptBlob({
      saleNumber: sale!.saleNumber, customerName: sale!.customerName,
      customerPhone: sale!.customerPhone ?? "", employeeName: sale!.employeeName,
      paymentMethod: sale!.paymentMethod ?? "cash", paymentType: sale!.paymentType ?? "full",
      createdAt: sale!.createdAt, totalAmount: sale!.totalAmount, amountPaid: sale!.amountPaid,
      outstandingBalance: sale!.outstandingBalance, subtotal: sale!.subtotal,
      items: sale!.items.map((it) => ({ productName: it.productName, variantName: it.variantName, qty: it.qty, unitPrice: it.unitPrice })),
    }, t);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `receipt-${sale!.saleNumber}.png`; a.click();
      URL.revokeObjectURL(url); addToast(t("saleDetail.receiptDownloaded"), "success");
    }
  }

  async function handleVoid() {
    // A second tap lands before React re-renders, so `disabled` alone would let two
    // void calls out — and the second one would answer "already voided" as an ERROR
    // toast right after the owner successfully voided the sale.
    if (voidingRef.current || !voidReason.trim()) return;
    voidingRef.current = true;
    setVoiding(true);
    try {
      const { rpcVoidSale } = await import("@/lib/db");
      await rpcVoidSale(sale!.id, voidReason.trim());
      setIsVoided(true);
      setShowVoidDialog(false);
      addToast("Sale voided successfully", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to void sale", "error");
    } finally {
      voidingRef.current = false;
      setVoiding(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("sales.saleDetails")} />

      {isVoided && (
        <div className="mx-4 mt-2 rounded-xl p-3 text-center" style={{ background: "#fee2e2", border: "1px solid #fca5a5" }}>
          <p className="text-sm font-bold" style={{ color: "#dc2626" }}>{t("admin.saleVoided")}</p>
          {voidReason && <p className="text-xs mt-0.5" style={{ color: "#ef4444" }}>Reason: {voidReason}</p>}
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        {/* Customer card */}
        <button
          onClick={() => navigate(`/admin/customers/${sale.customerId}`)}
          className="flex items-center justify-between rounded-[14px] p-4 text-start w-full transition-opacity active:opacity-70"
          style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}
        >
          <div className="flex items-center gap-3">
            {customer?.imageUrl ? (
              <img src={customer.imageUrl} alt={sale.customerName} className="size-11 rounded-full object-cover shrink-0" />
            ) : (
              <div className="size-11 rounded-full shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: initBgColor(sale.customerName), color: "#fff" }}>
                {(sale.customerName || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatDateTime(sale.createdAt)}</p>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
        </button>

        {/* Items sold with return badges */}
        <div>
          <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("sales.itemsSold")}
          </p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {sale.items.map((item, i) => {
              const itemCost = item.lineTotal * COST_RATIO;
              const itemProfit = item.lineTotal - itemCost;
              const key = `${item.productName}-${item.variantName}`;
              const returned = returnedQtyMap[key] ?? 0;
              const isFullyReturned = returned >= item.qty;
              const isPartialReturned = returned > 0 && returned < item.qty;

              return (
                <div
                  key={item.id}
                  className="flex justify-between p-4"
                  style={{ borderBottom: i < sale.items.length - 1 ? "1px solid var(--divider)" : "none" }}
                >
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {item.productName} {item.variantName}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatCurrency(item.unitPrice)} × {item.qty}
                    </p>
                    <p className="text-xs" style={{ color: "var(--brand-dark)" }}>
                      Profit: {formatCurrency(Math.round(itemProfit))}
                    </p>
                    {isFullyReturned && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                        {t("saleDetail.returned")}
                      </span>
                    )}
                    {isPartialReturned && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(245,158,11,0.1)", color: "#d97706" }}>
                        Partial return ({returned}/{item.qty})
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(item.lineTotal)}
                  </p>
                </div>
              );
            })}
            {/* Sold by */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--divider)", background: "var(--surface-2)" }}>
              <div className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: initBgColor(sale.employeeName), color: "#fff" }}>
                {(sale.employeeName || '?').charAt(0).toUpperCase()}
              </div>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {t("saleDetail.soldBy")} <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{sale.employeeName}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Return History */}
        {returns.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("saleDetail.returnHistory")}
            </p>
            <div className="flex flex-col gap-3">
              {returns.map((ret) => (
                <div key={ret.id} className="rounded-[14px] p-4" style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{ret.returnNumber}</p>
                      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{formatDateTime(ret.createdAt)}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
                      background: ret.resolution === "refund_cash" ? "rgba(132,204,22,0.12)" : "rgba(59,130,246,0.12)",
                      color: ret.resolution === "refund_cash" ? "var(--brand-dark)" : "#2563eb",
                    }}>
                      {ret.resolution === "refund_cash" ? t("saleDetail.cashRefund") : t("saleDetail.creditNote")}
                    </span>
                  </div>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                    {t("saleDetail.processedBy")} <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{ret.processedByName}</span>
                  </p>
                  {ret.reason && (
                    <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                      {t("saleDetail.reason")} <span style={{ color: "var(--text-primary)" }}>{ret.reason}</span>
                    </p>
                  )}
                  <div className="mt-2">
                    {ret.items.map((rit, j) => (
                      <p key={j} className="text-xs" style={{ color: "var(--text-primary)" }}>
                        {rit.productName} {rit.variantName} × {rit.qty} — {formatCurrency(rit.unitPrice * rit.qty)}
                      </p>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                    <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>{t("saleDetail.refund")}</span>
                    <span className="text-sm font-bold" style={{ color: "#ef4444" }}>{formatCurrency(ret.totalRefund)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payment summary + note */}
        <div className="rounded-[14px] p-4 flex flex-col gap-2" style={{ border: "1px solid var(--divider)" }}>
          <div className="flex justify-between">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sale.subtotal")}</span>
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(sale.subtotal)}</span>
          </div>
          {totalReturned > 0 && (
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("saleDetail.returns")}</span>
              <span className="text-sm font-bold" style={{ color: "#ef4444" }}>-{formatCurrency(totalReturned)}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {t("sales.method")}: {sale.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer")}
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("sales.status")}</p>
            </div>
            <PaymentBadge type={sale.paymentType} outstandingBalance={sale.outstandingBalance} />
          </div>
          {sale.outstandingBalance > 0 && (
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sales.outstandingBalance")}</span>
              <span className="text-sm font-bold" style={{ color: "#d97706" }}>{formatCurrency(sale.outstandingBalance)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 mt-1" style={{ borderTop: "1px solid var(--divider)" }}>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("admin.baseCost")}</span>
            <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>{formatCurrency(Math.round(baseCost))}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.netProfit")}</span>
            <span className="text-base font-bold" style={{ color: "#16a34a" }}>{formatCurrency(Math.round(netProfit))}</span>
          </div>
          {/* Note */}
          <div className="pt-2 mt-1" style={{ borderTop: "1px solid var(--divider)" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("saleDetail.note")}</p>
              {note !== (sale.note ?? "") && (
                <button onClick={handleSaveNote} disabled={savingNote} className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
                  {savingNote ? t("saleDetail.saving") : t("saleDetail.save")}
                </button>
              )}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("saleDetail.addNote")} rows={3}
              className="w-full rounded-[12px] px-4 py-3 text-sm resize-none outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={handleShare} className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full text-sm font-medium transition-colors"
            style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>
            <Share2 size={14} /> {t("saleDetail.share")}
          </button>
          <button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full text-sm font-medium transition-colors"
            style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>
            <Download size={14} /> {t("saleDetail.download")}
          </button>
        </div>

        {/* Return button — admin can return any sale */}
        {isWithinReturnWindow ? (
          <button
            onClick={() => navigate(`/admin/sales/${sale.id}/return`)}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            <RotateCcw size={15} />
            {t("sales.return")}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 w-full h-12 rounded-full text-sm"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-secondary)", background: "var(--surface-2)" }}>
            <Clock size={15} /> {t("saleDetail.returnWindowExpired")}
          </div>
        )}

        {/* Void button */}
        {!isVoided && (
          <button onClick={() => setShowVoidDialog(true)}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid #ef4444", color: "#ef4444", background: "transparent" }}>
            <Trash2 size={15} /> {t("admin.voidSale")}
          </button>
        )}
      </div>

      {/* Void dialog */}
      {showVoidDialog && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowVoidDialog(false)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center"><div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} /></div>
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>
              {t("admin.voidConfirmTitle", { number: sale?.saleNumber ?? "" })}
            </p>
            <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
              {t("admin.voidConfirm", { number: sale?.saleNumber ?? "" })}
            </p>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>{t("admin.voidReason")}</p>
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={t("sale.voidReasonPlaceholder")}
                className="w-full h-11 rounded-full px-4 text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowVoidDialog(false)} disabled={voiding} className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>{t("common.cancel")}</button>
              <button onClick={handleVoid} disabled={!voidReason.trim() || voiding} className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--error)", color: "#fff" }}>{voiding ? t("admin.voiding") : t("admin.voidSale")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
