import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import BranchesSection from "@/components/shop/BranchesSection";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";

/**
 * Branches, as the Settings section opens it.
 *
 * SHAPE (owner's reference, 2026-10-28): the section's own label, then one card holding every
 * branch — its mark, its name with Main/Sub and Current, how many people work there, and the
 * way in — followed by the row that adds another. No hub menu of four jobs: the jobs are each
 * branch, and the one act the section owns is creating another.
 *
 * The rows are `components/shop/BranchesSection`, the SAME block the account screen shows. It is
 * reused rather than copied so the two screens cannot describe the same branch differently, and
 * so the create row goes on opening the real branch flow (`openSwitcher("create")`) instead of a
 * second entry point invented here. The `plain` variant is the hub's surface: the rows stand on
 * the page with no card and no hairlines between them, the way every other section hub lists its
 * jobs (owner's reference, 2026-10-28).
 *
 * Every figure is the branch read's: the employee count arrives from `get_my_branches()` and is
 * left unsaid when this account may not read it — unknown is never drawn as zero.
 */
export default function AdminBranchesSectionPage() {
  const t = useT();
  const base = useShellBase();

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="branches-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("branches.title")} backTo={`${base}/settings`} />
      <div className="pb-8">
        <BranchesSection variant="plain" />
      </div>
    </div>
  );
}
