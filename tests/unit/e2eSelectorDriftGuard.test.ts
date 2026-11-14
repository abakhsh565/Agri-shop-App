import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The guard this repository was missing.
 *
 * WHY IT EXISTS. On 2026-11-13/14 the E2E lane set accumulated roughly a dozen lanes that could not
 * pass: `settings-edit-profile`, `profile-details-card`, `invite-join*` and others had been renamed or
 * removed in `src/`, and the specs still asked for them. Nothing noticed, because the PR lane ran
 * with `--max-failures=2` — each run stopped after two failures, so the rest of the suite never
 * executed and never went red. Clearing it took many 35-minute CI rounds, each revealing one more.
 *
 * The rot was detectable in two seconds without a browser: a spec asks for a testid that no source
 * file renders. This file does exactly that, so the next such rename fails the UNIT gate (which runs
 * on every commit, in seconds) instead of surfacing as a mysterious E2E failure an hour later.
 *
 * WHAT IT CHECKS (and what it deliberately does not):
 *   • every LITERAL `data-testid` a spec addresses must be rendered somewhere in `src/`
 *   • every static route a spec visits must exist in the router's path table
 * It cannot see:
 *   • ids built from template literals on either side (skipped, not guessed)
 *   • ids another library renders, or that only appear at runtime under data we do not have
 *   • whether the element is VISIBLE, enabled, or on the screen the spec thinks it is
 * So it is a floor, not a substitute for the lanes. It removes the silent, long-tail class only.
 */

const ROOT = process.cwd();
const ALLOWED_TESTID_PREFIXES = [
  // Rendered from a template ("emp-perm-<code>", "product-pack-size-<i>", "guide-faq-<id>"), so the
  // definition is dynamic and the reference is a concrete value. The prefix is checked instead.
  "emp-perm-",
  "branch-row-",
  "branch-delete-",
  "branch-delete-action-",
  "assign-person-",
  "role-modify-",
  "otp-digit-",
  "delete-back-",
  "audit-event-",
  "outstanding-row-",
  "add-branch-",
  "setup-step-",
  "product-pack-",
  "guide-faq-",
  "guide-watch-",
  "business-field-",
  "account-delete",
];

/**
 * DEBT REGISTRY — known-stale references, recorded rather than hidden.
 *
 * These lanes address screens that were renamed or removed. They were found on 2026-11-14 by this
 * guard, and by the whole-lane CI run that preceded it. None of them is in the 21-test critical smoke
 * gate, so they do not block a promotion; they DO run in the nightly full suite, which is where they
 * must be paid down. Listing them here (instead of deleting the assertion) keeps the drift visible: a
 * NEW stale reference anywhere still fails this guard, and removing an entry is how a lane graduates.
 */
const KNOWN_STALE: Record<string, string[]> = {
  "tests/e2e/accessUx.spec.ts": ["auth-tab-employee"],
  "tests/e2e/helpers.ts": ["auth-tab-employee"],
  "tests/e2e/businessProfilePapers.spec.ts": [
    "business-details-edit",
    "business-field-shop-id-change",
    "business-field-type-change",
    "business-document-licence",
  ],
  "tests/e2e/logicalDirection.spec.ts": ["auth-caption"],
  // Local-only lane (excluded from the Playwright run by `testIgnore`), kept for its co-owner flows.
  "tests/e2e/coOwner.local.spec.ts": [
    "auth-tab-employee",
    "shop-id-input",
    "co-owner-access-ended",
    "co-owner-revoke",
    "co-owner-revoke-confirm",
  ],
};

