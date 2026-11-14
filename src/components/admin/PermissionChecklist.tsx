import { useMemo, useState } from "react";
import Checkbox from "@/components/ui/Checkbox";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { ChevronDown } from "lucide-react";

interface PermissionChecklistProps {
  /** The codes currently granted. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Height cap for the scrolling region; the sheet passes its own when it needs one. */
  maxHeight?: string;
  /**
   * What the chosen role grants, when this list is editing one *employee's* access rather
   * than a role itself.
   */
  roleDefaults?: Set<string>;
  /** Distinguishes one list's rows from another's in tests and in the accessibility tree. */
  testIdPrefix?: string;
  /** Modules the current category recommends, shown first. */
  priorityModules?: string[];
  /** Modules that should start expanded and carry the "Relevant" mark. */
  highlightModules?: string[];
  /** The role wizard uses collapsible groups; employee access keeps every row visible. */
  accordion?: boolean;
  /**
   * Restriction-only mode for one employee: only permissions inherited from the assigned
   * role are shown, and a tick can be removed but never added. The database enforces the
   * same rule; this mode makes the screen say it before the write is attempted.
   */
  restrictOnly?: boolean;
}

/**
 * Access, as a list of ticked boxes, grouped by business area.
 *
 * The role wizard can collapse non-relevant modules so the forty-code catalogue reads as a
 * sequence of decisions instead of a wall. Employee access keeps the expanded list it
 * already had. Both modes write the same real permission codes.
 */
