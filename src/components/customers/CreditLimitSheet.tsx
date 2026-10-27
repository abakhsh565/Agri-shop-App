import { useEffect, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";

interface CreditLimitSheetProps {
  open: boolean;
  /** The limit on record; 0 means none has been set. */
  currentLimit: number;
  /** What this customer already owes — the figure a reduction has to be measured against. */
  outstanding: number;
  saving?: boolean;
  /**
   * `set` writes the limit directly (the actor holds `customers.credit_limit`); `request`
   * asks the owner instead, and the owner's own figure is what applies (0251). The two
   * share one sheet so "a limit" means the same thing on both paths — only who decides
   * changes.
   */
  mode?: "set" | "request";
  onClose: () => void;
  onSave: (limit: number, reason: string) => void;
}

/**
 * The one place a credit limit is set, used by the customer card and by the sale screen, so
 * "Set limit" means the same thing in both and there is a single write path (the audited
 * `set_customer_credit_limit` RPC) rather than two that can disagree.
 *
 * No close cross: the sheet collects a number, and Cancel, the scrim, Escape and the
 * Android back button are all ways out. A second exit on a one-field form is noise.
 *
 * Lowering a limit below what is already owed is **allowed** — a shop must be able to stop
 * lending to a customer who is not paying — and that decision is stated plainly instead of
 * being blocked or hidden: the debt is not touched, and the customer simply cannot take
 * more credit until they are back under the new limit. Raising it needs no ceremony.
 *
 * In request mode nothing is written here at all: the number and the optional reason go to
 * the owner as a request, and the copy says so rather than letting the employee believe the
 * new limit is already in force.
 */
export default function CreditLimitSheet({
  open,
  currentLimit,
  outstanding,
  saving = false,
  mode = "set",
  onClose,
  onSave,
}: CreditLimitSheetProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const requesting = mode === "request";

  useEffect(() => {
    if (open) {
      setDraft(currentLimit > 0 ? String(currentLimit) : "");
      setReason("");
    }
  }, [open, currentLimit]);

  const parsed = Number(draft.replace(/[^\d.]/g, ""));
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  // How far the customer sits past the limit they are being given. Zero while the new limit
  // still covers what is owed, so the warning only appears when it is true.
  const overBy = valid ? Math.max(0, outstanding - parsed) : 0;

  return (
    <Sheet
      open={open}
      title={requesting ? t("creditLimit.requestTitle") : currentLimit > 0 ? t("customers.changeLimit") : t("customers.setLimit")}
      onClose={onClose}
      closeButton={false}
    >
      <div className="px-5 pb-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>{t("customers.creditLimit")}</span>
          <span className="font-bold">{formatCurrency(currentLimit)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>{t("sales.outstandingBalance")}</span>
          <span className="font-bold" style={{ color: outstanding > 0 ? "var(--warning)" : "var(--text-primary)" }}>
            {formatCurrency(outstanding)}
          </span>
        </div>

        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("sale.enterAmount")}
          className="w-full h-12 rounded-[var(--radius-input)] border border-border px-4 text-sm text-foreground placeholder:text-caption outline-none"
        />

        {requesting && (
          <div className="flex flex-col gap-1.5">
            <label className="ds-section-label" style={{ color: "var(--text-secondary)" }} htmlFor="credit-limit-reason">
              {t("creditLimit.reasonLabel")}
            </label>
            <textarea
              id="credit-limit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("creditLimit.reasonPlaceholder")}
              rows={2}
              className="w-full rounded-[var(--radius-input)] border border-border px-4 py-3 text-sm text-foreground placeholder:text-caption outline-none resize-none"
            />
          </div>
        )}

        {overBy > 0 ? (
          <div
            className="rounded-[var(--radius-tile)] p-3"
            style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-border)" }}
            data-testid="credit-limit-below-outstanding"
          >
            <p className="text-12" style={{ color: "var(--warning)" }}>
              {t("sale.limitBelowOutstanding", {
                outstanding: formatCurrency(outstanding),
                over: formatCurrency(overBy),
                limit: formatCurrency(parsed),
              })}
            </p>
          </div>
        ) : (
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {requesting ? t("creditLimit.requestHint") : t("sale.creditLimitHint")}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="md" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={() => onSave(parsed, reason.trim())}
            disabled={saving || !valid}
          >
            {saving ? t("common.loading") : requesting ? t("creditLimit.requestSend") : t("common.save")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
