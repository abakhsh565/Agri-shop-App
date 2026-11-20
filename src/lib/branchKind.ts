import type { TranslateFn } from "@/lib/i18n";

/**
 * The KIND of a branch, in one word: Main or Sub.
 *
 * The rule the app follows is the one the database holds (`branches.is_default`):
 *
 *   Main — the branch the business started with, the one the owner signed up into. It can be
 *          renamed and never deleted, because the business has to live somewhere.
 *   Sub  — every branch added afterwards, under that same business. It starts empty and holds
 *          only its own stock, sales, people and receivables: no branch reads another's ledger.
 *
 * One helper because this word is now read in the profile card, the branch list, the switcher,
 * the dashboard header and the report context — five places that must not each invent their own
 * spelling. `isMain` is `null` only while the branch list is still loading, and an unknown kind
 * draws nothing rather than guessing "Sub".
 */
export function branchKind(t: TranslateFn, isMain: boolean | null | undefined): string | null {
  if (isMain == null) return null;
  return t(isMain ? "branches.main" : "branches.sub");
}

/**
 * The kind words a branch's own name may already end with.
 *
 * WHY. Branches provisioned by the signup flow were named after the business AND its kind —
 * production's main branch is literally "Kamran Traders - Main" — while every screen also draws
 * the kind as its own word or chip. The header read "Kamran Traders - Main · Main" and the same
 * repeat showed on the profile card, the branch list, the reports context and the employee role
 * sheet (owner, 2026-11-20: "Main main words repeating again and again on production").
 *
 * Both languages are matched, because a name is written once, in whatever language the owner was
 * using, and read later in either.
 */
const KIND_WORDS = ["main", "sub", "مرکزی", "ذیلی"];
const KIND_SUFFIX = /^(.*\S)\s*[-–—·|:]\s*(main|sub|مرکزی|ذیلی)$/i;

/** A branch's name with a kind already baked into it taken off: "Kamran Traders - Main" → "Kamran Traders". */
export function branchNameOnly(name: string | null | undefined): string {
  const original = (name ?? "").trim();
  let stripped = original;
  for (let guard = 0; guard < 3; guard += 1) {
    const match = KIND_SUFFIX.exec(stripped);
    if (!match) break;
    stripped = match[1].trim();
  }
  return stripped || original;
}

/**
 * A branch as one line reads it: the name, and the kind only when the name does not already say it.
 *
 * `name` is what to print, `kind` is the chip to draw beside it (or null). A branch called "Main"
 * keeps its name and gets no chip; "Kamran Traders - Main" became "Kamran Traders" and keeps the
 * chip; "Gulberg" (a sub) keeps both.
 */
export function branchIdentity(
  t: TranslateFn,
  name: string | null | undefined,
  isMain: boolean | null | undefined,
): { name: string; kind: string | null } {
  const original = (name ?? "").trim();
  const kind = branchKind(t, isMain);
  const stripped = branchNameOnly(original);
  if (!stripped || KIND_WORDS.includes(stripped.toLowerCase())) {
    return { name: original, kind: null };
  }
  return { name: stripped, kind };
}
