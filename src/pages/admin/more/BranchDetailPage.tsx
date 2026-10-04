import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import BranchEditor from "@/components/shop/BranchEditor";
import DeleteTargetSheet, { branchDeleteSubject } from "@/components/shop/DeleteTargetSheet";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";

/**
 * One branch, as a page.
 *
 * The Branches list used to open a bottom sheet with the branch's whole form inside it. The
 * form outgrew the sheet — a name, a map, the marketplace switch and the branch's roles all in
 * one panel — so the same form (BranchEditor, one implementation) now fills a page, and the
 * list row is the way in. The sheet stays on Settings for the account card's own Edit button.
 *
 * Deleting lives here too, where it has room to be the deliberate act it is; the main branch
 * has no Delete, because the database refuses it and a control that exists only to be refused
 * is a lie about what is possible.
 */
export default function BranchDetailPage() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const base = useShellBase();

  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);

  const [deleting, setDeleting] = useState(false);

  // A direct link can land here before the list has been read — the list is what carries every
  // branch's details — so the page reads it itself rather than claiming the branch is missing.
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  const branch = branches.find((b) => b.id === branchId);

  // Once the list is read and the branch is not in it, this URL names nothing the account can
  // open; going back is the honest answer, and this avoids flashing a stale "not found" claim.
  useEffect(() => {
    if (branchesLoaded && !branch) navigate(`${base}/more`, { replace: true });
  }, [branchesLoaded, branch, base, navigate]);

  if (!branch) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("branches.editTitle")} backTo={`${base}/more`} />
        <div className="flex items-center justify-center py-10" role="status" aria-busy="true">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={branch.name} backTo={`${base}/more`} />

      {/* The same form the sheet renders, page-sized. Saving keeps the page open: the name it
          just saved is the page's title, and everything else it wrote is visible in place. */}
      <BranchEditor branch={branch} onClose={() => undefined} onRenamed={() => undefined} />

      {!branch.isMain && (
        <div className="px-4 pb-8">
          <button
            type="button"
            onClick={() => setDeleting(true)}
            data-testid={`branch-delete-action-${branch.id}`}
            className="h-10 flex items-center text-13 font-bold ds-pressable"
            style={{ color: "var(--error)" }}
          >
            {t("branches.delete")}
          </button>
        </div>
      )}

      {deleting && (
        <DeleteTargetSheet
          subject={branchDeleteSubject(branch)}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            navigate(`${base}/more`);
          }}
        />
      )}
    </div>
  );
}
