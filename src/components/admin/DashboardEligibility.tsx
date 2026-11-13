import { useEffect, useMemo, useState } from "react";
import { ChevronDown, LockKeyhole, LayoutGrid } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useAccessCatalogStore } from "@/stores/accessCatalogStore";
import { eligibleWidgets, requiredPermissionsFor } from "@/lib/dashboardAccess";
import { DASHBOARD_WIDGET_HINTS } from "@/lib/roleTemplates";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { DashboardWidget } from "@/types";

/** The read-only sentence that replaces the old manual widget checklist. */
export function DashboardEligibility({
  permissions,
  compact = false,
  testId = "dashboard-eligibility",
}: {
  permissions: ReadonlySet<string>;
  compact?: boolean;
  testId?: string;
}) {
  const t = useT();
  const language = useThemeStore((s) => s.language);
  const widgets = useAccessCatalogStore((s) => s.widgets);
  const loadCatalog = useAccessCatalogStore((s) => s.load);
  const [open, setOpen] = useState(!compact);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const eligible = useMemo(() => eligibleWidgets(widgets, permissions), [widgets, permissions]);

  const label = (widget: DashboardWidget) => (language === "ur" ? widget.labelUr : widget.labelEn);

  if (widgets.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
        <SkeletonList rows={2} bare />
      </div>
    );
  }

  return (
    <div
      className="rounded-[var(--radius-card)] overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => compact && setOpen((value) => !value)}
        className="w-full p-3.5 flex items-center gap-3 text-start"
        aria-expanded={open}
        aria-disabled={!compact}
      >
        <span className="size-9 rounded-[var(--radius-tile)] grid place-items-center shrink-0" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
          <LayoutGrid size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <strong className="text-13 font-bold">{t("roles.dashboardAutomatic")}</strong>
            <span className="text-10 font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
              {t("roles.widgetCount", { count: String(eligible.length) })}
            </span>
          </span>
          <span className="text-11 mt-0.5 block" style={{ color: "var(--text-secondary)" }}>
            {t("roles.dashboardAutomaticHint")}
          </span>
        </span>
        {compact && (
          <ChevronDown size={17} style={{ color: "var(--text-secondary)", transform: open ? "rotate(180deg)" : undefined }} />
        )}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 pt-0">
          {eligible.length === 0 ? (
            <p className="text-11 py-2" style={{ color: "var(--text-tertiary)" }} data-testid={`${testId}-empty`}>
              {t("dashboard.noWidgets")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {eligible.map((widget) => {
                const required = requiredPermissionsFor(widget);
                return (
                  <div key={widget.key} className="flex items-start gap-2.5 rounded-[var(--radius-tile)] px-2.5 py-2" style={{ background: "var(--tone-sunken)" }}>
                    <span className="size-6 rounded-full grid place-items-center shrink-0 mt-0.5" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                      <LayoutGrid size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-12 font-semibold">{label(widget)}</p>
                      {!compact && DASHBOARD_WIDGET_HINTS[widget.key] && (
                        <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {t(DASHBOARD_WIDGET_HINTS[widget.key].hintKey)}
                        </p>
                      )}
                    </div>
                    <span className="text-9 shrink-0 mt-1" style={{ color: "var(--text-tertiary)" }} title={required.join(", ")}>
                      <LockKeyhole size={11} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
            {t("roles.dashboardReadOnly")}
          </p>
        </div>
      )}
    </div>
  );
}
