import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { applyOverrides, diffOverrides, overrideCount, overridesToStore } from "@/lib/accessModel";
import EmployeeAccessEditor from "@/components/admin/EmployeeAccessEditor";
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
  Phone, Hash, ShieldCheck, UserX, UserCheck, Clock,
  TrendingUp, ShoppingCart, Users, Calendar, ChevronRight,
  Eye,
} from "lucide-react";
import type { Sale, MembershipRole } from "@/types";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const { areaLabel } = usePermissionLabels();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const setActiveAction = useEmployeesStore((s) => s.setActive);
  const updateAccess = useEmployeesStore((s) => s.updateAccess);
  const getEmployeeAccess = useEmployeesStore((s) => s.getEmployeeAccess);
  const sales = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);
  const permissionsStore = usePermissionsStore();
  const rolesStore = useRolesStore();
  const now = useCurrentTime();

  const emp = employees.find((e) => e.id === employeeId);

  // Access editing state
  const [showPermEditor, setShowPermEditor] = useState(false);
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [roleDefaults, setRoleDefaults] = useState<Set<string>>(new Set());
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [editBranchScope, setEditBranchScope] = useState<string[] | null>(null);
  // The users list cannot carry the membership role, so the authoritative value
  // comes from the employee's membership via get_employee_access.
  const [empMembershipRole, setEmpMembershipRole] = useState<MembershipRole>("employee");
  const [empPerms, setEmpPerms] = useState<string[]>([]);
  // The employee's own exceptions, straight from user_permissions.
  const [storedOverrides, setStoredOverrides] = useState<Record<string, boolean>>({});
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Load permissions and branches on mount
  useEffect(() => {
    permissionsStore.load();
    rolesStore.load();
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => {
      setBranches((data as any[]) ?? []);
    });
  }, []);

  /**
   * Load the employee's access as configured: the role's defaults with their own
   * exceptions applied (see lib/accessModel). That is the model the database
   * documents, and the only form that is true in both membership states.
   *
   * get_employee_access also returns `effective` from the live permission
   * resolver, which is correct for authorization and returns nothing while an
   * invitation is still pending (every path requires status = 'active'). Showing
   * that here reported "this role has no access" for an employee whose role
   * carried 12 defaults.
   */
  function applyAccess(access: Awaited<ReturnType<typeof getEmployeeAccess>>) {
    const configured = applyOverrides(access.defaults, access.overrides);
    setRoleDefaults(new Set(access.defaults));
    setStoredOverrides(access.overrides);
    setEmpPerms([...configured]);
    setEditPerms(new Set(configured));
  }

  // Load this employee's current access
  useEffect(() => {
    if (emp && employeeId) {
      getEmployeeAccess(employeeId).then((access) => {
        setEmpMembershipRole(access.membershipRole);
        setEditRoleId(access.roleId);
        setEditBranchScope(access.branchScope);
        applyAccess(access);
      });
    }
  }, [emp?.id]);

  if (!emp) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title={t("admin.employees")} />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("empDetail.notFound")}</p>
      </div>
    </div>
  );

  // Attribution is strictly by employee id. sales.employee_id is NOT NULL, so the
  // old `|| s.employeeName === emp.name` fallback had no legitimate purpose and
  // credited one person's sales to any colleague sharing their name.
  const empSales = sales.filter((s: Sale) => !s.isVoided && s.employeeId === emp.id);
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
  const isActive = emp.isActive;
  // An invitation that has not been accepted yet: the person holds a membership
  // but every authorization path denies it until they sign in for the first time.
  const isInvited = emp.membershipStatus === "pending";
  const isOwner = empMembershipRole === "owner";
  const roleTemplateName = editRoleId
    ? rolesStore.roles.find((r) => r.id === editRoleId)?.name ?? t("empDetail.noRole")
    : t("empDetail.noRole");
  const canEditAccess = user?.membershipRole === "owner" && !emp.isOriginalOwner && !isOwner;

  // Access the employee actually has, in the shop owner's words.
  const effectiveSet = new Set(empPerms);
  const accessAreas = [...new Set(
    permissionsStore.permissions.filter((p) => effectiveSet.has(p.code))
      .map((p) => p.module),
  )];
  // "Changed" means the access above differs from the role — the current edit state
  // while editing, otherwise the access as loaded. Diffing the LIVE permission set is
  // deliberately not used: a pending membership is denied by authorization, which is
  // not a change the owner made.
  const storedCount = overrideCount(storedOverrides);
  const changeCount = overrideCount(diffOverrides(editPerms, roleDefaults));
  // Stored rows may include exceptions the role now covers on its own; they are kept
  // (see lib/accessModel) but they do not change the access, so they do not turn the
  // reset button into a lie either.
  const hasOverridesToClear = changeCount > 0 || storedCount > 0;

  const branchNames = editBranchScope === null
    ? t("addEmployee.allBranches")
    : branches.filter((b) => editBranchScope.includes(b.id)).map((b) => b.name).join(", ") || t("addEmployee.allBranches");

  async function resetToRoleDefaults() {
    if (!employeeId) return;
    setSaving(true);
    try {
      await updateAccess(employeeId, { roleId: editRoleId, resetOverrides: true });
      applyAccess(await getEmployeeAccess(employeeId));
      addToast(t("empDetail.roleOnlyDone", { name: emp!.name }), "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveAccessChanges() {
    if (!employeeId) return;
    setSaving(true);
    try {
      // The employee's exceptions relative to the SELECTED role, plus any stored
      // exception the role now covers on its own (a role change must not retire an
      // earlier decision, which is how the database resolves access).
      const overrides = overridesToStore(editPerms, roleDefaults, storedOverrides);
      await updateAccess(employeeId, {
        roleId: editRoleId,
        overrides,
        branchScope: editBranchScope,
      });
      addToast(t("empDetail.accessUpdated"), "success");
      setShowPermEditor(false);
      applyAccess(await getEmployeeAccess(employeeId));
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(next: boolean) {
    try {
      await setActiveAction(emp!.id, next, user?.id);
      // An invitation that has not been accepted is not an employment ending, so
      // it must not be reported as one.
      addToast(
        next
          ? t("empDetail.reactivated", { name: emp!.name })
          : isInvited
            ? t("empDetail.inviteCancelled", { name: emp!.name })
            : t("empDetail.deactivated", { name: emp!.name }),
        next ? "success" : "info",
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
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
              style={{ background: initBgColor(emp.name), color: "#0a0a0a" }}
            >
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                style={isActive
                  ? { background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }
                  : { background: "#fee2e2", color: "#dc2626" }
                }
              >
                {isInvited && isActive ? t("employees.invited") : isActive ? t("employees.active") : t("employees.deactivated")}
              </span>
              {isOwner && (
                <span
                  className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                  style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-secondary)" }}
                >
                  {t("settings.owner")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="px-4 pt-4 animate-fade-in-up delay-75">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("empDetail.contact")}
        </p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
          {[
            { icon: Phone, label: t("empDetail.phone"), value: emp.phone },
            { icon: Hash, label: t("empDetail.number"), value: emp.employeeNumber ?? "—" },
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

      {/* Job & access — what the employee does, where, and with what access */}
      <div className="px-4 pt-5 animate-fade-in-up delay-100">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            {t("empDetail.accessTitle")}
          </p>
          {canEditAccess && (
            <button
              onClick={() => setShowPermEditor(!showPermEditor)}
              className="text-xs font-semibold"
              style={{ color: "var(--brand)" }}
            >
              {showPermEditor ? t("common.cancel") : t("empDetail.customize")}
            </button>
          )}
        </div>

        {showPermEditor && canEditAccess ? (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {/* Role */}
            <div className="px-4 py-3" style={{ background: "var(--surface-2)" }}>
              <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("empDetail.roleSection")}
              </p>
              <div className="flex flex-col gap-2">
                {rolesStore.roles.map((r) => {
                  const selected = editRoleId === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => {
                        setEditRoleId(r.id);
                        rolesStore.getRolePermissions(r.id).then((perms) => {
                          setRoleDefaults(new Set(perms));
                          // A role supplies the defaults; it does not erase what the
                          // owner set for this person. New defaults + their existing
                          // exceptions, which is what the database resolves.
                          setEditPerms(applyOverrides(perms, storedOverrides));
                        });
                      }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-start"
                      style={{
                        background: selected ? "var(--brand)" : "var(--surface)",
                        color: selected ? "#0a0a0a" : "var(--text-primary)",
                        border: `1px solid ${selected ? "var(--brand)" : "var(--divider)"}`,
                      }}
                    >
                      <ShieldCheck size={14} />
                      <span className="text-xs font-semibold">{r.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] mt-2" style={{ color: "var(--text-secondary)" }}>{t("empDetail.roleHint")}</p>
            </div>

            {/* Where they can work */}
            {branches.length > 0 && (
              <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
                  {t("empDetail.whereSection")}
                </p>
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
                    {t("addEmployee.allBranches")}
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

            {/* Access */}
            <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
              <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("empDetail.access")}
              </p>
              <EmployeeAccessEditor roleDefaults={roleDefaults} value={editPerms} onChange={setEditPerms} />
              <p className="text-[10px] mt-2" style={{ color: "var(--text-secondary)" }}>
                {roleTemplateName}
                {changeCount > 0 ? ` · ${t("empDetail.changedFor", { name: emp.name })}` : ""}
              </p>
            </div>

            {/* Save */}
            <div className="px-4 py-3 flex gap-2" style={{ borderTop: "1px solid var(--divider)" }}>
              <button
                onClick={resetToRoleDefaults}
                disabled={saving || !hasOverridesToClear}
                className="flex-1 h-10 rounded-xl font-bold text-xs"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--divider)",
                  color: !hasOverridesToClear ? "var(--text-secondary)" : "var(--text-primary)",
                  opacity: saving || !hasOverridesToClear ? 0.6 : 1,
                }}
              >
                {t("empDetail.roleOnly")}
              </button>
              <button
                onClick={saveAccessChanges}
                disabled={saving}
                className="flex-1 h-10 rounded-xl font-bold text-sm"
                style={{ background: "var(--brand)", color: "#0a0a0a", opacity: saving ? 0.6 : 1 }}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("empDetail.role")}</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {isOwner ? t("empDetail.ownerFull") : roleTemplateName}
              </span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("empDetail.worksAt")}</span>
              <span className="text-sm font-bold text-end max-w-[60%]" style={{ color: "var(--text-primary)" }}>{branchNames}</span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderTop: "1px solid var(--divider)" }}>
              <span className="text-sm shrink-0" style={{ color: "var(--text-secondary)" }}>{t("empDetail.access")}</span>
              <span className="text-sm font-bold text-end" style={{ color: "var(--text-primary)" }}>
                {isOwner
                  ? t("empDetail.fullAccess")
                  : accessAreas.length > 0
                    ? accessAreas.map(areaLabel).join(", ")
                    : t("addEmployee.noRoleAccess")}
              </span>
            </div>
            {changeCount > 0 && (
              <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {t("empDetail.changedFor", { name: emp.name })}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invited: they have never signed in, so there is no work to report and
          showing zeros as "performance" would read as a real result. */}
      {isInvited && (
        <div className="px-4 pt-5 animate-fade-in-up delay-[125ms]">
          <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}>
            <Clock size={16} className="shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("empDetail.invitedTitle")}</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{t("empDetail.invitedHint", { name: emp.name })}</p>
            </div>
          </div>
        </div>
      )}

      {/* Performance — only once the person has actually completed onboarding */}
      {!isInvited && (
      <div className="px-4 pt-5 animate-fade-in-up delay-[125ms]">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("empDetail.performance")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: TrendingUp, label: t("empDetail.totalRevenue"), value: formatCurrency(totalRevenue), color: "var(--brand)" },
            { icon: ShoppingCart, label: t("empDetail.totalSales"), value: String(totalTransactions), color: "#3b82f6" },
            { icon: ShoppingCart, label: t("employee.itemsSold"), value: String(totalItems), color: "#8b5cf6" },
            { icon: Users, label: t("empDetail.customers"), value: String(uniqueCustomers.length), color: "#06b6d4" },
            { icon: Calendar, label: t("empDetail.today"), value: `${todayTransactions} · ${formatCurrency(todayRevenue)}`, color: "#f59e0b" },
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
      )}

      {/* Recent sales */}
      {!isInvited && (
      <div className="px-4 pt-5 animate-fade-in-up delay-[150ms]">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            {t("empDetail.recentSales")}
          </p>
          {empSales.length > 5 && (
            <button
              onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id } })}
              className="text-xs font-semibold flex items-center gap-1"
              style={{ color: "var(--brand)" }}
            >
              {t("common.viewAll")} <ChevronRight size={12} />
            </button>
          )}
        </div>
        {recentSales.length === 0 ? (
          <div className="rounded-xl p-6 text-center" style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}>
            <ShoppingCart size={20} className="mx-auto mb-2" style={{ color: "var(--text-secondary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sales.noSales")}</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {recentSales.map((sale, i) => (
              <button
                key={sale.id}
                onClick={() => navigate(`/admin/sales/${sale.id}`)}
                className="flex items-center justify-between px-4 py-3 w-full text-start transition-opacity active:opacity-70"
                style={{ borderBottom: i < recentSales.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatSmartDateTime(sale.createdAt, now, t)}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                    {sale.items.length} · {sale.paymentType === "full" ? t("sales.paid") : t("sales.credit")}
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
      )}

      {/* Actions */}
      <div className="px-4 pt-5 animate-fade-in-up delay-[175ms]">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id } })}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Eye size={14} />
            {t("empDetail.viewAllSales")}
          </button>
          <button
            onClick={() => window.open(`tel:${emp.phone}`, "_self")}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Phone size={14} />
            {t("empDetail.call")}
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
                const question = isInvited
                  ? t("empDetail.cancelInviteQ", { name: emp.name })
                  : t("empDetail.deactivateQ", { name: emp.name });
                const hint = isInvited ? t("empDetail.cancelInviteHint") : t("empDetail.deactivateHint");
                if (confirm(`${question}\n\n${hint}`)) setActive(false);
              }}
            >
              <UserX size={15} />
              {t(isInvited ? "empDetail.cancelInvite" : "empDetail.deactivate")}
            </button>
          ) : (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
              onClick={() => setActive(true)}
            >
              <UserCheck size={15} />
              {t("empDetail.reactivate")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
