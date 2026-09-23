import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * One list implementation, enforced.
 *
 * ListCard/ListRow own the grouped-list grammar: tone surface, no border, row
 * height, padding, the spacing between a name and its second line, and — critically
 * — the separator geometry, which the CARD decides and which is full-bleed (0 → 0).
 * A screen that restates a bordered row by hand silently re-introduces a second
 * implementation. Separators used to start after each row's leading slot, so a card
 * mixing tile, icon and text rows drew lines beginning at 72px, 52px and 16px and
 * the left of every card went bare; that per-row inset (`--row-inset`) is deleted
 * and may not come back.
 *
 * PENDING is the honest, explicit backlog: files still on the old path. It may
 * only shrink — converting a file without removing it from PENDING FAILS, so the
 * list cannot quietly rot, and a brand-new offender FAILS immediately.
 */
const PENDING_DSCARD: string[] = [];

/**
 * Accepted exceptions — not backlog. Empty on purpose: the one entry this list held
 * (`src/components/ui/RTL.tsx`) has been deleted. It was design scaffolding whose
 * six exports had no consumer in src/ — a repo-wide check found zero imports of the
 * module and zero references to five of its exports, with `ActionRow`'s only hits
 * belonging to a same-named local function elsewhere. An exception that points at a
 * file that no longer exists is worse than no exception, because it reads as a live
 * decision.
 */
const EXCEPTIONS_HANDROLLED: string[] = [];

const PENDING_HANDROLLED: string[] = [];

const ROOT = process.cwd();
const SKIP = new Set(["imports", "node_modules"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      out.push(path.relative(ROOT, path.join(dir, entry.name)).replace(/\\/g, "/"));
    }
  }
  return out;
}

const FILES = walk(path.join(ROOT, "src"));
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("grouped lists have exactly one implementation", () => {
  it("only ListCard renders the ds-listcard class", () => {
    const offenders = FILES.filter(
      (f) => f !== "src/components/ui/ListCard.tsx" && read(f).includes("ds-listcard")
    ).sort();
    expect(offenders, "new file bypasses ListCard — use the primitive").toEqual(PENDING_DSCARD);
  });

  it("the separator is full-bleed, and there is exactly one rule that draws it", () => {
    const styling = read("src/index.css");
    expect(styling).not.toContain("ds-listcard-flush");
    expect(styling).not.toContain("ds-listcard-icon");
    const sepRules = styling.match(/\.ds-listcard > \* \+ \*::before \{[^}]*\}/g) ?? [];
    expect(sepRules.length, "the separator is drawn in more than one place").toBe(1);
    expect(sepRules[0], "the hairline does not start at the card's edge").toContain(
      "inset-inline-start: 0;",
    );
    expect(sepRules[0], "the hairline does not reach the card's edge").toContain(
      "inset-inline-end: 0;",
    );
  });

  it("no row or screen places the hairline itself", () => {
    // The per-row inset is deleted, not merely unused: a property nothing reads is
    // how the old geometry would creep back in.
    const offenders = FILES.filter((f) => read(f).includes("--row-inset")).sort();
    expect(offenders, "a file is deciding the separator geometry again").toEqual([]);
  });

  it("a stacked row is spaced like a plain one, and its second line is clear of the name", () => {
    const styling = read("src/index.css");
    expect(styling, "a stacked row's block padding is not the row scale").toMatch(
      /\.ds-row-top \{[^}]*padding-block: var\(--space-3\);/,
    );
    expect(styling, "the second line has no gap under the name").toMatch(
      /\.ds-row-meta,\s*\.ds-row-desc \{[^}]*margin-block-start: 4px;/,
    );
  });

  it("no screen hand-rolls a bordered row separator", () => {
    const offenders = FILES.filter(
      (f) =>
        !EXCEPTIONS_HANDROLLED.includes(f) &&
        (/borderBottom: (i|idx) </.test(read(f)) || read(f).includes("0.5px solid var(--divider)"))
    ).sort();
    expect(
      offenders,
      "new hand-rolled row list — use ListCard/ListRow instead of a per-row border"
    ).toEqual(PENDING_HANDROLLED);
  });
});
