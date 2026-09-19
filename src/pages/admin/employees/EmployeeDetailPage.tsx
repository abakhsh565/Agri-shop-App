import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useEmployeesStore } from "@/stores/employeesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { supabase } from "@/lib/supabase";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { pkToday, pkDateFromISO } from "@/lib/pkDate";
import { useCurrentTime } from "@/lib/useCurrentTime";
import {
  Phone, Briefcase, Hash, ShieldCheck, UserX, UserCheck,
  TrendingUp, ShoppingCart, Users, Calendar, ChevronRight,
  Eye, Package, Settings, ChevronDown, Check, X, Building2,
} from "lucide-react";
import type { Sale, MembershipRole, PermissionCode } from "@/types";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

// Permission modules grouped for the UI
const PERMISSION_MODULES = [
  { module: "customers", label: "Customers", icon: Users },
  { module: "products", label: "Products", icon: Package },
  { module: "sales", label: "Sales", icon: ShoppingCart },
  { module: "returns", label: "Returns", icon: Package },
  { module: "purchases", label: "Purchases", icon: Package },
  { module: "payments", label: "Payments", icon: Package },
  { module: "inventory", label: "Inventory", icon: Package },
  { module: "companies", label: "Suppliers", icon: Building2 },
  { module: "reports", label: "Reports", icon: TrendingUp },
  { module: "employees", label: "Employees", icon: Users },
  { module: "settings", label: "Settings", icon: Settings },
  { module: "activity", label: "Activity", icon: Eye },
  { module: "notifications", label: "Notifications", icon: Eye },
  { module: "alerts", label: "Alerts", icon: Eye },
];

const ROLE_OPTIONS: { value: MembershipRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Full access to everything" },
  { value: "admin", label: "Admin", description: "Manage all operations" },
  { value: "employee", label: "Employee", description: "Assigned role access" },
];

