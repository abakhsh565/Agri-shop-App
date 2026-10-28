import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ClipboardList,
  Package,
  Plus,
  ShieldCheck,
  ShoppingCart,
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
import { useRolesStore } from "@/stores/rolesStore";
import { useShopStore } from "@/stores/shopStore";
import { useShellBase } from "@/lib/useShellBase";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import type { Role } from "@/types";

/**
 * Roles & Permissions — the templates the owner hands to employees.
 *
 * THE LIST IS A DOORWAY, NOT AN EDITOR. Each row names one role, the icon that says what kind of
 * work it covers, how many people hold it, how much it opens and what it is for, and it ends with
 * `Modify`, which opens that role's own screen (`pages/admin/people/RoleEditorPage`). Editing used
 * to happen in a sheet over this list; the owner's flow is now separate screens — directory →
 * roles → one role — so the list stays a list and the change happens where the save button is.
 *
 * ICONS ARE DERIVED, NOT STORED. A role is a name and a set of permissions; the database has no
 * "icon" column and inventing one would mean a role created today has no picture until somebody
 * assigns it. The leading icon is read from the role's name, so the built-in templates and the
 * owner's own "Cashier" / "Stock keeper" land on the glyph that names their work, and a role with
 * a name none of the words match keeps the plain shield rather than no icon at all.
 *
 * COUNTS ARE READ ONCE PER ROLE. The member count and the number of granted permissions come from
 * the same two reads the screen always used; nothing on this list claims a number it did not read.
 *
 * ── Flow mode ──────────────────────────────────────────────────────────────────────
 * The shop-setup wizard's "Add New role" / "Modify" arrive here with `location.state.setupFlow`
 * and are forwarded, unchanged, to the role screen so that saving or closing it hands the owner
 * back to the step they left. Nothing about an ordinary visit from the People hub is affected.
 */
interface SetupFlowState {
  returnPath: string;
  mode: "create" | "edit";
  roleId?: string;
}

/** What kind of work a role covers, read from its own name. */
function roleIcon(role: Role): LucideIcon {
  const name = role.name.toLowerCase();
  // Who is in charge is read before what they trade in: "Store Manager" is a manager, not a
  // crate, and matching the noun first gave it the package glyph.
  if (name.includes("manager") || name.includes("supervisor") || name.includes("admin")) return ShieldCheck;
  if (name.includes("inventor") || name.includes("stock") || name.includes("store")) return Package;
  if (name.includes("sale") || name.includes("cashier") || name.includes("shop floor")) return ShoppingCart;
  if (name.includes("cash") || name.includes("account") || name.includes("financ")) return Wallet;
  if (name.includes("office") || name.includes("clerk") || name.includes("record")) return ClipboardList;
  if (name.includes("staff") || name.includes("team")) return Users;
  return ShieldCheck;
}

export default function RolesAccessPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useShellBase();

  // Whether this screen was opened BY the shop-setup wizard, and where to hand the owner back
  // to. Forwarded to the role screen rather than interpreted here.
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

  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  /** How much each role opens, as a number. The module NAMES were the confusing part:
   *  "Products · Purchases · Payments · Inven…" is a truncated line of database areas, not
   *  something an owner can act on, and it crowded the row it sat in. */
  const [rolePermCounts, setRolePermCounts] = useState<Record<string, number>>({});

  // Reload when the SHOP changes, not only on mount: the roles belong to one shop, and a list
  // left over from the previous one is not just stale, it is uneditable — the writes are
  // authorized against whichever shop the account is working in now.
  useEffect(() => {
    void loadRoles();
    void loadPermissions();
  }, [activeShopId, loadRoles, loadPermissions]);

  // How many employees use each role, and how much it opens.
  useEffect(() => {
    if (roles.length === 0) return;
    roles.forEach(async (role) => {
      const count = await getRoleMemberCount(role.id);
      setMemberCounts((prev) => ({ ...prev, [role.id]: count }));
      const perms = await getRolePermissions(role.id);
      setRolePermCounts((prev) => ({ ...prev, [role.id]: perms.length }));
    });
  }, [roles.length, permissionCount, getRoleMemberCount, getRolePermissions]);

  /**
   * Arrived from the setup wizard: forward the owner to the role screen it asked for, once the
   * roles are here. Waits for the list rather than opening on an empty one — the edit case needs
   * the role to exist before there is anything to edit, and the create case must not be
   * pre-empted by a skeleton.
   */
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

  return (
    <div
      className="flex flex-col w-full min-h-full"
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
        {/* The heading says what the screen is for, the count says how many there are, and the
            button is the one action on it. */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-14 font-bold">
              {ready ? t("roles.count", { count: roles.length }) : ""}
            </p>
            <p className="text-11 mt-0.5 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t("roles.intro")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(`${base}/settings/roles/new`)}
            data-testid="role-new"
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-full text-13 font-bold shrink-0 ds-pressable"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <Plus size={15} /> {t("roles.new")}
          </button>
        </div>

        {!ready && <SkeletonList rows={3} />}

        {ready && roles.length === 0 && (
          <EmptyState icon={ShieldCheck} title={t("roles.empty")} />
        )}

        {ready && roles.length > 0 && (
          <ListCard>
            {roles.map((role) => {
              const count = memberCounts[role.id];
              const permCount = rolePermCounts[role.id];
              const Icon = roleIcon(role);
              return (
                <ListRow
                  key={role.id}
                  onClick={() => navigate(`${base}/settings/roles/${role.id}`)}
                  testId={`role-${role.id}`}
                  icon={Icon}
                  trailing={
                    <span
                      className="flex items-center gap-0.5 shrink-0 text-11 font-semibold ms-1"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t("roles.modify")}
                      <ChevronRight size={14} />
                    </span>
                  }
                >
                  {/* Name first, at 14 and bold. Then the two counts the owner reads before
                      opening a role, then what the role is for. Four sizes fighting on one row
                      is what made this card look unprofessional, so the facts are stacked by
                      importance: name, counts, purpose. */}
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-14 font-bold truncate">{role.name}</p>
                    {role.isSystem && (
                      <span
                        className="text-11 px-2 py-0.5 rounded-full shrink-0 font-medium"
                        style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                      >
                        {t("roles.builtIn")}
                      </span>
                    )}
                  </div>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {count === undefined ? "—" : t("roles.employees", { count })}
                    {permCount !== undefined && ` · ${t("roles.canDo", { count: permCount })}`}
                  </p>
                  {role.description && (
                    <p className="text-12 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                      {role.description}
                    </p>
                  )}
                </ListRow>
              );
            })}
          </ListCard>
        )}
      </div>
    </div>
  );
}
