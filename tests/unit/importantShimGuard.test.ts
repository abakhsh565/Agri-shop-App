import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The legacy `!important` compatibility layer, kept from rotting.
 *
 * `src/index.css` still carries shims that remap old physical utilities
 * (`[dir="rtl"] .pl-4`) and legacy literal colours (`.dark .bg-white`) onto tokens, because
 * screens written before the design system still reference them. That is acceptable debt.
 *
 * What is not acceptable is *dead* debt. A shim whose classes appear nowhere in the project
 * is a rule that can never match: it still loads on every launch, still outranks the token
 * layer, and reads to the next person as a live decision — exactly how the field-outline
 * regression hid, when a dark shim outranked the token that had just been fixed.
 *
 * 22 such rules were deleted when this guard was added. It now keeps the count at zero.
 *
 * Element, pseudo-element and attribute-selector rules are NOT shims and are never reported:
 * the `font-family` remap, `*::after`, `.dark select` and `.dark textarea::placeholder` are
 * live by nature.
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist") walk(path.join(dir, e.name), out);
    } else if (/\.(tsx?|jsx?|html)$/.test(e.name)) out.push(fs.readFileSync(path.join(dir, e.name), "utf8"));
  }
  return out;
}

const CSS = fs.readFileSync(path.join(ROOT, "src/index.css"), "utf8");
const SOURCES =
  walk(path.join(ROOT, "src")).join("\n") +
  (fs.existsSync(path.join(ROOT, "index.html")) ? fs.readFileSync(path.join(ROOT, "index.html"), "utf8") : "");

/** Every `!important` rule whose selector is class-gated. */
function shimRules(): Array<{ selector: string; classes: string[] }> {
  const out: Array<{ selector: string; classes: string[] }> = [];
  for (const m of CSS.matchAll(/^([^@{}\n][^{}\n]*?)\s*\{([^}]*!important[^}]*)\}/gm)) {
    const classes = [...m[1].matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)]
      .map((c) => c[1].replace(/\\(.)/g, "$1"))
      .filter((c) => !["dark", "light", "group", "peer"].includes(c));
    if (classes.length) out.push({ selector: m[1].trim(), classes });
  }
  return out;
}

const used = (cls: string) =>
  new RegExp(`(?<![\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g").test(SOURCES);

describe("legacy !important shims earn their place", () => {
  it("has a compatibility layer to police", () => {
    expect(shimRules().length, "no class-gated !important rules found").toBeGreaterThan(10);
  });

  it("no shim matches nothing anywhere in the project", () => {
    const dead = shimRules()
      // Conservative on purpose: a rule is dead only when EVERY class in its selector is
      // unreferenced. `html[dir="rtl"] .absolute.left-4` is live because `absolute` is used,
      // even though `left-4` alone may not be — removing it on a looser rule would break RTL.
      .filter(({ classes }) => classes.every((c) => !used(c)))
      .map(({ selector }) => selector)
      .sort();
    expect(
      dead,
      "dead !important shim — migrate its call sites, then delete the rule"
    ).toEqual([]);
  });

  it("a surviving input-border shim points at the control outline, not the hairline", () => {
    // The regression this guard exists for. A dark-mode shim sets `border-color` on every
    // input with `!important`, so it outranks both the base-layer field rule and the Input
    // component's class. It was pointed at `--divider` — the in-card hairline, 13/255 from
    // the dark field tone — which kept every dark-mode field edge invisible even after the
    // token itself had been fixed. The shim may stay; the token it names may not be the
    // hairline.
    const blocks = CSS.match(/\.dark[^{}]*\binput\b[^{}]*\{[^}]*\}/g) ?? [];
    expect(blocks.length, "the dark input shim disappeared — was it replaced by a real fix?")
      .toBeGreaterThan(0);

    const outlines = blocks
      .flatMap((b) => [...b.matchAll(/border-color:\s*([^;]+);/g)])
      .map((m) => m[1].replace(/!important/g, "").trim());

    expect(outlines, "no field outline declared in dark — a field would be invisible")
      .not.toEqual([]);
    for (const value of outlines) {
      expect(value, "a field outline must come from --border-control, never the --divider hairline")
        .toBe("var(--border-control)");
    }
  });
});
