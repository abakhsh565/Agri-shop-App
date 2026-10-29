import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCompaniesStore } from "@/stores/companiesStore";
import { rpcRecordSupplierPayment } from "@/lib/db";
import { formatCurrency } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import type { PaymentMethod } from "@/types";
import { useT } from "@/lib/i18n";

export default function RecordSupplierPaymentPage() {
  const t = useT();
  const { companyId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const companies = useCompaniesStore((s) => s.companies);
  const company = companies.find((c) => c.id === companyId);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // One confirm = one payment. `loading` only disables the button after React
  // re-renders, so a double tap gets two calls through before that happens; the
  // ref stops the second one synchronously. The key is minted once per attempt
  // and held, so a retry after a lost response returns the payment the shop
  // already recorded instead of paying the supplier twice (0138).
  const submittingRef = useRef(false);
  const submissionKeyRef = useRef<string | null>(null);

  if (!company) return null;

  const paid = Number(amount) || 0;
  const newPayable = Math.max(0, company.outstandingPayable - paid);

  async function handleConfirm() {
    if (submittingRef.current) return;
    setError("");
    if (paid <= 0) { setError(t("copy.enterAmount")); return; }
    if (paid > company!.outstandingPayable) {
      setError(t("copy.amountOverPayable", { owed: formatCurrency(company!.outstandingPayable) }));
      return;
    }

    submittingRef.current = true;
    if (!submissionKeyRef.current) submissionKeyRef.current = crypto.randomUUID();
    setLoading(true);
    try {
      // PRD §9 / §21: reduce payable; payment is a permanent event (never rewrites history).
      await rpcRecordSupplierPayment({
        companyId: company!.id,
        amount: paid,
        method,
        notes: "",
        idempotencyKey: submissionKeyRef.current,
      });
      // Done: this attempt's key retires, so a later payment is a new payment.
      submissionKeyRef.current = null;

      // Read the suppliers back BEFORE leaving this screen. The payable is a store the shell
      // loaded once and Realtime maintains, so without this the Payments screen this navigates
      // to (and the alerts, and the supplier's own page) showed the balance from before the
      // payment until something else happened to refresh it — the number the shopkeeper just
      // changed was the one number that did not move.
      await useCompaniesStore.getState().load();

      addToast(t("copy.paidToSupplier", { amount: formatCurrency(paid), name: company!.name }), "success");
      navigate("/admin/payments", { replace: true });
    } catch (e) {
      // The key is KEPT on failure: the attempt may have reached the database and
      // only the answer was lost, so the retry must not be treated as a new payment.
      setError(e instanceof Error ? e.message : t("errors.recordPaymentFailed"));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--field-bg)",
    color: "var(--text-primary)",
  } as const;

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={t("supplier.paySupplier")} />

        <div className="mx-4 mt-3 rounded-[var(--radius-card)] p-5 text-center" style={{ background: "var(--brand)" }}>
          <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.55)" }}>
            {company.name} · Outstanding Payable
          </p>
          <p className="text-32 font-bold mt-1" style={{ color: "#0a0a0a" }}>
            {formatCurrency(company.outstandingPayable)}
          </p>
        </div>

        <div className="flex flex-col gap-5 p-4 mt-2">
          <div>
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("common.amount")}</p>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("recordPayment.amountHint")}
              className={`w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none ${
                error ? "border-[#ef4444]" : ""
              }`}
              /* The resting edge, its green focus and its disabled dimming come from the field
                 contract; only the error state overrides the colour. */
              style={fieldStyle}
            />
            {error && <p className="text-xs mt-1" style={{ color: "var(--error)" }}>{error}</p>}
          </div>

          <div>
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("sale.paymentMethod")}</p>
            <div className="flex gap-2">
              {([{ key: "cash", label: "Cash" }, { key: "bank_transfer", label: "Bank Transfer" }] as const).map((m) => (
                <button key={m.key} onClick={() => setMethod(m.key)}
                  className="flex-1 h-11 rounded-full text-sm font-semibold transition-colors"
                  style={{
                    background: method === m.key ? "var(--brand)" : "var(--surface-2)",
                    color: method === m.key ? "#0a0a0a" : "var(--text-secondary)",
                    border: method === m.key ? "none" : "1px solid var(--divider)",
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {paid > 0 && (
            <div className="flex justify-between items-center px-4 py-3 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)" }}>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.remainingPayable")}</span>
              <span className="text-sm font-bold" style={{ color: newPayable === 0 ? "var(--brand-dark)" : "var(--text-primary)" }}>
                {formatCurrency(newPayable)}
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
          {loading ? t("common.recording") : t("dashboard.recordPayment")}
        </button>
      </div>
    </div>
  );
}
