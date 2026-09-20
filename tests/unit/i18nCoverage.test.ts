import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Permanent EN/UR + LTR/RTL coverage guard (Engineering OS invariant).
 *
 * 1. Every t("key") used in src must exist in both dictionaries — otherwise the
 *    raw key renders to the user.
 * 2. No hardcoded English UI strings may exist in shipped JSX. A line-based scan
 *    misses most of them, so three classes are checked:
 *      a. JSX text nodes          `>Gross Profit<`
 *      b. UI attribute literals   `title="Payments"`, `placeholder="..."`
 *      c. ternary label literals  `cond ? "Paid in full" : "Partial"`  (.tsx only —
 *         inside JSX a two-prose-string ternary is a label; in a plain .ts module
 *         it is usually domain data. Rendered .ts surfaces (the receipt canvas and
 *         the signal engine) return i18n keys instead of text, asserted below.)
 *    The baseline is 0 for all three.
 * 3. Values the signal engine hands to the UI must be i18n keys, never text:
 *    every `detailKey: "signal.*"` must exist in both dictionaries.
 * 4. Inline `isUrdu ? "ur" : "en"` translations render correct Urdu, but they
 *    duplicate what the dictionaries already hold. The count is frozen — new
 *    strings go through t().
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

// Proper nouns and formats that are intentionally identical in both languages.
const BRANDS = ["AgriShop", "WhatsApp", "SMS", "NTN", "Rs."];

// Unreferenced design mock-ups, not shipped UI (verified: nothing imports these).
const DEAD_FILES = ["src/components/ui/RTL.tsx"];

function parseDict(block: string): Set<string> {
  const keys = new Set<string>();
  for (const m of block.matchAll(/"([^"]+)":/g)) keys.add(m[1]);
  return keys;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // src/imports holds unreferenced design mock-ups, not shipped UI.
    if (entry.name === "imports" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const i18nSource = fs.readFileSync(path.join(SRC, "lib/i18n.ts"), "utf8");
const enKeys = parseDict(i18nSource.slice(i18nSource.indexOf("en: {"), i18nSource.indexOf("\n  ur: {")));
const urKeys = parseDict(i18nSource.slice(i18nSource.indexOf("\n  ur: {")));

const TEXT_NODE = />[\s]*([A-Za-z][A-Za-z0-9 ,.?!'&/-]{4,})[\s]*</g;
const ATTR_NODE = /\b(?:label|title|subtitle|placeholder|alt|emptyLabel|hint|aria-label|confirmLabel|message)="([^"{}<>]{3,})"/g;
const TERN_LABEL = /\?\s*"([^"<>]{3,})"\s*:\s*"([^"<>]{3,})"/g;
const SIGNAL_KEY = /detailKey:\s*"([^"]+)"/g;

// Frozen 2026-09-20. These 148 render correct Urdu (they are not English leaks),
// but they duplicate strings the dictionaries already hold. The count may only go
// down: new strings go through t() with EN + UR keys.
const INLINE_TRANSLATION_BASELINE = 148;

// Rendered-but-untranslated English found by parsing the JSX (text nodes plus string
// literals rendered inside {…}). Measured 2026-09-20. The previous regex checks could
// not see text with embedded expressions (`Actual inventory in {unit} …`) or with
// parentheses (`Credit Limit (Optional)`), nor the arm of a one-sided ternary
// (`cond ? "All products are well-stocked"`) — all of which shipped English into Urdu.
// Keyboard tokens (Enter/Escape/…) and the English arm of an inline bilingual ternary
// are excluded. May only decrease.
const JSX_LITERAL_BASELINE = 97;

