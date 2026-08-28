import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { rpcRecordCustomerPayment } from "@/lib/db";
import { formatCurrency } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { notifyPaymentReceived } from "@/lib/notifications";
import { Plus, Minus } from "lucide-react";

export default function RecordCustomerPaymentPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const { addToast } = useUIStore();
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!customer) return null;

  const paid       = Number(amount) || 0;
  const newBalance = Math.max(0, customer.outstandingBalance - paid);

  async function handleConfirm() {
    setError("");
    if (!paid || paid <= 0) { setError(t("recordPayment.errEmpty")); return; }
    if (paid > customer!.outstandingBalance) { setError(t("recordPayment.errExceeds")); return; }

    setLoading(true);
    try {
      await rpcRecordCustomerPayment({
        customerId: customer!.id,
        amount: paid,
        method,
        notes,
      });
      addToast(`${formatCurrency(paid)} recorded`, "success");
      notifyPaymentReceived(customer!.name, paid, customer!.id);
      navigate(`${base}/customers/${customerId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader
          title={t("recordPayment.title")}
          backTo={`${base}/customers/${customerId}`}
        />

        {/* Outstanding card — brand lime accent */}
        <div
          className="mx-4 mt-3 rounded-[14px] p-5 text-center animate-fade-in-up"
          style={{ background: "var(--brand)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(0,0,0,0.55)" }}>
            {customer.name} · {t("recordPayment.outstanding")}
          </p>
          <p className="text-[32px] font-bold mt-1" style={{ color: "#0a0a0a" }}>
            {formatCurrency(customer.outstandingBalance)}
          </p>
        </div>

        <div className="flex flex-col gap-5 p-4 mt-2">
          {/* Amount input */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("recordPayment.amountLabel")}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAmount(String(Math.max(0, (Number(amount) || 0) - 100)))}
                className="w-11 h-12 rounded-full flex items-center justify-center shrink-0 active:opacity-70"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
              >
                <Minus size={16} style={{ color: "var(--text-primary)" }} />
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("recordPayment.amountHint")}
                className="flex-1 h-12 rounded-[24px] px-4 text-sm font-bold text-center outline-none"
                style={{
                  background: "var(--surface-2)",
                  border: `1px solid ${error ? "var(--error)" : "var(--divider)"}`,
                  color: "var(--text-primary)",
                }}
              />
              <button
                onClick={() => setAmount(String(Math.min(customer!.outstandingBalance, (Number(amount) || 0) + 100)))}
                className="w-11 h-12 rounded-full flex items-center justify-center shrink-0 active:opacity-70"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                <Plus size={16} strokeWidth={2.5} />
              </button>
            </div>
            {error && <p className="text-xs mt-1" style={{ color: "var(--error)" }}>{error}</p>}
          </div>

          {/* Payment method */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("recordPayment.method")}
            </p>
            <div className="flex gap-2">
              {([
                { key: "cash",          label: t("sale.cash") },
                { key: "bank_transfer", label: t("sale.bankTransfer") },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMethod(m.key)}
                  className="flex-1 h-11 rounded-full text-sm font-semibold transition-colors"
                  style={{
                    background: method === m.key ? "var(--brand)" : "var(--surface-2)",
                    color: method === m.key ? "#0a0a0a" : "var(--text-secondary)",
                    border: method === m.key ? "none" : "1px solid var(--divider)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("recordPayment.notes")}
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("recordPayment.notesHint")}
              rows={3}
              className="w-full rounded-xl p-3 text-sm outline-none resize-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* New balance preview */}
          {paid > 0 && (
            <div
              className="flex justify-between items-center px-4 py-3 rounded-[12px] animate-fade-in-up"
              style={{ background: "var(--surface-2)" }}
            >
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {t("recordPayment.newBalance")}
              </span>
              <span
                className="text-sm font-bold"
                style={{ color: newBalance === 0 ? "var(--brand-dark)" : "var(--text-primary)" }}
              >
                {formatCurrency(newBalance)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleConfirm}
          disabled={loading || !amount}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? t("common.loading") : t("recordPayment.confirm")}
        </button>
      </div>
    </div>
  );
}
