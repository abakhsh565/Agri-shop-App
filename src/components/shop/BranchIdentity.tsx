import { Pencil } from "lucide-react";
import BranchKindChip from "@/components/ui/BranchKindChip";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { branchPlaceLine } from "@/lib/branchContext";
import type { BranchSummary } from "@/stores/shopStore";

/**
 * Which branch this is, said once — the block the branch's page opens with.
 *
 * SHAPE (owner's reference, 2026-10-28): a large circular mark carrying the branch's initial,
 * the name at the size of a title with its Main/Sub chip and the word Current beside it, the
 * address under that, then what the branch holds — starting with its total employees.
 *
 * The large mark is the branch's initial rather than a generic shop glyph: on a list of nine
 * branches every row would otherwise open onto the same picture, and the header's job is to say
 * which one this is. `Current` is a word, not a pill, because it describes the session rather
 * than the branch; the Main/Sub chip stays the only pill on the line.
 *
 * Rename is one small pencil, not a field. The name is the branch's identity on every other
 * screen, so changing it is an act with a question around it (`BranchDetailPage`), not something
 * a stray tap on a header can do.
 */
export default function BranchIdentity({
  branch,
  onRename,
}: {
  branch: BranchSummary;
  onRename?: () => void;
}) {
  const t = useT();
  const kind = branchKind(t, branch.isMain);
  const place = branchPlaceLine(branch);
  const initial = branch.name.trim().charAt(0).toUpperCase() || "•";
  // The total is said even when it is zero: "0 employees" is an answer, and the owner asked to
  // see every branch's total. Only an unreadable count (no permission) is left unsaid.
  const employees =
    branch.employeeCount == null
      ? null
      : t(branch.employeeCount === 1 ? "branches.employeeOne" : "branches.employeeOther", {
          count: String(branch.employeeCount),
        });
  const products =
    branch.productCount != null && branch.productCount > 0
      ? t(branch.productCount === 1 ? "branches.productOne" : "branches.productOther", {
          count: String(branch.productCount),
        })
      : null;

  return (
    <div className="flex items-start gap-3.5" data-testid={`branch-identity-${branch.id}`}>
      <span
        className="size-16 rounded-full flex items-center justify-center shrink-0 text-22 font-bold"
        style={{
          background: branch.isCurrent ? "var(--brand)" : "var(--brand-light)",
          color: branch.isCurrent ? "#0a0a0a" : "var(--brand-dark)",
        }}
        aria-hidden="true"
        data-testid={`branch-avatar-${branch.id}`}
      >
        {initial}
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-18 font-bold truncate" data-testid={`branch-name-${branch.id}`}>
            {branch.name}
          </p>
          {kind && <BranchKindChip isMain={branch.isMain} label={kind} />}
          {branch.isCurrent && (
            <span
              className="text-10 font-semibold shrink-0"
              style={{ color: "var(--text-secondary)" }}
              data-testid={`branch-current-${branch.id}`}
            >
              {t("shop.current")}
            </span>
          )}
          {onRename && (
            <button
              type="button"
              onClick={onRename}
              aria-label={t("branches.rename")}
              data-testid={`branch-rename-${branch.id}`}
              className="size-7 rounded-full flex items-center justify-center shrink-0 ms-auto active:opacity-70"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
            >
              <Pencil size={13} />
            </button>
          )}
        </div>

        <p
          className="text-13 mt-1 truncate"
          style={{ color: "var(--text-secondary)" }}
          data-testid={`branch-place-${branch.id}`}
        >
          {place ?? t("branches.noLocation")}
        </p>

        {/* Counts come from the branch read and are permission-gated there: a count this account
            may not see arrives as null, and the label states only what it knows. The employee
            total leads the line — it is the fact the owner asked to see for every branch. */}
        <p
          className="text-12 mt-1.5"
          style={{ color: "var(--text-secondary)" }}
          data-testid={`branch-context-${branch.id}`}
        >
          {[employees, products].filter(Boolean).join(" · ") || t("branches.contextUnknown")}
        </p>
      </div>
    </div>
  );
}