const isBrand = (s: string) => BRANDS.includes(s.trim());
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** UI prose, as opposed to a CSS class list, a CSS value, or a token. */
function looksLikeUiText(s: string): boolean {
  const v = s.trim();
  if (v.length < 3) return false;
  if (isBrand(v)) return false;
  if (/^[a-z][a-z0-9_]*$/.test(v)) return false; // enum token: "numeric", "outline"
  if (/[[\]()#/:]/.test(v)) return false; // CSS class chains, var(), rgba(), urls
  if (!/^[A-Z]/.test(v)) return false; // prose labels start capitalised
  return /[A-Za-z]{3}/.test(v);
}

describe("i18n coverage", () => {
  const shipped = sourceFiles(SRC).filter((f) => !DEAD_FILES.includes(rel(f)));

  it("every t() key exists in EN and UR", () => {
    const missing: string[] = [];
    // Both quote styles. The Observation Bot panel called t('overview') and 11 more
    // with single quotes; a double-quote-only scan cannot see those, so the panel
    // silently fell back to English in Urdu.
    const CALL = /\bt\(\s*["']([^"']+)["']/g;
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(CALL)) {
        const key = m[1];
        // dynamic prefixes such as t("reminder." + id) are resolved at runtime
        if (key.endsWith(".")) continue;
        if (!enKeys.has(key)) missing.push(`${rel(file)}: ${key} (EN)`);
        if (!urKeys.has(key)) missing.push(`${rel(file)}: ${key} (UR)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every *Key config property resolves to a dictionary entry", () => {
    // Keys are also reached indirectly, e.g. `{ labelKey: "admin.customers" }`.
    // MoreMenuPage carried `labelKey: "admin.observationBot"` with no such key, so
    // the owner's More menu rendered the raw key string to the user.
    const missing: string[] = [];
    const PROP = /\b([A-Za-z_$][\w$]*Key):\s*"([^"]+)"/g;
    for (const file of shipped) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(PROP)) {
        const value = m[2];
        if (!/^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(value)) continue;
        if (!enKeys.has(value)) missing.push(`${rel(file)}: ${m[1]} → ${value} (EN)`);
        if (!urKeys.has(value)) missing.push(`${rel(file)}: ${m[1]} → ${value} (UR)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no hardcoded JSX text nodes", () => {
    const found: string[] = [];
    for (const file of shipped) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(TEXT_NODE)) {
        const before = text.slice(0, m.index ?? 0);
        if (((before.match(/`/g) ?? []).length & 1) === 1) continue; // template literal
        if (before.endsWith("=")) continue; // arrow function or comparison, not JSX
        const value = m[1].trim();
        if (isBrand(value)) continue;
        if (/^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(value)) continue; // property path
        found.push(`${rel(file)}: ${value}`);
      }
    }
    expect(found, `Hardcoded JSX text:\n${found.join("\n")}`).toEqual([]);
  });

  it("has no hardcoded UI attribute literals", () => {
    const found: string[] = [];
    for (const file of shipped) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(ATTR_NODE)) {
        if (looksLikeUiText(m[1])) found.push(`${rel(file)}: "${m[1]}"`);
      }
    }
    expect(found, `Hardcoded UI attributes:\n${found.join("\n")}`).toEqual([]);
  });

  it("has no hardcoded ternary UI labels", () => {
    const found: string[] = [];
    for (const file of shipped.filter((f) => f.endsWith(".tsx"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(TERN_LABEL)) {
        if (looksLikeUiText(m[1]) && looksLikeUiText(m[2])) {
          found.push(`${rel(file)}: "${m[1]}" / "${m[2]}"`);
        }
      }
    }
    expect(found, `Hardcoded ternary labels:\n${found.join("\n")}`).toEqual([]);
  });

  it("signal engine hands the UI i18n keys, not English text", () => {
    const text = fs.readFileSync(path.join(SRC, "lib/signalEngine.ts"), "utf8");
    const missing: string[] = [];
    for (const m of text.matchAll(SIGNAL_KEY)) {
      if (!enKeys.has(m[1])) missing.push(`${m[1]} (EN)`);
      if (!urKeys.has(m[1])) missing.push(`${m[1]} (UR)`);
    }
    expect(missing).toEqual([]);
  });

  it("no new untranslated JSX literals (AST ratchet)", () => {
    const KEY_TOKENS = new Set(["Enter", "Escape", "Backspace", "Tab", "Shift", "Delete", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

    const looksLikeUiText = (s: string) => {
      const v = s.trim();
      if (v.length < 3) return false;
      if (BRANDS.includes(v)) return false;
      if (/^[a-z][a-z0-9_]*$/.test(v)) return false;
      if (/^[a-z][a-zA-Z0-9]*([./][a-zA-Z0-9]+)+$/.test(v)) return false;
      if (!/^[A-Z]/.test(v)) return false;
      return /[A-Za-z]{3}/.test(v);
    };

    const found: string[] = [];
    for (const file of shipped.filter((f) => f.endsWith(".tsx"))) {
      const text = fs.readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

      const insideT = (node: ts.Node) => {
        for (let n: ts.Node | undefined = node; n; n = n.parent) {
          if (ts.isCallExpression(n)) {
            const e = n.expression;
            const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
            if (name === "t") return true;
          }
        }
        return false;
      };
      const insideJsxExpression = (node: ts.Node) => {
        for (let n = node.parent; n; n = n.parent) {
          if (ts.isJsxAttribute(n)) return false;
          if (ts.isJsxExpression(n)) return true;
          if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return false;
        }
        return false;
      };
      // isUrdu ? "اردو" : "English" renders both languages — the English arm is not a leak
      const hasUrduSibling = (node: ts.Node) => {
        const isUrdu = (x: ts.Node) =>
          /[\u0600-\u06FF]/.test(
            ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : x.getText(sf),
          );
        for (let n: ts.Node | undefined = node; n; n = n.parent) {
          if (ts.isConditionalExpression(n) && (isUrdu(n.whenTrue) || isUrdu(n.whenFalse))) return true;
          if (ts.isJsxElement(n) || ts.isJsxAttribute(n)) break;
        }
        return false;
      };

      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
          const t = node.text.replace(/\s+/g, " ").trim();
          if (looksLikeUiText(t)) found.push(`${rel(file)}:${lineOf(node)} jsx text "${t.slice(0, 50)}"`);
        } else if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          !insideT(node) &&
          insideJsxExpression(node)
        ) {
          if (!KEY_TOKENS.has(node.text.trim()) && !hasUrduSibling(node) && looksLikeUiText(node.text)) {
            found.push(`${rel(file)}:${lineOf(node)} "${node.text.slice(0, 50)}"`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    expect(
      found.length,
      `Untranslated JSX literals (${found.length}, baseline ${JSX_LITERAL_BASELINE}) — ` +
        `route new strings through t() with EN + UR keys:\n${found.join("\n")}`,
    ).toBeLessThanOrEqual(JSX_LITERAL_BASELINE);
  });

  it("inline isUrdu translations have not increased", () => {
    const found: string[] = [];
    for (const file of shipped.filter((f) => f.endsWith(".tsx"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/isUrdu \? "([^"]{2,})" : "([^"]{2,})"/g)) {
        // layout/format choices such as "rtl"/"ltr" and "ur-PK"/"en-PK" are not translations
        const hasUrdu = /[^\u0000-\u007F]/.test(m[1]) || /[^\u0000-\u007F]/.test(m[2]);
        if (hasUrdu) found.push(`${rel(file)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(
      found.length,
      `Inline bilingual translations (${found.length}, baseline ${INLINE_TRANSLATION_BASELINE}).\n` +
        `These render correct Urdu; use t() with EN + UR keys for new strings instead.\n${found.join("\n")}`,
    ).toBeLessThanOrEqual(INLINE_TRANSLATION_BASELINE);
  });
});
