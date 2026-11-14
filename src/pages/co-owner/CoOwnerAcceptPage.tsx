import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check, ShieldCheck, X } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import StatusBar from "@/components/ui/StatusBar";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { hasPin } from "@/lib/pinLock";
import { supabase } from "@/lib/supabase";
import { coOwnerEnabled, coOwnerErrorCode, homePathForUser } from "@/lib/experience";
import type { PendingCoOwnerInvitation } from "@/types";

const ERROR_COPY: Record<string, string> = {
  INVITATION_EXPIRED: "coInvite.expired",
  INVITATION_REVOKED: "coInvite.revoked",
  INVITATION_NOT_FOUND: "coInvite.notFound",
  INVITATION_NOT_PENDING: "coInvite.unavailableHint",
};

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function CoOwnerAcceptPage() {
  const t = useT();
  const navigate = useNavigate();
  const language = useThemeStore((s) => s.language);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const enabled = coOwnerEnabled();

  const [invitation, setInvitation] = useState<PendingCoOwnerInvitation | null>(
    user?.pendingCoOwnerInvitation ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const busyRef = useRef(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc("get_my_pending_co_owner_invitation");
      if (!alive) return;
      if (rpcError) {
        setError(coOwnerErrorCode(rpcError));
        setLoading(false);
        return;
      }
      if (data) setInvitation(data as PendingCoOwnerInvitation);
      else setInvitation(null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  async function accept() {
    if (!invitation || busyRef.current) return;
    busyRef.current = true;
    setBusy("accept");
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("accept_co_owner_invitation", {
        p_grant_id: invitation.grantId,
      });
      if (rpcError) throw new Error(rpcError.message);
      const current = useAuthStore.getState().user;
      if (current) {
        setUser({
          ...current,
          pendingCoOwnerInvitation: null,
          experience: "co_owner",
          coOwnerGrantId: invitation.grantId,
          businessName: invitation.businessName,
          membershipStatus: "active",
        });
      }
      await useAuthStore.getState().refreshPermissions();
      const fresh = useAuthStore.getState().user ?? current;
      const dest = homePathForUser(fresh);
      if (fresh && !hasPin(fresh.id)) {
        navigate("/login/pin-set", { replace: true, state: { returnTo: dest } });
      } else {
        navigate(dest, { replace: true });
      }
    } catch (e) {
      setError(t((ERROR_COPY[coOwnerErrorCode(e)] ?? "coInvite.failed") as Parameters<typeof t>[0]));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function decline() {
    if (!invitation || busyRef.current) return;
    busyRef.current = true;
    setBusy("decline");
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("decline_co_owner_invitation", {
        p_grant_id: invitation.grantId,
        p_reason: "Declined by invitee",
      });
      if (rpcError) throw new Error(rpcError.message);
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setError(t((ERROR_COPY[coOwnerErrorCode(e)] ?? "coInvite.failed") as Parameters<typeof t>[0]));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  if (!enabled) return <Navigate to="/login" replace />;
  if (user && !user.pendingCoOwnerInvitation && user.experience === "co_owner") {
    return <Navigate to={homePathForUser(user)} replace />;
  }

  const label = (item: { labelEn: string; labelUr: string }) =>
    language === "ur" ? item.labelUr : item.labelEn;
  const modules = Array.from(new Set((invitation?.permissions ?? []).map((p) => p.module))).map((module) => {
    const first = invitation?.permissions.find((p) => p.module === module);
    return first ? label(first) : module;
  });
  const majorActions = (invitation?.authorities ?? []).filter((a) => a.mode !== "restricted");

  return (
    <AuthLayout>
      <StatusBar />
      <div className="flex flex-col flex-1 min-h-0" style={{ color: "var(--text-primary)" }}>
        <div className="px-5 pt-8 pb-4 text-center">
          <span className="size-14 rounded-full flex items-center justify-center mx-auto" style={{ background: "color-mix(in srgb, var(--brand) 18%, transparent)" }}>
            <ShieldCheck size={24} style={{ color: "var(--brand-dark)" }} />
          </span>
          <p className="text-20 font-bold mt-4">{t("coInvite.title")}</p>
          <p className="text-12 mt-1.5 max-w-[320px] mx-auto" style={{ color: "var(--text-secondary)" }}>
            {t("coInvite.review")}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-36">
          {loading ? (
            <p className="text-12 py-10 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
          ) : !invitation ? (
            <div className="rounded-[var(--radius-tile)] p-5 text-center" style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}>
              <p className="text-14 font-bold">{t("coInvite.notFound")}</p>
              <p className="text-12 mt-2" style={{ color: "var(--text-secondary)" }}>{error || t("coInvite.unavailableHint")}</p>
              <button
                type="button"
                onClick={() => { void logout(); navigate("/login", { replace: true }); }}
                className="mt-5 h-11 px-5 rounded-full text-12 font-bold"
                style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
              >
                {t("coInvite.signOut")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}>
                <p className="text-10 uppercase font-semibold tracking-wide" style={{ color: "var(--text-tertiary)" }}>
                  {t("coInvite.business")}
                </p>
                <p className="text-18 font-bold mt-1">{invitation.businessName}</p>
                <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                  {t("coInvite.invitedBy", { name: invitation.invitedBy ?? "—" })}
                </p>
                <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {invitation.expiresAt
                    ? t("coInvite.expires", { date: formatDate(invitation.expiresAt) })
                    : t("coInvite.noExpiry")}
                </p>
              </div>

              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}>
                <p className="text-11 font-bold">{t("coInvite.branches")}</p>
                <p className="text-12 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {invitation.branches.length ? invitation.branches.map((b) => b.name).join(" · ") : t("coOwners.noBranches")}
                </p>
              </div>

              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}>
                <p className="text-11 font-bold">{t("coInvite.modules")}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {modules.length ? modules.map((module) => (
                    <span key={module} className="text-10 px-2 py-1 rounded-full" style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                      {module}
                    </span>
                  )) : (
                    <span className="text-11" style={{ color: "var(--text-tertiary)" }}>{t("coInvite.noModules")}</span>
                  )}
                </div>
                <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
                  {t("coInvite.actionCount", { count: invitation.permissions.length })}
                </p>
              </div>

              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}>
                <p className="text-11 font-bold">{t("coInvite.dashboards")}</p>
                <p className="text-12 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {invitation.dashboards.length
                    ? invitation.dashboards.map(label).join(" · ")
                    : t("coInvite.noDashboards")}
                </p>
              </div>

              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}>
                <p className="text-11 font-bold">{t("coInvite.authorities")}</p>
                {majorActions.length ? (
                  <div className="flex flex-col gap-1.5 mt-2">
                    {majorActions.map((action) => (
                      <div key={action.code} className="flex items-center justify-between gap-2 text-11">
                        <span style={{ color: "var(--text-secondary)" }}>{label(action)}</span>
                        <span className="font-semibold">
                          {action.mode === "allowed"
                            ? t("coOwners.authorityAllowed")
                            : action.mode === "approval_required"
                              ? t("coOwners.authorityApproval")
                              : t("coOwners.authorityRestricted")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-11 mt-1.5" style={{ color: "var(--text-tertiary)" }}>{t("coInvite.noAuthorities")}</p>
                )}
              </div>

              {error && <p className="text-11 text-center" style={{ color: "var(--error)" }}>{error}</p>}
            </div>
          )}
        </div>

        {invitation && !loading && (
          <div
            className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-lg px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-2 flex flex-col gap-2 border-t"
            style={{ background: "var(--background)", borderColor: "var(--divider)" }}
          >
            <button
              type="button"
              onClick={() => void accept()}
              disabled={busy !== null}
              className="w-full h-12 rounded-full text-14 font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
              data-testid="co-owner-invitation-accept"
            >
              <Check size={16} />
              {busy === "accept" ? t("coInvite.accepting") : t("coInvite.accept")}
            </button>

            {!confirmDecline ? (
              <button
                type="button"
                onClick={() => setConfirmDecline(true)}
                disabled={busy !== null}
                className="w-full h-10 rounded-full text-12 font-semibold disabled:opacity-50"
                style={{ color: "var(--text-secondary)" }}
                data-testid="co-owner-invitation-decline"
              >
                {t("coInvite.decline")}
              </button>
            ) : (
              <div className="rounded-[var(--radius-tile)] p-3" style={{ background: "var(--tone-sunken)" }}>
                <p className="text-11 text-center">{t("coInvite.declineConfirm")}</p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => void decline()}
                    disabled={busy !== null}
                    className="flex-1 h-10 rounded-full text-11 font-bold disabled:opacity-50 flex items-center justify-center gap-1"
                    style={{ background: "color-mix(in srgb, #ef4444 14%, transparent)", color: "#b91c1c" }}
                    data-testid="co-owner-invitation-decline-confirm"
                  >
                    <X size={12} />
                    {busy === "decline" ? t("coInvite.declining") : t("coInvite.declineYes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDecline(false)}
                    disabled={busy !== null}
                    className="flex-1 h-10 rounded-full text-11 font-semibold"
                    style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
                  >
                    {t("coInvite.back")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
