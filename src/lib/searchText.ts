/**
 * One way to compare typed text to shop text.
 *
 * The same bill can be typed `Khan`, `KHAN`, `khaan` or `Khaan`, a Pakistani mobile can carry
 * spaces or a leading zero, and Urdu has two letters that share a key but not a code point
 * (`ی`/`ي`, `ک`/`ك`, `ہ`/`ه`). A search that only lowercases finds half of them. This is the
 * normalisation every search in the app uses, so a keyword means the same thing on the ledger
 * screen and in the global search.
 */
export function normalizeSearch(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ہھ]/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[\u200c\u200d]/g, "") // zero-width joiners do not carry meaning for a match
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every token has to appear somewhere in the haystack, in any order. A token matches as a plain
 * substring and from the start of a word, so `Ka` finds `Kashif` and `کرا` finds `کراچی`, while a
 * longer token also matches mid-word.
 */
export function matchesSearch(query: string, values: Array<string | number | null | undefined>): boolean {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeSearch(values.filter((value) => value != null).join(" "));
  const words = haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return terms.every((term) => haystack.includes(term) || words.some((word) => word.startsWith(term)));
}
