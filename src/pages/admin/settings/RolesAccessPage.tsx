import { useState, useEffect, useRef } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionChecklist, { useSelectAll } from "@/components/admin/PermissionChecklist";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import type { Role } from "@/types";

/**
 * Roles & Access — the templates the owner hands to employees.
 *
 * The list is the app's grouped grammar (one card, rows on the card's own tone), and editing
 * opens a sheet rather than replacing the screen: the list stays behind it, so changing a
 * role is a thing you do *to a list you can still see*, not a separate journey with its own
 * save button at the bottom of a page.
 *
 * Inside the sheet, access is a checklist — every actionable thing, one tick box each, grouped
 * by the part of the shop it belongs to — with a Select all for everything at the top and a
 * box on each group that grants or clears that group alone. The rule that enforces access has
 * not changed at all: the same permission codes are written to the same tables, and the
 * database still decides what any of them allow.
 */
export default function RolesAccessPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const { areaLabel } = usePermissionLabels();
  const { addToast } = useUIStore();
  const rolesStore = useRolesStore();
  const permissionsStore = usePermissionsStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  // A new role starts from a real, empty answer; an existing one has to be read first, and
  // until that read lands its access is unknown — not empty.
  const [permsState, setPermsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [saving, setSaving] = useState(false);
  // A ref, not `saving`: React batches, so two taps in one task both read the pre-render
  // `false` and both create the role. The state variable is only for the button's label.
  const savingRef = useRef(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [roleAreas, setRoleAreas] = useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  // A ref for the same reason as the employee screen: React batches, so two clicks in
  // one task would both read the pre-render value of `deleting` and both fire.
  const deletingRef = useRef(false);
  const [nameError, setNameError] = useState("");

  const selectAll = useSelectAll(selectedPerms, setSelectedPerms);

  useEffect(() => {
    rolesStore.load();
    permissionsStore.load();
  }, []);

  // How many employees use each role, and which business areas it opens
  useEffect(() => {
    if (rolesStore.roles.length === 0) return;
    rolesStore.roles.forEach(async (role) => {
      const count = await rolesStore.getRoleMemberCount(role.id);
      setMemberCounts((prev) => ({ ...prev, [role.id]: count }));
      const perms = await rolesStore.getRolePermissions(role.id);
      const modules = [...new Set(
        perms.map((code) => permissionsStore.permissions.find((p) => p.code === code)?.module ?? code.split(".")[0]),
      )];
      setRoleAreas((prev) => ({ ...prev, [role.id]: modules }));
    });
  }, [rolesStore.roles.length, permissionsStore.permissions.length]);

  function startCreate() {
    setEditingRole(null);
    setRoleName("");
    setRoleDesc("");
    setSelectedPerms(new Set());
    setNameError("");
    setPermsState("ready");
    setEditorOpen(true);
  }

  function startEdit(role: Role) {
    // A built-in role cannot be renamed or deleted, but the owner may still adjust what it
    // opens — and the fields that cannot change say so rather than accepting typing.
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDesc(role.description ?? "");
    setNameError("");
    setSelectedPerms(new Set());
    setPermsState("loading");
    setEditorOpen(true);
    void loadPerms(role.id);
  }

  async function loadPerms(id: string) {
    const { codes, error } = await rolesStore.loadRolePermissions(id);
    if (error) {
      // Said out loud rather than shown as a role that grants nothing: the sheet opened on
      // forty empty boxes before, which is a claim about the role, not a loading state.
      setPermsState("error");
      return;
    }
    setSelectedPerms(new Set(codes));
    setPermsState("ready");
  }

  function closeEditor() {
    if (savingRef.current) return;
    setEditorOpen(false);
    setEditingRole(null);
  }

  async function handleSave() {
    setNameError("");
    if (!roleName.trim()) { setNameError(t("roles.errName")); return; }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const perms = Array.from(selectedPerms);
      if (editingRole) {
        await rolesStore.updateRole(editingRole.id, {
          name: roleName.trim(),
          description: roleDesc.trim() || undefined,
          permissions: perms,
        });
        addToast(t("roles.updated"), "success");
      } else {
        await rolesStore.createRole({
          name: roleName.trim(),
          description: roleDesc.trim() || undefined,
          permissions: perms,
        });
        addToast(t("roles.created"), "success");
      }
      setEditorOpen(false);
      setEditingRole(null);
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("roles.errSave"), "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /**
   * A role that employees are still using cannot be deleted, and saying so is a business
   * explanation rather than a raw failure. Otherwise the owner confirms in the app's own
   * dialog, so the wording and the button order follow the language.
   */
  function handleDelete(role: Role) {
    if (role.isSystem) return;
    const count = memberCounts[role.id] ?? 0;
    if (count > 0) { addToast(t("roles.deleteBlocked", { count }), "error"); return; }
    setDeleteTarget(role);
  }

  async function confirmDelete() {
    if (deletingRef.current || !deleteTarget) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await rolesStore.deleteRole(deleteTarget.id);
      addToast(t("roles.deleted"), "success");
      if (editingRole?.id === deleteTarget.id) {
        setEditorOpen(false);
        setEditingRole(null);
      }
      setDeleteTarget(null);
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;

  const canDelete = Boolean(editingRole && !editingRole.isSystem);

  return (
    <div className="flex flex-col w-full min-h-full pb-20" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />
      <NavHeader title={t("settings.rolesAccess")} />

      <div className="flex-1 px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {rolesStore.ready ? t("roles.count", { count: rolesStore.roles.length }) : ""}
          </p>
          <button
            onClick={startCreate}
            data-testid="role-new"
            className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <Plus size={14} /> {t("roles.new")}
          </button>
        </div>

        {!rolesStore.ready && <SkeletonList rows={3} />}
        {rolesStore.ready && (
          <ListCard>
            {rolesStore.roles.map((role) => {
              const count = memberCounts[role.id] ?? 0;
              const areas = roleAreas[role.id] ?? [];
              return (
                <ListRow
                  key={role.id}
                  onClick={() => startEdit(role)}
                  testId={`role-${role.id}`}
                  title={role.name}
                  qualifier={role.isSystem ? t("roles.builtIn") : undefined}
                  /* One fact per line: what the role is for, then what it opens. Three facts
                     joined by dashes on one line read as a paragraph in a row. */
                  description={role.description || undefined}
                  meta={areas.length ? areas.map(areaLabel).join(" · ") : t("roles.employees", { count })}
                  trailing={
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                        {t("roles.employees", { count })}
                      </span>
                      <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
                    </div>
                  }
                />
              );
            })}
          </ListCard>
        )}
      </div>

      {/* ── The editor ─────────────────────────────────────────────────────────── */}
      <Sheet
        open={editorOpen}
        title={editingRole ? t("roles.edit") : t("roles.new")}
        onClose={closeEditor}
        actionIcon={canDelete ? Trash2 : undefined}
        actionLabel={t("roles.deleteAction")}
        onAction={canDelete ? () => handleDelete(editingRole!) : undefined}
        maxHeight="90vh"
      >
        <div className="px-4 flex flex-col gap-4">
          <div>
            <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              {t("roles.name")}
            </p>
            <input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder={t("roles.nameHint")}
              data-testid="role-name"
              autoFocus={!editingRole}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
              style={fieldStyle}
            />
          </div>

          <div>
            <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              {t("roles.description")}
            </p>
            <input
              value={roleDesc}
              onChange={(e) => setRoleDesc(e.target.value)}
              placeholder={t("roles.descriptionHint")}
              data-testid="role-description"
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
              style={fieldStyle}
            />
          </div>

          {/* The heading row carries the one control that clears or grants everything, the
              way the reference does — above the groups, not inside one of them. */}
          <div className="flex items-center justify-between">
            <p className="text-11 font-medium" style={{ color: "var(--text-secondary)" }}>
              {t("roles.access")}
            </p>
            <button
              type="button"
              onClick={selectAll.toggleAll}
              data-testid="role-select-all"
              className="text-12 font-semibold underline underline-offset-2"
              style={{ color: "var(--brand-dark)" }}
            >
              {selectAll.allSelected ? t("roles.clearAll") : t("roles.selectAll")}
            </button>
          </div>
        </div>

        {permsState === "error" ? (
          <div className="px-4 py-4">
            <p className="text-xs" style={{ color: "var(--error)" }} data-testid="role-perms-error">
              {t("access.roleUnavailable")}
            </p>
            {editingRole && (
              <button
                onClick={() => {
                  setPermsState("loading");
                  void loadPerms(editingRole.id);
                }}
                className="text-11 font-bold mt-2"
                style={{ color: "var(--brand)" }}
              >
                {t("common.retry")}
              </button>
            )}
          </div>
        ) : permsState === "ready" ? (
          <PermissionChecklist value={selectedPerms} onChange={setSelectedPerms} />
        ) : (
          <div className="px-4 py-4" role="status" aria-busy="true">
            <span className="sr-only">{t("access.loadingRole")}</span>
            <SkeletonList rows={3} bare />
          </div>
        )}

        <div className="px-4 pt-4 flex flex-col gap-2">
          {nameError && (
            <p className="text-xs" style={{ color: "var(--error)" }} data-testid="role-error">{nameError}</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            data-testid="role-save"
            className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {saving ? t("common.saving") : editingRole ? t("roles.update") : t("roles.create")}
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("roles.deleteConfirm")}
        message={t("roles.deleteHint", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("roles.deleteAction")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}
