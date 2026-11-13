import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight, Store } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import {
  chooseBusiness,
  getMyBusinesses,
  getMyInvitations,
  resumeSession,
  signOut,
  type BusinessChoice,
} from "@/lib/auth";
import { homePathForUser } from "@/lib/experience";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

/**
 * The workspace chooser after the identity is proved. It shows only active memberships the
 * server returned; the last shop is a preference, never evidence that access still exists.
 * A single active shop opens by itself. A business with multiple branches keeps its existing
 * branch switcher and branch-scope validation after entry.
 */
export default function BusinessSelectPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [businesses, setBusinesses] = useState<BusinessChoice[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");
  const autoOpened = useRef(false);

  useEffect(() => {
    if (!user) { navigate("/login", { replace: true }); return; }
    let alive = true;
    void Promise.all([getMyBusinesses(), getMyInvitations()]).then(async ([shops, invitations]) => {
      if (!alive) return;
      setPendingCount(invitations.length);
      const active = shops.filter((shop) => shop.membershipStatus === "active");
      setBusinesses(active);
      setLoading(false);
      if (active.length === 0) return;

      // Restore the server's current shop if it is still authorized; otherwise the first.
      const preferred = active.find((shop) => shop.isCurrent) ?? active[0];
      if (active.length === 1 && !autoOpened.current) {
        autoOpened.current = true;
        const opened = await open(preferred);
        if (!alive) return;
        if (!opened) setError(t("business.switchFailed"));
      }
    });
    return () => { alive = false; };
  }, []);

  async function open(shop: BusinessChoice): Promise<boolean> {
    if (!user) return false;
    setSwitching(shop.shopId);
    setError("");
    try {
      const chosen = await chooseBusiness(shop.shopId);
      if (!chosen.ok) return false;
      const resumed = await resumeSession(user);
      if (resumed.status !== "ok") return false;
      setUser(resumed.user);
      navigate(homePathForUser(resumed.user), { replace: true });
      return true;
    } finally {
      setSwitching(null);
    }
  }

  async function handleSignOut() {
    await signOut();
    setUser(null);
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex flex-col w-full min-h-[100dvh]" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <StatusBar />
      <NavHeader title={t("business.chooseTitle")} noBack />
      <div className="flex flex-col flex-1 gap-4 p-4 overflow-y-auto">
        {!loading && businesses.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-20 font-bold">{t("business.subtitle")}</p>
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("business.explain")}</p>
          </div>
        )}

        {error && (
          <p className="text-13 rounded-[var(--radius-tile)] px-3 py-2"
             style={{ color: "var(--error)", background: "var(--surface-2)" }}>{error}</p>
        )}

        {loading && (
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("business.loadingList")}</p>
        )}

        {!loading && businesses.map((shop) => (
          <button
            key={shop.shopId}
            type="button"
            disabled={switching !== null}
            onClick={() => void open(shop)}
            className="rounded-[var(--radius-card)] p-4 flex items-center gap-3 text-start disabled:opacity-60"
            style={{ background: "var(--surface-1)", border: "1px solid var(--divider)" }}
          >
            <span className="size-11 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                  style={{ background: "var(--brand-light)" }}>
              <Store size={19} style={{ color: "var(--brand-dark)" }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-16 font-bold truncate">{shop.name}</span>
              <span className="block text-12" style={{ color: "var(--text-secondary)" }}>
                {shop.membershipRole === "owner"
                  ? t("business.roleOwner")
                  : shop.membershipRole === "admin"
                    ? t("business.roleAdmin")
                    : t("business.roleEmployee")}
              </span>
            </span>
            {switching === shop.shopId
              ? <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("business.opening")}</span>
              : <ChevronRight size={17} style={{ color: "var(--text-secondary)" }} />}
          </button>
        ))}

        {!loading && businesses.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <span className="size-14 rounded-full flex items-center justify-center"
                  style={{ background: "var(--surface-2)" }}>
              <Building2 size={24} style={{ color: "var(--text-secondary)" }} />
            </span>
            <p className="text-16 font-bold">{t("business.noneTitle")}</p>
            <p className="text-13 max-w-[300px]" style={{ color: "var(--text-secondary)" }}>
              {pendingCount > 0 ? t("business.nonePending") : t("business.noneBody")}
            </p>
            {pendingCount > 0 && (
              <Button onClick={() => navigate("/login/invitations")}>
                {t("business.viewInvitations", { count: pendingCount })}
              </Button>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="text-12 underline underline-offset-2 mt-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("invitations.signOut")}
            </button>
          </div>
        )}

        {!loading && pendingCount > 0 && businesses.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/login/invitations")}
            className="text-12 font-semibold underline underline-offset-2 self-center py-3"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("invitations.pendingCount", { count: pendingCount })}
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate("/identity")}
          className="text-12 underline underline-offset-2 self-center py-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t("identity.settingsMeta")}
        </button>
      </div>
    </div>
  );
}
