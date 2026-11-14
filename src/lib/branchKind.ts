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
