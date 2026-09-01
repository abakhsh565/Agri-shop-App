import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { PaymentBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { supabase } from "@/lib/supabase";
import { ChevronRight, RotateCcw, Share2, Download, Clock } from "lucide-react";
import { useShellBase } from "@/lib/useShellBase";

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

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function SaleDetailPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const liveSales = useSalesStore((s) => s.sales);
  const sale = liveSales.find((s) => s.id === saleId);
  const customers = useCustomersStore((s) => s.customers);
  const customer = sale ? customers.find((c) => c.id === sale.customerId) : null;
  const currentUser = useAuthStore((s) => s.user);

  // Return history state
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(true);

  // Fetch return history for this sale
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
      } catch {
        // Returns table may not exist yet
      } finally {
        setLoadingReturns(false);
      }
    }
    fetchReturnHistory();
  }, [saleId]);

  // Calculate returned qty per item
  const returnedQtyMap: Record<string, number> = {};
  for (const ret of returns) {
    for (const ri of ret.items) {
      const key = `${ri.productName}-${ri.variantName}`;
      returnedQtyMap[key] = (returnedQtyMap[key] ?? 0) + ri.qty;
    }
  }

  // Check 30-day window
  const isWithinReturnWindow = sale
    ? (Date.now() - new Date(sale.createdAt).getTime()) <= 30 * 24 * 60 * 60 * 1000
    : false;

  // Check authorization: employee can only see Return button on their own sales
  const canReturn = sale && currentUser && sale.employeeId === currentUser.id && isWithinReturnWindow;

  // Calculate net total
  const totalReturned = returns.reduce((s, r) => s + r.totalRefund, 0);

  // Note state — must be before any conditional return
  const updateNote = useSalesStore((s) => s.updateNote);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const { addToast } = useUIStore.getState();

  useEffect(() => { if (sale) setNote(sale.note ?? ""); }, [sale?.id]);

  if (!sale) return (
    <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "var(--text-secondary)" }}>Sale not found</p>
    </div>
  );

  async function handleSaveNote() {
    if (note === (sale?.note ?? "")) return;
    setSavingNote(true);
    try {
      await updateNote(sale!.id, note);
      addToast("Note saved", "success");
    } catch {
      addToast("Could not save note", "error");
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
    });
    if (!blob) { addToast("Failed to generate receipt", "error"); return; }
    const fileName = `receipt-${sale!.saleNumber}.png`;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const base64 = await new Promise<string>((resolve) => { const r = new FileReader(); r.onloadend = () => resolve((r.result as string).split(",")[1]); r.readAsDataURL(blob); });
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
      const fileUri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "AgriShop Receipt", dialogTitle: "Share Receipt", url: fileUri.uri, files: [fileUri.uri] });
      return;
    } catch {}
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: "AgriShop Receipt", files: [file] }); return; } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url); addToast("Receipt image saved", "success");
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
    });
    if (!blob) { addToast("Failed to generate receipt", "error"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `receipt-${sale!.saleNumber}.png`; a.click();
    URL.revokeObjectURL(url); addToast("Receipt downloaded", "success");
  }

  const summaryRows = [
    { label: t("sale.subtotal"),             value: formatCurrency(sale.subtotal),             bold: false },
    { label: t("sales.amountPaid"),          value: formatCurrency(sale.amountPaid),          bold: false },
    ...(totalReturned > 0
      ? [{ label: "Returns", value: `-${formatCurrency(totalReturned)}`, bold: false, color: "#ef4444" }]
      : []),
    ...(sale.outstandingBalance > 0
      ? [{ label: t("sales.outstandingBalance"), value: formatCurrency(sale.outstandingBalance), bold: false, color: "#d97706" }]
      : []),
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("sales.saleDetails")} />

      <div className="flex flex-col gap-4 p-4">
        {/* Customer card */}
        <button
          onClick={() => navigate(`${base}/customers/${sale.customerId}`)}
          className="flex items-center justify-between rounded-[14px] p-4 text-start w-full transition-opacity active:opacity-70"
          style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}
        >
          <div className="flex items-center gap-3">
            {customer?.imageUrl ? (
              <img src={customer.imageUrl} alt={sale.customerName} className="size-11 rounded-full object-cover shrink-0" />
            ) : (
              <div className="size-11 rounded-full shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: initBgColor(sale.customerName), color: "#fff" }}>
                {sale.customerName.charAt(0).toUpperCase()}
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
                    {isFullyReturned && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                        Returned
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
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderTop: "1px solid var(--divider)", background: "var(--surface-2)" }}
            >
              <div
                className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: initBgColor(sale.employeeName), color: "#fff" }}
              >
                {sale.employeeName.charAt(0).toUpperCase()}
              </div>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Sold by <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{sale.employeeName}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Return History */}
        {returns.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Return History
            </p>
            <div className="flex flex-col gap-3">
              {returns.map((ret) => (
                <div
                  key={ret.id}
                  className="rounded-[14px] p-4"
                  style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                        {ret.returnNumber}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {formatDateTime(ret.createdAt)}
                      </p>
                    </div>
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: ret.resolution === "refund_cash" ? "rgba(132,204,22,0.12)" : "rgba(59,130,246,0.12)",
                        color: ret.resolution === "refund_cash" ? "var(--brand-dark)" : "#2563eb",
                      }}
                    >
                      {ret.resolution === "refund_cash" ? "Cash Refund" : "Credit Note"}
                    </span>
                  </div>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                    Returned by: <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{ret.processedByName}</span>
                  </p>
                  {ret.reason && (
                    <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                      Reason: <span style={{ color: "var(--text-primary)" }}>{ret.reason}</span>
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
                    <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>Refund</span>
                    <span className="text-sm font-bold" style={{ color: "#ef4444" }}>{formatCurrency(ret.totalRefund)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payment summary */}
        <div
          className="rounded-[14px] p-4 flex flex-col gap-2"
          style={{ border: "1px solid var(--divider)" }}
        >
          {summaryRows.map((row) => (
            <div key={row.label} className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{row.label}</span>
              <span
                className="text-sm font-bold"
                style={{ color: (row as any).color || "var(--text-primary)" }}
              >
                {row.value}
              </span>
            </div>
          ))}
          <div
            className="flex justify-between items-center pt-2 mt-1"
            style={{ borderTop: "1px solid var(--divider)" }}
          >
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {t("sales.method")}: {sale.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer")}
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("sales.status")}</p>
            </div>
            <PaymentBadge type={sale.paymentType} outstandingBalance={sale.outstandingBalance} />
          </div>
          {/* Note */}
          <div className="pt-2 mt-1" style={{ borderTop: "1px solid var(--divider)" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Note
              </p>
              {note !== (sale.note ?? "") && (
                <button
                  onClick={handleSaveNote}
                  disabled={savingNote}
                  className="text-xs font-bold px-3 py-1 rounded-full"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {savingNote ? "Saving..." : "Save"}
                </button>
              )}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              className="w-full rounded-[12px] px-4 py-3 text-sm resize-none outline-none"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full text-sm font-medium transition-colors"
            style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Share2 size={14} />
            Share
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full text-sm font-medium transition-colors"
            style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Download size={14} />
            Download
          </button>
        </div>

        {/* Return button — only shown if authorized and within 30-day window */}
        {canReturn ? (
          <button
            onClick={() => navigate(`${base}/sales/${sale.id}/return`)}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            <RotateCcw size={15} />
            {t("sales.return")}
          </button>
        ) : sale && !isWithinReturnWindow ? (
          <div
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full text-sm"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-secondary)", background: "var(--surface-2)" }}
          >
            <Clock size={15} />
            <span>Return window expired (30 days)</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
