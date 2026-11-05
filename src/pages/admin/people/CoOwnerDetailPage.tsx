import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArchiveRestore, Ban, CheckCircle2, Pencil, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { isCurrentUserOwner } from "@/lib/tenantContext";
import { useAuthStore } from "@/stores/authStore";
import { coOwnerEnabled, coOwnerErrorCode } from "@/lib/experience";
import {
  useCoOwnersStore,
  type AuthorityMode,
  type CoOwnerDetail,
  type CoOwnerStatus,
} from "@/stores/coOwnersStore";

const STATUS_LABEL: Record<CoOwnerStatus, string> = {
  active: "coOwners.statusActive",
  invited: "coOwners.statusInvited",
  suspended: "coOwners.statusSuspended",
  revoked: "coOwners.archived",
};

const AUTHORITY_LABEL: Record<AuthorityMode, string> = {
  allowed: "coOwners.authorityAllowed",
  approval_required: "coOwners.authorityApproval",
  restricted: "coOwners.authorityRestricted",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius-tile)] p-4"
      style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
    >
      {children}
    </div>
  );
}

export default function CoOwnerDetailPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { grantId } = useParams<{ grantId: string }>();
  const owner = isCurrentUserOwner();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const enabled = coOwnerEnabled();
  const { get, suspend, reactivate, restore, revoke } = useCoOwnersStore();

  const [grant, setGrant] = useState<CoOwnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function load() {
    if (!grantId) return;
    try {
      const data = await get(grantId);
      setGrant(data);
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (owner && enabled) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantId, owner, enabled]);

  async function act(action: "suspend" | "reactivate" | "restore" | "revoke") {
    if (!grantId || busy) return;
    setBusy(true);
    setError("");
    try {
      if (action === "suspend") {
        await suspend(grantId, reason);
        await load();
      } else if (action === "reactivate") {
        await reactivate(grantId);
        await load();
      } else if (action === "restore") {
        await restore(grantId);
        await load();
      } else {
        await revoke(grantId, reason.trim() || t("coOwners.revokeDefaultReason"));
        await load();
        setConfirmRevoke(false);
      }
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      setBusy(false);
    }
  }

  if (!owner) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.detailTitle")} backTo={`${base}/settings/hub/people/co-owners`} />
        <p className="px-4 pt-6 text-13" style={{ color: "var(--text-secondary)" }}>{t("coOwners.notOwner")}</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.title")} backTo={`${base}/settings/hub/people`} />
        <p className="px-4 pt-6 text-13" style={{ color: "var(--text-secondary)" }}>{t("coOwners.featureOff")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-full pb-10" style={{ background: "var(--background)", color: "var(--text-primary)" }} data-testid="co-owner-detail">
      <StatusBar />
      <NavHeader title={t("coOwners.detailTitle")} backTo={`${base}/settings/hub/people/co-owners`} />

      <div className="px-4 pt-1 flex flex-col gap-3">
        {loading ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
        ) : !grant ? (
          <Card>
            <p className="text-13 font-bold">{t("coOwners.failed")}</p>
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{error}</p>
          </Card>
        ) : (
          <>
            <Card>
              <div className="flex items-start gap-3">
                <span
                  className="size-12 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--tone-sunken)" }}
                >
                  {grant.status === "revoked" || grant.status === "suspended"
                    ? <ShieldAlert size={20} />
                    : <ShieldCheck size={20} style={{ color: "var(--brand-dark)" }} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-16 font-bold truncate">{grant.name}</p>
                  <p className="text-11 mt-0.5" dir="ltr" style={{ color: "var(--text-secondary)" }}>{grant.phone}</p>
                  <span
                    className="inline-block mt-2 text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {t(STATUS_LABEL[grant.status] as Parameters<typeof t>[0])}
                  </span>
                </div>
                {grant.status !== "revoked" && (
                  <button
                    type="button"
                    onClick={() => navigate(`${base}/settings/hub/people/co-owners/${grant.id}/edit`)}
                    className="size-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--tone-sunken)" }}
                    aria-label={t("coOwners.manage")}
                    data-testid="co-owner-edit"
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div>
                  <p className="text-10" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.branches")}</p>
                  <p className="text-12 font-semibold mt-0.5">
                    {grant.branches.length ? grant.branches.map((b) => b.name).join(" · ") : t("coOwners.noBranches")}
                  </p>
                </div>
                <div>
                  <p className="text-10" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.permissions")}</p>
                  <p className="text-12 font-semibold mt-0.5 tabular-nums">{grant.permissions.length}</p>
                </div>
                <div>
                  <p className="text-10" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.stepDashboard")}</p>
                  <p className="text-12 font-semibold mt-0.5 tabular-nums">{grant.dashboards.length}</p>
                </div>
                <div>
                  <p className="text-10" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.assignableRoles")}</p>
                  <p className="text-12 font-semibold mt-0.5 tabular-nums">{grant.assignableRoleIds.length}</p>
                </div>
              </div>
            </Card>

            <Card>
              <p className="text-12 font-bold mb-2">{t("coOwners.stepScope")}</p>
              <div className="flex flex-col gap-2 text-12">
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.branches")}</span>
                  <span className="font-semibold text-end">
                    {grant.scope?.branches_mode === "all" ? t("coOwners.branchModeAll") : grant.branches.map((b) => b.name).join(" · ") || "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.suppliers")}</span>
                  <span className="font-semibold">{grant.scope?.suppliers_mode ?? "none"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.departments")}</span>
                  <span className="font-semibold">{grant.scope?.departments_mode ?? "none"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.customers")}</span>
                  <span className="font-semibold">{grant.scope?.records_mode ?? "none"}</span>
                </div>
              </div>
            </Card>

            <Card>
              <p className="text-12 font-bold mb-2">{t("coOwners.stepAuthority")}</p>
              <div className="flex flex-col gap-2">
                {Object.entries(grant.authorities).map(([code, mode]) => (
                  <div key={code} className="flex items-center justify-between gap-3 text-12">
                    <span style={{ color: "var(--text-secondary)" }}>{code}</span>
                    <span className="font-semibold">{t(AUTHORITY_LABEL[mode] as Parameters<typeof t>[0])}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <p className="text-12 font-bold mb-2">{t("coOwners.activity")}</p>
              {grant.activity.length === 0 ? (
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.noActivity")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {grant.activity.map((item, index) => (
                    <div key={`${item.at}-${index}`} className="flex items-start gap-2">
                      <span className="size-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "var(--brand)" }} />
                      <div className="min-w-0">
                        <p className="text-11 font-semibold">{item.action}</p>
                        <p className="text-10" style={{ color: "var(--text-tertiary)" }}>{formatDate(item.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {grant.status !== "revoked" && (
              <Card>
                <p className="text-12 font-bold">{t("coOwners.manage")}</p>
                <label className="block text-10 mt-2" style={{ color: "var(--text-secondary)" }}>
                  {t("coOwners.revokeReason")}
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-[var(--radius-input)] px-3 py-2 text-12 outline-none resize-none"
                    style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
                  />
                </label>

                <div className="flex flex-col gap-2 mt-3">
                  {grant.status === "active" || grant.status === "invited" ? (
                    <button
                      type="button"
                      onClick={() => act("suspend")}
                      disabled={busy}
                      className="h-10 rounded-full text-12 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                      data-testid="co-owner-suspend"
                    >
                      <Ban size={14} />
                      {t("coOwners.suspend")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => act("reactivate")}
                      disabled={busy}
                      className="h-10 rounded-full text-12 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                      data-testid="co-owner-reactivate"
                    >
                      <RotateCcw size={14} />
                      {t("coOwners.reactivate")}
                    </button>
                  )}

                  {!confirmRevoke ? (
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(true)}
                      className="h-10 rounded-full text-12 font-bold"
                      style={{ background: "color-mix(in srgb, #ef4444 12%, transparent)", color: "#b91c1c" }}
                      data-testid="co-owner-revoke"
                    >
                      {t("coOwners.revoke")}
                    </button>
                  ) : (
                    <>
                      <p className="text-11" style={{ color: "#b91c1c" }}>{t("coOwners.revokeConfirm")}</p>
                      <button
                        type="button"
                        onClick={() => act("revoke")}
                        disabled={busy}
                        className="h-10 rounded-full text-12 font-bold disabled:opacity-50"
                        style={{ background: "#b91c1c", color: "white" }}
                        data-testid="co-owner-revoke-confirm"
                      >
                        {t("coOwners.revoke")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(false)}
                        className="h-9 text-11 font-semibold"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {t("common.cancel")}
                      </button>
                    </>
                  )}
                </div>
              </Card>
            )}

            {grant.status === "revoked" && (
              <Card>
                <div className="flex items-center gap-2">
                  <ArchiveRestore size={17} style={{ color: "var(--brand-dark)" }} />
                  <p className="text-12 font-bold">{t("coOwners.archivedTitle")}</p>
                </div>
                <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>
                  {grant.revocationReason === "ownership_transferred"
                    ? t("coOwners.promotedOwnerHint")
                    : t("coOwners.archiveHint")}
                </p>
                {grant.revocationReason !== "ownership_transferred" && grant.userId !== currentUserId && (
                  <button
                    type="button"
                    onClick={() => act("restore")}
                    disabled={busy}
                    className="mt-3 w-full h-10 rounded-full text-12 font-bold disabled:opacity-50"
                    style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
                    data-testid="co-owner-restore"
                  >
                    {busy ? t("coOwners.saving") : t("coOwners.restore")}
                  </button>
                )}
              </Card>
            )}

            {error && <p className="text-11" style={{ color: "var(--error)" }}>{error}</p>}
            {grant.status === "active" && (
              <p className="text-10 flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
                <CheckCircle2 size={11} />
                {t("coOwners.reviewHint")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
