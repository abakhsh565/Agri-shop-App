import VisibilityToggle from "@/components/ui/VisibilityToggle";
import { useT } from "@/lib/i18n";
import { usePermissionsStore } from "@/stores/permissionsStore";

/**
 * The risky subset of the permission set, asked as its own question.
 *
 * WHY NOT A NEW TABLE OF APPROVAL RULES. The wireframe calls this "Sensitive action" and
 * offers Allowed / Not allowed. Every one of those answers is already a real permission
 * code the database enforces — voiding a sale, deleting a customer, adjusting stock,
 * changing a credit limit, managing staff. Inventing a parallel "approval" flag that no
 * RPC reads would put a switch on screen that changes nothing, which is exactly the
 * failure this repository's evidence rule forbids.
 *
 * So this step edits the SAME set the permissions step edits, narrowed to the actions that
 * can hurt the business. Ticking it here ticks it there, and the review screen counts one
 * set. When an approval-workflow layer exists, it can sit on top of these codes.
 */
export const SENSITIVE_ACTIONS = [
  { code: "customers.payments", labelKey: "roles.sensitive.payment" },
  { code: "sales.void", labelKey: "roles.sensitive.void" },
  { code: "customers.delete", labelKey: "roles.sensitive.customerDelete" },
  { code: "inventory.adjust", labelKey: "roles.sensitive.stock" },
  { code: "customers.credit_limit", labelKey: "roles.sensitive.creditLimit" },
  { code: "employees.manage", labelKey: "roles.sensitive.employees" },
] as const;

/** Codes from that list that exist in this database's catalogue. */
export function sensitiveCodes(catalogue: { code: string }[]): string[] {
  const known = new Set(catalogue.map((p) => p.code));
  return SENSITIVE_ACTIONS.filter((a) => known.has(a.code)).map((a) => a.code);
}

interface SensitiveActionListProps {
  /** The role's permission codes — the same set the permissions step edits. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}

export default function SensitiveActionList({ value, onChange }: SensitiveActionListProps) {
  const t = useT();
  const permissions = usePermissionsStore((s) => s.permissions);
  const known = sensitiveCodes(permissions);

  const setAllowed = (code: string, allowed: boolean) => {
    const next = new Set(value);
    if (allowed) next.add(code);
    else next.delete(code);
    onChange(next);
  };

  return (
    <div
      className="mx-4 rounded-[var(--radius-tile)] overflow-hidden"
      style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)" }}
      data-testid="sensitive-list"
    >
      {SENSITIVE_ACTIONS.filter((a) => known.includes(a.code)).map((a) => {
        const on = value.has(a.code);
        return (
          <div key={a.code} className="flex items-center gap-3 px-3 py-3">
            <p className="text-14 font-semibold min-w-0 flex-1" style={{ color: "var(--text-primary)" }}>
              {t(a.labelKey)}
            </p>
            <VisibilityToggle
              value={on}
              onChange={(next) => setAllowed(a.code, next)}
              onLabel={t("roles.allowed")}
              offLabel={t("roles.notAllowed")}
              ariaLabel={t(a.labelKey)}
              testId={`sensitive-${a.code}`}
            />
          </div>
        );
      })}
    </div>
  );
}
