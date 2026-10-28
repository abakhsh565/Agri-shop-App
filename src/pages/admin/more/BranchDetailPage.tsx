import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
 * Renaming is the one act the reference does not draw, and it is kept as a pencil beside the
 * name: dropping it would strand the only rename in the app. It asks before it writes, because
 * the name is this branch's identity on every other screen.
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
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const submitting = useRef(false);
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");
  const { addToast } = useUIStore();
  const employees = useEmployeesStore((s) => s.employees);
  const loadEmployees = useEmployeesStore((s) => s.load);
  const assign = useShopStore((s) => s.assignBranchResponsibility);
  const transfer = useShopStore((s) => s.transferBranchResponsibility);
  const revoke = useShopStore((s) => s.revokeBranchResponsibility);
  const [responsible, setResponsible] = useState<{ user_id: string; name: string | null } | null>(null);
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

  async function rename() {
    if (!branch || !draftName.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await useShopStore.getState().renameBranch(branch.id, draftName);
      if (!result.ok) {
        addToast(
          t(result.code === "name_taken" ? "branches.nameTaken" : "branches.saveFailed"),
          "error",
        );
        return;
      }
      addToast(t("branches.saved", { branch: draftName.trim() }), "success");
      setRenaming(false);
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

  useEffect(() => {
    void readResponsible();
    if (isOwner) void loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readResponsible closes over branchId only
  }, [branchId, isOwner, loadEmployees]);

  const branch = branches.find((b) => b.id === branchId);

  // Once the list is read and the branch is not in it, this URL names nothing the account can
  // open; going back is the honest answer, and this avoids flashing a stale "not found" claim.
  useEffect(() => {
    if (branchesLoaded && !branch) navigate(`${base}/settings/hub/branches`, { replace: true });
  }, [branchesLoaded, branch, base, navigate]);

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

      <div className="px-4 pt-4">
        <BranchIdentity
          branch={branch}
          onRename={isOwner ? () => { setDraftName(branch.name); setRenaming(true); } : undefined}
        />
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

      {renaming && (
        <ConfirmDialog
          open
          title={t("branches.rename")}
          message={t("branches.renameBody")}
          confirmLabel={t("branches.save")}
          loading={busy}
          confirmDisabled={!draftName.trim() || draftName.trim() === branch.name}
          onConfirm={() => void rename()}
          onCancel={() => { if (!busy) setRenaming(false); }}
        >
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            label={t("branches.nameLabel")}
            maxLength={120}
            autoFocus
            data-testid="branch-rename-input"
          />
        </ConfirmDialog>
      )}

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
