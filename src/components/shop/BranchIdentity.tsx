import BranchKindChip from "@/components/ui/BranchKindChip";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { branchPlaceLine } from "@/lib/branchContext";
import type { BranchSummary } from "@/stores/shopStore";

/**
 * Which branch this is, said once — the block the branch's page opens with.
 *
 * SHAPE (owner's correction, 2026-10-30). It is the same header the business record draws, because
 * both answer the same question: whose record is this. The business's own picture in the 68px tile
 * — the branch belongs to that business and shows the mark the owner uploaded there, not a letter
 * standing in for it — then the branch's REAL name at the size of the business name, with the
 * Main/Sub chip as the only tag beside it, and the place on the line under it.
 *
 * WHAT IS NO LONGER HERE. The employee and product totals were restated while the roles section
 * below already counts the same people. "Current" was a second badge for a session fact the screen
 * already implies. Rename left the header with them: the name an owner reads here is the business's
 * own name, so the header carries identity and nothing that changes it.
 *
 * "Main" is not a kind of screen and not a second name — it is one tag that says which branch the
 * business started with, exactly as the list and the switcher spell it.
 */
export default function BranchIdentity({
  branch,
  imageUrl,
}: {
  branch: BranchSummary;
  /** The business's own picture, as the business record shows it. */
  imageUrl?: string | null;
}) {
  const t = useT();
  const kind = branchKind(t, branch.isMain);
  const place = branchPlaceLine(branch);
  const initial = branch.name.trim().charAt(0).toUpperCase() || "•";

  return (
    <div className="flex items-center gap-3.5" data-testid={`branch-identity-${branch.id}`}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="size-[68px] rounded-[var(--radius-tile)] object-cover shrink-0"
          data-testid={`branch-image-${branch.id}`}
        />
      ) : (
        <span
          className="size-[68px] rounded-[var(--radius-tile)] flex items-center justify-center shrink-0 text-22 font-bold"
          style={{
            background: branch.isCurrent ? "var(--brand)" : "var(--brand-light)",
            color: branch.isCurrent ? "var(--ink-fg)" : "var(--brand-dark)",
          }}
          aria-hidden="true"
          data-testid={`branch-avatar-${branch.id}`}
        >
          {initial}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-16 font-semibold truncate" data-testid={`branch-name-${branch.id}`}>
            {branch.name}
          </p>
          {kind && <BranchKindChip isMain={branch.isMain} label={kind} />}
        </div>

        {/* The place, where the business header carries the number that reaches it: one quiet
            line under the name. */}
        <p
          className="text-14 font-semibold mt-0.5 truncate"
          style={{ color: place ? "var(--text-secondary)" : "var(--text-tertiary)" }}
          data-testid={`branch-place-${branch.id}`}
        >
          {place ?? t("branches.noLocation")}
        </p>
      </div>
    </div>
  );
}
