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
import { ChevronRight, RotateCcw, Share2, Download } from "lucide-react";
import { useShellBase } from "@/lib/useShellBase";

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

  if (!sale) return (
    <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "var(--text-secondary)" }}>Sale not found</p>
    </div>
  );

  const updateNote = useSalesStore((s) => s.updateNote);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const { addToast } = useUIStore.getState();

  // Sync note from DB when sale loads
  useEffect(() => { if (sale) setNote(sale.note ?? ""); }, [sale?.id]);

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
    // Try Capacitor native share
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const base64 = await new Promise<string>((resolve) => { const r = new FileReader(); r.onloadend = () => resolve((r.result as string).split(",")[1]); r.readAsDataURL(blob); });
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
      const fileUri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "AgriShop Receipt", dialogTitle: "Share Receipt", url: fileUri.uri, files: [fileUri.uri] });
      return;
    } catch {}
    // Try Web Share API
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: "AgriShop Receipt", files: [file] }); return; } catch {}
    }
    // Fallback: download
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
        {/* Customer card with image */}
        <button
          onClick={() => navigate(`/employee/customers/${sale.customerId}`)}
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
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
        </button>

        {/* Items sold */}
        <div>
          <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("sales.itemsSold")}
          </p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {sale.items.map((item, i) => (
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
                </div>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {formatCurrency(item.lineTotal)}
                </p>
              </div>
            ))}
          </div>
        </div>

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
                style={{ color: row.label === t("sales.outstandingBalance") ? "#d97706" : "var(--text-primary)" }}
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

        {/* Return button */}
        <button
          onClick={() => navigate(`/employee/sales/${sale.id}/return`)}
          className="flex items-center justify-center gap-2 w-full h-12 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
          style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
        >
          <RotateCcw size={15} />
          {t("sales.return")}
        </button>
      </div>
    </div>
  );
}
