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
import { useUIStore } from "@/stores/uiStore";
import { ChevronRight, Trash2, Share2, Download } from "lucide-react";

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
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
  const [isVoided, setIsVoided] = useState(false);

  const liveSales = useSalesStore((s) => s.sales);
  const updateNote = useSalesStore((s) => s.updateNote);
  const { addToast } = useUIStore();
  const customers = useCustomersStore((s) => s.customers);
  const sale = liveSales.find((s) => s.id === saleId);
  const customer = sale ? customers.find((c) => c.id === sale.customerId) : null;
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Sync note from DB when sale loads
  useEffect(() => { if (sale) setNote(sale.note ?? ""); }, [sale?.id]);

  if (!sale) return (
    <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "var(--text-secondary)" }}>Sale not found</p>
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
      addToast("Note saved", "success");
    } catch {
      addToast("Could not save note", "error");
    } finally {
      setSavingNote(false);
    }
  }

  function buildReceiptText() {
    return `AgriShop Receipt\n#${sale!.saleNumber}\nCustomer: ${sale!.customerName}\nTotal: ${formatCurrency(sale!.totalAmount)}\nPaid: ${formatCurrency(sale!.amountPaid)}\nDate: ${formatDateTime(sale!.createdAt)}\nSold by: ${sale!.employeeName}`;
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
    // Generate receipt as image via canvas (reuse SaleSuccessPage logic)
    try {
      const { renderReceiptBlob } = await import("@/lib/receiptRenderer");
      const blob = await renderReceiptBlob({
        saleNumber: sale!.saleNumber,
        customerName: sale!.customerName,
        customerPhone: sale!.customerPhone ?? "",
        employeeName: sale!.employeeName,
        paymentMethod: sale!.paymentMethod ?? "cash",
        paymentType: sale!.paymentType ?? "full",
        createdAt: sale!.createdAt,
        totalAmount: sale!.totalAmount,
        amountPaid: sale!.amountPaid,
        outstandingBalance: sale!.outstandingBalance,
        subtotal: sale!.subtotal,
        items: sale!.items.map((it) => ({ productName: it.productName, variantName: it.variantName, qty: it.qty, unitPrice: it.unitPrice })),
      });
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `receipt-${sale!.saleNumber}.png`;
        a.click();
        URL.revokeObjectURL(url);
        addToast("Receipt downloaded", "success");
        return;
      }
    } catch {}
    // Fallback: CSV
    const rows = [
      ["Sale #", sale!.saleNumber],
      ["Customer", sale!.customerName],
      ["Date", formatDateTime(sale!.createdAt)],
      ["Sold by", sale!.employeeName],
      ...sale!.items.map((it) => [it.productName + " " + it.variantName, `${it.qty} × ${formatCurrency(it.unitPrice)}`]),
      ["Total", formatCurrency(sale!.totalAmount)],
      ["Paid", formatCurrency(sale!.amountPaid)],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob2 = new Blob([csv], { type: "text/csv" });
    const url2 = URL.createObjectURL(blob2);
    const a2 = document.createElement("a");
    a2.href = url2; a2.download = `sale-${sale!.saleNumber}.csv`; a2.click();
    URL.revokeObjectURL(url2);
    addToast("Sale exported as CSV", "success");
  }

  async function handleVoid() {
    if (!voidReason.trim()) return;
    try {
      const { rpcVoidSale } = await import("@/lib/db");
      await rpcVoidSale(sale!.id, voidReason.trim());
      setIsVoided(true);
      setShowVoidDialog(false);
      addToast("Sale voided successfully", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to void sale", "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("sales.saleDetails")}
        backTo="/admin/sales"
      />

      {/* Void banner */}
      {isVoided && (
        <div
          className="mx-4 mt-2 rounded-xl p-3 text-center"
          style={{ background: "#fee2e2", border: "1px solid #fca5a5" }}
        >
          <p className="text-sm font-bold" style={{ color: "#dc2626" }}>This sale has been voided</p>
          {voidReason && <p className="text-xs mt-0.5" style={{ color: "#ef4444" }}>Reason: {voidReason}</p>}
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        {/* Customer card with image */}
        <button
          onClick={() => navigate(`/admin/customers/${sale.customerId}`)}
          className="flex items-center justify-between rounded-[14px] p-4 text-left w-full transition-opacity active:opacity-70"
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
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Sold by: {sale.employeeName}
              </p>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
        </button>

        {/* Items sold with profit per line */}
        <div>
          <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("sales.itemsSold")}
          </p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {sale.items.map((item, i) => {
              const itemCost = item.lineTotal * COST_RATIO;
              const itemProfit = item.lineTotal - itemCost;
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
                  </div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(item.lineTotal)}
                  </p>
                </div>
              );
            })}
            {/* Sold by — admin only */}
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

        {/* Payment summary + note grouped */}
        <div
          className="rounded-[14px] p-4 flex flex-col gap-2"
          style={{ border: "1px solid var(--divider)" }}
        >
          {/* Subtotal + Payment method first */}
          <div className="flex justify-between">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sale.subtotal")}</span>
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(sale.subtotal)}
            </span>
          </div>
          <div
            className="flex justify-between items-center"
          >
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
              <span className="text-sm font-bold" style={{ color: "#d97706" }}>
                {formatCurrency(sale.outstandingBalance)}
              </span>
            </div>
          )}
          {/* Base cost + Net profit at bottom */}
          <div className="flex justify-between pt-2 mt-1" style={{ borderTop: "1px solid var(--divider)" }}>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("admin.baseCost")}</span>
            <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
              {formatCurrency(Math.round(baseCost))}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {t("admin.netProfit")}
            </span>
            <span className="text-base font-bold" style={{ color: "#16a34a" }}>
              {formatCurrency(Math.round(netProfit))}
            </span>
          </div>
          {/* Note — inside payment card */}
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

        {/* Actions — Share + Download only (Export removed, was duplicate) */}
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

        {/* Void button */}
        {!isVoided && (
          <button
            onClick={() => setShowVoidDialog(true)}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid #ef4444", color: "#ef4444", background: "transparent" }}
          >
            <Trash2 size={15} />
            {t("admin.voidSale")}
          </button>
        )}
      </div>

      {/* Void dialog */}
      {showVoidDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowVoidDialog(false)}
        >
          <div
            className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>
              {t("admin.voidSale")}
            </p>
            <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
              {t("admin.voidConfirm")}
            </p>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("admin.voidReason")}
              </p>
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Customer returned goods"
                className="w-full h-11 rounded-full px-4 text-sm outline-none"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--divider)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowVoidDialog(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleVoid}
                disabled={!voidReason.trim()}
                className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                {t("admin.voidSale")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
