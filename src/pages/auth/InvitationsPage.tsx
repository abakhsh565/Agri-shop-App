import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, Store, X } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import {
  acceptMyInvitation,
  declineMyInvitation,
  getMyInvitations,
  resumeSession,
  signOut,
} from "@/lib/auth";
import type { PendingInvitation, User } from "@/types";
import { hasPin } from "@/lib/pinLock";
import { homePathForUser } from "@/lib/experience";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

/**
 * Invitations are decisions, not side effects.
 *
 * Each pending membership is shown with the shop, the inviter, the role and the branches it
 * actually carries. Accepting one activates that membership only; every other invitation
 * stays exactly as it was. Declining one leaves the account and the other invitations intact.
 */
export default function InvitationsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [invitations, setInvitations] = useState<PendingInvitation[]>(user?.pendingInvitations ?? []);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) { navigate("/login", { replace: true }); return; }
    let alive = true;
    void getMyInvitations().then((rows) => {
      if (!alive) return;
      setInvitations(rows);
      setUser({ ...user, pendingInvitations: rows });
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  async function continueAfterDecision(updatedUser: User) {
    if (!hasPin(updatedUser.id)) {
      navigate("/login/pin-set", {
        replace: true,
        state: { returnTo: "/login/business", celebrate: true },
      });
      return;
    }
    navigate("/login/business", { replace: true });
  }

  async function handleAccept(invitation: PendingInvitation) {
    if (!user || actingOn) return;
    setActingOn(invitation.membershipId);
    setError("");
    try {
      const result = await acceptMyInvitation(invitation.membershipId);
      if (!result.ok) {
        setError(/INVITATION_EXPIRED/.test(result.error ?? "") ? t("invitations.expiredError") : t("invitations.acceptFailed"));
        return;
      }
      const remaining = invitations.filter((row) => row.membershipId !== invitation.membershipId);
      const resumed = await resumeSession(user);
      const nextUser = resumed.status === "ok"
        ? { ...resumed.user, pendingInvitations: remaining }
        : { ...user, pendingInvitations: remaining };
      setUser(nextUser);
      await continueAfterDecision(nextUser);
    } finally {
      setActingOn(null);
    }
  }

  async function handleDecline(invitation: PendingInvitation) {
    if (!user || actingOn) return;
    setActingOn(invitation.membershipId);
    setError("");
    try {
      const result = await declineMyInvitation(invitation.membershipId);
      if (!result.ok) { setError(t("invitations.acceptFailed")); return; }
      const remaining = invitations.filter((row) => row.membershipId !== invitation.membershipId);
      setInvitations(remaining);
      setUser({ ...user, pendingInvitations: remaining });
    } finally {
      setActingOn(null);
    }
  }

  async function handleLeave() {
    if (user) {
      const active = await resumeSession(user);
      if (active.status === "ok") {
        setUser(active.user);
        navigate(homePathForUser(active.user), { replace: true });
        return;
      }
    }
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex flex-col w-full min-h-[100dvh]" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <StatusBar />
      <NavHeader title={t("invitations.title")} noBack />
      <div className="flex flex-col flex-1 gap-4 p-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <p className="text-20 font-bold">{t("invitations.subtitle")}</p>
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>
            {t("invitations.explain")}
          </p>
        </div>

        {error && (
          <p className="text-13 rounded-[var(--radius-tile)] px-3 py-2"
             style={{ color: "var(--error)", background: "var(--surface-2)" }}>
            {error}
          </p>
        )}

        {loading && (
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("invitations.loading")}</p>
        )}

        {!loading && invitations.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <span className="size-14 rounded-full flex items-center justify-center"
                  style={{ background: "var(--surface-2)" }}>
              <Check size={24} style={{ color: "var(--brand-dark)" }} />
            </span>
            <p className="text-16 font-bold">{t("invitations.empty")}</p>
            <p className="text-13 max-w-[280px]" style={{ color: "var(--text-secondary)" }}>
              {t("invitations.emptyBody")}
            </p>
            <Button onClick={handleLeave}>{t("invitations.continue")}</Button>
          </div>
        )}

        {invitations.map((invitation) => (
          <div key={invitation.membershipId}
               className="rounded-[var(--radius-card)] p-4 flex flex-col gap-3"
               style={{ background: "var(--surface-1)", border: "1px solid var(--divider)" }}>
            <div className="flex items-start gap-3">
              <span className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                    style={{ background: "var(--brand-light)" }}>
                <Store size={18} style={{ color: "var(--brand-dark)" }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-16 font-bold truncate">{invitation.shopName}</p>
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                  {t("invitations.role")}: {invitation.roleName || invitation.membershipRole}
                </p>
                {invitation.inviterName && (
                  <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                    {t("invitations.from", { name: invitation.inviterName })}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 text-12" style={{ color: "var(--text-secondary)" }}>
              <p>
                {t("invitations.branches")}: {invitation.branchNames.length ? invitation.branchNames.join(", ") : t("invitations.allBranches")}
              </p>
              <p style={{ color: invitation.expired ? "var(--error)" : "var(--text-secondary)" }}>
                {invitation.expired
                  ? t("invitations.expired")
                  : t("invitations.expires", { date: new Date(invitation.expiresAt).toLocaleDateString() })}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={invitation.expired || actingOn !== null}
                onClick={() => handleAccept(invitation)}
                className="ds-btn-brand h-11 flex-1 text-13 font-bold disabled:opacity-45"
              >
                {actingOn === invitation.membershipId ? t("invitations.working") : t("invitations.accept")}
              </button>
              <button
                type="button"
                disabled={actingOn !== null}
                onClick={() => handleDecline(invitation)}
                className="h-11 px-4 rounded-full flex items-center gap-1 text-13 font-semibold disabled:opacity-45"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
              >
                <X size={14} /> {t("invitations.decline")}
              </button>
            </div>
          </div>
        ))}

        {!loading && invitations.length > 0 && (
          <button
            type="button"
            onClick={handleLeave}
            className="flex items-center justify-center gap-1 text-12 font-semibold underline underline-offset-2 py-3"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("invitations.continue")} <ChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
