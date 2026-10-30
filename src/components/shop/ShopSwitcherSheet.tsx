import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Loader2, Plus, Store } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import BranchKindChip from "@/components/ui/BranchKindChip";
import SetupChecklist from "@/components/ui/SetupChecklist";
import LocationField from "@/components/ui/LocationField";
import { useT } from "@/lib/i18n";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";
import { branchKind } from "@/lib/branchKind";
import { loadBusinessProfile } from "@/lib/businessProfile";

/**
 * The branch switcher, in the shape of an account switcher.
 *
 * SHAPE (owner's reference, 2026-10-30). One card of tall rows: the business's own picture, the
 * branch's name with its Main/Sub tag, a second line that says what is waiting there, and a filled
 * tick on the branch the account is standing in. Creating a branch is the last row of that same
 * card with a plus mark — it belongs to the set of branches, not under it as a separate button.
 *
 * WHAT THE SECOND LINE SAYS. When the branch has unread events, the line is the count and a red
 * dot, which is the one fact that makes switching worth doing right now. With nothing waiting, it
 * falls back to the role the account holds in that branch, which used to be the only line here.
 * The count is the notification feed's own per-branch read (`unreadInBranch`'s rule, applied to
 * the rows already loaded), so the sheet can never invent a number the bell does not agree with.
 *
 * One existing selector, one branch identity. A branch does not provision another business, copy
 * roles, or require stock/staff before it can be entered.
 */
export default function ShopSwitcherSheet() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useUIStore();
  const { switcherOpen: open, closeSwitcher: close, openSwitcher, branches, activeBranchId,
    activeBranchName, activeShopName, branchesLoading: loading, branchesError, load, switching, creating,
    switchBranch, create, assignBranchResponsibility, switcherIntent, setupDraft, setSetupDraft } = useShopStore();
  const membershipRole = useAuthStore((s) => s.user?.membershipRole);
  const canCreate = membershipRole === "owner";
  const employees = useEmployeesStore((s) => s.employees);
  const loadEmployees = useEmployeesStore((s) => s.load);
  // The business's own picture, the same one the branch's header draws. Read only by an account
  // the business record answers (owner/admin); anyone else keeps the branch's initial.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // Unread events per branch: the notifications feed is already stamped with the branch each row
  // happened in (0197), so the count is a filtered length, not a second query.
  const notifications = useNotificationStore((s) => s.items);
  const notificationsReady = useNotificationStore((s) => s.ready);
  const loadNotifications = useNotificationStore((s) => s.load);
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
  useEffect(() => {
    if (!open || notificationsReady) return;
    void loadNotifications();
  }, [open, notificationsReady, loadNotifications]);
  useEffect(() => {
    if (!open) return;
    if (membershipRole !== "owner" && membershipRole !== "admin") return;
    let live = true;
    void loadBusinessProfile()
      .then((profile) => {
        if (live) setLogoUrl(profile?.shop?.logo_url ?? profile?.documents?.logo ?? null);
      })
      .catch(() => { if (live) setLogoUrl(null); });
    return () => { live = false; };
  }, [open, membershipRole]);

  const unreadByBranch = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of notifications) {
      if (row.read || !row.branch_id) continue;
      counts.set(row.branch_id, (counts.get(row.branch_id) ?? 0) + 1);
    }
    return counts;
  }, [notifications]);
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
          {(branches.length > 0 || canCreate) && <ListCard>
            {branches.map((branch) => {
              const kind = branchKind(t, branch.isMain);
              // The main branch IS the business — it is the one the owner signed up into, and its
              // row is the business's name rather than a branch label. An added branch keeps the
              // name the owner gave it, because that is the only thing that tells two of them apart.
              const label = branch.isMain ? activeShopName ?? branch.name : branch.name;
              const unread = unreadByBranch.get(branch.id) ?? 0;
              return (
                <ListRow
                  key={branch.id}
                  testId={`shop-option-${branch.id}`}
                  selected={branch.id === activeBranchId}
                  disabled={busy || branch.membershipStatus !== "active"}
                  onClick={() => void select(branch)}
                  // The business's own picture says "this is the business's branch"; an added
                  // branch has no picture of its own, so it carries the branch glyph instead of
                  // borrowing the business's face and looking like a second main branch.
                  tile={branch.isMain && logoUrl ? (
                    <img src={logoUrl} alt="" className="size-11 rounded-full object-cover shrink-0" />
                  ) : (
                    <span
                      className="size-11 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: branch.isCurrent ? "var(--brand)" : "var(--tone-sunken)",
                        color: branch.isCurrent ? "var(--ink-fg)" : "var(--text-secondary)",
                      }}
                      aria-hidden="true"
                    >
                      <Store size={18} />
                    </span>
                  )}
                  trailing={pendingId === branch.id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : branch.id === activeBranchId ? (
                    <span
                      className="size-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--brand)" }}
                      data-testid={`shop-current-${branch.id}`}
                    >
                      <Check size={14} strokeWidth={3} style={{ color: "var(--ink-fg)" }} />
                    </span>
                  ) : undefined}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-15 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {label}
                    </span>
                    {kind && <BranchKindChip isMain={branch.isMain} label={kind} />}
                  </div>
                  {/* What is waiting in this branch, or who this account is there. The dot and
                      the count are the feed's own unread rows — nothing here is estimated. */}
                  {(unread > 0 || branch.roleName) && (
                    <p className="flex items-center gap-1.5 mt-1 text-12" style={{ color: "var(--text-tertiary)" }}>
                      {unread > 0 && (
                        <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--error)" }} />
                      )}
                      {unread > 0
                        ? t(unread === 1 ? "shop.alertOne" : "shop.alertOther", { count: String(unread) })
                        : branch.roleName}
                    </p>
                  )}
                </ListRow>
              );
            })}

            {/* The way in, as the card's last row: a new branch belongs to the set above it. */}
            {canCreate && (
              <ListRow
                testId="shop-setup-start"
                disabled={busy}
                onClick={() => { setSetupDraft({ name: "", place: null, requestId: null }); setStep(1); }}
                tile={
                  <span
                    className="size-11 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                    aria-hidden="true"
                  >
                    <Plus size={20} />
                  </span>
                }
                title={t("branches.create")}
              />
            )}
          </ListCard>}
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
