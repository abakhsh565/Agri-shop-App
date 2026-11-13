import {
  AlertTriangle,
  Check,
  KeyRound,
  Laptop,
  Phone,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";

/**
 * Security is a preview of the account-protection surface.
 *
 * The data on this screen is representative only: there is no password, session or recovery
 * endpoint behind it yet. The layout is real so the screen can be wired to those endpoints
 * without redesigning it, and the note at the bottom says so plainly.
 */
export default function SecuritySettingsPage() {
  const t = useT();
  const base = useShellBase();
  const language = useThemeStore((s) => s.language);
  const { addToast } = useUIStore();

  const preview = () => addToast(t("securityDemo.preview"), "info");
  const rtl = language === "ur";

  const pill = (label: string, strong = false) => (
    <span
      className="shrink-0 text-10 font-semibold px-2 py-1 rounded-full"
      style={{
        background: strong ? "rgba(34, 197, 94, 0.14)" : "var(--tone-sunken)",
        color: strong ? "var(--success)" : "var(--text-secondary)",
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="security-settings-page"
    >
      <StatusBar />
      <NavHeader title={t("more.security")} backTo={`${base}/more`} />

      <div className="px-4 pt-1 pb-8">
        <p className="ds-body mb-4" style={{ color: "var(--text-secondary)" }}>
          {t("securityDemo.subtitle")}
        </p>

        <div
          className="rounded-[var(--radius-card)] p-4 flex items-start gap-3"
          style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
        >
          <span
            className="size-11 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(34, 197, 94, 0.12)", color: "var(--success)" }}
          >
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-14 font-bold">{t("securityDemo.protection")}</p>
              {pill(t("securityDemo.protected"), true)}
            </div>
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}>
              {t("securityDemo.protectionHint")}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <ListCard section={t("securityDemo.signIn")}>
            <ListRow
              icon={KeyRound}
              title={t("securityDemo.password")}
              meta={t("securityDemo.passwordMeta")}
              trailing={<span className="ds-row-value">{t("securityDemo.change")}</span>}
              onClick={preview}
            />
            <ListRow
              icon={ShieldCheck}
              title={t("securityDemo.twoStep")}
              meta={t("securityDemo.twoStepMeta")}
              trailing={pill(t("securityDemo.on"), true)}
              onClick={preview}
            />
            <ListRow
              icon={Phone}
              title={t("securityDemo.recovery")}
              meta={t("securityDemo.recoveryMeta")}
              onClick={preview}
            />
          </ListCard>
        </div>

        <div className="mt-5">
          <ListCard section={t("securityDemo.sessions")}>
            <ListRow
              icon={Laptop}
              title={t("securityDemo.sessionOne")}
              meta={t("securityDemo.sessionOneMeta")}
              trailing={pill(t("securityDemo.thisDevice"))}
            />
            <ListRow
              icon={Smartphone}
              title={t("securityDemo.sessionTwo")}
              meta={t("securityDemo.sessionTwoMeta")}
              trailing={<span className="ds-row-value">{t("securityDemo.signOut")}</span>}
              onClick={preview}
            />
          </ListCard>
          <button
            type="button"
            onClick={preview}
            className="w-full mt-2.5 font-semibold active:opacity-70"
            style={{
              height: 44,
              borderRadius: "var(--radius-field)",
              background: "var(--tone-card)",
              color: "var(--text-primary)",
              fontSize: "var(--text-meta)",
              fontWeight: "var(--weight-strong)",
            }}
          >
            {t("securityDemo.signOutOthers")}
          </button>
        </div>

        <div className="mt-5">
          <ListCard section={t("securityDemo.activity")}>
            <ListRow
              icon={Check}
              title={t("securityDemo.activityOne")}
              meta={t("securityDemo.activityOneMeta")}
            />
            <ListRow
              icon={ShieldCheck}
              title={t("securityDemo.activityTwo")}
              meta={t("securityDemo.activityTwoMeta")}
            />
            <ListRow
              icon={AlertTriangle}
              title={t("securityDemo.activityThree")}
              meta={t("securityDemo.activityThreeMeta")}
            />
          </ListCard>
        </div>

        <p className="text-10 mt-5 px-1" style={{ color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          {t("securityDemo.note")}
        </p>
      </div>
    </div>
  );
}
