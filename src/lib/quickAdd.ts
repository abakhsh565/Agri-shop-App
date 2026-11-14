import type { FinanceEntryKind, FinanceMethod } from "@/lib/financeEntries";

/**
 * Reading one sentence about money.
 *
 * WHY THIS IS LOCAL AND DUMB. The owner asked for a quick way to write down money that is not a
 * sale — "paid 5000 rent to Malik" — without walking the whole form. Turning that sentence into
 * the five facts the ledger needs is a parsing job, not an intelligence job: it is deterministic,
 * it works with no connection, and it cannot send a shop's takings to a model. Every rule below
 * only *suggests*; the screen shows the result as a confirmation before anything is written.
 *
 * WHAT IT REFUSES TO GUESS. A sentence about a sale is not recorded here, because a sale writes
 * stock and a customer's balance through another path. The parser marks it and the screen sends
 * the reader to the sale flow instead of quietly filing it as income and making the books disagree
 * with the shelf.
 */

export type QuickAddKind = FinanceEntryKind;

export interface QuickAddDraft {
  amount: number | null;
  kind: QuickAddKind | null;
  party: string;
  category: string | null;
  method: FinanceMethod | null;
  note: string;
  /** "sold …", "sale …" — a sale belongs in the sale flow, not in this ledger. */
  looksLikeSale: boolean;
  /** Whether the sentence gave us anything at all. */
  matched: boolean;
}

const EMPTY: QuickAddDraft = {
  amount: null,
  kind: null,
  party: "",
  category: null,
  method: null,
  note: "",
  looksLikeSale: false,
  matched: false,
};

const URDU_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** The same sentence with every digit the phone can produce written as 0–9. */
function plainDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit) => {
    const urdu = URDU_DIGITS.indexOf(digit);
    if (urdu >= 0) return String(urdu);
    return String(ARABIC_DIGITS.indexOf(digit));
  });
}

