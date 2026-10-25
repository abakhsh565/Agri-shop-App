import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import SetupChecklist from "@/components/ui/SetupChecklist";
import LocationField from "@/components/ui/LocationField";
import { useT } from "@/lib/i18n";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useUIStore } from "@/stores/uiStore";

// One existing selector, one branch identity. A branch does not provision another
// business, copy roles, or require stock/staff before it can be entered.
export default function ShopSwitcherSheet() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useUIStore();
  const { switcherOpen: open, closeSwitcher: close, openSwitcher, branches, activeBranchId,
    activeBranchName, branchesLoading: loading, branchesError, load, switching, creating,
    switchBranch, create, assignBranchResponsibility, switcherIntent, setupDraft, setSetupDraft } = useShopStore();
  const canCreate = useAuthStore((s) => s.user?.membershipRole === "owner");
  const employees = useEmployeesStore((s) => s.employees);
  const loadEmployees = useEmployeesStore((s) => s.load);
  const [step, setStep] = useState<"list" | 1 | 2 | 3>("list");
  // Who runs the new branch. Held here, not in the draft: this step never leaves the sheet, so
  // there is no unmount to survive — and clearing it after a creation cannot leak into the next.
  const [ownership, setOwnership] = useState<"keep" | "assign">("keep");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  // The candidates are exactly who the database will accept: active people who are not the
  // business owner. Offering anyone else would be a control that exists only to be refused.
  const assignable = employees.filter((e) => e.isActive && !e.isOriginalOwner);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const submitting = useRef(false);
  const busy = switching || creating;
  const flowStep = new URLSearchParams(location.search).get("setupFlow");

  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => { if (step === 2) void loadEmployees(); }, [step, loadEmployees]);
  useEffect(() => {
    if (!open || switcherIntent !== "create") return;
    setStep(1);
    useShopStore.setState({ switcherIntent: "list" });
  }, [open, switcherIntent]);
  useEffect(() => {
    if (flowStep !== "1" && flowStep !== "3") return;
    openSwitcher();
    setStep(flowStep === "1" ? 1 : 3);
  }, [flowStep, openSwitcher]);

  function returnPath(target: 1 | 3) {
    const params = new URLSearchParams(location.search);
    params.set("setupFlow", String(target));
    return `${location.pathname}?${params.toString()}`;
  }
  function removeMarker() {
    const params = new URLSearchParams(location.search);
    params.delete("setupFlow");
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }
  function finish() {
    if (busy || submitting.current) return;
    close();
    setStep("list");
    setOwnership("keep");
    setAssigneeId(null);
    setSetupDraft({ name: "", place: null, requestId: null });
    removeMarker();
  }
  async function select(branch: BranchSummary) {
    if (busy || submitting.current || branch.id === activeBranchId) return;
    submitting.current = true;
    setPendingId(branch.id);
    try {
      const result = await switchBranch(branch.id);
      if (!result.ok) {
        addToast(t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"), "error");
        return;
      }
      close();
      addToast(t("shop.switched", { shop: branch.name }), "success");
    } finally { submitting.current = false; setPendingId(null); }
  }
  async function createBranch() {
    if (busy || submitting.current) return;
    if (!setupDraft.place) { addToast(t("branchFlow.locationRequired"), "error"); return; }
    submitting.current = true;
    // Stable across a retry and the location-page round trip. Never issue a new
    // branch identity merely because a response or the following switch failed.
    const requestId = setupDraft.requestId ?? crypto.randomUUID();
    setSetupDraft({ requestId });
    try {
      const result = await create(setupDraft.name, setupDraft.place, requestId);
      if (!result.ok) {
        const key = result.code === "denied" ? "shop.ownerOnly" : result.code === "name_taken" ? "branches.nameTaken"
          : result.code === "pending_sync" ? "shop.pendingSync" : "shop.createFailed";
        addToast(t(key), "error");
        return;
      }
      // The handover happens after the branch exists, and a failure here is reported without
      // undoing the branch: the branch is real, and the owner can assign it from its page. Losing
      // the branch because the second call failed would be the worse answer.
      const newBranchId = useShopStore.getState().activeBranchId;
      if (ownership === "assign" && assigneeId && newBranchId) {
        const assigned = await assignBranchResponsibility(newBranchId, assigneeId);
        if (!assigned.ok) addToast(t("branchFlow.assignFailed"), "error");
      }
      setStep(3);
      setOwnership("keep");
      setAssigneeId(null);
      setSetupDraft({ name: "", place: null, requestId: null });
    } finally { submitting.current = false; }
  }

  return (
    <Sheet open={open} title={t("branches.title")} onClose={finish} closeButton={false}>
      <div className="px-4 pt-1 pb-3">
        {step === "list" && <>
          {loading && branches.length === 0 && <div className="flex justify-center py-8" role="status" aria-busy="true"><Loader2 size={20} className="animate-spin" /></div>}
          {!loading && branchesError && <div className="py-4"><p className="ds-meta">{t("branches.loadFailed")}</p><Button onClick={() => void load()}>{t("common.tryAgain")}</Button></div>}
          {!loading && !branchesError && branches.length === 0 && <p className="ds-meta py-6 text-center">{t("shop.noneMember")}</p>}
          {branches.length > 0 && <ListCard>{branches.map((branch) => <ListRow key={branch.id}
            title={branch.name} meta={branch.roleName ?? undefined}
            testId={`shop-option-${branch.id}`} selected={branch.id === activeBranchId}
            disabled={busy || branch.membershipStatus !== "active"} onClick={() => void select(branch)}
            trailing={pendingId === branch.id ? <Loader2 size={18} className="animate-spin" /> : branch.id === activeBranchId ? <Check size={18} /> : undefined}
          />)}</ListCard>}
          {canCreate && <Button className="mt-3" variant="outline" fullWidth testId="shop-setup-start" disabled={busy}
            onClick={() => { setSetupDraft({ name: "", place: null, requestId: null }); setStep(1); }}>{t("branches.create")}</Button>}
        </>}
        {step === 1 && <div data-testid="setup-step-1">
          <p className="ds-meta">{t("branchFlow.createHint")}</p>
          <div className="ds-field mt-3"><input value={setupDraft.name} maxLength={120} disabled={busy}
            onChange={(e) => setSetupDraft({ name: e.target.value, requestId: null })}
            placeholder={t("shop.namePlaceholder")} aria-label={t("branches.nameLabel")}
            data-testid="shop-name-input" className="h-full flex-1 bg-transparent outline-none ds-body text-start" /></div>
          <div className="mt-4"><LocationField pagePicker returnTo={returnPath(1)} value={setupDraft.place}
            onChange={(place) => setSetupDraft({ place, requestId: null })} label={t("branches.locationLabel")} testId="new-branch-location" /></div>
          <Button fullWidth className="mt-3" testId="setup-continue" disabled={!setupDraft.name.trim() || !setupDraft.place || busy}
            onClick={() => setStep(2)}>{t("branchFlow.next")}</Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={() => { setStep("list"); removeMarker(); }}>{t("common.back")}</Button>
        </div>}
        {step === 2 && <div data-testid="setup-step-2">
          <p className="ds-body font-semibold">{t("branchFlow.ownershipHint")}</p>
          <p className="ds-meta mt-2">{t("branchFlow.ownershipBody")}</p>
          <div className="mt-3"><ListCard>
            <ListRow title={t("branchFlow.keepOwnership")} testId="ownership-keep"
              selected={ownership === "keep"} disabled={busy}
              onClick={() => { setOwnership("keep"); setAssigneeId(null); }} />
            <ListRow title={t("branchFlow.assignPerson")} testId="ownership-assign"
              selected={ownership === "assign"} disabled={busy || assignable.length === 0}
              onClick={() => setOwnership("assign")} />
          </ListCard></div>
          {ownership === "assign" && (assignable.length > 0
            ? <div className="mt-3"><ListCard>{assignable.map((person) => <ListRow key={person.id}
                title={person.name} testId={`assign-person-${person.id}`} selected={assigneeId === person.id}
                disabled={busy} onClick={() => setAssigneeId(person.id)} />)}</ListCard></div>
            : <p className="ds-meta mt-3">{t("branchFlow.noAssignablePeople")}</p>)}
          <Button fullWidth className="mt-3" testId="setup-create-shop" loading={creating || switching}
            disabled={!setupDraft.name.trim() || !setupDraft.place || busy || (ownership === "assign" && !assigneeId)}
            onClick={() => void createBranch()}>{t("branches.create")}</Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={() => setStep(1)}>{t("common.back")}</Button>
        </div>}
        {step === 3 && <div data-testid="setup-step-3">
          <p className="ds-body font-semibold">{t("shop.createdTitle", { shop: activeBranchName ?? "" })}</p>
          <p className="ds-meta mt-2">{t("branchFlow.setupHint")}</p>
          <div className="mt-3"><SetupChecklist testId="setup-flow-checklist" returnTo={returnPath(3)}
            onAction={(to) => { close(); navigate(to); }} /></div>
          <Button fullWidth className="mt-3" testId="setup-finish" onClick={finish}>{t("branchFlow.enter")}</Button>
        </div>}
      </div>
    </Sheet>
  );
}
