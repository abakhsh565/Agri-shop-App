/**
 * What a phone field accepts — one rule, used by every phone field in the app.
 *
 * Before this, three screens stripped letters and none capped the length, while four screens
 * (the company, employee and customer forms) accepted anything at all: a 20-character paste with
 * spaces, dashes and a country code went straight into the field and was only sorted out — or
 * silently mangled — at submit. The owner's report was simple: a phone field takes a phone number,
 * in every screen, before sign-in and after it.
 *
 * The rule is therefore about what can be TYPED and what a PASTE means:
 *
 *   • digits only — a letter, a space or a symbol never lands in the field;
 *   • never more than eleven digits — an eleventh digit is taken, a twelfth is refused;
 *   • a paste that carries the country code (`+92 300 1234567`, `00923001234567`) becomes the
 *     local number the field is asking for, rather than the first eleven characters of it, which
 *     would quietly produce a different number.
 *
 * It is applied by the field itself (`components/ui/Input.tsx` for `type="tel"`, and by
 * `phoneFieldProps` where a screen draws its own `<input>`), so a screen cannot forget it and a
 * new phone field cannot be added without it. `tests/unit/phoneInput.test.ts` holds both halves:
 * the behaviour, and the fact that no screen bypasses it.
 */

/** An 11-digit local number (03xx…, 0xx…): what the field shows and what the app stores from it. */
export const PHONE_MAX_DIGITS = 11;

/**
 * The value a phone field should hold for what was typed or pasted.
 *
 * Never returns anything but digits, and never more than eleven of them.
 */
export function digitsOnlyPhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length <= PHONE_MAX_DIGITS) return digits;

  // A paste carrying the country code. Only accepted when what is left is a whole local number
  // (ten digits: 3001234567) — "92300" from a longer paste must not be read as a country code.
  const local = digits.replace(/^(?:0092|92)/, "");
  if (local.length === PHONE_MAX_DIGITS || local.length === PHONE_MAX_DIGITS - 1) {
    return local.slice(0, PHONE_MAX_DIGITS);
  }

  // Anything else — including a twelfth digit typed by hand — keeps the first eleven, so a number
  // already in the field is left exactly as it was instead of being rewritten under the person.
  return digits.slice(0, PHONE_MAX_DIGITS);
}

/**
 * The local spelling of a stored number.
 *
 * The database holds the canonical `92…` form (see `lib/auth.ts`), while every
 * hand-typed phone field in the app asks for `03…`. Screens that receive a
 * canonical number from a link or a request must show the form the field accepts,
 * or the first edit turns the value into a different number.
 */
export function localPhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) return "0" + digits.slice(2);
  return digits.slice(0, PHONE_MAX_DIGITS);
}

/** Is this a complete Pakistani number in either the local or international form? */
export function isValidPhone(raw: string): boolean {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return /^0\d{9,10}$/.test(digits) || /^92\d{10,11}$/.test(digits);
}

/**
 * The attributes a hand-drawn phone field needs: the phone keypad, and the browser's own hint
 * that this is a number. The digits-only rule itself is applied on change, by `digitsOnlyPhone`
 * (or automatically by `Input`), because `maxLength` counts characters — with it, pasting
 * "+92 300 1234567" would be cut to "+92 300 123" before anything could strip the code.
 */
export function phoneFieldProps(): {
  type: "tel";
  inputMode: "numeric";
  autoComplete: "tel";
  pattern: string;
} {
  return { type: "tel", inputMode: "numeric", autoComplete: "tel", pattern: "[0-9]*" };
}
