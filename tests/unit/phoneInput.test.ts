/**
 * Permanent guard: a phone field takes a phone number.
 *
 * Two things are held here, and both were real complaints:
 *
 *   1. **What the field accepts.** Letters, spaces and symbols never land in it; an eleventh digit
 *      is taken and a twelfth is refused (the number already in the field is not rewritten under
 *      the person typing it); and a paste that carries the country code becomes the local number
 *      the field is asking for instead of its first eleven characters, which would be a different
 *      number.
 *   2. **That no screen can forget it.** The rule is applied by the field primitive for
 *      `type="tel"`, and by `phoneFieldProps()` where a screen draws its own `<input>`. This walks
 *      every source file and fails on a phone field that does neither — which is how the four
 *      company/employee/customer screens, that accepted anything at all, are kept from coming back.
 *
 * Measured, not assumed: before this, three screens stripped letters and none capped the length.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PHONE_MAX_DIGITS, digitsOnlyPhone, phoneFieldProps } from "../../src/lib/phoneInput";

/** Every .tsx/.ts under src, as paths relative to the repository root. */
function sourceFiles(dir = path.resolve(process.cwd(), "src")): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(process.cwd(), file).replace(/\\/g, "/");

describe("a phone field takes a phone number", () => {
  it("strips everything that is not a digit", () => {
    expect(digitsOnlyPhone("0300-1234567")).toBe("03001234567");
    expect(digitsOnlyPhone("0300 123 4567")).toBe("03001234567");
    expect(digitsOnlyPhone("0300abc1234567")).toBe("03001234567");
    expect(digitsOnlyPhone("(0300) 123-4567")).toBe("03001234567");
    // Arabic-Indic digits are not the digits the app stores; they are refused rather than
    // transliterated, because a phone number is a string of ASCII digits end to end.
    expect(digitsOnlyPhone("٠٣٠٠١٢٣٤٥٦٧")).toBe("");
    expect(digitsOnlyPhone("hello")).toBe("");
    expect(digitsOnlyPhone("")).toBe("");
  });

  it("takes an eleventh digit and refuses a twelfth", () => {
    expect(PHONE_MAX_DIGITS).toBe(11);
    expect(digitsOnlyPhone("03001234567")).toBe("03001234567");
    // The twelfth digit is refused: what is in the field stays exactly as it was.
    expect(digitsOnlyPhone("030012345678")).toBe("03001234567");
    expect(digitsOnlyPhone("0300123456789999")).toBe("03001234567");
  });

  it("reads a pasted country code as the local number, not as its first eleven characters", () => {
    // "+92 300 1234567" — the naive answer is "92300123456", which is a different number.
    expect(digitsOnlyPhone("+92 300 1234567")).toBe("3001234567");
    expect(digitsOnlyPhone("00923001234567")).toBe("3001234567");
    expect(digitsOnlyPhone("+923001234567")).toBe("3001234567");
    // Not a country code: a long paste with no 92 prefix keeps its first eleven digits.
    expect(digitsOnlyPhone("030012345678")).toBe("03001234567");
  });

  it("hands a hand-drawn field the phone keypad and the numeric hint", () => {
    expect(phoneFieldProps()).toMatchObject({ type: "tel", inputMode: "numeric" });
  });

  it("is applied by the field primitive for type=\"tel\"", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/ui/Input.tsx"), "utf8");
    // The rule is inside the primitive, so every screen that uses <Input type="tel"> inherits it.
    expect(source).toMatch(/digitsOnlyPhone\(event\.target\.value\)/);
    expect(source).toMatch(/props\.type === "tel"/);
  });

  it("no phone field in the app can bypass it", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const name = rel(file);
      if (name === "src/components/ui/Input.tsx") continue; // the rule itself
      const source = fs.readFileSync(file, "utf8");
      // A file has a phone field when it marks one as such (the type), shows the example number
      // every phone field in the app shows, or asks for the shared props. The second and third
      // matter because a field that spread `phoneFieldProps()` no longer spells out `type="tel"`.
      const isPhoneField =
        /type="tel"/.test(source) ||
        /placeholder="03001234567"/.test(source) ||
        /phoneFieldProps\(\)/.test(source);
      if (!isPhoneField) continue;

      // Two correct shapes: the field primitive (which applies the rule for `type="tel"`), or a
      // hand-drawn field using the shared props and the shared sanitiser.
      const usesSharedRule = /digitsOnlyPhone/.test(source) && /phoneFieldProps/.test(source);
      const usesPrimitive = /<Input\b/.test(source);
      if (!usesSharedRule && !usesPrimitive) offenders.push(name);
    }
    expect(
      offenders,
      "these screens take a phone number without the digits-only, eleven-digit rule — use " +
        "<Input type=\"tel\">, or phoneFieldProps() + digitsOnlyPhone() on your own <input>",
    ).toEqual([]);
  });

  it("is not vacuous — the scan would catch a screen that drops the rule", () => {
    // Proves the check above can fail: the same predicates against a field written the old way.
    const oldWay = `<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />`;
    const isPhoneField = /type="tel"/.test(oldWay);
    const usesSharedRule = /digitsOnlyPhone/.test(oldWay) && /phoneFieldProps/.test(oldWay);
    const usesPrimitive = /<Input\b/.test(oldWay);
    expect(isPhoneField).toBe(true);
    expect(usesSharedRule || usesPrimitive).toBe(false);
  });
});
