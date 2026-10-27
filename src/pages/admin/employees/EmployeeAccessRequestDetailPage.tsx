import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, UserPlus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import InviteLinkCard from "@/components/admin/InviteLinkCard";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { formatPhone, formatSmartDateTime } from "@/lib/formatters";
import {
  dismissEmployeeAccessRequest,
  getEmployeeAccessRequest,
  type EmployeeAccessRequest,
} from "@/lib/employeeAccessRequests";

/**
 * One request, and the two honest answers: add the matching number, or close
 * the request. The employee is already invited when a membership exists; that
 * case shares the existing invitation instead of creating a second employee.
 */
export default function EmployeeAccessRequestDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const { requestId } = useParams<{ requestId: string }>();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const now = useCurrentTime();
  const { addToast } = useUIStore();

  const [request, setRequest] = useState<EmployeeAccessRequest | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) { setState("missing"); return; }
    setState("loading");
    try {
      const row = await getEmployeeAccessRequest(requestId);
      setRequest(row);
      setState(row ? "ready" : "missing");
    } catch {
      setState("error");
    }
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  async function handleDismiss() {
    if (!request || dismissing) return;
    setDismissing(true);
    try {
      const updated = await dismissEmployeeAccessRequest(request.id);
      if (updated) {
        setRequest({ ...request, status: "dismissed" });
        addToast(t("accessRequests.dismissedToast"), "success");
      }
      setConfirmDismiss(false);
    } catch {
      addToast(t("accessRequests.loadFailed"), "error");
    } finally {
      setDismissing(false);
    }
  }

  function openAddEmployee() {
    if (!request) return;
    const query = new URLSearchParams({ phone: request.phone, request: request.id });
    if (request.name) query.set("name", request.name);
    navigate(`/admin/employees/new?${query.toString()}`);
  }

  const name = request?.name || t("accessRequests.unknownName");
  const alreadyInvited = !!request?.employeeId;
  const isActive = request?.membershipStatus === "active";
  const isPending = request?.status === "pending";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("accessRequests.detailTitle")} backTo="/admin/employees/requests" />

      <div className="flex flex-col gap-4 px-4 pb-24">
        {state === "loading" && <SkeletonList rows={3} tile />}

        {(state === "missing" || state === "error") && (
          <EmptyState
            icon={UserPlus}
            title={t("accessRequests.notFound")}
            subtitle={t("accessRequests.notFoundHint")}
            action={{ label: t("accessRequests.retry"), onClick: () => void load() }}
          />
        )}

        {state === "ready" && request && (
          <>
            <div className="flex flex-col items-center text-center gap-2 pt-3">
              <div
                className="size-14 rounded-full flex items-center justify-center"
                style={{ background: "var(--brand-light)" }}
              >
                <UserPlus size={24} style={{ color: "var(--brand-dark)" }} />
              </div>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{name}</p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{formatPhone(request.phone)}</p>
              <span
                className="text-10 font-bold px-2.5 py-1 rounded-full"
                style={{
                  background: request.status === "pending"
                    ? "var(--warning-bg)"
                    : request.status === "approved"
                      ? "var(--brand-light)"
                      : "var(--surface-2)",
                  color: request.status === "pending"
                    ? "var(--warning)"
                    : request.status === "approved"
                      ? "var(--brand-dark)"
                      : "var(--text-secondary)",
                }}
              >
                {t(`accessRequests.${request.status}`)}
              </span>
            </div>

            <ListCard>
              <ListRow
                trailing={<span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{name}</span>}
              >
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("accessRequests.name")}</span>
              </ListRow>
              <ListRow
                trailing={<span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{formatPhone(request.phone)}</span>}
              >
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("accessRequests.phone")}</span>
              </ListRow>
              <ListRow
                trailing={<span className="text-sm font-semibold text-end" style={{ color: "var(--text-primary)" }}>{formatSmartDateTime(request.createdAt, now, t)}</span>}
              >
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("accessRequests.status")}</span>
              </ListRow>
            </ListCard>

            {alreadyInvited && !isActive && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {t("accessRequests.alreadyInvited")}
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {t("accessRequests.alreadyInvitedHint")}
                </p>
                <InviteLinkCard name={name} phone={request.phone} />
              </div>
            )}

            {isPending && (
              <div className="flex flex-col gap-3 pt-1">
                {alreadyInvited ? (
                  <Button
                    fullWidth
                    size="lg"
                    onClick={() => navigate(`/admin/employees/${request.employeeId}`)}
                    testId="access-request-open-employee"
                  >
                    {t("accessRequests.openEmployee")}
                  </Button>
                ) : (
                  <Button
                    fullWidth
                    size="lg"
                    onClick={openAddEmployee}
                    testId="access-request-add-employee"
                  >
                    {t("accessRequests.add")}
                  </Button>
                )}
                <Button
                  fullWidth
                  variant="outline"
                  onClick={() => setConfirmDismiss(true)}
                  testId="access-request-dismiss"
                >
                  {t("accessRequests.dismiss")}
                </Button>
              </div>
            )}

            {!isPending && request.employeeId && (
              <button
                type="button"
                onClick={() => navigate(`/admin/employees/${request.employeeId}`)}
                className="flex items-center justify-between rounded-[var(--radius-tile)] px-4 py-3 ds-pressable"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              >
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {t("accessRequests.openEmployee")}
                </span>
                <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className={isUrdu ? "rotate-180" : ""} />
              </button>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDismiss}
        title={t("accessRequests.dismissQ")}
        message={t("accessRequests.dismissHint")}
        confirmLabel={t("accessRequests.dismiss")}
        cancelLabel={t("common.cancel")}
        loading={dismissing}
        onConfirm={() => void handleDismiss()}
        onCancel={() => setConfirmDismiss(false)}
      />
    </div>
  );
}
