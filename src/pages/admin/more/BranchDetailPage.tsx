import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowRightLeft, Crown, Loader2, MapPin, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import BranchEditor from "@/components/shop/BranchEditor";
import BranchIdentity from "@/components/shop/BranchIdentity";
import BranchPerformance from "@/components/shop/BranchPerformance";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Input from "@/components/ui/Input";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { exportText } from "@/lib/exportData";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCoOwnersStore, type BranchCoOwner } from "@/stores/coOwnersStore";
import { loadBusinessProfile } from "@/lib/businessProfile";
import { resolveImageUrl } from "@/lib/storage";
import { supabase } from "@/lib/supabase";

/**
 * One branch, as a record the owner reads.
 *
 * PURPOSE (owner's redesign, 2026-11-12). The owner opens this page to answer four questions
 * about a branch they are not editing right now: whose place is this, how is it doing, where is it
 * and can farmers find it, and who runs it. So the page is one reading order — identity,
 * performance, location, people — and every block answers exactly one of those questions.
 *
 * WHAT WAS REMOVED. The same people appeared in three separately titled blocks (roles, responsible
 * person, co-owner), each with its own sentence explaining which branch could be read or why
 * something was unavailable. Those are one People section now, and the sentences are gone: a row
 * states the fact, and the control to change it is the row itself. The figures moved from a card
 * of labelled tiles into the reports' plate, so this record page stops looking like a dashboard.
 * The bottom "operational" list is still absent — those screens are in the menu, and a branch page
 * that relisted them read as a second Settings.
 *
 * WHAT IT GAINED. A "..." menu with the two actions this page owns besides editing — switch to
 * this branch, share its location — because the branch's address is the one thing an owner
 * forwards to a driver or a customer. Archive stays at the foot of the page, where the only
 * destructive act has room to be deliberate; the main branch has no archive, because the database
 * refuses it and a control that exists only to be refused is a lie about what is possible.
 */
