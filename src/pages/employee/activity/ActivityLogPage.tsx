import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useReturnTo } from "@/lib/useReturnTo";
import { AUDIT_ACTION_KEYS } from "@/lib/auditActions";
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
// The labels are shared with the per-employee history (`lib/auditActions`) so the same action
// cannot be named two different ways on two activity screens.

export default function ActivityLogPage() {
  const t = useT();
  const [params] = useSearchParams();
  const transactionsOnly = params.get("view") === "transactions";
  // No fixed parent: the audit trail is a tab destination, so with no caller-supplied return
  // path it keeps the journey-stack behaviour it always had.
  const returnTo = useReturnTo();
  const branchId = useShopStore((s) => s.activeBranchId);
  const branchName = useShopStore((s) => s.activeBranchName);
  const branches = useShopStore((s) => s.branches);
  const switching = useShopStore((s) => s.switching);
  const userId = useAuthStore((s) => s.user?.id);
  const owner = useAuthStore((s) => s.user?.membershipRole === "owner");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [branchFilter, setBranchFilter] = useState<string | "all">("all");
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
    const selectedBranch = owner && branchFilter !== "all" ? branchFilter : null;
    Promise.resolve(supabase.rpc("get_activity_feed", {
      p_branch_id: selectedBranch,
      p_limit: 50,
    })).then(({ data, error }) => {
      if (cancelled || !isDataContextCurrent(context)) return;
      if (error) { setFailed(true); return; }
      const rows = (data ?? []) as AuditEvent[];
      setEvents(rows); setMore(rows.length === 50);
    }).catch(() => { if (!cancelled && isDataContextCurrent(context)) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, switching, userId, retry, owner, branchFilter]);

  async function loadMore() {
    if (busy.current || loading || !events.length) return;
    busy.current = true; setLoading(true); setFailed(false);
    const context = captureDataContext();
    const last = events[events.length - 1];
    try {
      const selectedBranch = owner && branchFilter !== "all" ? branchFilter : null;
      const { data, error } = await supabase.rpc("get_activity_feed", {
        p_branch_id: selectedBranch,
        p_before: last.created_at,
        p_before_id: last.id,
        p_limit: 50,
      });
      if (!isDataContextCurrent(context)) return;
      if (error) { setFailed(true); return; }
      const rows = (data ?? []) as AuditEvent[];
      setEvents((previous) => [...previous, ...rows.filter((row) => !previous.some((item) => item.id === row.id))]);
      setMore(rows.length === 50);
    } catch { if (isDataContextCurrent(context)) setFailed(true); }
    finally { busy.current = false; if (isDataContextCurrent(context)) setLoading(false); }
  }

  const visibleEvents = transactionsOnly
    ? events.filter((event) =>
        /sale|payment|return|refund|void|purchase|finance|expense|income|drawing|salary/i.test(
          event.action,
        ),
      )
    : events;
  const ready = !loading || events.length > 0;
  const scopeLabel = owner && branchFilter === "all"
    ? t("audit.allBranches")
    : branches.find((branch) => branch.id === branchFilter)?.name ?? branchName ?? t("audit.noBranch");
  return <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
    <StatusBar /><NavHeader title={transactionsOnly ? t("activity.transactionHistory") : t("activity.activityLog")} backTo={returnTo} />
    <div className="px-4 pt-3 pb-6">
      <p className="ds-meta mb-2" data-testid="activity-branch-context">{scopeLabel}</p>
      {owner && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto" data-testid="activity-branch-filter">
          <button
            type="button"
            onClick={() => setBranchFilter("all")}
            className="h-8 px-3 rounded-full text-10 font-semibold shrink-0"
            style={{
              background: branchFilter === "all" ? "var(--text-primary)" : "var(--tone-sunken)",
              color: branchFilter === "all" ? "var(--background)" : "var(--text-secondary)",
            }}
            data-testid="activity-filter-all"
          >
            {t("audit.allBranches")}
          </button>
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => setBranchFilter(branch.id)}
              className="h-8 px-3 rounded-full text-10 font-semibold shrink-0"
              style={{
                background: branchFilter === branch.id ? "var(--text-primary)" : "var(--tone-sunken)",
                color: branchFilter === branch.id ? "var(--background)" : "var(--text-secondary)",
              }}
              data-testid={`activity-filter-${branch.id}`}
            >
              {branch.name}
            </button>
          ))}
        </div>
      )}
      {!ready && <SkeletonList rows={4} />}
      {failed && <div className="mb-3" role="alert"><p className="ds-meta">{t("audit.loadFailed")}</p>
        <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>{t("common.tryAgain")}</Button></div>}
      {!loading && !failed && visibleEvents.length === 0 && !more && <EmptyState icon={History} title={transactionsOnly ? t("activity.noTransactions") : t("admin.noActivityYet")} />}
      {visibleEvents.length > 0 && <ListCard>{visibleEvents.map((event) => <ListRow key={event.id} testId={`audit-event-${event.id}`}
        title={t(AUDIT_ACTION_KEYS[event.action] ?? "audit.otherAction")}
        meta={`${event.actor_name ?? t("audit.unknownActor")} · ${event.actor_role ?? t("audit.unknownRole")} · ${event.branch_name ?? t("audit.unknownBranch")}`}
      ><p className="text-13 font-semibold">{t(AUDIT_ACTION_KEYS[event.action] ?? "audit.otherAction")}</p>
        <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{event.actor_name ?? t("audit.unknownActor")} · {event.actor_role ?? t("audit.unknownRole")} · {event.branch_name ?? t("audit.unknownBranch")}</p>
        <p className="text-11" style={{ color: "var(--text-secondary)" }}>{formatDateTime(event.created_at)}</p>
        {typeof event.details.reason === "string" && <p className="text-12 mt-1">{t("audit.reason", { reason: event.details.reason })}</p>}
        <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("audit.succeeded")}</p>
      </ListRow>)}</ListCard>}
      {more && <Button fullWidth className="mt-3" loading={loading} onClick={() => void loadMore()}>{t("audit.loadMore")}</Button>}
    </div>
  </div>;
}
