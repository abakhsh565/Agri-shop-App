import { useState } from "react";
import {
  Bell,
  CalendarDays,
  Languages,
  MessageSquare,
  Moon,
  PackageSearch,
  RotateCcw,
  Wallet,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";

function PreviewSwitch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="relative shrink-0 rounded-full transition-colors"
      style={{
        width: 42,
        height: 24,
        background: on ? "var(--roles-accent, var(--text-primary))" : "var(--tone-sunken)",
        border: "1px solid var(--border-control)",
      }}
    >
      <span
        className="absolute rounded-full transition-transform"
        style={{
          width: 18,
          height: 18,
          top: 2,
          left: on ? 20 : 2,
          background: on ? "var(--tone-page)" : "var(--text-tertiary)",
        }}
      />
    </button>
  );
}

/**
 * Preferences preview.
 *
 * Language and theme are the real app settings. Notification and regional rows are a
 * representative layout: their values stay local to this visit until those preferences have a
 * storage contract. That is stated in the note instead of pretending a selection was saved.
 */
export default function PreferencesPage() {
  const t = useT();
  const base = useShellBase();
  const { language, setLanguage, theme, toggleTheme } = useThemeStore();
  const { addToast } = useUIStore();
  const [notifications, setNotifications] = useState({
    sales: true,
    lowStock: true,
    reminders: true,
    summary: false,
  });

  const rtl = language === "ur";
  const toggleNotification = (key: keyof typeof notifications) =>
    setNotifications((current) => ({ ...current, [key]: !current[key] }));

  const reset = () => {
    setNotifications({ sales: true, lowStock: true, reminders: true, summary: false });
    addToast(t("preferencesDemo.resetDone"), "success");
  };

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="preferences-page"
    >
      <StatusBar />
      <NavHeader title={t("more.preferences")} backTo={`${base}/more`} />

      <div className="px-4 pt-1 pb-8">
        <p className="ds-body mb-4" style={{ color: "var(--text-secondary)" }}>
          {t("preferencesDemo.subtitle")}
        </p>

        <ListCard section={t("preferencesDemo.appearance")}>
          <ListRow
            icon={Languages}
            title={t("preferencesDemo.language")}
            meta={t("preferencesDemo.languageHint")}
            value={language === "ur" ? t("preferencesDemo.urdu") : t("preferencesDemo.english")}
            onClick={() => setLanguage(language === "en" ? "ur" : "en")}
          />
          <ListRow
            icon={theme === "dark" ? Moon : CalendarDays}
            title={t("preferencesDemo.theme")}
            meta={t("preferencesDemo.themeHint")}
            trailing={
              <PreviewSwitch
                on={theme === "dark"}
                label={t("preferencesDemo.theme")}
                onToggle={toggleTheme}
              />
            }
          />
        </ListCard>

        <div className="mt-5">
          <ListCard section={t("preferencesDemo.notifications")}>
            <ListRow
              icon={Bell}
              title={t("preferencesDemo.sales")}
              meta={t("preferencesDemo.salesHint")}
              trailing={
                <PreviewSwitch
                  on={notifications.sales}
                  label={t("preferencesDemo.sales")}
                  onToggle={() => toggleNotification("sales")}
                />
              }
            />
            <ListRow
              icon={PackageSearch}
              title={t("preferencesDemo.lowStock")}
              meta={t("preferencesDemo.lowStockHint")}
              trailing={
                <PreviewSwitch
                  on={notifications.lowStock}
                  label={t("preferencesDemo.lowStock")}
                  onToggle={() => toggleNotification("lowStock")}
                />
              }
            />
            <ListRow
              icon={MessageSquare}
              title={t("preferencesDemo.reminders")}
              meta={t("preferencesDemo.remindersHint")}
              trailing={
                <PreviewSwitch
                  on={notifications.reminders}
                  label={t("preferencesDemo.reminders")}
                  onToggle={() => toggleNotification("reminders")}
                />
              }
            />
            <ListRow
              icon={CalendarDays}
              title={t("preferencesDemo.summary")}
              meta={t("preferencesDemo.summaryHint")}
              trailing={
                <PreviewSwitch
                  on={notifications.summary}
                  label={t("preferencesDemo.summary")}
                  onToggle={() => toggleNotification("summary")}
                />
              }
            />
          </ListCard>
        </div>

        <div className="mt-5">
          <ListCard section={t("preferencesDemo.regional")}>
            <ListRow
              icon={Wallet}
              title={t("preferencesDemo.currency")}
              value={t("preferencesDemo.currencyValue")}
            />
            <ListRow
              icon={CalendarDays}
              title={t("preferencesDemo.dateFormat")}
              value={t("preferencesDemo.dateFormatValue")}
            />
            <ListRow
              icon={CalendarDays}
              title={t("preferencesDemo.weekStart")}
              value={t("preferencesDemo.weekStartValue")}
            />
          </ListCard>
        </div>

        <button
          type="button"
          onClick={reset}
          className="w-full mt-4 flex items-center justify-center gap-2 font-semibold active:opacity-70"
          style={{
            height: 44,
            borderRadius: "var(--radius-field)",
            background: "var(--tone-card)",
            color: "var(--text-primary)",
            fontSize: "var(--text-meta)",
            fontWeight: "var(--weight-strong)",
          }}
        >
          <RotateCcw size={15} />
          {t("preferencesDemo.reset")}
        </button>

        <p className="text-10 mt-4 px-1" style={{ color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          {t("preferencesDemo.note")}
        </p>
      </div>
    </div>
  );
}
