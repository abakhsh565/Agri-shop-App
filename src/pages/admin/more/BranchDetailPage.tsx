import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BarChart3, Boxes, ChevronRight, History, Loader2, Package, ShoppingCart, TrendingUp, Truck, Users,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import BranchEditor from "@/components/shop/BranchEditor";
import BranchIdentity from "@/components/shop/BranchIdentity";
import BranchPerformance from "@/components/shop/BranchPerformance";
import { hasPermission } from "@/lib/tenantContext";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Input from "@/components/ui/Input";
import { useRef } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { supabase } from "@/lib/supabase";

/**
 * One branch, as a page.
 *
 * The Branches list used to open a bottom sheet with the branch's whole form inside it. The
 * form outgrew the sheet — a name, a map, the marketplace switch and the branch's roles all in
 * one panel — so the same form (BranchEditor, one implementation) now fills a page, and the
 * list row is the way in. The list itself lives on Settings, which is why back goes there.
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
  const workingBranchName = useShopStore((s) => s.activeBranchName);

  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
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

  /**
   * The doors this page offers, grouped the way the work is grouped.
   *
   * A row appears only when the account holds the permission its destination requires, so the
   * page cannot offer a screen the route guard refuses — and it does not re-implement any of
   * them: each is a pointer at the one implementation, exactly as the Settings menu's rows are.
   * The section names are the menu's own names, because they are the same places.
   */
  const operationalRows = [
    { id: "products", icon: Package, label: t("settings.menu.inventory"), to: "/products", permission: "products.view" },
    { id: "sales", icon: ShoppingCart, label: t("settings.menu.sales"), to: "/sales", permission: "sales.view" },
    { id: "customers", icon: Users, label: t("settings.menu.customers"), to: "/customers", permission: "customers.view" },
    { id: "purchases", icon: Truck, label: t("settings.menu.purchases"), to: "/purchases", permission: "purchases.view" },
  ].filter((row) => hasPermission(row.permission));

  /**
   * The reports, each naming what it holds rather than only what it is called.
   *
   * These are the screens the figures on this page are READ in full; the summary above is
   * deliberately not a report, and this is where it says so by pointing instead of duplicating.
   */
  const reportRows = [
    { id: "sales", icon: BarChart3, label: t("branchPage.salesReport"), meta: t("branchPage.salesReportHint"), to: "/reports", permission: "reports.view" },
    { id: "profit", icon: TrendingUp, label: t("branchPage.profitReport"), meta: t("branchPage.profitReportHint"), to: "/reports", permission: "reports.view" },
    { id: "customer-balances", icon: Users, label: t("branchPage.customerBalances"), meta: t("branchPage.customerBalancesHint"), to: "/customers", permission: "customers.view" },
    { id: "supplier-balances", icon: Truck, label: t("branchPage.supplierBalances"), meta: t("branchPage.supplierBalancesHint"), to: "/companies", permission: "companies.view" },
    { id: "inventory", icon: Boxes, label: t("branchPage.inventoryReport"), meta: t("branchPage.inventoryReportHint"), to: "/reports", permission: "reports.view" },
    { id: "activity", icon: History, label: t("branchPage.activityHistory"), meta: t("branchPage.activityHistoryHint"), to: "/activity", permission: "activity.view" },
  ].filter((row) => hasPermission(row.permission));

  // Once the list is read and the branch is not in it, this URL names nothing the account can
  // open; going back is the honest answer, and this avoids flashing a stale "not found" claim.
  // Back goes to the branch list — the screen whose cards open this page.
  useEffect(() => {
    if (branchesLoaded && !branch) navigate(`${base}/settings/branches`, { replace: true });
  }, [branchesLoaded, branch, base, navigate]);

  if (!branch) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("branches.editTitle")} backTo={`${base}/settings/branches`} />
        <div className="flex items-center justify-center py-10" role="status" aria-busy="true">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={branch.name} backTo={`${base}/settings/branches`} />

      {/* ── Which branch, then what it is doing ────────────────────────────────────────────────
          The page opens with the branch itself: its icon and name, the kind of branch it is, where
          it is and whether it is open. Directly under that, its own figures — so a reader who
          came to check on a branch has both answers before the configuration form begins. */}
      <div className="px-4 pt-4">
        <BranchIdentity branch={branch} />
      </div>
      <div className="px-4 pt-4">
        <BranchPerformance branch={branch} />
      </div>

      <p className="ds-section px-5 mt-6 mb-1">{t("branchPage.configuration")}</p>

      {/* The configuration itself: everything that was answered when this branch was created, and
          every change writes the moment it is made. Saving keeps the page open — the name it just
          saved is the page's title, and everything else it wrote is visible in place. */}
      <BranchEditor branch={branch} onClose={() => undefined} onRenamed={() => undefined} />

      {isOwner && (
        <div className="px-4 pb-4">
          <p className="ds-meta">{t("branchFlow.responsiblePerson")}</p>
          <div className="mt-2"><ListCard>
            <ListRow title={responsible?.name ?? t("branchFlow.nobodyResponsible")}
              testId={`branch-responsible-${branch.id}`} />
            <ListRow title={t("branchFlow.transfer")} testId={`branch-handover-${branch.id}`}
              disabled={busy} onClick={() => { setChosenId(null); setHandingOver(true); }} />
            {responsible && (
              <ListRow title={t("branchFlow.revoke")} testId={`branch-revoke-${branch.id}`}
                disabled={busy} onClick={() => setRevoking(true)} />
            )}
          </ListCard></div>
        </div>
      )}

      {/* ── The doors ───────────────────────────────────────────────────────────────────────────
          Everything that is a whole screen now lives one tap away, grouped the way the work is
          grouped: the operational areas first, then the reports. Each row is drawn only when the
          account holds the permission that screen requires, so this page never offers a door the
          route guard would refuse — the same rule the Settings menu follows. */}
      {operationalRows.length > 0 && (
        <div className="px-4 pt-5">
          <ListCard section={t("branchPage.operationalAreas")}>
            {operationalRows.map((row) => (
              <ListRow
                key={row.id}
                icon={row.icon}
                title={row.label}
                testId={`branch-area-${row.id}-${branch.id}`}
                onClick={() => navigate(`${base}${row.to}`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
            ))}
          </ListCard>
          {/* Said only when it is true and would otherwise surprise: these screens follow the branch
              the account is WORKING in, and this page is about a different one. */}
          {!branch.isCurrent && (
            <p className="text-11 mt-2 px-1" style={{ color: "var(--text-tertiary)" }}>
              {t("branchPage.followsBranch", { branch: workingBranchName ?? "" })}
            </p>
          )}
        </div>
      )}

      {reportRows.length > 0 && (
        <div className="px-4 pt-4">
          <ListCard section={t("settings.menu.reports")}>
            {reportRows.map((row) => (
              <ListRow
                key={row.id}
                icon={row.icon}
                title={row.label}
                meta={row.meta}
                testId={`branch-report-${row.id}-${branch.id}`}
                onClick={() => navigate(`${base}${row.to}`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
            ))}
          </ListCard>
        </div>
      )}

      {!branch.isMain && isOwner && (
        <div className="px-4 pt-4 pb-8">
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

      <ConfirmDialog open={deleting} title={t("branchFlow.archiveTitle", { branch: branch.name })}
        message={t("branchFlow.archiveBody")} confirmLabel={t("branchFlow.archive")}
        destructive loading={busy} confirmDisabled={!reason.trim()} onConfirm={() => void archive()}
        onCancel={() => { if (!busy) setDeleting(false); }}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} label={t("branchFlow.reason")} maxLength={500}
          data-testid="branch-archive-reason" />
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
