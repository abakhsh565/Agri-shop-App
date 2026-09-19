import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { Plus, ChevronRight, Edit3, Trash2, Users, Shield, X, Check } from "lucide-react";
import type { Role } from "@/types";

// Business area grouping for the UI
const BUSINESS_AREAS = [
  { code: "sales", label: "Sales", icon: "🛒" },
  { code: "customers", label: "Customers", icon: "👥" },
  { code: "products", label: "Products", icon: "📦" },
  { code: "inventory", label: "Inventory", icon: "📊" },
  { code: "purchases", label: "Purchases", icon: "🏪" },
  { code: "payments", label: "Payments", icon: "💰" },
  { code: "companies", label: "Suppliers", icon: "🏭" },
  { code: "returns", label: "Returns", icon: "↩️" },
  { code: "employees", label: "Employees", icon: "👤" },
  { code: "reports", label: "Reports", icon: "📈" },
  { code: "settings", label: "Settings", icon: "⚙️" },
  { code: "activity", label: "Activity", icon: "📋" },
  { code: "notifications", label: "Notifications", icon: "🔔" },
  { code: "alerts", label: "Alerts", icon: "🚨" },
];

// Human-readable action labels
const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  void: "Void",
  payments: "Record Payments",
  adjust: "Adjust Stock",
  manage: "Manage",
};

export default function RolesAccessPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
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

  useEffect(() => {
    rolesStore.load();
    permissionsStore.load();
  }, []);

  // Load member counts
  useEffect(() => {
    if (rolesStore.roles.length > 0) {
      rolesStore.roles.forEach(async (role) => {
        const count = await rolesStore.getRoleMemberCount(role.id);
        setMemberCounts((prev) => ({ ...prev, [role.id]: count }));
      });
    }
  }, [rolesStore.roles.length]);

  const allPerms = permissionsStore.permissions;

  function startCreate() {
    setIsCreating(true);
    setEditingRole(null);
    setRoleName("");
    setRoleDesc("");
    setSelectedPerms(new Set());
  }

  function startEdit(role: Role) {
    setEditingRole(role);
    setIsCreating(false);
    setRoleName(role.name);
    setRoleDesc(role.description ?? "");
    // Load role's permissions
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
    if (!roleName.trim()) { addToast("Role name is required", "error"); return; }
    setSaving(true);
    try {
      const perms = Array.from(selectedPerms);
      if (editingRole) {
        await rolesStore.updateRole(editingRole.id, { name: roleName.trim(), description: roleDesc.trim() || undefined, permissions: perms });
        addToast(`Role "${roleName}" updated`, "success");
      } else {
        await rolesStore.createRole({ name: roleName.trim(), description: roleDesc.trim() || undefined, permissions: perms });
        addToast(`Role "${roleName}" created`, "success");
      }
      setEditingRole(null);
      setIsCreating(false);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Failed to save role", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: Role) {
    if (role.isSystem) { addToast("Cannot delete system roles", "error"); return; }
    const count = memberCounts[role.id] ?? 0;
    if (count > 0) { addToast(`Cannot delete "${role.name}" — ${count} employee(s) use it`, "error"); return; }
    if (!confirm(`Delete role "${role.name}"?`)) return;
    try {
      await rolesStore.deleteRole(role.id);
      addToast(`Role "${role.name}" deleted`, "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Failed to delete", "error");
    }
  }

  const fieldStyle = { background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" } as const;

  // Role editor / creator
  if (isCreating || editingRole) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
        <StatusBar />
        <NavHeader title={editingRole ? "Edit Role" : "Create Role"} />
        <div className="flex-1 flex flex-col p-4 gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>Role Name *</p>
            <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Sales Manager" className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} autoFocus />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>Description <span style={{ opacity: 0.6 }}>(optional)</span></p>
            <input value={roleDesc} onChange={(e) => setRoleDesc(e.target.value)} placeholder="What this role can do" className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>Access Permissions</p>
            <div className="space-y-3">
              {BUSINESS_AREAS.map(({ code, label, icon }) => {
                const areaPerms = allPerms.filter((p) => p.module === code);
                if (areaPerms.length === 0) return null;
                const selectedCount = areaPerms.filter((p) => selectedPerms.has(p.code)).length;
                const allSelected = selectedCount === areaPerms.length;
                const someSelected = selectedCount > 0;
                return (
                  <div key={code}>
                    <button onClick={() => toggleArea(code)} className="flex items-center justify-between w-full py-2.5 px-3 rounded-xl" style={{ background: allSelected ? "rgba(132,204,22,0.1)" : "var(--surface)", border: `1px solid ${someSelected ? "var(--brand)" : "var(--divider)"}` }}>
                      <div className="flex items-center gap-2">
                        <span className="text-base">{icon}</span>
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{selectedCount}/{areaPerms.length}</span>
                        {allSelected && <Check size={14} style={{ color: "var(--brand)" }} />}
                      </div>
                    </button>
                    {someSelected && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 ps-6">
                        {areaPerms.map((p) => (
                          <button key={p.code} onClick={() => togglePerm(p.code)} className="text-[11px] px-2.5 py-1 rounded-full font-medium" style={{ background: selectedPerms.has(p.code) ? "var(--brand)" : "var(--surface)", color: selectedPerms.has(p.code) ? "#0a0a0a" : "var(--text-secondary)", border: "1px solid var(--divider)" }}>
                            {ACTION_LABELS[p.action] || p.action}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="p-4 pb-6 flex gap-3">
          <button onClick={() => { setEditingRole(null); setIsCreating(false); }} className="h-12 px-6 rounded-full font-bold text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 h-12 rounded-full font-bold text-sm" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
            {saving ? "Saving…" : editingRole ? "Update Role" : "Create Role"}
          </button>
        </div>
      </div>
    );
  }

  // Roles list
  return (
    <div className="flex flex-col w-full min-h-full pb-20" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />
      <NavHeader title="Roles & Access" />
      <div className="flex-1 p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{rolesStore.roles.length} roles configured</p>
          <button onClick={startCreate} className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
            <Plus size={14} /> New Role
          </button>
        </div>
        <div className="space-y-3">
          {rolesStore.roles.map((role) => {
            const count = memberCounts[role.id] ?? 0;
            const permCount = role.permissionCount ?? 0;
            return (
              <div key={role.id} className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield size={16} style={{ color: "var(--brand)" }} />
                      <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{role.name}</p>
                      {role.isSystem && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>System</span>}
                    </div>
                    {role.description && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{role.description}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        <Shield size={10} /> {permCount} permissions
                      </span>
                      <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        <Users size={10} /> {count} employee{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(role)} className="p-2 rounded-lg" style={{ background: "var(--surface-2)" }}>
                      <Edit3 size={14} style={{ color: "var(--text-secondary)" }} />
                    </button>
                    {!role.isSystem && (
                      <button onClick={() => handleDelete(role)} className="p-2 rounded-lg" style={{ background: "var(--surface-2)" }}>
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
    </div>
  );
}
