import { useRef, useState } from "react";
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
import { Plus, Minus, Layers } from "lucide-react";

type SplitRow = { amount: string; method: "cash" | "bank_transfer" };

const METHODS = [
  { key: "cash" as const, labelKey: "sale.cash" },
  { key: "bank_transfer" as const, labelKey: "sale.bankTransfer" },
];

export default function RecordCustomerPaymentPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const { addToast } = useUIStore();
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));

  // Single payment state
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // One confirm = one payment. The button's `disabled` only applies after React
  // re-renders, so a double tap reaches this function twice; the ref stops the
  // second call synchronously, and the key — minted once per attempt and held —
  // makes the database return the first payment instead of recording a second
  // one if the answer to the first call was lost.
  const submittingRef = useRef(false);
  const submissionKeyRef = useRef<string | null>(null);

  // Split payment state
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>([
    { amount: "", method: "cash" },
    { amount: "", method: "bank_transfer" },
  ]);

  if (!customer) return null;

  // Calculate total based on mode
  const totalPaid = splitMode
    ? splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
    : Number(amount) || 0;
  const newBalance = Math.max(0, customer.outstandingBalance - totalPaid);

  function updateSplit(index: number, field: keyof SplitRow, value: string) {
    setSplits((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }

  function addSplit() {
    setSplits((prev) => [...prev, { amount: "", method: "cash" }]);
  }

  function removeSplit(index: number) {
    if (splits.length <= 2) return; // minimum 2 splits
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  function autoFillRemaining() {
    const filled = splits.reduce((sum, s, i) => {
      // skip the last row
      return i < splits.length - 1 ? sum + (Number(s.amount) || 0) : sum;
    }, 0);
    const remaining = Math.max(0, (customer?.outstandingBalance ?? 0) - filled);
    updateSplit(splits.length - 1, "amount", String(remaining));
  }

  async function handleConfirm() {
    if (submittingRef.current) return;
    setError("");
    if (totalPaid <= 0) { setError(t("recordPayment.errEmpty")); return; }
    if (totalPaid > customer!.outstandingBalance) { setError(t("recordPayment.errExceeds")); return; }

    // Validate splits
    if (splitMode) {
      for (let i = 0; i < splits.length; i++) {
        if ((Number(splits[i].amount) || 0) <= 0) {
          setError(`Split ${i + 1}: amount must be positive`);
          return;
        }
      }
    }

    submittingRef.current = true;
    if (!submissionKeyRef.current) submissionKeyRef.current = crypto.randomUUID();
    setLoading(true);
    try {
      if (splitMode) {
        await rpcRecordCustomerPayment({
          customerId: customer!.id,
          notes,
          idempotencyKey: submissionKeyRef.current,
          splits: splits
            .filter((s) => (Number(s.amount) || 0) > 0)
            .map((s) => ({ amount: Number(s.amount), method: s.method })),
        });
      } else {
        await rpcRecordCustomerPayment({
          customerId: customer!.id,
          amount: totalPaid,
          method,
          notes,
          idempotencyKey: submissionKeyRef.current,
        });
      }
      // Done: this attempt's key retires, so the next payment is a new payment.
      submissionKeyRef.current = null;
      // Invalidate cache so load() fetches fresh data from Supabase
      try {
        localStorage.removeItem("agrishop_cache_customers");
        await useCustomersStore.getState().load();
      } catch {}
      addToast(`${formatCurrency(totalPaid)} recorded`, "success");
      notifyPaymentReceived(customer!.name, totalPaid, customer!.id);
      navigate(`${base}/customers/${customerId}`, { replace: true });
    } catch (e) {
      // The key is KEPT on failure: the attempt may have reached the database and
      // only the answer was lost, so the retry must not be a new payment.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submittingRef.current = false;
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

        {/* Outstanding card */}
        <div
          className="mx-4 mt-3 rounded-[var(--radius-card)] p-5 text-center animate-fade-in-up"
          style={{ background: "var(--brand)" }}
        >
          <p className="text-10 font-bold uppercase tracking-widest" style={{ color: "rgba(0,0,0,0.55)" }}>
            {customer.name} · {t("recordPayment.outstanding")}
          </p>
          <p className="text-32 font-bold mt-1" style={{ color: "#0a0a0a" }}>
            {formatCurrency(customer.outstandingBalance)}
          </p>
        </div>

        <div className="flex flex-col gap-5 p-4 mt-2">
          {/* Split payment toggle */}
          <div
            className="flex items-center justify-between px-4 py-3 rounded-[var(--radius-tile)] cursor-pointer select-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
            onClick={() => {
              setSplitMode(!splitMode);
              setError("");
              if (!splitMode) {
                // switching to split mode — pre-fill first split with current amount
                setSplits([
                  { amount: amount || "", method },
                  { amount: "", method: method === "cash" ? "bank_transfer" : "cash" },
                ]);
              } else {
                // switching to single mode — combine splits into single amount
                const total = splits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                setAmount(total > 0 ? String(total) : "");
              }
            }}
          >
            <div className="flex items-center gap-2">
              <Layers size={16} style={{ color: "var(--text-secondary)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("recordPayment.splitPayment") || "Split Payment"}
              </span>
            </div>
            <div
              className="w-10 h-6 rounded-full relative transition-colors"
              style={{ background: splitMode ? "var(--brand)" : "var(--divider)" }}
            >
              {/* Knob stays true white in both themes (`bg-white` is Tailwind's literal now
                  that the compatibility layer is gone); it sits at the inline START when off
                  and at the END when on, so it slides the right way in Urdu too. */}
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                style={{ insetInlineStart: splitMode ? "18px" : "2px" }}
              />
            </div>
          </div>

          {/* SINGLE PAYMENT MODE */}
          {!splitMode && (
            <>
              {/* Amount input */}
              <div>
                <p className="text-11 font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
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
                    className="flex-1 h-12 rounded-[var(--radius-input)] px-4 text-sm font-bold text-center outline-none"
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
              </div>

              {/* Payment method */}
              <div>
                <p className="text-11 font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {t("recordPayment.method")}
                </p>
                <div className="flex gap-2">
                  {METHODS.map((m) => (
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
                      {t(m.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* SPLIT PAYMENT MODE */}
          {splitMode && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-11 font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {t("recordPayment.paymentSplits") || "Payment Splits"}
                </p>
                <button
                  onClick={autoFillRemaining}
                  className="text-10 font-bold px-3 py-1 rounded-full"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {t("recordPayment.autoFill") || "Auto-fill remaining"}
                </button>
              </div>

              {splits.map((split, i) => (
                <div key={i} className="flex flex-col gap-2 p-3 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-10 font-bold uppercase" style={{ color: "var(--text-secondary)" }}>
                      Split {i + 1}
                    </span>
                    {splits.length > 2 && (
                      <button
                        onClick={() => removeSplit(i)}
                        className="text-10 font-bold px-2 py-0.5 rounded"
                        style={{ color: "var(--error)" }}
                      >
                        {t("common.remove")}
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={split.amount}
                    onChange={(e) => updateSplit(i, "amount", e.target.value)}
                    placeholder={t("common.amount")}
                    className="w-full h-10 rounded-[var(--radius-tile)] px-3 text-sm font-bold outline-none"
                    style={{ background: "var(--background)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
                  />
                  <div className="flex gap-2">
                    {METHODS.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => updateSplit(i, "method", m.key)}
                        className="flex-1 h-9 rounded-full text-xs font-semibold transition-colors"
                        style={{
                          background: split.method === m.key ? "var(--brand)" : "var(--background)",
                          color: split.method === m.key ? "#0a0a0a" : "var(--text-secondary)",
                          border: split.method === m.key ? "none" : "1px solid var(--divider)",
                        }}
                      >
                        {t(m.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <button
                onClick={addSplit}
                className="flex items-center justify-center gap-1 h-9 rounded-full text-xs font-bold"
                style={{ background: "var(--surface-2)", border: "1px dashed var(--divider)", color: "var(--text-secondary)" }}
              >
                <Plus size={14} />
                {t("recordPayment.addSplit") || "Add split"}
              </button>

              {/* Split total */}
              <div className="flex justify-between items-center px-4 py-2 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)" }}>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("sale.total")}</span>
                <span className="text-sm font-bold" style={{ color: totalPaid > customer.outstandingBalance ? "var(--error)" : "var(--text-primary)" }}>
                  {formatCurrency(totalPaid)} / {formatCurrency(customer.outstandingBalance)}
                </span>
              </div>
            </div>
          )}

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}

          {/* Notes */}
          <div>
            <p className="text-11 font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("recordPayment.notes")}
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("recordPayment.notesHint")}
              rows={3}
              className="w-full rounded-[var(--radius-tile)] p-3 text-sm outline-none resize-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* New balance preview */}
          {totalPaid > 0 && (
            <div
              className="flex justify-between items-center px-4 py-3 rounded-[var(--radius-tile)] animate-fade-in-up"
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
          disabled={loading || totalPaid <= 0}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? t("common.loading") : t("recordPayment.confirm")}
        </button>
      </div>
    </div>
  );
}
