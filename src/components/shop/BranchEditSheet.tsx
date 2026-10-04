import Sheet from "@/components/ui/Sheet";
import BranchEditor from "@/components/shop/BranchEditor";
import { useT } from "@/lib/i18n";
import type { BranchSummary } from "@/stores/shopStore";

/**
 * The branch form in a bottom sheet — the same form the branch detail page renders.
 *
 * The sheet is still the right container on the Settings screen, where the account card's own
 * Edit button opens it in place. The Branches list no longer uses it: a branch there opens its
 * own detail page, because a branch has more to say than a sheet should hold.
 */
export default function BranchEditSheet({
  branch,
  onClose,
  onRenamed,
}: {
  branch: BranchSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const t = useT();
  return (
    <Sheet open title={t("branches.editTitle")} onClose={onClose}>
      <BranchEditor branch={branch} onClose={onClose} onRenamed={onRenamed} />
    </Sheet>
  );
}
