import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { History } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useShopStore } from "@/stores/shopStore";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/formatters";
import { businessActionLabelKey } from "@/lib/auditActions";

interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  actor_name: string | null;
  actor_role: string | null;
  branch_id: string;
  branch_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const PAGE = 50;

/**
 * One employee's business history.
 *
 * WHAT IS SHOWN, and what is not, is the owner's rule (2026-10-29): actions that changed the
 * shop's money, stock, people or access. Switching the branch being viewed, or editing a name or
 * phone number, is not a business event and would bury the rows that matter. The filter lives in
 * `lib/auditActions` (`businessActionLabelKey`), not here, so the definition is one thing and the
 * branch-wide Activity Log still shows the complete record.
 *
 * THE WINDOW IS THE WORKING BRANCH. `get_branch_activity` is branch-scoped by design and cannot
 * read another branch's events; the subheader says so rather than letting a short list imply the
 * person did nothing elsewhere.
 *
 * PAGES, not a single capped read: the actor's own rows are sparse inside a branch-wide stream,
 * so fifty events might contain none of this person's. `Load more` walks the raw cursor forward
 * and appends only the matching rows, remembering the last RAW event so a page of misses still
 * advances.
 */
export default function AdminEmployeeActivityDetailPage() {
  const t = useT();
  const base = useShellBase();
  const { employeeId } = useParams<{ employeeId: string }>();

  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const loadEmployees = useEmployeesStore((s) => s.load);
  const branchId = useShopStore((s) => s.activeBranchId);
  const branchName = useShopStore((s) => s.activeBranchName);

  const employee = employees.find((e) => e.id === employeeId) ?? null;

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<AuditEvent | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!employeesReady) void loadEmployees();
  }, [employeesReady, loadEmployees]);

  useEffect(() => {
    if (!branchId || !employeeId) {
      setEvents([]);
      setInitialLoading(false);
      return;
    }
    let cancelled = false;
    setEvents([]);
    setCursor(null);
    setHasMore(false);
    setFailed(false);
    setInitialLoading(true);
    void supabase
      .rpc("get_branch_activity", { p_limit: PAGE })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setFailed(true);
          setInitialLoading(false);
          return;
        }
        const rows = (data ?? []) as AuditEvent[];
        setEvents(
          rows.filter(
            (row) => row.actor_id === employeeId && businessActionLabelKey(row.action) !== null,
          ),
        );
        setCursor(rows.length > 0 ? rows[rows.length - 1] : null);
        setHasMore(rows.length === PAGE);
        setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, employeeId, retry]);

  async function loadMore() {
    if (!cursor || busy.current) return;
    busy.current = true;
    setMoreLoading(true);
    setFailed(false);
    const { data, error } = await supabase.rpc("get_branch_activity", {
      p_before: cursor.created_at,
      p_before_id: cursor.id,
      p_limit: PAGE,
    });
    if (error) {
      setFailed(true);
      setMoreLoading(false);
      busy.current = false;
      return;
    }
    const rows = (data ?? []) as AuditEvent[];
    const mine = rows.filter(
      (row) => row.actor_id === employeeId && businessActionLabelKey(row.action) !== null,
    );
    setEvents((previous) => {
      const seen = new Set(previous.map((event) => event.id));
      return [...previous, ...mine.filter((event) => !seen.has(event.id))];
    });
    setCursor(rows.length > 0 ? rows[rows.length - 1] : cursor);
    setHasMore(rows.length === PAGE);
    setMoreLoading(false);
    busy.current = false;
  }

  const roleLine = employee
    ? employee.isOriginalOwner
      ? t("settings.owner")
      : employee.roleName || employee.jobTitle || t("empDetail.noRole")
    : "";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-activity-page"
    >
      <StatusBar />
      <NavHeader
        title={employee?.name || t("hub.people.activity")}
        backTo={`${base}/settings/hub/people/activity`}
      />

      <div className="px-4 pt-1 pb-3">
        <p className="text-12 font-semibold">
          {roleLine}
          {branchName ? ` · ${branchName}` : ""}
        </p>
        <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
          {t("people.businessOnlyHint")}
        </p>
      </div>

      <div className="px-4 pb-10">
        {initialLoading && <SkeletonList rows={5} />}

        {failed && (
          <div className="mb-3" role="alert">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("audit.loadFailed")}
            </p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("common.tryAgain")}
            </Button>
          </div>
        )}

        {!initialLoading && !failed && events.length === 0 && (
          <EmptyState icon={History} title={t("people.noBusinessActivity")} />
        )}

        {events.length > 0 && (
          <ListCard>
            {events.map((event) => {
              const labelKey = businessActionLabelKey(event.action);
              return (
                <ListRow
                  key={event.id}
                  testId={`employee-activity-event-${event.id}`}
                  title={labelKey ? t(labelKey) : t("audit.otherAction")}
                  meta={formatDateTime(event.created_at)}
                />
              );
            })}
          </ListCard>
        )}

        {hasMore && !initialLoading && (
          <div className="pt-3">
            <Button
              variant="outline"
              fullWidth
              disabled={moreLoading}
              onClick={() => void loadMore()}
            >
              {moreLoading ? t("common.loading") : t("people.loadMore")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