export default function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const setActiveAction = useEmployeesStore((s) => s.setActive);
  const updateAccess = useEmployeesStore((s) => s.updateAccess);
  const loadEmpPerms = useEmployeesStore((s) => s.loadEmployeePermissions);
  const getEmployeeAccess = useEmployeesStore((s) => s.getEmployeeAccess);
  const sales = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);
  const permissionsStore = usePermissionsStore();
  const rolesStore = useRolesStore();
  const now = useCurrentTime();

  const emp = employees.find((e) => e.id === employeeId);

  // Permission editing state
  const [showPermEditor, setShowPermEditor] = useState(false);
  const [editRole, setEditRole] = useState<MembershipRole>("employee");
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [roleDefaults, setRoleDefaults] = useState<Set<string>>(new Set());
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [editBranchScope, setEditBranchScope] = useState<string[] | null>(null);
  const [empPerms, setEmpPerms] = useState<string[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Load permissions and branches on mount
  useEffect(() => {
    permissionsStore.load();
    rolesStore.load();
    // Load branches
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => {
      setBranches((data as any[]) ?? []);
    });
  }, []);

  // Load employee's current permissions when emp changes
  useEffect(() => {
    if (emp && employeeId) {
      getEmployeeAccess(employeeId).then((access) => {
        setEditRole(access.membershipRole);
        setEditRoleId(access.roleId);
        setEditBranchScope(access.branchScope);
        setRoleDefaults(new Set(access.defaults));
        setEmpPerms(access.effective);
        setEditPerms(new Set(access.effective));
      });
    }
  }, [emp?.id]);

  if (!emp) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title="Employee" />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Employee not found</p>
      </div>
    </div>
  );

  const empSales = sales.filter((s: Sale) => !s.isVoided && (s.employeeId === emp.id || s.employeeName === emp.name));
  const recentSales = [...empSales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const todayStr = pkToday();
  const totalRevenue = empSales.reduce((sum, x) => sum + x.totalAmount, 0);
  const totalTransactions = empSales.length;
  const todaySales = empSales.filter(s => pkDateFromISO(s.createdAt) === todayStr);
  const todayRevenue = todaySales.reduce((sum, x) => sum + x.totalAmount, 0);
  const todayTransactions = todaySales.length;
  const totalItems = empSales.reduce((sum, s) => sum + s.items.reduce((isum, it) => isum + it.qty, 0), 0);
  const customerIds = [...new Set(empSales.map(s => s.customerId).filter(Boolean))];
  const uniqueCustomers = customerIds.map(id => customers.find(c => c.id === id)).filter(Boolean);

  const initials = emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const roleLabel = emp.membershipRole === "owner" ? "Owner" : emp.membershipRole === "admin" ? "Admin" : "Employee";
  const isActive = emp.isActive;

  // Effective access = role defaults + employee exceptions. Keep the two
  // visibly separate so an admin can always tell what came from the role and
  // what was changed for this one person.
  const effectiveSet = new Set(empPerms);
  const addedCount = permissionsStore.permissions.filter(
    (p) => effectiveSet.has(p.code) && !roleDefaults.has(p.code),
  ).length;
  const removedCount = permissionsStore.permissions.filter(
    (p) => !effectiveSet.has(p.code) && roleDefaults.has(p.code),
  ).length;
  const roleTemplateName = editRoleId
    ? rolesStore.roles.find((r) => r.id === editRoleId)?.name ?? "Custom profile"
    : "No role profile";
  const overrideCount = addedCount + removedCount;

  // Classify a single permission so the editor can label it.
  function permState(code: string): "inherited" | "added" | "removed" | "none" {
    const inherited = roleDefaults.has(code);
    const effective = editPerms.has(code);
    if (inherited && effective) return "inherited";
    if (!inherited && effective) return "added";
    if (inherited && !effective) return "removed";
    return "none";
  }

  const PERM_STATE_STYLE: Record<string, { bg: string; fg: string; hint: string }> = {
    inherited: { bg: "var(--brand)", fg: "#0a0a0a", hint: "Inherited from role" },
    added: { bg: "#3b82f6", fg: "#ffffff", hint: "Added for this employee" },
    removed: { bg: "rgba(239,68,68,0.18)", fg: "#ef4444", hint: "Removed for this employee" },
    none: { bg: "var(--surface)", fg: "var(--text-secondary)", hint: "Not granted" },
  };

  async function resetToRoleDefaults() {
    if (!employeeId) return;
    setSaving(true);
    try {
      await updateAccess(employeeId, { resetOverrides: true });
      const fresh = await getEmployeeAccess(employeeId);
      setRoleDefaults(new Set(fresh.defaults));
      setEmpPerms(fresh.effective);
      setEditPerms(new Set(fresh.effective));
      addToast(`${emp!.name} now uses only their role access`, "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Could not reset access", "error");
    } finally {
      setSaving(false);
    }
  }
  const pl = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

  // Save role/permission/branch changes
  async function saveAccessChanges() {
    if (!employeeId) return;
    setSaving(true);
    try {
      const overrides: Record<string, boolean> = {};
      for (const permission of permissionsStore.permissions) {
        const effective = editPerms.has(permission.code);
        const inherited = roleDefaults.has(permission.code);
        if (effective !== inherited) overrides[permission.code] = effective;
      }
      await updateAccess(employeeId, {
        membershipRole: editRole,
        roleId: editRoleId,
        overrides: editRole === "owner" ? {} : overrides,
        branchScope: editBranchScope,
      });
      addToast("Employee access updated", "success");
      setShowPermEditor(false);
      // Reload permissions display
      const fresh = await getEmployeeAccess(employeeId);
      setRoleDefaults(new Set(fresh.defaults));
      setEmpPerms(fresh.effective);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Failed to update access", "error");
    } finally {
      setSaving(false);
    }
  }

  function togglePerm(code: string) {
    setEditPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModulePerms(module: string) {
    const modulePerms = permissionsStore.getByModule(module);
    const allSelected = modulePerms.every((p) => editPerms.has(p.code));
    setEditPerms((prev) => {
      const next = new Set(prev);
      for (const p of modulePerms) {
        if (allSelected) next.delete(p.code);
        else next.add(p.code);
      }
      return next;
    });
  }

  async function setActive(next: boolean) {
    try {
      await setActiveAction(emp!.id, next, user?.id);
      addToast(
        next ? `${emp!.name} reactivated` : `${emp!.name} deactivated — historical sales are preserved`,
        next ? "success" : "info",
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Could not update employee", "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full pb-20"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={emp.name} />

      {/* Avatar + name card */}
      <div className="px-4 pt-3 animate-fade-in-up">
        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}
        >
          {emp.photoUrl ? (
            <img src={emp.photoUrl} alt={emp.name} className="w-16 h-16 rounded-full object-cover shrink-0" />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{emp.jobTitle ?? roleLabel}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                style={isActive
                  ? { background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }
                  : { background: "#fee2e2", color: "#dc2626" }
                }
              >
                {isActive ? t("employees.active") : t("employees.deactivated")}
              </span>
              <span
                className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-secondary)" }}
              >
                {roleLabel}
              </span>
              {emp.membershipRole !== "owner" && empPerms.length > 0 && (
                <span
                  className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                  style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}
                >
                  {empPerms.length} permissions
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contact & Details */}
      <div className="px-4 pt-4 animate-fade-in-up delay-75">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Contact & Details
        </p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
          {[
            { icon: Phone, label: "Phone", value: emp.phone },
            { icon: Hash, label: "Employee #", value: emp.employeeNumber ?? "—" },
            { icon: ShieldCheck, label: "Role", value: roleLabel },
          ].map(({ icon: Icon, label, value }, i, arr) => (
            <div
              key={label}
              className="flex items-center justify-between px-4 py-3.5"
              style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="flex items-center gap-3">
                <Icon size={16} style={{ color: "var(--brand)" }} />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Access Management — only for admin viewing non-owner employees */}
      {user?.membershipRole === "owner" && !emp.isOriginalOwner && (
        <div className="px-4 pt-5 animate-fade-in-up delay-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
              Access Management
            </p>
            <button
              onClick={() => setShowPermEditor(!showPermEditor)}
              className="text-xs font-semibold flex items-center gap-1"
              style={{ color: "var(--brand)" }}
            >
              <Settings size={12} />
              {showPermEditor ? "Close" : "Edit Access"}
            </button>
          </div>

          {showPermEditor ? (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
              {/* Role selector */}
              <div className="px-4 py-3" style={{ background: "var(--surface-2)" }}>
                <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>ROLE</p>
                <div className="flex gap-2">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setEditRole(opt.value)}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        background: editRole === opt.value ? "var(--brand)" : "var(--surface)",
                        color: editRole === opt.value ? "#0a0a0a" : "var(--text-secondary)",
                        border: `1px solid ${editRole === opt.value ? "var(--brand)" : "var(--divider)"}`,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {ROLE_OPTIONS.find((r) => r.value === editRole)?.description}
                </p>
                {editRole !== "owner" && rolesStore.roles.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-bold mb-1" style={{ color: "var(--text-secondary)" }}>ACCESS PROFILE</p>
                    <select
                      value={editRoleId ?? ""}
                      onChange={(e) => {
                        const nextId = e.target.value || null;
                        setEditRoleId(nextId);
                        if (nextId) rolesStore.getRolePermissions(nextId).then((perms) => {
                          setRoleDefaults(new Set(perms));
                          setEditPerms(new Set(perms));
                        });
                      }}
                      className="w-full h-10 rounded-lg px-3 text-xs outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
                    >
                      <option value="">No role template</option>
                      {rolesStore.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <p className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>Role defaults update automatically when the role is edited.</p>
                  </div>
                )}
              </div>

              {/* Branch scope (if branches exist) */}
              {branches.length > 0 && (
                <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>BRANCH SCOPE</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => setEditBranchScope(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{
                        background: editBranchScope === null ? "var(--brand)" : "var(--surface)",
                        color: editBranchScope === null ? "#0a0a0a" : "var(--text-secondary)",
                        border: `1px solid ${editBranchScope === null ? "var(--brand)" : "var(--divider)"}`,
                      }}
                    >
                      All Branches
                    </button>
                    {branches.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => {
                          setEditBranchScope((prev) => {
                            if (!prev) return [b.id];
                            if (prev.includes(b.id)) return prev.filter((id) => id !== b.id);
                            return [...prev, b.id];
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{
                          background: editBranchScope?.includes(b.id) ? "var(--brand)" : "var(--surface)",
                          color: editBranchScope?.includes(b.id) ? "#0a0a0a" : "var(--text-secondary)",
                          border: `1px solid ${editBranchScope?.includes(b.id) ? "var(--brand)" : "var(--divider)"}`,
                        }}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Permissions — only for non-owner roles */}
              {editRole !== "owner" && (
                <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>PERMISSIONS</p>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {PERMISSION_MODULES.map(({ module: mod, label, icon: ModIcon }) => {
                      const modulePerms = permissionsStore.getByModule(mod);
                      if (modulePerms.length === 0) return null;
                      const selectedCount = modulePerms.filter((p) => editPerms.has(p.code)).length;
                      const allSelected = selectedCount === modulePerms.length;
                      return (
                        <div key={mod}>
                          <button
                            onClick={() => toggleModulePerms(mod)}
                            className="flex items-center justify-between w-full py-2 px-3 rounded-lg"
                            style={{
                              background: allSelected ? "rgba(132,204,22,0.1)" : "var(--surface)",
                              border: "1px solid var(--divider)",
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <ModIcon size={14} style={{ color: allSelected ? "var(--brand)" : "var(--text-secondary)" }} />
                              <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                                {selectedCount}/{modulePerms.length}
                              </span>
                              {allSelected && <Check size={12} style={{ color: "var(--brand)" }} />}
                            </div>
                          </button>
                          {/* Individual permissions within module */}
                          {selectedCount > 0 && selectedCount < modulePerms.length && (
                            <div className="flex flex-wrap gap-1 mt-1 ps-6">
                              {modulePerms.map((p) => {
                                const state = permState(p.code);
                                const s = PERM_STATE_STYLE[state];
                                return (
                                  <button
                                    key={p.code}
                                    onClick={() => togglePerm(p.code)}
                                    title={s.hint}
                                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                    style={{
                                      background: s.bg,
                                      color: s.fg,
                                      border: state === "removed" ? "1px solid #ef4444" : "1px solid var(--divider)",
                                    }}
                                  >
                                    {p.action}
                                    {state === "added" ? " +" : state === "removed" ? " −" : ""}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Legend + Save */}
              <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  {(["inherited", "added", "removed"] as const).map((k) => (
                    <span key={k} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: PERM_STATE_STYLE[k].bg, border: `1px solid ${PERM_STATE_STYLE[k].fg}` }}
                      />
                      {PERM_STATE_STYLE[k].hint}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] mb-3" style={{ color: "var(--text-secondary)" }}>
                  {roleTemplateName}: {roleDefaults.size} default permission(s)
                  {overrideCount > 0 ? ` · ${addedCount} added, ${removedCount} removed for ${emp.name}` : " · no employee-specific changes"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={resetToRoleDefaults}
                    disabled={saving || overrideCount === 0}
                    className="flex-1 h-10 rounded-xl font-bold text-xs"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--divider)",
                      color: overrideCount === 0 ? "var(--text-secondary)" : "var(--text-primary)",
                      opacity: saving || overrideCount === 0 ? 0.6 : 1,
                    }}
                  >
                    Reset to Role Defaults
                  </button>
                  <button
                    onClick={saveAccessChanges}
                    disabled={saving}
                    className="flex-1 h-10 rounded-xl font-bold text-sm"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    {saving ? "Saving..." : "Save Access Changes"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Summary view when not editing */
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Role</span>
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{roleLabel}</span>
              </div>
              {emp.membershipRole !== "owner" && (
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Access profile</span>
                  <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{roleTemplateName}</span>
                </div>
              )}
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Branch</span>
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {emp.branchScope ? `${emp.branchScope.length} branch(es)` : "All branches"}
                </span>
              </div>
              {emp.membershipRole !== "owner" && (
                <>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
                    <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Effective permissions</span>
                    <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {empPerms.length} granted
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
                    <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Employee exceptions</span>
                    <span className="text-sm font-bold" style={{ color: overrideCount > 0 ? "#f59e0b" : "var(--text-primary)" }}>
                      {overrideCount > 0 ? `${addedCount} added · ${removedCount} removed` : "None"}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Performance Stats */}
      <div className="px-4 pt-5 animate-fade-in-up delay-[125ms]">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Performance Overview
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: TrendingUp, label: "Total Revenue", value: formatCurrency(totalRevenue), color: "var(--brand)" },
            { icon: ShoppingCart, label: "Total Sales", value: pl(totalTransactions, "sale", "sales"), color: "#3b82f6" },
            { icon: Package, label: "Items Sold", value: pl(totalItems, "item", "items"), color: "#8b5cf6" },
            { icon: Users, label: "Customers", value: pl(uniqueCustomers.length, "customer", "customers"), color: "#06b6d4" },
            { icon: Calendar, label: "Today", value: `${pl(todayTransactions, "sale", "sales")} · ${formatCurrency(todayRevenue)}`, color: "#f59e0b" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div
              key={label}
              className="rounded-xl p-3.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `${color}20` }}>
                  <Icon size={12} style={{ color }} />
                </div>
                <span className="text-[10px] font-medium" style={{ color: "var(--text-secondary)" }}>{label}</span>
              </div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Sales */}
      <div className="px-4 pt-5 animate-fade-in-up delay-[150ms]">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            Recent Sales ({empSales.length})
          </p>
          {empSales.length > 5 && (
            <button
              onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id } })}
              className="text-xs font-semibold flex items-center gap-1"
              style={{ color: "var(--brand)" }}
            >
              View All <ChevronRight size={12} />
            </button>
          )}
        </div>
        {recentSales.length === 0 ? (
          <div className="rounded-xl p-6 text-center" style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}>
            <ShoppingCart size={20} className="mx-auto mb-2" style={{ color: "var(--text-secondary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No sales yet</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {[...empSales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5).map((sale, i) => (
              <button
                key={sale.id}
                onClick={() => navigate(`/admin/sales/${sale.id}`)}
                className="flex items-center justify-between px-4 py-3 w-full text-start transition-opacity active:opacity-70"
                style={{ borderBottom: i < 4 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatSmartDateTime(sale.createdAt, now, t)}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                    {sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.paymentType === "full" ? "Paid" : "Credit"}
                  </p>
                </div>
                <span className="text-[13px] font-bold shrink-0 ms-2" style={{ color: "var(--text-primary)" }}>
                  {formatCurrency(sale.totalAmount)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-4 pt-5 animate-fade-in-up delay-[175ms]">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Actions
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id } })}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Eye size={14} />
            View All Sales
          </button>
          <button
            onClick={() => window.open(`tel:${emp.phone}`, "_self")}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Phone size={14} />
            Call Employee
          </button>
        </div>
      </div>

      {/* Deactivate / reactivate */}
      {!emp.isOriginalOwner && (
        <div className="px-4 pt-5 pb-6 animate-fade-in-up delay-[200ms]">
          {isActive ? (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ border: "1.5px solid var(--error)", color: "var(--error)", background: "transparent" }}
              onClick={() => {
                if (confirm(`Deactivate ${emp.name}? They will lose access, but all their past sales stay on record.`)) {
                  setActive(false);
                }
              }}
            >
              <UserX size={15} />
              Deactivate Employee
            </button>
          ) : (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
              onClick={() => setActive(true)}
            >
              <UserCheck size={15} />
              Reactivate Employee
            </button>
          )}
        </div>
      )}
    </div>
  );
}
