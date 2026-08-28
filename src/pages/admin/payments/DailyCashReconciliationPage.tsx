import { useMemo, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { Calculator, CheckCircle, AlertTriangle } from "lucide-react";

export default function DailyCashReconciliationPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const sales = useSalesStore((s) => s.sales);
  const { addToast } = useUIStore();

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [countedCash, setCountedCash] = useState("");
  const [saved, setSaved] = useState(false);

  const reconciliation = useMemo(() => {
    const dayStart = new Date(selectedDate + "T00:00:00");
    const dayEnd = new Date(selectedDate + "T23:59:59");

    const daySales = sales.filter((s) => {
      const d = new Date(s.createdAt);
      return !s.isVoided && d >= dayStart && d <= dayEnd;
    });

    const paidSales = daySales.filter((s) => s.paymentType === "full" && s.paymentMethod === "cash");
    const partialCashSales = daySales.filter((s) => s.paymentType === "partial" && s.paymentMethod === "cash");

    const expectedCash =
      paidSales.reduce((sum, s) => sum + s.totalAmount, 0) +
      partialCashSales.reduce((sum, s) => sum + s.amountPaid, 0);

    const totalCounted = Number(countedCash) || 0;
    const variance = totalCounted - expectedCash;

    return {
      totalSales: daySales.length,
      paidCashCount: paidSales.length,
      partialCashCount: partialCashSales.length,
      expectedCash,
      totalCounted,
      variance,
      hasData: daySales.length > 0,
    };
  }, [sales, selectedDate, countedCash]);

  function handleSave() {
    if (!countedCash || Number(countedCash) <= 0) {
      addToast("Enter the counted cash amount", "warning");
      return;
    }
    setSaved(true);
    addToast("Cash reconciliation saved", "success");
  }

  const varianceColor =
    reconciliation.variance === 0
      ? "#22c55e"
      : Math.abs(reconciliation.variance) <= 100
        ? "#d97706"
        : "var(--error)";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Daily Cash Reconciliation" backTo="/admin/payments" />

      <div className="flex flex-col gap-4 p-4">
        {/* Date selector */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Select Date</p>
          <input
            type="date"
            value={selectedDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => { setSelectedDate(e.target.value); setSaved(false); setCountedCash(""); }}
            className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          />
        </div>

        {/* Expected cash summary */}
        <div className="rounded-[14px] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>Expected Cash</p>

          {!reconciliation.hasData ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No sales recorded for this date</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Total Sales</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{reconciliation.totalSales}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Full Payment (Cash)</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{reconciliation.paidCashCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Partial Payment (Cash)</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{reconciliation.partialCashCount}</span>
              </div>
              <div className="border-t my-1" style={{ borderColor: "var(--divider)" }} />
              <div className="flex justify-between">
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Expected Cash</span>
                <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(reconciliation.expectedCash)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Counted cash input */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Counted Cash</p>
          <div className="relative">
            <Calculator size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text-secondary)" }} />
            <input
              type="number"
              inputMode="numeric"
              value={countedCash}
              onChange={(e) => { setCountedCash(e.target.value); setSaved(false); }}
              placeholder="Enter physically counted cash"
              className="w-full h-12 rounded-[24px] pl-10 pr-4 text-sm outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* Variance display */}
        {countedCash && Number(countedCash) > 0 && (
          <div className="rounded-[14px] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Variance</p>
            <div className="flex items-center gap-3">
              {reconciliation.variance === 0 ? (
                <CheckCircle size={20} style={{ color: "#22c55e" }} />
              ) : (
                <AlertTriangle size={20} style={{ color: varianceColor }} />
              )}
              <div>
                <p className="text-lg font-bold" style={{ color: varianceColor }}>
                  {reconciliation.variance >= 0 ? "+" : ""}{formatCurrency(reconciliation.variance)}
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {reconciliation.variance === 0
                    ? "Cash matches expected amount"
                    : reconciliation.variance > 0
                      ? "Over — more cash than expected"
                      : "Short — less cash than expected"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        {!saved && (
          <button
            onClick={handleSave}
            disabled={!countedCash || Number(countedCash) <= 0}
            className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            Save Reconciliation
          </button>
        )}

        {saved && (
          <div className="flex items-center justify-center gap-2 py-3">
            <CheckCircle size={18} style={{ color: "#22c55e" }} />
            <p className="text-sm font-medium" style={{ color: "#22c55e" }}>Saved successfully</p>
          </div>
        )}
      </div>
    </div>
  );
}
