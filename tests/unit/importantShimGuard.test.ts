import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The compatibility layer is gone; this guard keeps it gone.
 *
 * `src/index.css` used to carry a block of `!important` shims that remapped legacy physical
 * utilities (`[dir="rtl"] .absolute.left-4`, `[dir="rtl"] .pl-10`) and hardcoded literal
 * colours (`.dark .bg-white`, `.text-black`) onto tokens, because screens written before the
 * design system still referenced them. Two things were wrong with that, and both are the
 * reason this file exists:
 *
 *   1. It decided direction in a second place. Position was written physically in the screen
 *      and flipped physically in the stylesheet, so a screen could only be read correctly by
 *      holding both in your head — and any utility the list did not cover silently stayed
 *      unflipped.
 *   2. `!important` outranks tokens. `.dark input { border-color: var(--divider) !important }`
 *      kept every dark field edge invisible *after* the token itself had been fixed, which is
 *      how that regression hid.
 *
 * So the layer was migrated rather than patched: every positional utility in `src/` is now
 * logical (`start/end`, `ps/pe`, `ms/me`), the new token names carry the intent that the
 * literal classes were standing in for (`--ink`, `--ink-fg`, `--caption`,
 * `--border-control`), and the shims were deleted.
 *
 * What this guard enforces:
 *   • the class-gated `!important` set is exactly the five rules listed below, each of which
 *     is a rule in its own right rather than a compatibility shim. A sixth one fails the
 *     build, so the next physical utility gets migrated instead of shimmed.
 *   • no screen writes a physical direction utility again.
 *   • the surviving dark field rule still names the control outline, never the hairline.
 */
const ROOT = process.cwd();

/** Every `!important` rule whose selector is class-gated. */
function shimRules(): Array<{ selector: string; classes: string[] }> {
  const css = fs.readFileSync(path.join(ROOT, "src/index.css"), "utf8");
  const out: Array<{ selector: string; classes: string[] }> = [];
  for (const m of css.matchAll(/^([^@{}\n][^{}\n]*?)\s*\{([^}]*!important[^}]*)\}/gm)) {
    const classes = [...m[1].matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)]
      .map((c) => c[1].replace(/\\(.)/g, "$1"))
      .filter((c) => !["dark", "light", "group", "peer"].includes(c));
    if (classes.length) out.push({ selector: m[1].trim(), classes });
  }
  return out;
}

/**
 * The rules allowed to carry a class-gated `!important`, and why each one is not a shim.
 * Adding to this list is a deliberate act; leaving a new rule unlisted fails the build.
 */
const ALLOWED: Array<{ selector: string; why: string }> = [
  {
    selector: ".app-frame",
    why: "installed-app chrome: fills the device viewport in standalone mode only",
  },
  {
    selector: ".app-shell-bg",
    why: "same media query — the shell background outside the phone frame",
  },
  {
    selector: ".ds-anim-leaving",
    why: "an overlay on its way out must not swallow a tap aimed at the screen beneath it",
  },
  {
    selector: ".dark textarea.bg-transparent",
    why: "a field that asks to be transparent inside a filled pill must stay transparent",
  },
  {
    selector: "body:has(.fixed.inset-0.z-50)",
    why: "page scroll lock while a sheet or dialog is open",
  },
];

function sourceFiles(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "dist") walk(p);
      } else if (/\.(tsx?|jsx?|html)$/.test(e.name)) {
        out.push({ file: path.relative(ROOT, p), text: fs.readFileSync(p, "utf8") });
      }
    }
  };
  walk(path.join(ROOT, "src"));
  const indexHtml = path.join(ROOT, "index.html");
  if (fs.existsSync(indexHtml)) out.push({ file: "index.html", text: fs.readFileSync(indexHtml, "utf8") });
  return out;
}

/** Physical direction utilities. Tailwind's logical equivalents are start/end, ps/pe. */
const PHYSICAL = [
  ["left-N", /(?<![\w-])left-\d/],
  ["right-N", /(?<![\w-])right-\d/],
  ["pl-N", /(?<![\w-])pl-\d/],
  ["pr-N", /(?<![\w-])pr-\d/],
  ["ml-N", /(?<![\w-])ml-\d/],
  ["mr-N", /(?<![\w-])mr-\d/],
  ["text-left", /(?<![\w-])text-left(?![\w-])/],
  ["text-right", /(?<![\w-])text-right(?![\w-])/],
  ["border-l", /(?<![\w-])border-l(?![\w-])/],
  ["border-r", /(?<![\w-])border-r(?![\w-])/],
  ["rounded-l", /(?<![\w-])rounded-l(?![\w-])/],
  ["rounded-r", /(?<![\w-])rounded-r(?![\w-])/],
] as const;

describe("the RTL compatibility layer stays deleted", () => {
  it("has no class-gated !important rule outside the documented allow-list", () => {
    const found = shimRules().map((r) => r.selector);
    const allowed = ALLOWED.map((a) => a.selector);

    expect(
      found.filter((s) => !allowed.includes(s)),
      "a new !important shim appeared. Write the utility logically (start-/end-, ps-/pe-) " +
        "or name the token, rather than remapping a class with !important.",
    ).toEqual([]);

    // …and the allow-list itself must not rot: every entry still matches a real rule.
    expect(
      allowed.filter((s) => !found.includes(s)),
      "an allowed rule disappeared — remove it from ALLOWED so the list stays truthful",
    ).toEqual([]);
  });

  it("no screen writes a physical direction utility", () => {
    const offenders: string[] = [];
    for (const { file, text } of sourceFiles()) {
      for (const [label, re] of PHYSICAL) {
        if (re.test(text)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders, "physical direction utilities — use the logical equivalents").toEqual([]);
  });

  it("no screen paints a legacy literal colour the old layer used to remap", () => {
    // `bg-white` and `text-white` are deliberately still allowed where literal white IS the
    // intent (a barcode plate that must scan, a switch knob, white type on a red badge).
    // The remapped literals are the ones that must never come back.
    const FORBIDDEN = ["text-black", "border-black", "bg-[#f5f5f5]", "text-[#888]", "border-[#e5e5e5]"];
    const offenders: string[] = [];
    for (const { file, text } of sourceFiles()) {
      for (const cls of FORBIDDEN) {
        if (new RegExp(`(?<![\\w-])${cls.replace(/[[\]()#]/g, "\\$&")}(?![\\w-])`).test(text)) {
          offenders.push(`${file}: ${cls}`);
        }
      }
    }
    expect(offenders, "legacy literal colour classes returned — use the token utility").toEqual([]);
  });

  it("the surviving dark field rule points at the control outline, not the hairline", () => {
    // The regression this guard was written for. An element-level dark rule sets
    // `border-color` on every input with `!important`, so it outranks both the base-layer
    // field rule and the Input component's class. It was pointed at `--divider` — the
    // in-card hairline, 13/255 from the dark field tone — which kept every dark-mode field
    // edge invisible even after the token itself had been fixed.
    const css = fs.readFileSync(path.join(ROOT, "src/index.css"), "utf8");
    const blocks = css.match(/\.dark[^{}]*\binput\b[^{}]*\{[^}]*\}/g) ?? [];
    expect(blocks.length, "the dark field rule disappeared — was it replaced by a real fix?")
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