function normalise(text: string): string {
  return plainDigits(text).replace(/[\u200c\u200d]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Units that make a number a quantity rather than an amount of money. */
const QUANTITY_UNITS =
  /^(?:kg|kgs|g|gram|grams|litre|liter|litres|liters|ltr|ml|pack|packs|packet|packets|bag|bags|bori|boris|piece|pieces|pcs|dozen|box|boxes|bottle|bottles|month|months|day|days|week|weeks|year|years|acre|acres)\b/;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  hazar: 1_000,
  hazaar: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  lakh: 100_000,
  lac: 100_000,
  crore: 10_000_000,
  cr: 10_000_000,
};

interface AmountCandidate {
  value: number;
  score: number;
}

/**
 * The most likely amount in a sentence such as "paid Rs 1.5 lakh rent to Malik".
 *
 * A number earns its place by wearing a currency, a multiplier or a decimal; a bare small
 * integer next to a unit ("5 kg") loses. The winner is the highest score, and if every candidate
 * looks like a quantity there is no amount to report.
 */
export function quickAddAmount(text: string): number | null {
  const source = plainDigits(text).replace(/\s+/g, " ");
  const pattern =
    /(?<![\p{L}\d])((?:rs\.?|pkr|rupees?|rupay)\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(k|m|million|lakh|lac|crore|cr|thousand|hazar|hazaar))?(?![\p{L}\d])/giu;
  const candidates: AmountCandidate[] = [];

  for (const match of source.matchAll(pattern)) {
    const hasCurrency = Boolean(match[1]);
    const digits = match[2].replace(/,/g, "");
    const suffix = match[3]?.toLowerCase() ?? "";
    const value = Number(digits) * (suffix ? MULTIPLIERS[suffix] ?? 1 : 1);
    if (!Number.isFinite(value) || value <= 0) continue;

    const after = source.slice((match.index ?? 0) + match[0].length).trimStart();
    const followedByUnit = QUANTITY_UNITS.test(after);
    let score = Math.min(4, Math.log10(value));
    if (hasCurrency) score += 12;
    if (suffix) score += 9;
    if (digits.includes(".")) score += 2;
    if (digits.includes(",")) score += 1;
    if (followedByUnit) score -= 7;
    // A bare integer up to a dozen is far more often a count than a price.
    if (!hasCurrency && !suffix && !digits.includes(".") && value <= 12) score -= 3;

    candidates.push({ value, score });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score > 0 ? Math.round(candidates[0].value * 100) / 100 : null;
}

const SALE =
  /\b(sold|sale|sales|sell|selling|becha|bechi|bech\s+diya|bech\s+di)\b|(?:فروخت|بیچا|بیچی|بیچ)/;
const DRAWING =
  /\b(drew|drawing|withdrew|withdraw|withdrawal|took\s+out|take\s+out|owner\s+pay|personal\s+use|nikala|nikaala|nikal|apne\s+liye)\b|(?:نکالا|نکال|نکاسی|ذاتی)/;
const INCOME =
  /\b(received|receive|receiving|got|income|earned|earning|deposit|deposited|mila|mili|aayi|aya|aaya|loan|investment|refund\s+received)\b|(?:آمدن|موصول|ملا|ملی|ملے|آیا|آئی|قرض|سرمایہ\s+کاری)/;
const EXPENSE =
  /\b(paid|pay|paying|spent|spend|bought|buy|purchase|purchased|expense|kharch|kharcha|diya|diye|kharida|bill|rent|kiraya|salary|salaries|wage|wages|fuel|petrol|diesel|electric|electricity|bijli|gas|water|internet|repair|maintenance|transport|fare|stock)\b|(?:خرچ|ادا|دیا|دیے|خریدا|کرایہ|کرایے|تنخواہ|بل|بجلی|گیس|مرمت|پٹرول|ڈیزل|اسٹاک|کھاد|بیج)/;

type CategoryRule = { pattern: RegExp; category: string };

const INCOME_RULES: CategoryRule[] = [
  { pattern: /\b(loan|qarz|udhar\s+liya)\b|(?:قرض)/, category: "loan_received" },
  {
    pattern: /\b(investment|invested|capital|sarmaya)\b|(?:سرمایہ\s+کاری|سرمایہ)/,
    category: "investment",
  },
];

const EXPENSE_RULES: CategoryRule[] = [
  { pattern: /\b(rent|kiraya|kiraye)\b|(?:کرایہ|کرایے)/, category: "rent" },
  {
    pattern:
      /\b(bill|bills|electric|electricity|bijli|gas|water|internet|utility|utilities)\b|(?:بل|بجلی|گیس|پانی|انٹرنیٹ)/,
    category: "utilities",
  },
  {
    pattern: /\b(salary|salaries|wage|wages|tankha|staff\s+pay)\b|(?:تنخواہ|تنخواہیں|اجرت)/,
    category: "salaries",
  },
  {
    pattern:
      /\b(fuel|petrol|diesel|transport|fare|rickshaw|bus|truck)\b|(?:پٹرول|ڈیزل|ٹرانسپورٹ|کرایہ\s+سفر|بس|ٹرک)/,
    category: "transport",
  },
  {
    pattern: /\b(repair|repairs|maintenance|service|servicing|mistri)\b|(?:مرمت|سروس|مستری)/,
    category: "maintenance",
  },
  {
    pattern:
      /\b(stock|purchase|purchased|inventory|seed|seeds|fertilizer|fertiliser|medicine|mal|saman)\b|(?:اسٹاک|خریداری|کھاد|بیج|دوا)/,
    category: "stock_purchase",
  },
];

const DRAWING_RULES: CategoryRule[] = [
  {
    pattern: /\b(owner\s+pay|owner\s+salary|apni\s+tanakhwah)\b|(?:مالک\s+کی\s+تنخواہ|مالک\s+کی\s+ادائیگی)/,
    category: "owner_pay",
  },
  {
    pattern: /\b(personal|ghar|home|khud|apne\s+liye|family)\b|(?:ذاتی|گھر|خود|خاندان)/,
    category: "personal_use",
  },
];

function categoryFor(kind: QuickAddKind, text: string): string | null {
  const rules =
    kind === "income" ? INCOME_RULES : kind === "expense" ? EXPENSE_RULES : DRAWING_RULES;
  for (const rule of rules) if (rule.pattern.test(text)) return rule.category;
  if (kind === "income") return "other_income";
  if (kind === "expense") return "other_expense";
  return "personal_use";
}

const METHODS: { pattern: RegExp; method: FinanceMethod }[] = [
  { pattern: /\b(easypaisa|easy\s+paisa)\b|(?:ایزی\s+پیسہ)/, method: "easypaisa" },
  { pattern: /\b(jazzcash|jazz\s+cash)\b|(?:جاز\s+کیش)/, method: "jazzcash" },
  { pattern: /\b(bank|transfer|online|cheque|check)\b|(?:بینک|ٹرانسفر)/, method: "bank" },
  { pattern: /\b(cash|naqad|naqd)\b|(?:نقد)/, method: "cash" },
];

/** Words that are never a person's name in these sentences. */
const NOT_A_NAME = new Set([
  "the", "a", "an", "my", "our", "his", "her", "their", "this", "that", "these", "those",
  "cash", "bank", "account", "easypaisa", "jazzcash", "card", "cheque", "check",
  "shop", "business", "store", "company", "supplier", "vendor", "customer", "staff",
  "rent", "bill", "salary", "stock", "fuel", "transport", "maintenance", "income", "expense",
  "owner", "personal", "use", "today", "yesterday", "tomorrow", "morning", "evening",
  "for", "on", "in", "at", "with", "and", "via", "from", "to", "by", "of",
  "دکان", "بینک", "گاہک", "سپلائر", "کاروبار", "نقد", "کرایہ", "تنخواہ",
]);

const NAME_BREAK = new Set([
  "for", "on", "in", "at", "with", "and", "via", "from", "to", "by", "of",
  "cash", "bank", "easypaisa", "jazzcash", "today", "yesterday", "tomorrow",
]);

function cleanName(value: string): string {
  const words: string[] = [];
  for (const raw of value.split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}]+|[^\p{L}'’.-]+$/gu, "");
    if (!word) continue;
    const lower = word.toLowerCase();
    if (NAME_BREAK.has(lower) || NOT_A_NAME.has(lower)) break;
    words.push(word);
    if (words.length === 3) break;
  }
  return words.join(" ");
}

/**
 * The person or business the money moved with.
 *
 * A name after "to"/"from"/"by" is the one signal strong enough to trust. A sentence with no such
 * word gets no party rather than a guess: a wrong name on a ledger row is worse than a blank one.
 */
export function quickAddParty(text: string): string {
  const source = plainDigits(text).replace(/\s+/g, " ");

  const capitalised = /\b(?:from|to|by)\s+([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){0,3})/gu;
  for (const match of source.matchAll(capitalised)) {
    const name = cleanName(match[1]);
    if (name) return name;
  }

  const anyCase = /\b(?:from|to|by)\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){0,3})/giu;
  for (const match of source.matchAll(anyCase)) {
    const name = cleanName(match[1]);
    if (name) return name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  // Urdu puts the name before the marker: "احمد سے 5000 ملے".
  const urdu = /([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){0,2})\s+(?:سے|کو)(?=\s|$)/gu;
  for (const match of source.matchAll(urdu)) {
    const name = cleanName(match[1]);
    if (name) return name;
  }

  return "";
}

