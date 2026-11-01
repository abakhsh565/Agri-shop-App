import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, UserPlus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { formatPhone, formatSmartDateTime } from "@/lib/formatters";
import {
  listEmployeeAccessRequests,
  type EmployeeAccessRequest,
} from "@/lib/employeeAccessRequests";

function statusTone(status: EmployeeAccessRequest["status"]): { bg: string; color: string } {
  if (status === "pending") return { bg: "var(--warning-bg)", color: "var(--warning)" };
  if (status === "approved") return { bg: "var(--brand-light)", color: "var(--brand-dark)" };
  return { bg: "var(--surface-2)", color: "var(--text-secondary)" };
}

export default function EmployeeAccessRequestsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const base = useShellBase();
  const now = useCurrentTime();

  const [items, setItems] = useState<EmployeeAccessRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const rows = await listEmployeeAccessRequests();
      setItems(rows);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pendingCount = items.filter((r) => r.status === "pending").length;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("accessRequests.title")} backTo={`${base}/settings/hub/people`} />

      <div className="flex flex-col px-4 gap-3 pb-24">
        <div className="flex flex-col gap-1 px-1 pt-1">
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>
            {t("accessRequests.subtitle")}
          </p>
          {pendingCount > 0 && (
            <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
              {t("accessRequests.pendingCount", { count: pendingCount })}
            </p>
          )}
        </div>

        {state === "loading" && <SkeletonList rows={3} tile />}

        {state === "error" && (
          <div className="flex flex-col items-center py-16 gap-3 text-center">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {t("accessRequests.loadFailed")}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="ds-pill"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("accessRequests.retry")}
            </button>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <EmptyState
            icon={UserPlus}
            title={t("accessRequests.empty")}
            subtitle={t("accessRequests.emptyHint")}
          />
        )}

        {state === "ready" && items.length > 0 && (
          <ListCard>
            {items.map((request) => {
              const tone = statusTone(request.status);
              const name = request.name || t("accessRequests.unknownName");
              return (
                <ListRow
                  key={request.id}
                  testId={`access-request-${request.id}`}
                  onClick={() => navigate(`${base}/employees/requests/${request.id}`)}
                  tile={
                    <div
                      className="size-11 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--tone-sunken)" }}
                    >
                      <UserPlus size={18} style={{ color: "var(--text-secondary)" }} />
                    </div>
                  }
                  trailing={<ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                >
                  <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                      {name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatPhone(request.phone)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-10 font-bold px-2 py-0.5 rounded-full"
                        style={{ background: tone.bg, color: tone.color }}
                      >
                        {t(`accessRequests.${request.status}`)}
                      </span>
                      {request.createdAt && (
                        <span className="text-10" style={{ color: "var(--text-secondary)" }}>
                          {formatSmartDateTime(request.createdAt, now, t)}
                        </span>
                      )}
                    </div>
                  </div>
                </ListRow>
              );
            })}
          </ListCard>
        )}
      </div>
    </div>
  );
}
