import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import BranchEditor from "@/components/shop/BranchEditor";
import BranchIdentity from "@/components/shop/BranchIdentity";
import BranchPerformance from "@/components/shop/BranchPerformance";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Input from "@/components/ui/Input";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCoOwnersStore, type BranchCoOwner } from "@/stores/coOwnersStore";
import { loadBusinessProfile } from "@/lib/businessProfile";
import { supabase } from "@/lib/supabase";

/**
 * One branch, as a page.
 *
 * SHAPE (owner's reference, 2026-10-28): the branch's own identity with its employee total, its
 * period and money figures, its inventory health, then — in the order the owner manages them —
 * where it is, whether farmers can find it, who works here, who is responsible, and the way to
 * archive it. The operational and report rows that used to sit at the foot of this page are gone:
 * every one of those screens is already in the menu, and a branch page that listed them again
 * read as a second Settings rather than as this branch's own record.
 *
 * The header carries the business's own picture (owner's correction, 2026-10-30): a branch is a
 * place that business trades from, so the mark the owner uploaded on the business record is what
 * belongs there. No rename control sits beside the name — the name is the business's own — and no
 * "Current" word either; the screen is already the branch the account is standing in.
 *
 * Deleting lives at the bottom, where it has room to be the deliberate act it is; the main branch
 * has none, because the database refuses it and a control that exists only to be refused is a lie
 * about what is possible.
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
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /** The business's picture, so the header shows the real mark rather than a stand-in letter. */
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const submitting = useRef(false);
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");
  const { addToast } = useUIStore();
  const employees = useEmployeesStore((s) => s.employees);
  const loadEmployees = useEmployeesStore((s) => s.load);
  const assign = useShopStore((s) => s.assignBranchResponsibility);
  const transfer = useShopStore((s) => s.transferBranchResponsibility);
  const revoke = useShopStore((s) => s.revokeBranchResponsibility);
  const getBranchCoOwners = useCoOwnersStore((s) => s.getBranchCoOwners);
  const [responsible, setResponsible] = useState<{ user_id: string; name: string | null } | null>(null);
  const [coOwners, setCoOwners] = useState<BranchCoOwner[]>([]);
  const [handingOver, setHandingOver] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Same rule the database applies: active people who are not the business owner.
  const candidates = employees.filter((e) => e.isActive && !e.isOriginalOwner && e.id !== responsible?.user_id);

  // Read from the server rather than from a remembered value: who is responsible for a branch is
  // exactly the kind of fact that must not be stale on the screen that changes it.
  async function readResponsible() {
    if (!branchId) return;
    const { data } = await supabase.rpc("branch_responsible_person", { p_branch_id: branchId });
    const person = data as { user_id?: string; name?: string | null } | null;
    setResponsible(person?.user_id ? { user_id: person.user_id, name: person.name ?? null } : null);
  }

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

  async function handOver() {
    if (!branchId || !chosenId || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      // Transfer when someone already holds it, assign when nobody does. Two different RPCs
      // because they are two different acts, and the database refuses each in its own words.
      const result = responsible ? await transfer(branchId, chosenId) : await assign(branchId, chosenId);
      if (!result.ok) {
        addToast(t(result.code === "already_assigned" ? "branchFlow.alreadyAssigned" : "branchFlow.responsibilityFailed"), "error");
        return;
      }
      addToast(t("branchFlow.transferred", { name: employees.find((e) => e.id === chosenId)?.name ?? "" }), "success");
      setHandingOver(false);
      setChosenId(null);
      await readResponsible();
    } finally { submitting.current = false; setBusy(false); }
  }

  async function takeBack() {
    if (!branchId || !revokeReason.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await revoke(branchId, revokeReason);
      if (!result.ok) { addToast(t("branchFlow.responsibilityFailed"), "error"); return; }
      addToast(t("branchFlow.revoked"), "success");
      setRevoking(false);
      setRevokeReason("");
      await readResponsible();
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
        setLogoUrl(profile?.shop?.logo_url ?? profile?.documents?.logo ?? null);
      })
      .catch(() => { if (live) setLogoUrl(null); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    void readResponsible();
    void readCoOwners();
    if (isOwner) void loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readResponsible closes over branchId only
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

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("branchPage.title")} backTo={`${base}/settings/hub/branches`} />

      {/* The record's header, in the business screen's block: the tile, the name and its one tag,
          the place under them, and the line the section below begins from. */}
      <div
        className="px-5 pt-6 pb-5"
        style={{ borderBottom: "1px solid var(--divider)" }}
      >
        <BranchIdentity branch={branch} imageUrl={logoUrl} />
      </div>

      <div className="px-4 pt-4">
        <BranchPerformance branch={branch} />
      </div>

      {/* Location, the marketplace decision and the roles: the branch's own configuration, in the
          order the reference lays it out. The form no longer edits the name — that is the pencil
          above — so this block starts where configuration starts. */}
      <BranchEditor branch={branch} />

      <div className="px-4 pt-6">
        <p className="ds-section-label px-1 mb-2">{t("branchFlow.responsiblePerson")}</p>
        <ListCard>
          <ListRow testId={`branch-responsible-${branch.id}`}>
            <p className="text-13" style={{ color: "var(--text-primary)" }}>
              {responsible?.name ?? t("branchFlow.nobodyResponsible")}
            </p>
          </ListRow>
          <ListRow
            title={t("branchFlow.transfer")}
            testId={`branch-handover-${branch.id}`}
            disabled={busy}
            onClick={() => { setChosenId(null); setHandingOver(true); }}
          />
          {responsible && (
            <ListRow
              title={t("branchFlow.revoke")}
              testId={`branch-revoke-${branch.id}`}
              disabled={busy}
              onClick={() => setRevoking(true)}
            />
          )}
        </ListCard>
      </div>

      {isOwner && (
        <div className="px-4 pt-5" data-testid={`branch-co-owner-card-${branch.id}`}>
          <p className="ds-section-label px-1 mb-2">{t("branchFlow.coOwner")}</p>
          <ListCard>
            {branch.isMain ? (
              <ListRow
                title={t("branchFlow.mainOwnerOnly")}
                meta={t("branchFlow.mainOwnerOnlyHint")}
              />
            ) : (
              <>
                {coOwners.length > 0 ? (
                  coOwners.map((person) => (
                    <ListRow
                      key={person.grantId}
                      title={person.name}
                      meta={`${person.phone} · ${t(person.status === "active" ? "coOwners.statusActive" : person.status === "invited" ? "coOwners.statusInvited" : "coOwners.statusSuspended")}`}
                      testId={`branch-co-owner-${person.grantId}`}
                      onClick={() => navigate(`${base}/settings/hub/people/co-owners/${person.grantId}`)}
                    />
                  ))
                ) : (
                  <ListRow
                    title={t("branchFlow.noCoOwner")}
                    meta={t("branchFlow.noCoOwnerHint")}
                  />
                )}
                <ListRow
                  icon={ShieldCheck}
                  title={t("branchFlow.assignCoOwner")}
                  meta={t("branchFlow.coOwnerOnlyBranch")}
                  testId={`branch-assign-co-owner-${branch.id}`}
                  onClick={() => navigate(`${base}/settings/hub/people/co-owners/new?branchId=${branch.id}`)}
                />
              </>
            )}
          </ListCard>
        </div>
      )}

      {!branch.isMain && isOwner && (
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

      {/* Rendered only while open, deliberately. ConfirmDialog keeps itself mounted through its
          exit animation, so two always-rendered dialogs on one page put two `confirm-submit`
          buttons in the document at once — ambiguous for a test and two overlapping dialogs for
          a screen reader. Gating on the flag means a closed dialog is not in the DOM at all. */}
      {handingOver && <ConfirmDialog open title={t("branchFlow.responsiblePerson")}
        message={t("branchFlow.ownershipBody")} confirmLabel={t("branchFlow.transfer")}
        loading={busy} confirmDisabled={!chosenId} onConfirm={() => void handOver()}
        onCancel={() => { if (!busy) { setHandingOver(false); setChosenId(null); } }}>
        {candidates.length > 0
          ? <ListCard>{candidates.map((person) => <ListRow key={person.id} title={person.name}
              testId={`handover-person-${person.id}`} selected={chosenId === person.id}
              onClick={() => setChosenId(person.id)} />)}</ListCard>
          : <p className="ds-meta">{t("branchFlow.noAssignablePeople")}</p>}
      </ConfirmDialog>}

      {revoking && <ConfirmDialog open title={t("branchFlow.revokeTitle", { branch: branch.name })}
        message={t("branchFlow.revokeBody")} confirmLabel={t("branchFlow.revoke")}
        destructive loading={busy} confirmDisabled={!revokeReason.trim()} onConfirm={() => void takeBack()}
        onCancel={() => { if (!busy) setRevoking(false); }}>
        <Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} label={t("branchFlow.reason")} maxLength={500} />
      </ConfirmDialog>}
    </div>
  );
}
