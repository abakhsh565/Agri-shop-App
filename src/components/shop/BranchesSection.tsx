import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Store } from "lucide-react";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { branchContextLabel } from "@/lib/branchContext";
import { branchKind } from "@/lib/branchKind";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";

/**
 * The branches this account runs, as one block.
 *
 * TWO SURFACES, ONE SET OF ROWS. `card` (the default) is the grouped block the account screen
 * shows: a section label and one surface holding the rows. `plain` drops the card and its
 * hairlines so the section hub can draw the same rows straight on the page, the way every other
 * section hub draws its jobs — the owner asked for no lines between those rows (2026-10-28).
 * The rows, the create row and the route into a branch are the same implementation in both, so
 * the two surfaces cannot drift.
 *
 * It used to live only on the owner suite's More screen. It is here now because a branch is a
 * fact about the shop the account works in, and Settings is the screen that answers "which shop
 * am I in and what is in it" — the same question the profile card at the top of that page
 * answers about the person. One implementation, so both screens can never disagree about the
 * same branch: the rows, the states, the create row and the route into each branch are all here.
 *
 * Every row opens that branch's own detail page, which is the one place all of it is edited or
 * removed — so the row itself carries no check and no Edit control, just the way in.
 */
export default function BranchesSection({ variant = "card" }: { variant?: "card" | "plain" }) {
  const navigate = useNavigate();
  const t = useT();
  const base = useShellBase();
  const { isRtl } = useDir();

  const branches = useShopStore((s) => s.branches);
  const branchesLoading = useShopStore((s) => s.branchesLoading);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const branchesError = useShopStore((s) => s.branchesError);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const activeShopId = useShopStore((s) => s.activeBranchId);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");

  /**
   * Read the branches when this block is opened, not once at sign-in.
   *
   * This is where a branch is added or removed, so it is the one place that has to be right
   * immediately after somebody changes something — on this phone or another one.
   * `branchesLoaded` keeps the repeat visits free.
   */
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  // What one branch holds. One derivation, shared with Home (`lib/branchContext`), because two
  // screens writing the same sentence is how they start disagreeing about the same branch.
  const branchContext = (b: BranchSummary) => branchContextLabel(t, b);

  const rows = (
    <>
      {branchesLoading && branches.length === 0 && (
          <div data-testid="branches-loading">
            <SkeletonList rows={2} />
          </div>
        )}

        {!branchesLoading && branches.length === 0 && (
          <ListRow
            title={t(branchesError === "load_failed" ? "branches.loadFailed" : "shop.noneOwned")}
            testId="branches-empty"
            trailing={
              branchesError === "load_failed" ? (
                <Button variant="outline" size="sm" onClick={() => void loadBranches()}>
                  {t("common.tryAgain")}
                </Button>
              ) : undefined
            }
          />
        )}

        {branches.map((branch) => {
          // "Which one am I in" is read from the ONE owner of that fact — the same value the
          // header and every query follow — rather than from the row's own snapshot, so a switch
          // marks the right row without waiting for this list to reload.
          const isCurrent = branch.id === activeShopId;
          return (
            <ListRow
              key={branch.id}
              testId={`branch-row-${branch.id}`}
              tile={
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: isCurrent ? "var(--brand)" : "var(--tone-sunken)",
                    color: isCurrent ? "#0a0a0a" : "var(--text-secondary)",
                  }}
                  aria-hidden="true"
                >
                  <Store size={16} />
                </div>
              }
              title={branch.name}
              // The KIND first, because it never changes: this is the branch the business
              // started with, or one added later. Which row you are standing in is a second,
              // temporary fact, so it follows the kind rather than replacing it.
              qualifier={[branchKind(t, branch.isMain), isCurrent ? t("shop.current") : null]
                .filter(Boolean).join(" · ")}
              meta={branchContext(branch)} // branchContextLabel already treats unknown as neutral
              // The whole row is the way into the branch's detail page. Edit and delete are not
              // squeezed in beside it: a row that is both a destination and a set of controls is
              // how the wrong control gets tapped on the way to the page.
              onClick={() => navigate(`${base}/settings/branches/${branch.id}`)}
              trailing={
                <ChevronRight
                  size={14}
                  style={{ color: "var(--text-secondary)", transform: isRtl ? "rotate(180deg)" : undefined }}
                  className="shrink-0"
                />
              }
            />
          );
        })}

        {/* The way in, as a row of the same list rather than a button floating under it: adding a
            branch belongs to the set of branches, and it is the last thing in that set because it
            is the newest. */}
      {isOwner && <ListRow
        testId="branches-create"
        icon={Plus}
        title={t("branches.create")}
        meta={t("branches.createHint")}
        // `create` rather than the plain open: this row asked for a new branch, and the sheet
        // opens on the name step instead of making the person find the link again.
        onClick={() => openSwitcher("create")}
      />}
    </>
  );

  // The section hub: no card, no section label, no line between rows. The page's own title
  // already names the section, and the owner's reference (Customers & Credit) draws its CTAs
  // straight on the page, so Branches does the same.
  if (variant === "plain") {
    return (
      <div className="pt-4 pb-2" data-testid="branches-section">
        {rows}
      </div>
    );
  }

  return (
    <div className="px-4 pt-4" data-testid="branches-section">
      <ListCard section={t("branches.title")}>{rows}</ListCard>
    </div>
  );
}
