import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * One list implementation, enforced.
 *
 * ListCard/ListRow own the grouped-list grammar: tone surface, no border, row
 * height, padding and — critically — the separator inset, which the ROW decides
 * (ListRow publishes `--row-inset` from its own leading slot). A screen that
 * restates a bordered row by hand silently re-introduces a second implementation,
 * and one that sets a CARD-level inset cannot describe a card whose rows have
 * different leading slots. Both drift modes are caught here.
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

  it("no card-level separator inset exists (the row owns it)", () => {
    const styling = read("src/index.css");
    expect(styling).not.toContain("ds-listcard-flush");
    expect(styling).not.toContain("ds-listcard-icon");
    // The only inset the card layer may express is the fallback for a row that
    // publishes nothing; anything else means the decision leaked back into the card.
    const insetRules = styling.match(/inset-inline-start:\s*var\(--row-inset[^)]*\)[^;]*;/g) ?? [];
    expect(insetRules).toEqual(["inset-inline-start: var(--row-inset, 16px);"]);
  });

  it("ListRow publishes the inset, so the row is the single owner", () => {
    const row = read("src/components/ui/ListRow.tsx");
    expect(row).toContain('["--row-inset" as string]');
    expect(row).toMatch(/const rowInset = tile \? 72 : Icon \? 52 : 16;/);
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
