import { useT } from "@/lib/i18n";
import PermissionChecklist from "@/components/admin/PermissionChecklist";
import { SkeletonList } from "@/components/ui/Skeleton";

/**
 * The access editor, shared by Add Employee (where the owner can customize an
 * employee before inviting them) and Employee Detail (where they change it
 * later). One component so the same model is presented identically in both
 * places.
 *
 * Two decisions this screen has to communicate at once, and it now says both with the same
 * control:
 *
 *   • **what this employee can do** — a ticked box, one per action, grouped by the part of
 *     the shop it belongs to. Before, the actions inside a group only appeared once the group
 *     was *partly* granted, so a fresh employee offered fourteen group buttons and no actions
 *     at all, and a full group showed none either: the more you granted, the less you saw.
 *   • **how that differs from their role** — carried by a marker on the rows that differ
 *     ("added" / "removed"). A row that simply agrees with the role stays unmarked, so in a
 *     list of forty boxes the two exceptions are the only things shouting, which is exactly
 *     what an override is for.
 *
 * Controlled: the caller owns `value`, which is the employee's effective access being edited
 * — role defaults with their exceptions applied. `roleDefaults` is what the chosen role
 * grants, and is used only for the difference markers.
 */
export interface EmployeeAccessEditorProps {
  /** The selected role's defaults, for telling "from the role" from "for this employee". */
  roleDefaults: Set<string>;
  /** The access being edited (effective: role defaults + this employee's exceptions). */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /**
   * Whether the access this editor is showing has actually been read.
   *
   * Required on purpose. An optional default would let the next screen open on an empty box
   * list while its read was still in flight, which is the exact defect this state exists to
   * make impossible — forty unticked boxes are a claim about a person's access.
   */
  state: "loading" | "ready" | "error";
}

export default function EmployeeAccessEditor({ roleDefaults, value, onChange, state }: EmployeeAccessEditorProps) {
  const t = useT();

  // Waiting and failed are drawn here, once, for every screen that edits an employee's access.
  // Before, each screen owned its own copy of this — and two of the three drew neither, so an
  // unfetched role and a role that grants nothing looked identical.
  if (state !== "ready") {
    return state === "error" ? (
      <p className="text-xs" style={{ color: "var(--error)" }} data-testid="emp-access-error">
        {t("access.roleUnavailable")}
      </p>
    ) : (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("access.loadingRole")}</span>
        <SkeletonList rows={3} bare />
      </div>
    );
  }

  const LEGEND = [
    { key: "fromRole", dot: "var(--brand)" },
    { key: "onlyThis", dot: "#3b82f6" },
    { key: "offForThis", dot: "var(--error)" },
  ] as const;

  return (
    <div>
      <PermissionChecklist
        value={value}
        onChange={onChange}
        roleDefaults={roleDefaults}
        maxHeight="400px"
        testIdPrefix="emp-perm"
      />

      {/* The markers only mean something next to their own key, and the middle one is the
          only state that has no marker on the row — a box that is ticked for nobody else. */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {LEGEND.map(({ key, dot }) => (
          <span key={key} className="flex items-center gap-1 text-10" style={{ color: "var(--text-secondary)" }}>
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: dot }}
            />
            {t(
              key === "fromRole"
                ? "empDetail.fromRole"
                : key === "onlyThis"
                  ? "empDetail.onlyThis"
                  : "empDetail.offForThis"
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
