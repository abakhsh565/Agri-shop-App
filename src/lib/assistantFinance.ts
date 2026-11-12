import { parseQuickAdd } from "@/lib/quickAdd";
import type { FinanceEntryKind, FinanceMethod } from "@/lib/financeEntries";

/**
 * A sentence that can safely be handed to the existing recorded-money form.
 *
 * The assistant does not write money itself. It reads the same deterministic sentence parser
 * the ledger form already uses, shows exactly what it understood, and then opens that form for
 * the owner to review. This keeps one write path, one set of database checks, and one place where
 * a person confirms the amount.
 */

export type AssistantFinanceKind = Extract<FinanceEntryKind, "income" | "expense">;

export interface AssistantFinanceDraft {
  kind: AssistantFinanceKind;
  amount: number;
  category: string;
  method: FinanceMethod;
  party: string;
  note: string;
  sentence: string;
}

/** A question about money is not an instruction to record it. */
const QUESTION_START =
  /^\s*(what|how|why|when|where|which|who|show|tell|list|do|did|does|is|are|could|should)\b/i;

/** Even in a question, an explicit "add/record…" is an instruction. */
const EXPLICIT_ACTION = /\b(add|record|log|save|create|file|enter)\b/i;

/**
 * Read an explicit income/expense sentence.
 *
 * A sale is never accepted here: it moves stock and a customer's balance through the sale flow,
 * not through the money ledger. A drawing is left to the full form as well. If the sentence has
 * no amount, there is nothing to review yet.
 */
export function financeDraftFromText(text: string): AssistantFinanceDraft | null {
  const sentence = text.trim();
  if (!sentence) return null;
  if (QUESTION_START.test(sentence) && !EXPLICIT_ACTION.test(sentence)) return null;

  const parsed = parseQuickAdd(sentence);
  if (parsed.looksLikeSale) return null;
  if (parsed.kind !== "income" && parsed.kind !== "expense") return null;
  if (parsed.amount == null || parsed.amount <= 0 || parsed.amount > 1_000_000_000_000) {
    return null;
  }

  return {
    kind: parsed.kind,
    amount: Math.round(parsed.amount * 100) / 100,
    category:
      parsed.category ?? (parsed.kind === "income" ? "other_income" : "other_expense"),
    method: parsed.method ?? "cash",
    party: parsed.party,
    note: sentence.slice(0, 500),
    sentence: sentence.slice(0, 500),
  };
}

/** The existing ledger form is the confirmation screen; this is only its address. */
export function financeRecordPath(base: string, draft: AssistantFinanceDraft): string {
  const query = new URLSearchParams({ kind: draft.kind, sentence: draft.sentence });
  return `${base}/settings/hub/finance/record?${query.toString()}`;
}
