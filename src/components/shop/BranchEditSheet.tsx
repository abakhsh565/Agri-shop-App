import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Store } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";

/**
 * Editing one branch — everything that was answered when it was created.
 *
 * Creating a branch collects two things: a name and which roles it starts with. Both are
 * editable here, which is the point the request makes about products: an input you can set
 * but never change is not management.
 *
 * The name is edited in place. The roles are NOT, and that is a deliberate limit rather
 * than a missing feature: a role belongs to the branch it was created in, and this app's
 * role screens — the list, the permission grid, the delete — are all authorized against
 * the branch the account is working in. Showing another branch's roles in a form here and
 * then having every save refused would be worse than saying where they are edited. So for
 * the branch you are standing in, the roles are listed with the number of people on each
 * and this sheet hands off to the real role screen; for any other branch the sheet names
 * where they live and offers to open it, stating the consequence it has — that opening it
 * means working in that branch.
 *
 * The main branch carries one extra sentence: it can be renamed and never deleted, which is
 * the reason it has no Delete row anywhere on the Branches screen.
 */
export default function BranchEditSheet({
  branch,
  onClose,
  onRenamed,
}: {
  branch: BranchSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { addToast } = useUIStore();

  const renameBranch = useShopStore((s) => s.renameBranch);
  const switchTo = useShopStore((s) => s.switchTo);

  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);

  const [name, setName] = useState(branch.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  /**
   * The save guard is a ref, not `saving`.
   *
   * `saving` is a state variable, so it is still `false` for the second tap of a double
   * tap inside the same task — two saves would go out for one intention, and the second
   * could land after the sheet has closed. The ref is set synchronously, before anything
   * awaits, which is what actually stops the second one.
   */
  const savingRef = useRef(false);

  // The branch being edited is the active one: its roles are the ones this app can read,
  // so they are what the sheet can list. Any other branch gets the sentence and the way in.
  const isActive = branch.isCurrent;
  useEffect(() => {
    if (!isActive) return;
    if (!rolesReady) void loadRoles();
  }, [isActive, rolesReady, loadRoles]);

  useEffect(() => {
    if (!isActive || roles.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const role of roles) next[role.id] = await getRoleMemberCount(role.id);
      if (!cancelled) setCounts(next);
    })();
    return () => { cancelled = true; };
  }, [isActive, roles, getRoleMemberCount]);

  const clean = name.trim();
  const dirty = clean !== branch.name.trim();

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    setSaving(true);
    const result = await renameBranch(branch.id, clean);
    savingRef.current = false;
    setSaving(false);
    if (!result.ok) {
      // An error is not a refusal the person can fix by tapping again blindly; it is shown
      // under the field they typed in.
      setError(
        result.code === "name_required" ? t("branches.nameRequired")
          : result.code === "name_taken" ? t("branches.nameTaken")
            : result.code === "name_too_long" ? t("branches.nameTooLong")
              : result.code === "denied" ? t("branches.delete.errDenied")
                : t("branches.saveFailed"),
      );
      return;
    }
    addToast(t("branches.saved", { branch: clean }), "success");
    onRenamed(clean);
  }

  /** Working in another branch is what changing its roles means; say so, then do it. */
  async function openRoles() {
    if (!isActive) {
      const result = await switchTo(branch.id);
      if (!result.ok) {
        addToast(
          t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"),
          result.code === "pending_sync" ? "warning" : "error",
        );
        return;
      }
      addToast(t("shop.switched", { shop: branch.name }), "success");
    }
    onClose();
    navigate(`${base}/settings/roles`);
  }

  return (
    <Sheet open title={t("branches.editTitle")} onClose={onClose}>
      <div className="px-4 pt-1 pb-2" data-testid={`branch-edit-${branch.id}`}>
        {/* Which branch is being edited, said once, above the field the name goes in. */}
        <div className="flex items-center gap-2.5">
          <div
            className="size-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            aria-hidden="true"
          >
            <Store size={17} />
          </div>
          <div className="min-w-0">
            <p className="text-14 font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {branch.name}
            </p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {branch.isMain
                ? t("branches.mainNote")
                : t(branch.salesCount === 1 ? "branches.saleOne" : "branches.saleOther", {
                    count: String(branch.salesCount),
                  })}
            </p>
          </div>
        </div>

        {/* ── The name ──────────────────────────────────────────────────────────── */}
        <p className="text-12 font-semibold mt-4" style={{ color: "var(--text-primary)" }}>
          {t("branches.nameLabel")}
        </p>
        <div className="ds-field mt-2">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && dirty && void handleSave()}
            maxLength={120}
            data-testid="branch-name-input"
            aria-label={t("branches.nameLabel")}
            className="h-full flex-1 bg-transparent outline-none ds-body text-start"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        {/* The refusal sits directly under the field it is about, not in a toast that has
            already faded by the time the person looks back at what they typed. */}
        {error && (
          <p className="text-11 mt-1.5" style={{ color: "var(--error)" }} data-testid="branch-name-error">
            {error}
          </p>
        )}

        {/* ── The roles ─────────────────────────────────────────────────────────── */}
        <p className="text-12 font-semibold mt-4" style={{ color: "var(--text-primary)" }}>
          {t("branches.rolesTitle")}
        </p>

        {isActive && !rolesReady && (
          <div className="flex items-center justify-center py-5" role="status" aria-busy="true">
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
          </div>
        )}

        {isActive && rolesReady && roles.length > 0 && (
          <ListCard className="mt-2">
            {roles.map((role) => (
              <ListRow
                key={role.id}
                title={role.name}
                meta={t(
                  (counts[role.id] ?? 0) === 1 ? "branches.employeeOne" : "branches.employeeOther",
                  { count: String(counts[role.id] ?? 0) },
                )}
                onClick={() => void openRoles()}
              />
            ))}
          </ListCard>
        )}

        <p className="text-12 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
          {t("branches.rolesHint")}
        </p>

        <button
          type="button"
          onClick={() => void openRoles()}
          data-testid="branch-manage-roles"
          className="mt-2 h-10 px-1 flex items-center text-13 font-bold ds-pressable"
          style={{ color: "var(--brand-dark)" }}
        >
          {t("branches.manageRoles", { branch: branch.name })}
        </button>

        <Button
          fullWidth
          className="mt-4"
          loading={saving}
          disabled={!clean || !dirty}
          onClick={() => void handleSave()}
          testId="branch-save"
        >
          {saving ? t("branches.saving") : t("branches.save")}
        </Button>
      </div>
    </Sheet>
  );
}
