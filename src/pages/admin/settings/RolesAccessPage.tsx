import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  ChevronRight,
  ClipboardList,
  LayoutGrid,
  Package,
  Plus,
  Settings2,
  ShoppingCart,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useAccessCatalogStore } from "@/stores/accessCatalogStore";
import { useUIStore } from "@/stores/uiStore";
import type { Role, RoleCategory } from "@/types";
import { isOwnerRoleName } from "@/lib/roleTemplates";
import { eligibleWidgetKeys } from "@/lib/dashboardAccess";

const CATEGORY_ICONS: Record<RoleCategory, LucideIcon> = {
  sales: ShoppingCart,
  finance: Wallet,
  inventory: Package,
  procurement: Package,
  people_hr: Users,
  operations: LayoutGrid,
  business_management: BriefcaseBusiness,
  other: ClipboardList,
};

interface RoleFacts {
  permissions: number;
  widgets: number;
  employees: number;
}

export default function RolesAccessPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const language = useThemeStore((s) => s.language);
  const { addToast } = useUIStore();

  const roles = useRolesStore((s) => s.roles);
  const ready = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const deleteRole = useRolesStore((s) => s.deleteRole);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);
  const loadRolePermissions = useRolesStore((s) => s.loadRolePermissions);
  const permissionsReady = usePermissionsStore((s) => s.ready);
  const loadPermissions = usePermissionsStore((s) => s.load);
  const widgets = useAccessCatalogStore((s) => s.widgets);
  const loadCatalog = useAccessCatalogStore((s) => s.load);

  const [search, setSearch] = useState("");
  const [facts, setFacts] = useState<Record<string, RoleFacts>>({});
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    void loadRoles();
    void loadPermissions();
    void loadCatalog();
  }, [loadRoles, loadPermissions, loadCatalog]);

  useEffect(() => {
    if (!ready || !permissionsReady || widgets.length === 0 || roles.length === 0) return;
    let live = true;
    void Promise.all(
      roles.map(async (role) => {
        const [access, employees] = await Promise.all([
          loadRolePermissions(role.id),
          getRoleMemberCount(role.id),
        ]);
        return [
          role.id,
          {
            permissions: access.codes.length,
            widgets: eligibleWidgetKeys(widgets, new Set(access.codes)).length,
            employees,
          },
        ] as const;
      }),
    ).then((rows) => {
      if (live) setFacts(Object.fromEntries(rows));
    });
    return () => {
      live = false;
    };
  }, [ready, permissionsReady, widgets, roles, loadRolePermissions, getRoleMemberCount]);

  const visibleRoles = useMemo(
    () =>
      roles
        .filter((role) => !isOwnerRoleName(role.name))
        .filter((role) => {
          const term = search.trim().toLowerCase();
          if (!term) return true;
          return [role.name, role.description ?? "", role.departmentName ?? "", role.roleCategory ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(term);
        })
        .sort((left, right) => {
          const rank = (role: Role) => {
            const name = role.name.trim().toLowerCase();
            if (name === "staff") return 0;
            if (name === "manager") return 1;
            return 2;
          };
          return rank(left) - rank(right) || left.name.localeCompare(right.name);
        }),
    [roles, search],
  );

  async function confirmDelete() {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteRole(deleteTarget.id);
      addToast(t("roles.deleted"), "success");
      setDeleteTarget(null);
    } catch (error) {
      addToast(error instanceof Error ? error.message : t("roles.errSave"), "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const deleteMembers = deleteTarget ? facts[deleteTarget.id]?.employees ?? 0 : 0;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="roles-access-page"
    >
      <StatusBar />
      <NavHeader
        title={t("roles.accessTitle")}
        backTo={`${base}/settings/hub/people`}
      />

      <div className="px-4 pt-4">
        <h1 className="text-17 font-bold">{t("roles.accessHeading")}</h1>
        <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("roles.accessSubtitle")}
        </p>

        <div className="mt-5">
          <SearchBar
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch("")}
            placeholder={t("roles.searchPlaceholder")}
            data-testid="roles-search"
          />
        </div>

        <Button
          fullWidth
          size="lg"
          variant="cta"
          className="mt-2.5"
          onClick={() => navigate(`${base}/settings/roles/new`)}
          testId="role-create"
        >
          <Plus size={15} className="me-1.5" /> {t("roles.createNew")}
        </Button>
      </div>

      <div className="flex items-baseline justify-between gap-3 px-4 pt-5 pb-2.5">
        <p className="text-13 font-bold">
          {t("roles.enrolled")} <span style={{ color: "var(--text-secondary)" }}>({visibleRoles.length})</span>
        </p>
      </div>

      <div className="px-4 pb-8">
        {!ready && <SkeletonList rows={4} />}
        {ready && (visibleRoles.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title={search.trim() ? t("roles.noMatch") : t("roles.empty")}
            subtitle={t("roles.emptyHint")}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleRoles.map((role) => {
              const Icon = CATEGORY_ICONS[role.roleCategory ?? "other"] ?? Settings2;
              const roleFacts = facts[role.id];
              const employees = roleFacts?.employees ?? 0;
              const permissions = roleFacts?.permissions ?? role.permissionCount ?? 0;
              const widgetCount = roleFacts?.widgets ?? 0;
              const department = language === "ur" && role.departmentNameUr
                ? role.departmentNameUr
                : role.departmentName;
              return (
                <div
                  key={role.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`${base}/settings/roles/${role.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`${base}/settings/roles/${role.id}`);
                    }
                  }}
                  data-testid={`role-row-${role.id}`}
                  className="rounded-[var(--radius-card)] overflow-hidden text-start active:opacity-90"
                  style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                >
                  <div className="p-4 flex items-start gap-3">
                    <span
                      className="size-9 rounded-[var(--radius-tile)] grid place-items-center shrink-0 mt-0.5"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                    >
                      <Icon size={17} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <strong className="text-14 font-bold">{role.name}</strong>
                        <span
                          className="text-9 font-bold px-1.5 py-0.5 rounded-full"
                          style={role.isSystem
                            ? { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
                            : { background: "var(--brand-light)", color: "var(--brand-dark)" }}
                        >
                          {role.isSystem ? t("roles.builtIn") : t("roles.custom")}
                        </span>
                      </div>

                      {role.description && (
                        <p className="text-11 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                          {role.description}
                        </p>
                      )}

                      <p className="text-10 mt-1.5 leading-snug" style={{ color: "var(--text-secondary)" }}>
                        {[department, t("roles.permissionShort", { count: String(permissions) }), t("roles.widgetShort", { count: String(widgetCount) })]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </p>
                    </div>

                    <span className="flex items-center gap-1 shrink-0 mt-1.5">
                      <span className="text-11 font-semibold" style={{ color: "var(--text-primary)" }}>
                        {t("roles.modify")}
                      </span>
                      <ChevronRight size={15} style={{ color: "var(--text-secondary)" }} />
                    </span>
                  </div>

                  <div
                    className="px-4 h-10 flex items-center justify-between gap-3"
                    style={{ borderTop: "1px solid var(--divider)" }}
                  >
                    <span className="flex items-center gap-1.5 text-10" style={{ color: "var(--text-secondary)" }}>
                      <Users size={12} /> {t("roles.employeeShort", { count: String(employees) })}
                    </span>

                    <button
                      type="button"
                      title={t("roles.deleteAction")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(role);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      data-testid={`role-delete-${role.id}`}
                      className="flex items-center gap-1.5 text-10 font-semibold"
                      style={{ color: "var(--error)" }}
                    >
                      <Trash2 size={12} /> {t("roles.delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("roles.deleteConfirm")}
        message={
          deleteTarget
            ? deleteMembers === 0
              ? t("roles.deleteHint", { name: deleteTarget.name })
              : deleteMembers === 1
                ? t("roles.deleteRevokesOne")
                : t("roles.deleteRevokes", { count: String(deleteMembers) })
            : ""
        }
        confirmLabel={t("roles.deleteAction")}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