export default function BranchDetailPage() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const base = useShellBase();

  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const switchTo = useShopStore((s) => s.switchBranch);

  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The business's picture, so the header shows the real mark rather than a stand-in letter. */
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const submitting = useRef(false);
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");
  const { addToast } = useUIStore();
  const employees = useEmployeesStore((s) => s.employees);
  const loadEmployees = useEmployeesStore((s) => s.load);
  const getBranchCoOwners = useCoOwnersStore((s) => s.getBranchCoOwners);
  const [coOwners, setCoOwners] = useState<BranchCoOwner[]>([]);

  async function readCoOwners() {
    if (!branchId || !isOwner) return;
    try {
      const result = await getBranchCoOwners(branchId);
      setCoOwners(result.coOwners ?? []);
    } catch {
      setCoOwners([]);
    }
  }

  async function archive() {
    if (!branchId || !reason.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await useShopStore.getState().archiveBranch(branchId, reason);
      if (!result.ok) {
        addToast(t(result.code === "has_staff" ? "branchFlow.hasStaff" : "branches.saveFailed"), "error");
        return;
      }
      addToast(t("branchFlow.archived"), "success");
      navigate(`${base}/settings`);
    } finally { submitting.current = false; setBusy(false); }
  }

  // A direct link can land here before the list has been read — the list is what carries every
  // branch's details — so the page reads it itself rather than claiming the branch is missing.
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  // The picture lives on the business record, not on the branch row; a business with none keeps
  // the branch's initial, which is derived from the name and so can never be stale.
  useEffect(() => {
    let live = true;
    void loadBusinessProfile()
      .then((profile) => {
        if (!live) return;
        setLogoUrl(resolveImageUrl(profile?.shop?.logo_url ?? profile?.documents?.logo ?? null) ?? null);
      })
      .catch(() => { if (live) setLogoUrl(null); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    void readCoOwners();
    if (isOwner) void loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readCoOwners closes over branchId only
  }, [branchId, isOwner, loadEmployees]);

  const branch = branches.find((b) => b.id === branchId);

  // Once the list is read and the branch is not in it, this URL names nothing the account can
  // open; going back is the honest answer, and this avoids flashing a stale "not found" claim.
  useEffect(() => {
    if (branchesLoaded && !branch) navigate(`${base}/settings/hub/branches`, { replace: true });
  }, [branchesLoaded, branch, base, navigate]);

  // A Co-Owner can read the branch through their own screens but cannot manage its lifecycle.
  // This direct address must not become a second way into the Owner's branch editor.
  if (!isOwner) return <Navigate to={`${base}/more`} replace />;

  if (!branch) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("branchPage.title")} backTo={`${base}/settings/hub/branches`} />
        <div className="flex items-center justify-center py-10" role="status" aria-busy="true">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
        </div>
      </div>
    );
  }

  /** Working in another branch is what changing its roles means; say so, then do it. */
  async function openRoles() {
    if (!branch) return;
    if (!branch.isCurrent) {
      const result = await switchTo(branch.id);
      if (!result.ok) {
        addToast(
          t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"),
          result.code === "pending_sync" ? "warning" : "error",
        );
        return;
      }
      addToast(t("shop.switched", { shop: branch.name }), "success");
    }
    navigate(`${base}/settings/roles`);
  }

  async function switchHere() {
    setMenuOpen(false);
    if (!branch || branch.isCurrent) return;
    const result = await switchTo(branch.id);
    if (!result.ok) {
      addToast(t("shop.switchFailed"), "error");
      return;
    }
    addToast(t("shop.switched", { shop: branch.name }), "success");
  }

  /**
   * The address, through the app's one share path: the system sheet (Android app, or a phone
   * browser) with the branch's map link as its link card, and the clipboard where no sheet can
   * exist. No custom chooser is drawn — the platform's own sheet already lists WhatsApp, mail and
   * everything else installed (owner's reference, 2026-11-12).
   */
  async function shareLocation() {
    setMenuOpen(false);
    if (!branch) return;
    if (!branch.place) {
      addToast(t("branchPage.noLocationToShare"), "warning");
      return;
    }
    const place = [branch.place.label, branch.place.address].filter(Boolean).join(" · ");
    const url = `https://maps.google.com/?q=${branch.place.lat},${branch.place.lng}`;
    const text = [branch.name, place].filter(Boolean).join("\n");
    try {
      const outcome = await exportText(text, branch.name, url);
      addToast(
        outcome === "shared" ? t("branchPage.locationShared") : t("branchPage.locationCopied"),
        "success",
      );
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  const employeeLine = branch.employeeCount != null
    ? t(branch.employeeCount === 1 ? "branches.employeeOne" : "branches.employeeOther", {
        count: String(branch.employeeCount),
      })
    : undefined;

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader
        title={t("branchPage.title")}
        backTo={`${base}/settings/hub/branches`}
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("data.moreActions")}
            testId="branch-actions"
          />
        }
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={branch.name}
        actions={[
          ...(branch.isCurrent
            ? []
            : [
                {
                  id: "switch" as const,
                  icon: ArrowRightLeft,
                  title: t("branchPage.switchHere"),
                  onClick: () => { void switchHere(); },
                },
              ]),
          // The existing Co-Owner flow, opened with this branch fixed: pick the person, then
          // what they can open, their major actions, the dashboards and the employee limits,
          // then the invitation. Reaching it from the branch is the point — a co-owner is a
          // person who runs a branch, so this is the page where the decision is made.
          ...(branch.isMain || !isOwner
            ? []
            : [
                {
                  id: "transfer-ownership" as const,
                  icon: Crown,
                  title: t("coOwners.transferTitle"),
                  onClick: () => {
                    setMenuOpen(false);
                    navigate(`${base}/settings/hub/people/co-owners/new?branchId=${branch.id}`);
                  },
                },
              ]),
          {
            id: "share-location",
            icon: MapPin,
            title: t("branchPage.shareLocation"),
            onClick: () => { void shareLocation(); },
          },
        ]}
      />

      {/* The record's header: the mark, the name and its one tag, the place under them. */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: "1px solid var(--divider)" }}>
        <BranchIdentity branch={branch} imageUrl={logoUrl} />
      </div>

      <div className="px-4 pt-5">
        <BranchPerformance branch={branch} />
      </div>

      {/* Location and the marketplace decision — the branch's own configuration, in the order a
          reader checks it: where it is, then whether farmers can find it. */}
      <BranchEditor branch={branch} />

      {/* One section for everyone connected to this branch: who runs it day to day, who co-owns
          it, and the door to the roles themselves. Three titled blocks became one list. */}
      <div className="px-4 pt-6" data-testid={`branch-people-${branch.id}`}>
        <p className="ds-section-label mb-2">{t("branchPage.people")}</p>
        <ListCard>
          {/* One body runs a branch and it is the co-owner: there is no separate "responsible
              person" to hand the branch to, so the old assign/transfer/revoke rows and their
              dialogs are gone. Nobody assigned shows the action to assign; somebody assigned
              shows who, with their phone and status underneath, and tapping that row opens their
              own page. */}
          {branch.isMain ? (
            <ListRow title={t("branchFlow.mainOwnerOnly")} />
          ) : !isOwner ? null : coOwners.length > 0 ? (
            coOwners.map((person) => (
              <ListRow
                key={person.grantId}
                title={person.name}
                description={`${person.phone} · ${t(person.status === "active" ? "coOwners.statusActive" : person.status === "invited" ? "coOwners.statusInvited" : "coOwners.statusSuspended")}`}
                testId={`branch-co-owner-${person.grantId}`}
                onClick={() => navigate(`${base}/settings/hub/people/co-owners/${person.grantId}`)}
              />
            ))
          ) : (
            <ListRow
              icon={ShieldCheck}
              title={t("branchFlow.assignCoOwner")}
              testId={`branch-assign-co-owner-${branch.id}`}
              onClick={() => navigate(`${base}/settings/hub/people/co-owners/new?branchId=${branch.id}`)}
            />
          )}

          <ListRow
            testId={`branch-roles-${branch.id}`}
            title={t("branchPage.rolesAndPermissions")}
            value={employeeLine}
            onClick={() => void openRoles()}
          />
        </ListCard>
      </div>

      {!branch.isMain && (
        <div className="px-4 pt-5 pb-8">
          <button
            type="button"
            onClick={() => setDeleting(true)}
            data-testid={`branch-delete-action-${branch.id}`}
            className="h-10 flex items-center text-13 font-bold ds-pressable"
            style={{ color: "var(--error)" }}
          >
            {t("branchFlow.archive")}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        title={t("branchFlow.archiveTitle", { branch: branch.name })}
        message={t("branchFlow.archiveBody")}
        confirmLabel={t("branchFlow.archive")}
        destructive
        loading={busy}
        confirmDisabled={!reason.trim()}
        onConfirm={() => void archive()}
        onCancel={() => { if (!busy) setDeleting(false); }}
      >
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          label={t("branchFlow.reason")}
          maxLength={500}
          data-testid="branch-archive-reason"
        />
      </ConfirmDialog>
    </div>
  );
}