export default function PermissionChecklist({
  value,
  onChange,
  maxHeight = "46vh",
  roleDefaults,
  testIdPrefix = "perm",
  priorityModules = [],
  highlightModules = [],
  accordion = false,
  restrictOnly = false,
}: PermissionChecklistProps) {
  const t = useT();
  const { areaLabel, actionLabel, areaIcon } = usePermissionLabels();
  const permissions = usePermissionsStore((s) => s.permissions);
  const getByModule = usePermissionsStore((s) => s.getByModule);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const priority = useMemo(() => new Set(priorityModules), [priorityModules]);
  const highlight = useMemo(() => new Set(highlightModules), [highlightModules]);

  /**
   * Relevant modules first, then the rest in catalogue order. The sort is stable, so a
   * module does not jump around while the owner ticks boxes.
   */
  const modules = useMemo(() => {
    const available = restrictOnly && roleDefaults
      ? permissions.filter((p) => roleDefaults.has(p.code))
      : permissions;
    const seen = [...new Set(available.map((p) => p.module))];
    const rank = (module: string) => {
      const index = priorityModules.indexOf(module);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return seen
      .map((module, index) => ({ module, index }))
      .sort((a, b) => rank(a.module) - rank(b.module) || a.index - b.index)
      .map((x) => x.module);
  }, [permissions, priorityModules, restrictOnly, roleDefaults]);

  const toggleCode = (code: string) => {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else if (!restrictOnly) next.add(code);
    onChange(next);
  };

  const toggleModule = (module: string) => {
    const areaPerms = restrictOnly && roleDefaults
      ? getByModule(module).filter((p) => roleDefaults.has(p.code))
      : getByModule(module);
    const allSelected = areaPerms.every((p) => value.has(p.code));
    const next = new Set(value);
    for (const p of areaPerms) {
      if (allSelected) next.delete(p.code);
      else next.add(p.code);
    }
    onChange(next);
  };

  const isOpen = (module: string) => {
    if (!accordion) return true;
    if (opened.has(module)) return true;
    if (closed.has(module)) return false;
    return highlight.has(module);
  };

  const toggleOpen = (module: string) => {
    if (isOpen(module)) {
      setClosed((prev) => new Set(prev).add(module));
      setOpened((prev) => {
        const next = new Set(prev);
        next.delete(module);
        return next;
      });
    } else {
      setOpened((prev) => new Set(prev).add(module));
      setClosed((prev) => {
        const next = new Set(prev);
        next.delete(module);
        return next;
      });
    }
  };

  if (permissions.length === 0) {
    return (
      <div className="px-4 pb-4" role="status" aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        <SkeletonList rows={3} bare />
      </div>
    );
  }

  return (
    <div className="overflow-y-auto" style={{ maxHeight }}>
      {modules.map((mod) => {
        const areaPerms = restrictOnly && roleDefaults
          ? getByModule(mod).filter((p) => roleDefaults.has(p.code))
          : getByModule(mod);
        if (areaPerms.length === 0) return null;
        const selectedCount = areaPerms.filter((p) => value.has(p.code)).length;
        const allSelected = selectedCount === areaPerms.length;
        const someSelected = selectedCount > 0 && !allSelected;
        const AreaIcon = areaIcon(mod);
        const open = isOpen(mod);
        const relevant = highlight.has(mod);

        return (
          <div key={mod} className="px-4 pt-3">
            <div className="flex items-center gap-3 py-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={allSelected ? true : someSelected ? "mixed" : false}
                aria-label={areaLabel(mod)}
                onClick={() => toggleModule(mod)}
                data-testid={`${testIdPrefix}-area-${mod}`}
                className="flex items-center gap-3 text-start min-w-0 flex-1"
              >
                <Checkbox checked={allSelected} mixed={someSelected} />
                <AreaIcon size={16} className="shrink-0" style={{ color: relevant ? "var(--brand-dark)" : "var(--text-secondary)" }} />
                <span className="text-sm font-semibold min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                  {areaLabel(mod)}
                </span>
              </button>
              {relevant && (
                <span
                  className="text-10 font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
                >
                  {t("roles.relevant")}
                </span>
              )}
              <span className="text-11 shrink-0 tabular-nums" style={{ color: selectedCount > 0 ? "var(--brand-dark)" : "var(--text-secondary)" }}>
                {selectedCount}/{areaPerms.length}
              </span>
              {accordion && (
                <button
                  type="button"
                  onClick={() => toggleOpen(mod)}
                  aria-expanded={open}
                  aria-label={`${open ? t("common.close") : t("common.viewAll")} ${areaLabel(mod)}`}
                  data-testid={`${testIdPrefix}-toggle-${mod}`}
                  className="size-7 rounded-full grid place-items-center shrink-0"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined }} />
                </button>
              )}
            </div>

            {open && (
              <div
                className="ms-7 mb-1 rounded-[var(--radius-tile)] overflow-hidden"
                style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)" }}
              >
                {areaPerms.map((p) => {
                  const on = value.has(p.code);
                  const inherited = roleDefaults?.has(p.code) ?? false;
                  const marker: "added" | "off" | null = !roleDefaults
                    ? null
                    : on && !inherited
                      ? "added"
                      : !on && inherited
                        ? "off"
                        : null;
                  return (
                    <button
                      key={p.code}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleCode(p.code)}
                      aria-disabled={restrictOnly && !on}
                      data-testid={`${testIdPrefix}-${p.code}`}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-start disabled:opacity-60"
                      disabled={restrictOnly && !on}
                    >
                      <Checkbox checked={on} size={14} />
                      <span
                        className="text-13 min-w-0 truncate flex-1"
                        style={{ color: on ? "var(--text-primary)" : "var(--text-secondary)" }}
                      >
                        {actionLabel(p.action)}
                      </span>
                      {marker && (
                        <span
                          className="text-10 font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            background: marker === "added" ? "rgba(59,130,246,0.18)" : "var(--error-bg)",
                            color: marker === "added" ? "#3b82f6" : "var(--error)",
                          }}
                        >
                          {t(marker === "added" ? "empDetail.markAdded" : "empDetail.markOff")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="pb-2" />
    </div>
  );
}

/** The one control that grants or clears everything, for the sheet header. */
export function useSelectAll(value: Set<string>, onChange: (next: Set<string>) => void) {
  const permissions = usePermissionsStore((s) => s.permissions);
  const allSelected = permissions.length > 0 && permissions.every((p) => value.has(p.code));
  return {
    allSelected,
    toggleAll: () => {
      if (allSelected) onChange(new Set());
      else onChange(new Set(permissions.map((p) => p.code)));
    },
  };
}
