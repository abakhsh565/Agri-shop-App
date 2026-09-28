import { useMemo } from "react";
import Checkbox from "@/components/ui/Checkbox";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { usePermissionsStore } from "@/stores/permissionsStore";

interface PermissionChecklistProps {
  /** The codes currently granted. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Height cap for the scrolling region; the sheet passes its own when it needs one. */
  maxHeight?: string;
  /**
   * What the chosen role grants, when this list is editing one *employee's* access rather
   * than a role itself.
   *
   * Supplying it turns on the difference markers: the employee's access starts as the role's
   * answer, so the only thing worth saying on a row is where this person departs from it —
   * "added" for a box ticked here and nowhere else, "removed" for one the role grants and
   * this employee does not get. A row that agrees with the role says nothing, which is what
   * makes the two differences visible at a glance in a list of forty boxes.
   */
  roleDefaults?: Set<string>;
  /** Distinguishes one list's rows from another's in tests and in the accessibility tree. */
  testIdPrefix?: string;
}

/**
 * Access, as a list of ticked boxes.
 *
 * Every grantable thing is on screen, in a column, with a box beside it — grouped by the part
 * of the shop it belongs to, each group headed by a box that grants or clears the whole group
 * and left in a mixed state while only some of its items are ticked. Before this, the actions
 * inside a group only appeared once the group was *partly* granted, so the screen showed
 * fewer choices the less you had chosen: a fresh role offered fourteen group buttons and no
 * actions at all, and the actions appeared as chips whose meaning depended on a colour legend
 * underneath. Nothing about that told the owner what a "Salesman" could actually do.
 *
 * A group's actions now sit inside an inset block under the group's own row, the way a nested
 * scope list is drawn, so "these belong to Inventory" is a shape on the screen rather than
 * something assembled from indentation and hope. The block is a region, not a second list: no
 * interaction lives on it, and each action is still one button with one box.
 *
 * Semantics are unchanged — this reads and writes exactly the same permission codes the
 * database already stores, so roles and the rules that enforce them are untouched.
 */
export default function PermissionChecklist({
  value,
  onChange,
  maxHeight = "46vh",
  roleDefaults,
  testIdPrefix = "perm",
}: PermissionChecklistProps) {
  const t = useT();
  const { areaLabel, actionLabel, areaIcon } = usePermissionLabels();
  const permissions = usePermissionsStore((s) => s.permissions);
  const getByModule = usePermissionsStore((s) => s.getByModule);

  /** Modules in catalogue order, so the list does not reshuffle as things are ticked. */
  const modules = useMemo(
    () => [...new Set(permissions.map((p) => p.module))],
    [permissions]
  );

  const toggleCode = (code: string) => {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  const toggleModule = (module: string) => {
    const areaPerms = getByModule(module);
    const allSelected = areaPerms.every((p) => value.has(p.code));
    const next = new Set(value);
    for (const p of areaPerms) {
      if (allSelected) next.delete(p.code);
      else next.add(p.code);
    }
    onChange(next);
  };

  // The catalogue is a separate read from the grants, so a checklist opened early would
  // otherwise draw no rows at all — which reads as "this feature is missing" rather than
  // "this is still loading".
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
        const areaPerms = getByModule(mod);
        if (areaPerms.length === 0) return null;
        const selectedCount = areaPerms.filter((p) => value.has(p.code)).length;
        const allSelected = selectedCount === areaPerms.length;
        const someSelected = selectedCount > 0 && !allSelected;
        const AreaIcon = areaIcon(mod);

        return (
          <div key={mod} className="px-4 pt-3">
            {/* The group's own box. Clicking anywhere on the row grants or clears the whole
                group, which is the decision an owner actually makes. */}
            <button
              type="button"
              role="checkbox"
              aria-checked={allSelected ? true : someSelected ? "mixed" : false}
              aria-label={areaLabel(mod)}
              onClick={() => toggleModule(mod)}
              data-testid={`${testIdPrefix}-area-${mod}`}
              className="w-full flex items-center gap-3 py-2 text-start"
            >
              <Checkbox checked={allSelected} mixed={someSelected} />
              <AreaIcon size={16} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
              <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                {areaLabel(mod)}
              </span>
              <span className="text-11 shrink-0" style={{ color: "var(--text-secondary)" }}>
                {selectedCount}/{areaPerms.length}
              </span>
            </button>

            {/* Every action, always listed. One box each, inside the group's own inset block so
                the nesting is drawn rather than implied. The block is a control surface, so its
                edge is the control token: `--divider` is the hairline between two rows of a
                card, and used here it drew a boundary the eye could not find. */}
            <div
              className="ms-7 mb-1 rounded-[var(--radius-tile)] overflow-hidden"
              style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)" }}
            >
              {areaPerms.map((p) => {
                const on = value.has(p.code);
                const inherited = roleDefaults?.has(p.code) ?? false;
                // Only a difference from the role is worth a word.
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
                    data-testid={`${testIdPrefix}-${p.code}`}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-start"
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