/**
 * Reads a sentence the owner typed or said.
 *
 * The order matters: a sale is checked first and wins, so "sold 2000 rice to Kamal" can never be
 * filed as income. A drawing is checked before income because "took out" is unambiguous, and a
 * category ("rent", "salary") can supply the kind when the verb is missing.
 */
export function parseQuickAdd(text: string): QuickAddDraft {
  if (!text.trim()) return { ...EMPTY };

  const lower = normalise(text);
  const looksLikeSale = SALE.test(lower);
  if (looksLikeSale) {
    return {
      ...EMPTY,
      amount: quickAddAmount(text),
      party: quickAddParty(text),
      note: text.trim().slice(0, 500),
      looksLikeSale: true,
      matched: true,
    };
  }

  let kind: QuickAddKind | null = null;
  if (DRAWING.test(lower)) kind = "drawing";
  else if (INCOME.test(lower)) kind = "income";
  else if (EXPENSE.test(lower)) kind = "expense";

  let category: string | null = null;
  const rentOrSalary = EXPENSE_RULES.find((rule) => rule.pattern.test(lower))?.category ?? null;
  if (!kind && rentOrSalary) kind = "expense";

  if (kind) category = categoryFor(kind, lower);
  // A category can exist without a recognised verb only if the kind was derived from it.
  if (kind && !category) category = categoryFor(kind, lower);

  const method = METHODS.find((entry) => entry.pattern.test(lower))?.method ?? null;
  const amount = quickAddAmount(text);
  const party = quickAddParty(text);

  return {
    amount,
    kind,
    party,
    category,
    method,
    note: text.trim().slice(0, 500),
    looksLikeSale: false,
    matched: amount != null || kind != null || party !== "",
  };
}