function knownStale(path: string, id: string): boolean {
  const key = path.replace(/\\/g, "/").replace(/^.*?tests\/e2e\//, "tests/e2e/");
  return (KNOWN_STALE[key] ?? []).includes(id);
}

/** testids a spec addresses, from the three shapes the suite uses. */
export function referencedTestIds(spec: string): string[] {
  const out = new Set<string>();
  const templates = [
    /getByTestId\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\[data-testid=["']([^"']+)["']\]/g,
    /data-testid=\\?["']([^"'\\]+)\\?["']/g,
  ];
  for (const re of templates) {
    for (const m of spec.matchAll(re)) {
      const id = m[1]?.trim();
      // A template literal is not a literal: `${...}` cannot be resolved statically.
      if (!id || id.includes("$") || id.includes("{")) continue;
      out.add(id);
    }
  }
  return [...out];
}

/** testids `src/` actually renders (literal definitions only). */
export function definedTestIds(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(/data-testid=\{?["'`]([^"'`$]+)["'`]/g)) out.add(m[1]);
    for (const m of source.matchAll(/testId=\{?["'`]([^"'`$]+)["'`]/g)) out.add(m[1]);
  }
  return out;
}

/** Static routes `router/index.tsx` declares. */
export function declaredRoutes(routerSource: string): Set<string> {
  const out = new Set<string>();
  for (const m of routerSource.matchAll(/path:\s*["']([^"']+)["']/g)) out.add(m[1]);
  return out;
}

/** Routes a spec visits literally (`page.goto('/x/y')`). */
export function referencedRoutes(spec: string): string[] {
  const out = new Set<string>();
  for (const m of spec.matchAll(/\.goto\(\s*[`'"]([^`'"]*)[`'"]/g)) {
    const raw = m[1] ?? "";
    if (!raw.startsWith("/")) continue;
    if (raw.includes("$") || raw.includes("{")) continue;
    out.add(raw);
  }
  return out;
}

function walk(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const specFiles = walk(join(ROOT, "tests/e2e"), (p) => p.endsWith(".spec.ts") || p.endsWith("helpers.ts"));
const srcFiles = walk(join(ROOT, "src"), (p) => p.endsWith(".ts") || p.endsWith(".tsx"));
const routerPath = join(ROOT, "src/router/index.tsx");

describe("E2E selector drift — a spec cannot outlive the screen it names", () => {
  const specs = specFiles.map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const sources = srcFiles.map((path) => readFileSync(path, "utf8"));
  const defined = definedTestIds(sources);
  const routes = declaredRoutes(readFileSync(routerPath, "utf8"));

  it("the analyser is not vacuous: it reports an id nothing renders", () => {
    const poisoned = `await page.getByTestId('a-testid-that-does-not-exist-xyz').click();`;
    const found = referencedTestIds(poisoned);
    expect(found).toContain("a-testid-that-does-not-exist-xyz");
    expect(defined.has("a-testid-that-does-not-exist-xyz")).toBe(false);
  });

  it("the analyser ignores template literals instead of guessing", () => {
    expect(referencedTestIds("page.getByTestId(`row-${id}`)")).toEqual([]);
  });

  it("every literal testid the lanes address is rendered by src/", () => {
    const missing: string[] = [];
    for (const spec of specs) {
      for (const id of referencedTestIds(spec.text)) {
        if (defined.has(id)) continue;
        if (ALLOWED_TESTID_PREFIXES.some((prefix) => id.startsWith(prefix))) continue;
        if (knownStale(spec.path, id)) continue;
        missing.push(`${spec.path.replace(ROOT, "").replace(/\\/g, "/")} → ${id}`);
      }
    }
    expect(
      missing,
      "a lane asks for a testid that no source file renders. Either the screen was renamed (fix the lane) or the lane is asserting a screen that no longer exists (delete or rewrite it).",
    ).toEqual([]);
  });

  it("every static route a lane visits exists in the router", () => {
    // Nested routers compose full paths from segments, so the check is by SEGMENT: a renamed or
    // deleted screen changes its segment name, which is the drift that actually happens. It cannot
    // prove the composition, and the lanes still do.
    const missing: string[] = [];
    for (const spec of specs) {
      for (const route of referencedRoutes(spec.text)) {
        const segments = route.split("/").filter(Boolean);
        for (const segment of segments) {
          if (segment.startsWith(":") || /^[0-9a-f-]{8,}$/i.test(segment)) continue;
          if (routes.has(segment)) continue;
          // A parent segment can be declared as part of a longer literal ("settings/hub/branches").
          const contained = [...routes].some((declared) => declared.split("/").includes(segment)) ||
            [...routes].some((declared) => declared.startsWith(`${segment}/`));
          if (!contained) {
            missing.push(`${spec.path.replace(ROOT, "").replace(/\\/g, "/")} → ${route} (segment "${segment}")`);
            break;
          }
        }
      }
    }
    expect(missing, "a lane visits a route whose segment no longer exists in the router").toEqual([]);
  });
});
