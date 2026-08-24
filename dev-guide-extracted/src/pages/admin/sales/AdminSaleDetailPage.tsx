import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { PaymentBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { ChevronRight, Trash2 } from "lucide-react";

export default function AdminSaleDetailPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [note, setNote] = useState("");
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [isVoided, setIsVoided] = useState(false);

  const liveSales = useSalesStore((s) => s.sales);
  const sale = liveSales.find((s) => s.id === saleId);

  if (!sale) return (
    <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "var(--text-secondary)" }}>Sale not found</p>
    </div>
  );

  const COST_RATIO = 0.7;
  const baseCost = sale.items.reduce((s, item) => s + item.lineTotal * COST_RATIO, 0);
  const netProfit = sale.totalAmount - baseCost;

  function handleVoid() {
    setIsVoided(true);
    setShowVoidDialog(false);
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("sales.saleDetails")}
        backLabel={t("admin.sales")}
        backTo="/admin/sales"
        right={
          <div
            className="px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            Admin
          </div>
        }
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
        {/* Customer card */}
        <button
          onClick={() => navigate(`/admin/customers/${sale.customerId}`)}
          className="flex items-center justify-between rounded-[14px] p-4 text-left w-full transition-opacity active:opacity-70"
          style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}
        >
          <div>
            <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatDateTime(sale.createdAt)}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("sales.employee")}: {sale.employeeName}
            </p>
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
          </div>
        </div>

        {/* Payment summary + profit */}
        <div
          className="rounded-[14px] p-4 flex flex-col gap-2"
          style={{ border: "1px solid var(--divider)" }}
        >
          <div className="flex justify-between">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.baseCost")}</span>
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(Math.round(baseCost))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sale.subtotal")}</span>
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(sale.subtotal)}
            </span>
          </div>
          {sale.outstandingBalance > 0 && (
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sales.outstandingBalance")}</span>
              <span className="text-sm font-bold" style={{ color: "#d97706" }}>
                {formatCurrency(sale.outstandingBalance)}
              </span>
            </div>
          )}
          <div
            className="flex justify-between items-center pt-2 mt-1"
            style={{ borderTop: "1px solid var(--divider)" }}
          >
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {t("admin.netProfit")}
            </span>
            <span className="text-base font-bold" style={{ color: "#16a34a" }}>
              {formatCurrency(Math.round(netProfit))}
            </span>
          </div>
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
        </div>

        {/* Note field */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
            Note
          </p>
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
                className="flex-1 h-12 rounded-full text-sm font-bold"
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
