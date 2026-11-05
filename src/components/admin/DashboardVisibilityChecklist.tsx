import { SkeletonList } from "@/components/ui/Skeleton";
import VisibilityToggle from "@/components/ui/VisibilityToggle";
import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { useAccessCatalogStore } from "@/stores/accessCatalogStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useThemeStore } from "@/stores/themeStore";
import { DASHBOARD_WIDGET_HINTS } from "@/lib/roleTemplates";
import { Lock } from "lucide-react";

interface DashboardVisibilityChecklistProps {
  /** Widget keys this role may see. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /**
   * The role's selected permissions. A widget whose `default_permission` is absent here is
   * still selectable, but the row says it will stay hidden until that permission is added.
   */
  permissions?: Set<string>;
  testIdPrefix?: string;
}

/**
 * What this role is SHOWN on a dashboard — a different question from what it may DO.
 *
 * Visibility and authority are separate: a role can be shown a figure without being able
 * to change it, and a selected widget never grants its required permission. The database
 * enforces the second half in `get_my_dashboards()`, so this screen cannot create a
 * dashboard the employee is not authorized to see.
 */
export default function DashboardVisibilityChecklist({
  value,
  onChange,
  permissions,
  testIdPrefix = "dash",
}: DashboardVisibilityChecklistProps) {
  const t = useT();
  const language = useThemeStore((s) => s.language);
  const widgets = useAccessCatalogStore((s) => s.widgets);
  const catalogue = usePermissionsStore((s) => s.permissions);
  const { areaLabel } = usePermissionLabels();

  if (widgets.length === 0) {
    return (
      <div className="px-4 pb-4" role="status" aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        <SkeletonList rows={3} bare />
      </div>
    );
  }

  const setVisible = (key: string, visible: boolean) => {
    const next = new Set(value);
    if (visible) next.add(key);
    else next.delete(key);
    onChange(next);
  };

  const permissionLabel = (code: string | null) => {
    if (!code) return "";
    const permission = catalogue.find((p) => p.code === code);
    if (!permission) return code;
    return language === "ur" ? permission.label_ur : permission.label_en;
  };

  return (
    <div
      className="mx-4 rounded-[var(--radius-tile)] overflow-hidden"
      style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)" }}
      data-testid={`${testIdPrefix}-list`}
    >
      {widgets.map((w) => {
        const on = value.has(w.key);
        const label = language === "ur" ? w.labelUr : w.labelEn;
        const meta = DASHBOARD_WIDGET_HINTS[w.key];
        const missingPermission =
          w.defaultPermission && permissions && !permissions.has(w.defaultPermission)
            ? w.defaultPermission
            : null;
        return (
          <div key={w.key} className="px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
                  {label}
                </p>
                <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {meta ? t(meta.hintKey) : areaLabel(w.module)}
                </p>
              </div>
              <VisibilityToggle
                value={on}
                onChange={(next) => setVisible(w.key, next)}
                onLabel={t("roles.visible")}
                offLabel={t("roles.hidden")}
                ariaLabel={label}
                testId={`${testIdPrefix}-${w.key}`}
              />
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span
                className="text-10 font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
              >
                {meta?.scope === "business" ? t("roles.widgetBusiness") : t("roles.widgetBranch")}
              </span>
              {on && missingPermission && (
                <span
                  className="text-10 font-semibold flex items-center gap-1"
                  style={{ color: "var(--error)" }}
                  data-testid={`${testIdPrefix}-missing-${w.key}`}
                >
                  <Lock size={11} />
                  {t("roles.widgetNeeds", { permission: permissionLabel(missingPermission) })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
