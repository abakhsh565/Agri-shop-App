import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * One type system, enforced.
 *
 * The ramp in `src/index.css` (`--fs-8` … `--fs-34`) is the single source of truth
 * for font size, and `@theme inline` turns each step into a utility (`text-13`,
 * `text-17`). A screen is therefore never allowed to own a size:
 *
 *   - `text-[13px]` re-introduces a second, screen-level scale — the exact drift
 *     that previously left 590 raw sizes in 77 files, where "make the type smaller"
 *     meant editing 77 files instead of one.
 *   - a `text-N` utility with no matching ramp token renders as nothing at all,
 *     which is silent and looks like a styling bug rather than a build error.
 *   - a raw `font-size: Npx` in the stylesheet is the system layer bypassing itself.
 *
 * The ramp is allowed to change — that is the point of it. What is not allowed is a
 * size that exists nowhere in the ramp.
 */
const ROOT = process.cwd();
const SKIP = new Set(["imports", "node_modules"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name)));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(path.relative(ROOT, path.join(dir, entry.name)).replace(/\\/g, "/"));
    }
  }
  return out;
}

const FILES = walk(path.join(ROOT, "src"));
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const STYLING = read("src/index.css");

/** The ramp, read out of the stylesheet — never a second hardcoded copy of it. */
const RAMP = new Set(
  [...STYLING.matchAll(/^\s*--fs-(\d+):\s*\d+px;/gm)].map((m) => Number(m[1]))
);

describe("type sizes live in one place", () => {
  it("the ramp is actually declared", () => {
    expect(RAMP.size, "no --fs-* ramp found in src/index.css").toBeGreaterThan(10);
    expect(RAMP.has(13)).toBe(true);
  });

  it("no screen writes a raw px font size", () => {
    const offenders = FILES.filter((f) => /text-\[\d+(?:\.\d+)?px\]/.test(read(f))).sort();
    expect(
      offenders,
      "use a ramp utility (text-13) instead of text-[13px] — a raw size is a second type system"
    ).toEqual([]);
  });

  it("every text-<size> utility in use has a ramp step behind it", () => {
    const missing = new Map<string, string>();
    for (const file of FILES) {
      for (const m of read(file).matchAll(/(?:^|[\s"'`])text-(\d{1,3})(?![\d\w-])/g)) {
        const step = Number(m[1]);
        if (!RAMP.has(step)) missing.set(`text-${step}`, file);
      }
    }
    expect(
      [...missing].map(([cls, file]) => `${cls} (${file})`),
      "a text-N with no ramp token renders nothing — add the step to the ramp"
    ).toEqual([]);
  });

  it("the stylesheet's own sizes come from the ramp, not literals", () => {
    const literals = [...STYLING.matchAll(/^\s*font-size:\s*\d+px;/gm)].map((m) => m[0].trim());
    expect(literals, "the system layer must read the ramp too").toEqual([]);
  });

  it("the ramp is exposed as Tailwind utilities", () => {
    for (const step of [10, 11, 13, 15, 17]) {
      expect(STYLING, `--text-${step} missing from @theme inline`).toContain(
        `--text-${step}: var(--fs-${step});`
      );
    }
  });

  it("one font family, and no second family is requested", () => {
    expect(read("src/index.css")).not.toMatch(/fonts\.googleapis\.com\/css2\?family=(?!Inter)/);
    const families = new Set(
      [...STYLING.matchAll(/font-family:\s*([^;]+);/g)]
        .map((m) => m[1].trim())
        .filter((v) => !v.startsWith("inherit") && !v.startsWith("var("))
        .map((v) => v.split(",")[0].replace(/['"]/g, ""))
    );
    expect(
      [...families],
      "a second typeface was introduced — the product ships exactly one"
    ).toEqual(["Inter"]);
  });
});
