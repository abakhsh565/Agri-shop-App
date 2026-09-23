import { useState, useEffect, useRef } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { Plus, Edit3, Trash2, Users, Shield, Check } from "lucide-react";
import type { Role } from "@/types";

/**
 * Roles — reusable access templates.
 *
 * The owner picks a role when adding an employee, so each role is described by
 * what the employee does and which business areas it opens. The area/action
 * wording comes from the shared permission labels, never from permission codes.
 */
export default function RolesAccessPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const { areaLabel, actionLabel, areaIcon } = usePermissionLabels();
  const { addToast } = useUIStore();
  const rolesStore = useRolesStore();
  const permissionsStore = usePermissionsStore();

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  // A ref for the same reason as the employee screen: React batches, so two clicks in
  // one task would both read the pre-render value of `deleting` and both fire.
  const deletingRef = useRef(false);
  const [roleAreas, setRoleAreas] = useState<Record<string, string[]>>({});
  const [nameError, setNameError] = useState("");

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

  const allPerms = permissionsStore.permissions;

  function startCreate() {
    setIsCreating(true);
    setEditingRole(null);
    setRoleName("");
    setRoleDesc("");
    setSelectedPerms(new Set());
    setNameError("");
  }

  function startEdit(role: Role) {
    setEditingRole(role);
    setIsCreating(false);
    setRoleName(role.name);
    setRoleDesc(role.description ?? "");
    setNameError("");
    rolesStore.getRolePermissions(role.id).then((perms) => {
      setSelectedPerms(new Set(perms));
    });
  }

  function togglePerm(code: string) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleArea(areaCode: string) {
    const areaPerms = allPerms.filter((p) => p.module === areaCode);
    const allSelected = areaPerms.every((p) => selectedPerms.has(p.code));
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const p of areaPerms) {
        if (allSelected) next.delete(p.code);
        else next.add(p.code);
      }
      return next;
    });
  }

  async function handleSave() {
    setNameError("");
    if (!roleName.trim()) { setNameError(t("roles.errName")); return; }
    setSaving(true);
    try {
      const perms = Array.from(selectedPerms);
      if (editingRole) {
        await rolesStore.updateRole(editingRole.id, { name: roleName.trim(), description: roleDesc.trim() || undefined, permissions: perms });
        addToast(t("roles.updated"), "success");
      } else {
        await rolesStore.createRole({ name: roleName.trim(), description: roleDesc.trim() || undefined, permissions: perms });
        addToast(t("roles.created"), "success");
      }
      setEditingRole(null);
      setIsCreating(false);
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("roles.errSave"), "error");
    } finally {
      setSaving(false);
    }
  }

  /**
   * A role that employees are still using cannot be deleted, and saying so is a
   * business explanation rather than a raw failure. Otherwise the owner confirms in
   * the app's own dialog, so the wording and the button order follow the language.
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
      setDeleteTarget(null);
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const fieldStyle = { background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" } as const;

  // Role editor / creator
  if (isCreating || editingRole) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
        <StatusBar />
        <NavHeader title={editingRole ? t("roles.edit") : t("roles.new")} />
        <div className="flex-1 flex flex-col p-4 gap-4">
          <div>
            <p className="text-11 font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("roles.name")} *</p>
            <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder={t("roles.nameHint")} className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} autoFocus />
          </div>
          <div>
            <p className="text-11 font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("roles.description")}</p>
            <input value={roleDesc} onChange={(e) => setRoleDesc(e.target.value)} placeholder={t("roles.descriptionHint")} className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>
          <div>
            <p className="text-11 font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("roles.access")}</p>
            <div className="space-y-3">
              {[...new Set(allPerms.map((p) => p.module))].map((mod) => {
                const areaPerms = allPerms.filter((p) => p.module === mod);
                const selectedCount = areaPerms.filter((p) => selectedPerms.has(p.code)).length;
                const allSelected = selectedCount === areaPerms.length && selectedCount > 0;
                const someSelected = selectedCount > 0;
                const AreaIcon = areaIcon(mod);
                return (
                  <div key={mod}>
                    <button onClick={() => toggleArea(mod)} className="flex items-center justify-between w-full py-2.5 px-3 rounded-[var(--radius-tile)]" style={{ background: allSelected ? "rgba(132,204,22,0.1)" : "var(--surface)", border: `1px solid ${someSelected ? "var(--brand)" : "var(--divider)"}` }}>
                      <div className="flex items-center gap-2">
                        <AreaIcon size={17} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{areaLabel(mod)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-10" style={{ color: "var(--text-secondary)" }}>{selectedCount}/{areaPerms.length}</span>
                        {allSelected && <Check size={14} style={{ color: "var(--brand)" }} />}
                      </div>
                    </button>
                    {someSelected && !allSelected && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 ps-6">
                        {areaPerms.map((p) => (
                          <button key={p.code} onClick={() => togglePerm(p.code)} className="text-11 px-2.5 py-1 rounded-full font-medium" style={{ background: selectedPerms.has(p.code) ? "var(--brand)" : "var(--surface)", color: selectedPerms.has(p.code) ? "#0a0a0a" : "var(--text-secondary)", border: "1px solid var(--divider)" }}>
                            {actionLabel(p.action)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {nameError && <p className="text-xs" style={{ color: "var(--error)" }}>{nameError}</p>}
        </div>
        <div className="p-4 pb-6 flex gap-3">
          <button onClick={() => { setEditingRole(null); setIsCreating(false); }} className="h-12 px-6 rounded-full font-bold text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}>{t("common.cancel")}</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 h-12 rounded-full font-bold text-sm" style={{ background: "var(--brand)", color: "#0a0a0a", opacity: saving ? 0.6 : 1 }}>
            {saving ? t("common.saving") : editingRole ? t("common.save") : t("roles.create")}
          </button>
        </div>
      </div>
    );
  }

  // Roles list
  return (
    <div className="flex flex-col w-full min-h-full pb-20" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />
      <NavHeader title={t("settings.rolesAccess")} />
      <div className="flex-1 p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{rolesStore.ready && t("roles.count", { count: rolesStore.roles.length })}</p>
          <button onClick={startCreate} className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
            <Plus size={14} /> {t("roles.new")}
          </button>
        </div>
        <div className="space-y-3">
          {!rolesStore.ready && <SkeletonList rows={3} />}
          {rolesStore.ready && rolesStore.roles.map((role) => {
            const count = memberCounts[role.id] ?? 0;
            const areas = roleAreas[role.id] ?? [];
            return (
              <div key={role.id} className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield size={16} style={{ color: "var(--brand)" }} />
                      <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{role.name}</p>
                      {role.isSystem && <span className="text-9 px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{t("roles.builtIn")}</span>}
                    </div>
                    {role.description && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{role.description}</p>}
                    {areas.length > 0 && (
                      <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                        {areas.map(areaLabel).join(", ")}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-10 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        <Users size={10} /> {t("roles.employees", { count })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(role)} className="p-2 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)" }}>
                      <Edit3 size={14} style={{ color: "var(--text-secondary)" }} />
                    </button>
                    {!role.isSystem && (
                      <button onClick={() => handleDelete(role)} className="p-2 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)" }}>
                        <Trash2 size={14} style={{ color: "var(--error)" }} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
