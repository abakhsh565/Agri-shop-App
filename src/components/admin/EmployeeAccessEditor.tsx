import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { Check } from "lucide-react";

/**
 * The access editor, shared by Add Employee (where the owner can customize an
 * employee before inviting them) and Employee Detail (where they change it
 * later). One component so the same model is presented identically in both
 * places: business areas with the actions this employee will actually have, and
 * a legend that says where each one came from.
 *
 * Controlled: the caller owns `value`, which is the employee's effective access
 * being edited — role defaults with their exceptions applied.
 */
export interface EmployeeAccessEditorProps {
  /** The selected role's defaults, for telling "from the role" from "for this employee". */
  roleDefaults: Set<string>;
  /** The access being edited (effective: role defaults + this employee's exceptions). */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}

export default function EmployeeAccessEditor({ roleDefaults, value, onChange }: EmployeeAccessEditorProps) {
  const t = useT();
  const { areaLabel, actionLabel, areaIcon } = usePermissionLabels();
  const permissions = usePermissionsStore((s) => s.permissions);
  const getByModule = usePermissionsStore((s) => s.getByModule);

  /** How a single action relates to the role — the owner-facing state of a chip. */
  function permState(code: string): "fromRole" | "onlyThis" | "offForThis" | "none" {
    const inherited = roleDefaults.has(code);
    const effective = value.has(code);
    if (inherited && effective) return "fromRole";
    if (!inherited && effective) return "onlyThis";
    if (inherited && !effective) return "offForThis";
    return "none";
  }

  const STATE_STYLE: Record<string, { bg: string; fg: string }> = {
    fromRole: { bg: "var(--brand)", fg: "#0a0a0a" },
    onlyThis: { bg: "#3b82f6", fg: "#ffffff" },
    offForThis: { bg: "rgba(239,68,68,0.18)", fg: "#ef4444" },
    none: { bg: "var(--surface)", fg: "var(--text-secondary)" },
  };

  function togglePerm(code: string) {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  function toggleArea(module: string) {
    const areaPerms = getByModule(module);
    const allSelected = areaPerms.every((p) => value.has(p.code));
    const next = new Set(value);
    for (const p of areaPerms) {
      if (allSelected) next.delete(p.code);
      else next.add(p.code);
    }
    onChange(next);
  }

  return (
    <div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {permissions.length === 0 && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
        )}
        {[...new Set(permissions.map((p) => p.module))].map((mod) => {
          const areaPerms = getByModule(mod);
          if (areaPerms.length === 0) return null;
          const selectedCount = areaPerms.filter((p) => value.has(p.code)).length;
          const allSelected = selectedCount === areaPerms.length;
          return (
            <div key={mod}>
              <button
                onClick={() => toggleArea(mod)}
                className="flex items-center justify-between w-full py-2 px-3 rounded-lg"
                style={{
                  background: allSelected ? "rgba(132,204,22,0.1)" : "var(--surface)",
                  border: `1px solid ${selectedCount > 0 ? "var(--brand)" : "var(--divider)"}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{areaIcon(mod)}</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{areaLabel(mod)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {allSelected ? (
                    <>
                      <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("empDetail.areaFull")}</span>
                      <Check size={12} style={{ color: "var(--brand)" }} />
                    </>
                  ) : selectedCount === 0 ? (
                    <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("empDetail.areaNone")}</span>
                  ) : null}
                </div>
              </button>
              {/* Individual actions — only when the area is partly granted, so the
                  owner is not shown 40 checkboxes to make one decision. */}
              {selectedCount > 0 && selectedCount < areaPerms.length && (
                <div className="flex flex-wrap gap-1 mt-1 ps-6">
                  {areaPerms.map((p) => {
                    const state = permState(p.code);
                    const s = STATE_STYLE[state];
                    return (
                      <button
                        key={p.code}
                        onClick={() => togglePerm(p.code)}
                        className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{
                          background: s.bg,
                          color: s.fg,
                          border: state === "offForThis" ? "1px solid #ef4444" : "1px solid var(--divider)",
                        }}
                      >
                        {actionLabel(p.action)}
                        {state === "onlyThis" ? " +" : state === "offForThis" ? " −" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {(["fromRole", "onlyThis", "offForThis"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: STATE_STYLE[k].bg, border: `1px solid ${STATE_STYLE[k].fg}` }}
            />
            {t(k === "fromRole" ? "empDetail.fromRole" : k === "onlyThis" ? "empDetail.onlyThis" : "empDetail.offForThis")}
          </span>
        ))}
      </div>
    </div>
  );
}
