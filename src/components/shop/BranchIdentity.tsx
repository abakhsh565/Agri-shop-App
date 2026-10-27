import { CheckCircle2, Store } from "lucide-react";
import BranchKindChip from "@/components/ui/BranchKindChip";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { branchContextLabel, branchPlaceLine } from "@/lib/branchContext";
import type { BranchSummary } from "@/stores/shopStore";

/**
 * Which branch this is, said once — the block every screen about a single branch opens with.
 *
 * It answers the five things a person checking a branch needs before anything else on the page
 * means anything: its icon and name, the KIND of branch it is (the one the business started with
 * or one added afterwards), whether it is the one they are working in, where it is, and whether
 * it is open. The counts line under it says what is inside it.
 *
 * ONE IMPLEMENTATION, TWO HOSTS. The bottom sheet on Settings and the branch's own page both
 * render this, so the two can never describe the same branch differently — and every fact here
 * comes from the branch row the caller was handed (`get_my_branches`), not from a second read:
 * `shops` may only be read for the branch the account is working in, so asking it about another
 * branch answers nothing at all rather than answering wrongly.
 *
 * Nothing here is an edit control. A branch is renamed, pinned or listed by the deliberate
 * actions further down the page, and a header that could also be tapped would make every one of
 * them a guess about which tap the person meant.
 */
export default function BranchIdentity({ branch }: { branch: BranchSummary }) {
  const t = useT();
  const kind = branchKind(t, branch.isMain);
  const place = branchPlaceLine(branch);
  // The membership state, in the same word the Employees list uses for it, so "active" means one
  // thing across the app rather than a second vocabulary that only branches speak.
  const status = t(branch.membershipStatus === "active" ? "employees.active" : "employees.invited");

  return (
    <div className="flex items-start gap-3" data-testid={`branch-identity-${branch.id}`}>
      <span
        className="size-10 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: branch.isCurrent ? "var(--brand)" : "var(--tone-sunken)",
          color: branch.isCurrent ? "#0a0a0a" : "var(--text-secondary)",
        }}
        aria-hidden="true"
      >
        <Store size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-16 font-bold truncate" data-testid={`branch-name-${branch.id}`}>
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
        </div>

        <p
          className="text-12 mt-1 truncate"
          style={{ color: "var(--text-secondary)" }}
          data-testid={`branch-place-${branch.id}`}
        >
          {place ?? t("branches.noLocation")}
        </p>

        <p
          className="text-12 mt-1 flex items-center gap-1.5"
          style={{ color: "var(--brand-dark)" }}
          data-testid={`branch-status-${branch.id}`}
        >
          <CheckCircle2 size={13} />
          {status}
        </p>

        {/* Counts come from the branch read and are permission-gated there: a count this account
            may not see arrives as null and the line simply says what it does know, rather than
            claiming the branch is empty. */}
        <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
          {branchContextLabel(t, branch)}
        </p>
      </div>
    </div>
  );
}
