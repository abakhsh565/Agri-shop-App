import { useOutletContext } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import type { CoOwnerAccess } from "@/components/layout/CoOwnerLayout";

/**
 * Account and grant state only. Module navigation belongs to More; keeping a second module
 * list here would recreate the duplicate menu tree this cleanup removed.
 */
export default function CoOwnerSettingsPage() {
  const t = useT();
  const { access } = useOutletContext<{ access: CoOwnerAccess }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="px-4 pt-3 pb-5" data-testid="co-owner-settings">
      <h1 className="text-18 font-bold">{t("coOwner.settingsTitle")}</h1>
      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{access.businessName}</p>

      <div
        className="rounded-[var(--radius-tile)] p-4 mt-3 flex items-center gap-3"
        style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
      >
        <span className="size-11 rounded-full flex items-center justify-center" style={{ background: "var(--tone-sunken)" }}>
          <ShieldCheck size={19} style={{ color: "var(--brand-dark)" }} />
        </span>
        <div className="min-w-0">
          <p className="text-14 font-bold truncate">{user?.name ?? user?.phone}</p>
          <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.context")}</p>
        </div>
      </div>

      <div
        className="rounded-[var(--radius-tile)] p-4 mt-2.5"
        style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
      >
        <p className="text-11 font-bold">{t("coOwners.stepScope")}</p>
        <div className="flex flex-col gap-1.5 mt-2 text-11">
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.branches")}</span>
            <span className="font-semibold text-end">{access.branches.map((b) => b.name).join(" · ") || "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.suppliers")}</span>
            <span className="font-semibold">{access.scope?.suppliers_mode ?? "none"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.departments")}</span>
            <span className="font-semibold">{access.scope?.departments_mode ?? "none"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--text-secondary)" }}>{t("coOwners.customers")}</span>
            <span className="font-semibold">{access.scope?.records_mode ?? "none"}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        className="w-full mt-2.5 rounded-[var(--radius-tile)] px-4 py-3 flex items-center gap-2 text-12 font-semibold text-start"
        style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)", color: "var(--error)" }}
      >
        <LogOut size={14} />
        {t("coOwner.signOut")}
      </button>

      <p className="text-10 mt-4" style={{ color: "var(--text-tertiary)" }}>
        {t("coOwners.reviewHint")}
      </p>
    </div>
  );
}
