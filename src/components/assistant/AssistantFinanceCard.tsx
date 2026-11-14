import { ArrowDownLeft, ArrowUpRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency } from "@/lib/formatters";
import {
  CATEGORY_KEY,
  KIND_LABEL_KEY,
  METHOD_KEY,
} from "@/lib/financeEntries";
import { financeRecordPath, type AssistantFinanceDraft } from "@/lib/assistantFinance";

/**
 * A parsed money sentence, shown before anything is written.
 *
 * The card is deliberately not a second form. It states the kind, amount, category, method and
 * party, then hands the sentence to the one ledger form that already owns category validation,
 * receipt attachments and the owner-only database rule. The final line says plainly that this
 * card has not saved anything yet.
 */
export default function AssistantFinanceCard({ draft }: { draft: AssistantFinanceDraft }) {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const Icon = draft.kind === "income" ? ArrowDownLeft : ArrowUpRight;
  const category = CATEGORY_KEY[draft.category];
  const method = METHOD_KEY[draft.method];

  return (
    <div
      className="mt-3 rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--tone-card)" }}
      data-testid="assistant-finance-card"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
        >
          <Icon size={16} strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("assistant.finance.ready")}
          </p>
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t(KIND_LABEL_KEY[draft.kind])}
          </p>
        </div>
      </div>

      <p className="mt-3 text-22 font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
        {formatCurrency(draft.amount)}
      </p>
      <p className="mt-1 text-12" style={{ color: "var(--text-secondary)" }}>
        {category ? t(category) : draft.category}
        {" · "}
        {method ? t(method) : draft.method}
      </p>
      {draft.party && (
        <p className="mt-1 text-12" style={{ color: "var(--text-secondary)" }}>
          {draft.party}
        </p>
      )}

      <button
        type="button"
        onClick={() => navigate(financeRecordPath(base, draft))}
        className="ds-pressable mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-field)] px-4 text-13 font-semibold"
        style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
        data-testid="assistant-finance-review"
      >
        <Check size={16} strokeWidth={1.5} />
        {t("assistant.finance.review")}
      </button>
      <p className="mt-2 text-10" style={{ color: "var(--text-tertiary)" }}>
        {t("assistant.finance.notSaved")}
      </p>
    </div>
  );
}
