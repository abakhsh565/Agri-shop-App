import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Photo from "@/components/ui/Photo";
import {
  ArchiveRestore,
  Ban,
  Crown,
  Pencil,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { navigateBack } from "@/lib/navContext";
import { isCurrentUserOwner } from "@/lib/tenantContext";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
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

function formatDay(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** `branch_co_owner_invited` reads as the sentence it is, without a second dictionary. */
function humanise(code: string): string {
  const words = code.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function CoOwnerDetailPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const location = useLocation();
  const { grantId } = useParams<{ grantId: string }>();
  const owner = isCurrentUserOwner();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { addToast } = useUIStore();
  const enabled = coOwnerEnabled();
  const { get, suspend, reactivate, restore, revoke } = useCoOwnersStore();

  const [grant, setGrant] = useState<CoOwnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

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
        addToast(t("coOwners.suspendedToast"), "success");
      } else if (action === "reactivate") {
        await reactivate(grantId);
        await load();
        addToast(t("coOwners.reactivatedToast"), "success");
      } else if (action === "restore") {
        await restore(grantId);
        await load();
        addToast(t("coOwners.sent"), "success");
      } else {
        await revoke(grantId, reason.trim() || t("coOwners.revokeDefaultReason"));
        await load();
        setRevoking(false);
        setReason("");
        addToast(t("coOwners.revokedToast"), "success");
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

  const statusTone =
    grant?.status === "active"
      ? { bg: "color-mix(in srgb, var(--brand) 18%, transparent)", fg: "var(--brand-dark)" }
      : grant?.status === "suspended"
        ? { bg: "var(--tone-sunken)", fg: "var(--text-primary)" }
        : { bg: "var(--tone-sunken)", fg: "var(--text-secondary)" };

  // Every scope dimension reads the same three ways, because the delegation itself is three
  // ways: the whole business, the pieces chosen, or nothing at all.
  const dimension = (mode: string | undefined): string =>
    mode === "all" ? t("coOwners.scopeAll")
      : mode === "selected" ? t("coOwners.scopeSelected")
        : t("coOwners.scopeNone");

  const branchValue = grant && grant.scope?.branches_mode === "all"
    ? t("coOwners.branchModeAll")
    : grant && grant.branches.length > 0
      ? grant.branches.map((b) => b.name).join(" · ")
      : t("coOwners.branchModeNone");

  const yesNo = (value: boolean) => (value ? t("common.yes") : t("common.no"));

  return (
    <div
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="co-owner-detail"
    >
      <StatusBar />
      <NavHeader
        title={t("coOwners.detailTitle")}
        backTo={`${base}/settings/hub/people/co-owners`}
        // The person can be reached from the branch they run as well as from the Co-Owners
        // list, so back returns to whoever sent them here instead of always to the list.
        onBack={() => navigateBack(location, navigate, `${base}/settings/hub/people/co-owners`)}
        right={
          grant && grant.status !== "revoked" ? (
            <SectionActionsButton
              label={t("coOwners.manage")}
              onClick={() => setMenuOpen(true)}
              testId="co-owner-detail-menu"
            />
          ) : undefined
        }
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={grant?.name ?? t("coOwners.detailTitle")}
        actions={[
          {
            id: "edit",
            icon: Pencil,
            title: t("coOwners.manage"),
            onClick: () => {
              setMenuOpen(false);
              if (grant) navigate(`${base}/settings/hub/people/co-owners/${grant.id}/edit`);
            },
          },
          {
            id: "suspend",
            icon: grant?.status === "suspended" ? RotateCcw : Ban,
            title: grant?.status === "suspended" ? t("coOwners.reactivate") : t("coOwners.suspend"),
            onClick: () => {
              setMenuOpen(false);
              void act(grant?.status === "suspended" ? "reactivate" : "suspend");
            },
          },
          {
            id: "revoke",
            icon: Trash2,
            title: t("coOwners.revoke"),
            onClick: () => {
              setMenuOpen(false);
              setRevoking(true);
            },
          },
        ]}
      />

      {loading ? (
        <p className="text-12 py-10 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
      ) : !grant ? (
        <div className="px-4 pt-6">
          <p className="text-15 font-semibold">{t("coOwners.failed")}</p>
          {error && <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>{error}</p>}
        </div>
      ) : (
        <>
          {/* The person, and the one fact about them: what body they are and whether that body
              is switched on right now. */}
          <div className="px-5 pt-6 pb-5" style={{ borderBottom: "1px solid var(--divider)" }}>
            <div className="flex items-start gap-3.5">
              <Photo
                src={grant.photoUrl}
                className="size-14 rounded-full object-cover shrink-0"
                fallback={
                  <span
                    className="size-14 rounded-full flex items-center justify-center text-16 font-bold shrink-0"
                    style={{ background: "var(--tone-sunken)" }}
                    aria-hidden="true"
                  >
                    {initials(grant.name || grant.phone)}
                  </span>
                }
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 min-w-0">
                  <span className="text-18 font-bold truncate">{grant.name}</span>
                  <span
                    className="text-9 font-bold px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {t("people.coOwner")}
                  </span>
                </p>
                <p className="text-13 mt-0.5" dir="ltr" style={{ color: "var(--text-secondary)" }}>
                  {grant.phone}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{ background: statusTone.bg, color: statusTone.fg }}
                  >
                    {t(STATUS_LABEL[grant.status] as Parameters<typeof t>[0])}
                  </span>
                  <span className="text-11" style={{ color: "var(--text-tertiary)" }}>
                    {grant.status === "invited"
                      ? `${t("coOwners.transferWaitingTitle")}`
                      : `${t("coOwners.stepReview")} · ${formatDay(grant.activatedAt ?? grant.invitedAt)}`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* What they can open. One row per dimension of the business; a closed dimension says
              so rather than disappearing, because "no suppliers" is the access decision. */}
          <div className="px-4 pt-5">
            <p className="ds-section-label mb-2">{t("coOwners.access")}</p>
            <ListCard>
              <ListRow title={t("coOwners.branches")} value={branchValue} />
              <ListRow title={t("coOwners.suppliers")} value={dimension(grant.scope?.suppliers_mode)} />
              <ListRow title={t("coOwners.departments")} value={dimension(grant.scope?.departments_mode)} />
              <ListRow title={t("coOwners.customers")} value={dimension(grant.scope?.records_mode)} />
              <ListRow
                title={t("coOwners.permissions")}
                value={String(grant.permissions.length)}
                onClick={() => navigate(`${base}/settings/hub/people/co-owners/${grant.id}/edit`)}
              />
              <ListRow
                title={t("coOwners.stepDashboard")}
                value={String(grant.dashboards.length)}
                onClick={() => navigate(`${base}/settings/hub/people/co-owners/${grant.id}/edit`)}
              />
            </ListCard>
          </div>

          {/* Major actions: the permissions that money and stock depend on, each with the mode
              that decides whether the action runs, waits for the owner, or is closed. */}
          {Object.keys(grant.authorities).length > 0 && (
            <div className="px-4 pt-5">
              <p className="ds-section-label mb-2">{t("coOwners.stepAuthority")}</p>
              <ListCard>
                {Object.entries(grant.authorities).map(([code, mode]) => (
                  <ListRow
                    key={code}
                    title={humanise(code)}
                    value={t(AUTHORITY_LABEL[mode] as Parameters<typeof t>[0])}
                    emphasis={mode === "allowed"}
                  />
                ))}
              </ListCard>
            </div>
          )}

          {/* The employee side of the delegation: what they may do to the team, and which roles
              they may hand out. */}
          <div className="px-4 pt-5">
            <p className="ds-section-label mb-2">{t("coOwners.stepTeam")}</p>
            <ListCard>
              <ListRow title={t("coOwners.canInvite")} value={yesNo(grant.canInviteEmployees)} />
              <ListRow title={t("coOwners.canDeactivate")} value={yesNo(grant.canDeactivateEmployees)} />
              <ListRow title={t("coOwners.canManageBranches")} value={yesNo(grant.canManageBranches)} />
              <ListRow title={t("coOwners.assignableRoles")} value={String(grant.assignableRoleIds.length)} />
            </ListCard>
          </div>

          {/* Delegation history: what was changed and when. Five is the scan; the rest is
              history, not a decision, so it stays in the record rather than on the screen. */}
          <div className="px-4 pt-5">
            <p className="ds-section-label mb-2">{t("coOwners.activity")}</p>
            <ListCard>
              {grant.activity.length === 0 ? (
                <ListRow title={t("coOwners.noActivity")} />
              ) : (
                grant.activity.slice(0, 5).map((item, index) => (
                  <ListRow
                    key={`${item.at}-${index}`}
                    title={humanise(item.action)}
                    value={formatDate(item.at)}
                  />
                ))
              )}
            </ListCard>
          </div>

          {/* A revoked grant is a record, not a control panel: it says what happened and offers
              the one thing that can still be done — invite them back. */}
          {grant.status === "revoked" && (
            <div className="px-4 pt-5">
              <p className="ds-section-label mb-2">{t("coOwners.archived")}</p>
              <ListCard>
                <ListRow
                  icon={ArchiveRestore}
                  title={t("coOwners.archivedTitle")}
                  description={
                    grant.revocationReason === "ownership_transferred"
                      ? t("coOwners.promotedOwnerHint")
                      : t("coOwners.archiveHint")
                  }
                />
                {grant.revocationReason !== "ownership_transferred" && grant.userId !== currentUserId && (
                  <ListRow
                    icon={Crown}
                    title={busy ? t("coOwners.saving") : t("coOwners.restore")}
                    disabled={busy}
                    onClick={() => void act("restore")}
                    testId="co-owner-restore"
                  />
                )}
              </ListCard>
            </div>
          )}

          {grant.status === "active" && (
            <p className="px-4 pt-5 text-11 flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
              <ShieldCheck size={12} />
              {t("coOwners.reviewHint")}
            </p>
          )}

          {error && (
            <p className="px-4 pt-4 text-12 flex items-center gap-1.5" style={{ color: "var(--error)" }} role="alert">
              <ShieldAlert size={13} />
              {error}
            </p>
          )}
        </>
      )}

      {/* Revocation is the one action that ends someone's work, so it is asked for in words and
          needs a reason on the record. */}
      <ConfirmDialog
        open={revoking}
        title={t("coOwners.revoke")}
        message={t("coOwners.revokeConfirm")}
        confirmLabel={busy ? t("coOwners.saving") : t("coOwners.revoke")}
        destructive
        loading={busy}
        onConfirm={() => void act("revoke")}
        onCancel={() => { if (!busy) { setRevoking(false); setReason(""); } }}
      >
        <label className="block text-11" style={{ color: "var(--text-secondary)" }}>
          {t("coOwners.revokeReason")}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="mt-1.5 w-full rounded-[var(--radius-input)] px-3 py-2 text-13 outline-none resize-none"
            style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
            data-testid="co-owner-revoke-reason"
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
