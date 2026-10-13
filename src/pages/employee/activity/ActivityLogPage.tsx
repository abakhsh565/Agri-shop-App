import { useEffect, useRef, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { useShopStore } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { captureDataContext, isDataContextCurrent } from "@/lib/localCache";
import { formatDateTime } from "@/lib/formatters";
import { History } from "lucide-react";

interface AuditEvent {
  id: string; action: string; entity_type: string; entity_id: string;
  actor_id: string; actor_name: string | null; actor_role: string | null;
  branch_id: string; branch_name: string | null; details: Record<string, unknown>; created_at: string;
}
const ACTION_KEYS: Record<string, string> = {
  sale_created: "audit.saleCreated", sale_voided: "audit.saleVoided", return_processed: "audit.returnProcessed",
  purchase_recorded: "audit.purchaseRecorded", customer_payment_recorded: "audit.paymentRecorded",
  supplier_payment_recorded: "audit.paymentRecorded", customer_payments_insert: "audit.paymentRecorded",
  supplier_payments_insert: "audit.paymentRecorded", stock_adjusted: "audit.stockAdjusted",
  stock_adjustments_insert: "audit.stockAdjusted", employee_branch_add: "audit.employeeAdded",
  employee_branch_move: "audit.employeeMoved", employee_access_updated: "audit.accessUpdated",
  employee_created: "audit.employeeCreated", branch_selected: "audit.branchSelected",
  branch_created: "audit.branchCreated", branch_renamed: "audit.branchRenamed", branch_archived: "audit.branchArchived",
  membership_access_changed: "audit.accessUpdated",
  role_created: "audit.roleUpdated", role_updated: "audit.roleUpdated", role_deleted: "audit.roleUpdated",
  location_updated: "audit.locationUpdated",
};

export default function ActivityLogPage() {
  const t = useT();
  const branchId = useShopStore((s) => s.activeBranchId);
  const branchName = useShopStore((s) => s.activeBranchName);
  const switching = useShopStore((s) => s.switching);
  const userId = useAuthStore((s) => s.user?.id);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setEvents([]); setMore(false); setFailed(false);
    if (!branchId || switching) return;
    const context = captureDataContext();
    setLoading(true);
    Promise.resolve(supabase.rpc("get_branch_activity", { p_limit: 50 })).then(({ data, error }) => {
      if (cancelled || !isDataContextCurrent(context)) return;
      if (error) { setFailed(true); return; }
      const rows = (data ?? []) as AuditEvent[];
      setEvents(rows); setMore(rows.length === 50);
    }).catch(() => { if (!cancelled && isDataContextCurrent(context)) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, switching, userId, retry]);

  async function loadMore() {
    if (busy.current || loading || !events.length) return;
    busy.current = true; setLoading(true); setFailed(false);
    const context = captureDataContext();
    const last = events[events.length - 1];
    try {
      const { data, error } = await supabase.rpc("get_branch_activity", { p_before: last.created_at, p_before_id: last.id, p_limit: 50 });
      if (!isDataContextCurrent(context)) return;
      if (error) { setFailed(true); return; }
      const rows = (data ?? []) as AuditEvent[];
      setEvents((previous) => [...previous, ...rows.filter((row) => !previous.some((item) => item.id === row.id))]);
      setMore(rows.length === 50);
    } catch { if (isDataContextCurrent(context)) setFailed(true); }
    finally { busy.current = false; if (isDataContextCurrent(context)) setLoading(false); }
  }

  const ready = !loading || events.length > 0;
  return <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
    <StatusBar /><NavHeader title={t("activity.activityLog")} />
    <div className="px-4 pt-3 pb-6">
      <p className="ds-meta mb-3" data-testid="activity-branch-context">{branchName ?? t("audit.noBranch")}</p>
      {!ready && <SkeletonList rows={4} />}
      {failed && <div className="mb-3" role="alert"><p className="ds-meta">{t("audit.loadFailed")}</p>
        <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>{t("common.tryAgain")}</Button></div>}
      {!loading && !failed && events.length === 0 && <EmptyState icon={History} title={t("admin.noActivityYet")} />}
      {events.length > 0 && <ListCard>{events.map((event) => <ListRow key={event.id} testId={`audit-event-${event.id}`}
        title={t(ACTION_KEYS[event.action] ?? "audit.otherAction")}
        meta={`${event.actor_name ?? t("audit.unknownActor")} · ${event.actor_role ?? t("audit.unknownRole")} · ${event.branch_name ?? t("audit.unknownBranch")}`}
      ><p className="text-13 font-semibold">{t(ACTION_KEYS[event.action] ?? "audit.otherAction")}</p>
        <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{event.actor_name ?? t("audit.unknownActor")} · {event.actor_role ?? t("audit.unknownRole")} · {event.branch_name ?? t("audit.unknownBranch")}</p>
        <p className="text-11" style={{ color: "var(--text-secondary)" }}>{formatDateTime(event.created_at)}</p>
        {typeof event.details.reason === "string" && <p className="text-12 mt-1">{t("audit.reason", { reason: event.details.reason })}</p>}
        <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("audit.succeeded")}</p>
      </ListRow>)}</ListCard>}
      {more && <Button fullWidth className="mt-3" loading={loading} onClick={() => void loadMore()}>{t("audit.loadMore")}</Button>}
    </div>
  </div>;
}
