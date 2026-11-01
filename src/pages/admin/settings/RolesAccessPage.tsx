import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ClipboardList,
  Layers,
  Package,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import SearchBar from "@/components/ui/SearchBar";
import { useRolesStore } from "@/stores/rolesStore";
import { useShopStore } from "@/stores/shopStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import type { Role, RoleCategory } from "@/types";
import {
  ROLE_TEMPLATES,
  categoryLabelKey,
  levelLabelKey,
  type RoleTemplate,
} from "@/lib/roleTemplates";

/**
 * Roles & Access — system starting points above the owner's own roles.
 *
 * System templates are deliberately separated from "My business roles". A template is a
 * protected starting point; using one opens a NEW role with the template's catalogue
 * selections copied in. The owner's roles are the only rows that can be edited.
 */
interface SetupFlowState {
  returnPath: string;
  mode: "create" | "edit";
  roleId?: string;
}

const CATEGORY_ICONS: Record<RoleCategory, LucideIcon> = {
  sales: ShoppingCart,
  finance: Wallet,
  inventory: Package,
  procurement: Store,
  people_hr: Users,
  operations: Layers,
  business_management: Settings2,
  other: ClipboardList,
};

export default function RolesAccessPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useShellBase();

  const flow = (location.state as { setupFlow?: SetupFlowState } | null)?.setupFlow;
  const flowForwarded = useRef(false);

  const roles = useRolesStore((s) => s.roles);
  const ready = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);
  const getRolePermissions = useRolesStore((s) => s.getRolePermissions);
  const loadPermissions = usePermissionsStore((s) => s.load);
  const permissionCount = usePermissionsStore((s) => s.permissions.length);
  const activeShopId = useShopStore((s) => s.activeShopId);

  const [search, setSearch] = useState("");
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [rolePermCounts, setRolePermCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    void loadRoles();
    void loadPermissions();
  }, [activeShopId, loadRoles, loadPermissions]);

  useEffect(() => {
    if (roles.length === 0) return;
    roles.forEach(async (role) => {
      const count = await getRoleMemberCount(role.id);
      setMemberCounts((prev) => ({ ...prev, [role.id]: count }));
      const perms = await getRolePermissions(role.id);
      setRolePermCounts((prev) => ({ ...prev, [role.id]: perms.length }));
    });
  }, [roles.length, permissionCount, getRoleMemberCount, getRolePermissions]);

  useEffect(() => {
    if (!flow || flowForwarded.current || !ready) return;
    if (flow.mode === "create") {
      flowForwarded.current = true;
      navigate(`${base}/settings/roles/new`, { state: { setupFlow: flow }, replace: true });
      return;
    }
    const target = flow.roleId ? roles.find((r) => r.id === flow.roleId) : undefined;
    if (!target) return;
    flowForwarded.current = true;
    navigate(`${base}/settings/roles/${target.id}`, { state: { setupFlow: flow }, replace: true });
  }, [flow, ready, roles, base, navigate]);

  const customRoles = useMemo(() => roles.filter((role) => !role.isSystem), [roles]);

  /**
   * The four protected templates are always present. A database system role whose name
   * already appears in that list is not shown twice; any other seeded role is appended so
   * the screen also reflects real catalogues created by this shop.
   */
  const systemTemplates = useMemo(() => {
    const protectedNames = new Set(
      ROLE_TEMPLATES.map((template) => template.name.trim().toLowerCase()),
    );
    const extra = roles.filter(
      (role) => role.isSystem && !protectedNames.has(role.name.trim().toLowerCase()),
    );
    return { protectedNames, extra };
  }, [roles]);

  const query = search.trim().toLowerCase();
  const filteredProtected = ROLE_TEMPLATES.filter((template) =>
    query ? t(template.nameKey).toLowerCase().includes(query) : true,
  );
  const filteredSystem = systemTemplates.extra.filter((role) =>
    query ? role.name.toLowerCase().includes(query) : true,
  );
  const filteredRoles = customRoles.filter((role) => {
    if (!query) return true;
    return (
      role.name.toLowerCase().includes(query) ||
      (role.description ?? "").toLowerCase().includes(query) ||
      (role.departmentName ?? "").toLowerCase().includes(query)
    );
  });

  const hasResults =
    filteredProtected.length > 0 || filteredSystem.length > 0 || filteredRoles.length > 0;

  function openTemplate(template: RoleTemplate) {
    navigate(`${base}/settings/roles/new`, {
      state: { ...(flow ? { setupFlow: flow } : {}), templateId: template.id },
    });
  }

  function openDatabaseTemplate(role: Role) {
    navigate(`${base}/settings/roles/new`, {
      state: { ...(flow ? { setupFlow: flow } : {}), templateRoleId: role.id },
    });
  }

  function openRole(role: Role) {
    navigate(`${base}/settings/roles/${role.id}`, {
      state: flow ? { setupFlow: flow } : undefined,
    });
  }

  const roleMeta = (role: Role) => {
    const count = memberCounts[role.id];
    const perms = rolePermCounts[role.id] ?? role.permissionCount;
    return [
      categoryLabelKey(role.roleCategory) === "roles.category.other" && !role.roleCategory
        ? null
        : t(categoryLabelKey(role.roleCategory)),
      role.responsibilityLevel ? t(levelLabelKey(role.responsibilityLevel)) : null,
      count === undefined ? null : t("roles.employees", { count }),
      perms === undefined ? null : t("roles.canDo", { count: perms }),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <div
      className="roles-neutral flex flex-col w-full min-h-full"
      style={{
        background: "var(--background)",
        color: "var(--text-primary)",
        direction: isUrdu ? "rtl" : "ltr",
      }}
      data-testid="roles-list-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.people.roles")} backTo={`${base}/settings/hub/people`} />

      <div className="flex-1 px-4 pt-1 pb-10">
        <p className="text-13" style={{ color: "var(--text-secondary)" }}>
          {t("roles.homeSubtitle")}
        </p>

        <button
          type="button"
          onClick={() => navigate(`${base}/settings/roles/new`)}
          data-testid="role-new"
          className="mt-4 w-full h-11 rounded-full text-13 font-bold flex items-center justify-center ds-pressable"
          style={{ background: "var(--roles-accent)", color: "var(--roles-accent-fg)" }}
        >
          {t("roles.addNew")}
        </button>

        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("roles.searchRoles")}
          aria-label={t("roles.searchRoles")}
          dir="auto"
          data-testid="role-search"
          containerClass="mt-3"
        />

        {!ready && <SkeletonList rows={3} />}

        {ready && !hasResults && (
          <div className="pt-6">
            <EmptyState
              icon={ShieldCheck}
              title={t("roles.noSearchResults")}
            />
          </div>
        )}

        {ready && hasResults && (
          <>
            <section className="pt-5" data-testid="roles-system-templates">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-15 font-bold">{t("roles.systemTemplates")}</h2>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.systemTemplatesHint")}
                  </p>
                </div>
                <span
                  className="text-10 font-semibold px-2 py-1 rounded-full shrink-0"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                >
                  {filteredProtected.length + filteredSystem.length}
                </span>
              </div>

              <div
                className="flex gap-3 overflow-x-auto mt-3 -mx-4 px-4 pb-1"
                style={{ scrollSnapType: "x mandatory" }}
              >
                {filteredProtected.map((template) => {
                  const Icon = CATEGORY_ICONS[template.category] ?? ShieldCheck;
                  return (
                    <article
                      key={template.id}
                      className="w-[248px] shrink-0 rounded-[var(--radius-card)] p-3.5 flex flex-col"
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--divider)",
                        scrollSnapAlign: "start",
                      }}
                      data-testid={`role-template-${template.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="size-10 rounded-[var(--radius-tile)] grid place-items-center"
                          style={{ background: "var(--roles-accent-soft)", color: "var(--roles-accent-text)" }}
                        >
                          <Icon size={19} />
                        </span>
                        <span
                          className="text-10 font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                        >
                          {t("roles.system")}
                        </span>
                      </div>
                      <h3 className="text-14 font-bold mt-3">{t(template.nameKey)}</h3>
                      <p
                        className="text-11 leading-snug mt-1 flex-1"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {t(template.descriptionKey)}
                      </p>
                      <p className="text-10 mt-3" style={{ color: "var(--text-secondary)" }}>
                        {t("roles.canDo", { count: template.permissions.length })}
                      </p>
                      <button
                        type="button"
                        onClick={() => openTemplate(template)}
                        className="mt-3 h-9 rounded-full text-12 font-bold ds-pressable"
                        style={{
                          background: "var(--surface-2)",
                          border: "1px solid var(--roles-accent-border)",
                          color: "var(--roles-accent-text)",
                        }}
                      >
                        {t("roles.useTemplate")}
                      </button>
                    </article>
                  );
                })}

                {filteredSystem.map((role) => {
                  const Icon = CATEGORY_ICONS[role.roleCategory ?? "other"] ?? ShieldCheck;
                  const perms = rolePermCounts[role.id] ?? role.permissionCount ?? 0;
                  return (
                    <article
                      key={role.id}
                      className="w-[248px] shrink-0 rounded-[var(--radius-card)] p-3.5 flex flex-col"
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--divider)",
                        scrollSnapAlign: "start",
                      }}
                      data-testid={`role-template-${role.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="size-10 rounded-[var(--radius-tile)] grid place-items-center"
                          style={{ background: "var(--roles-accent-soft)", color: "var(--roles-accent-text)" }}
                        >
                          <Icon size={19} />
                        </span>
                        <span
                          className="text-10 font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                        >
                          {t("roles.system")}
                        </span>
                      </div>
                      <h3 className="text-14 font-bold mt-3">{role.name}</h3>
                      <p
                        className="text-11 leading-snug mt-1 flex-1"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {role.description ?? role.departmentName ?? t("roles.systemTemplatesHint")}
                      </p>
                      <p className="text-10 mt-3" style={{ color: "var(--text-secondary)" }}>
                        {t("roles.canDo", { count: perms })}
                      </p>
                      <button
                        type="button"
                        onClick={() => openDatabaseTemplate(role)}
                        className="mt-3 h-9 rounded-full text-12 font-bold ds-pressable"
                        style={{
                          background: "var(--surface-2)",
                          border: "1px solid var(--roles-accent-border)",
                          color: "var(--roles-accent-text)",
                        }}
                      >
                        {t("roles.useTemplate")}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="pt-6" data-testid="roles-business-list">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-15 font-bold">{t("roles.myBusinessRoles")}</h2>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.myBusinessRolesHint")}
                  </p>
                </div>
                <span
                  className="text-10 font-semibold px-2 py-1 rounded-full shrink-0"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                >
                  {filteredRoles.length}
                </span>
              </div>

              {filteredRoles.length === 0 ? (
                <div className="pt-3">
                  <EmptyState icon={ShieldCheck} title={t("roles.empty")} />
                </div>
              ) : (
                <div className="pt-3">
                  <ListCard>
                    {filteredRoles.map((role) => {
                      const Icon = CATEGORY_ICONS[role.roleCategory ?? "other"] ?? ShieldCheck;
                      return (
                        <ListRow
                          key={role.id}
                          onClick={() => openRole(role)}
                          testId={`role-${role.id}`}
                          icon={Icon}
                          trailing={
                            <span
                              className="flex items-center gap-0.5 shrink-0 text-11 font-semibold ms-1"
                              style={{ color: "var(--roles-accent-text)" }}
                            >
                              {t("roles.manage")}
                              <ChevronRight size={14} />
                            </span>
                          }
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-14 font-bold truncate">{role.name}</p>
                            {role.isSystem && (
                              <span
                                className="text-10 px-2 py-0.5 rounded-full shrink-0 font-medium"
                                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                              >
                                {t("roles.builtIn")}
                              </span>
                            )}
                          </div>
                          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                            {roleMeta(role)}
                          </p>
                          {role.description && (
                            <p
                              className="text-12 mt-1 leading-snug"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {role.description}
                            </p>
                          )}
                        </ListRow>
                      );
                    })}
                  </ListCard>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
