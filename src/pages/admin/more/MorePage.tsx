import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightLeft,
  BarChart3,
  Bell,
  BellRing,
  Building2,
  ChevronRight,
  ClipboardList,
  Compass,
  Crown,
  KeyRound,
  Landmark,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Package,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Truck,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Checkbox from "@/components/ui/Checkbox";
import Sheet from "@/components/ui/Sheet";
import { useT, type I18nKey } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import { hasPermission, isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerEnabled, isCoOwner } from "@/lib/experience";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";

interface MoreRow {
  id: string;
  icon: LucideIcon;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  to: string;
  show: boolean;
  danger?: boolean;
  state?: { from: string };
  onClick?: () => void;
}

/** The business areas that can appear in the top shortcut strip, in display order. */
const SHORTCUT_IDS = [
  "customers",
  "items",
  "purchases",
  "finance",
  "reports",
  "alerts",
  "notifications",
  "employees",
  "activity",
] as const;

function readShortcutIds(key: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

/**
 * The business menu.
 *
 * A header card carries the page's name, its subtitle and one horizontal strip of shortcuts the
 * person can choose. Below it the business areas are grouped, with a section rule between groups
 * and no rule under every action. Every destination is the screen that already owns that area;
 * this page does not grow a second implementation of any of them.
 */
export default function AdminMorePage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { isRtl } = useDir();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const shortcutStorageKey = `agri_more_shortcuts_${user?.id ?? "anon"}`;
  const [shortcutIds, setShortcutIds] = useState<string[] | null>(() => readShortcutIds(shortcutStorageKey));
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false);

  useEffect(() => {
    setShortcutIds(readShortcutIds(shortcutStorageKey));
  }, [shortcutStorageKey]);

  const isOwner = isCurrentUserOwner();
  const canReceiveOwnershipTransfer = isCoOwner(user);
  const canManagePeople = hasPermission("employees.manage");
  const canSettings = hasPermission("settings.view");
  const canSeeCoOwners = isOwner && coOwnerEnabled();

  const chevron = (
    <ChevronRight
      size={16}
      className="ds-row-chevron shrink-0"
      style={{
        color: "var(--text-secondary)",
        transform: isRtl ? "rotate(180deg)" : undefined,
      }}
    />
  );

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  const groups: Array<{ id: string; headingKey: I18nKey; rows: MoreRow[] }> = [
    // Alerts and the inbox sit above the business areas (owner, 2026-11-12): what needs an
    // answer today is read before the places it came from.
    {
      id: "alerts",
      headingKey: "more.group.alertsInbox",
      rows: [
        {
          id: "alerts",
          icon: BellRing,
          labelKey: "more.alertsReminders",
          descriptionKey: "more.hint.alerts",
          to: `${base}/alerts/reminders`,
          show: hasPermission("alerts.view"),
        },
        {
          id: "notifications",
          icon: Bell,
          labelKey: "more.notifications",
          descriptionKey: "more.hint.notifications",
          to: `${base}/notifications`,
          state: { from: `${base}/more` },
          show: hasPermission("notifications.view"),
        },
        {
          id: "messages",
          icon: MessageSquare,
          labelKey: "admin.messages",
          descriptionKey: "more.hint.messages",
          to: `${base}/messages`,
          state: { from: `${base}/more` },
          show: true,
        },
      ],
    },
    {
      id: "business",
      headingKey: "more.group.business",
      rows: [
        {
          id: "customers",
          icon: Users,
          labelKey: "more.business.customersCredit",
          descriptionKey: "more.hint.customers",
          to: `${base}/settings/hub/customers`,
          show: hasPermission("customers.view"),
        },
        {
          id: "items",
          icon: Package,
          labelKey: "more.business.productsInventory",
          descriptionKey: "more.hint.products",
          to: `${base}/settings/hub/inventory`,
          state: { from: `${base}/more` },
          show: hasPermission("products.view"),
        },
        {
          id: "purchases",
          icon: Truck,
          labelKey: "more.business.purchasesSuppliers",
          descriptionKey: "more.hint.purchases",
          to: `${base}/settings/hub/purchases`,
          show: hasPermission("purchases.view"),
        },
        {
          id: "finance",
          icon: Landmark,
          labelKey: "settings.menu.finance",
          descriptionKey: "more.hint.finance",
          to: `${base}/settings/hub/finance`,
          show: hasPermission("payments.view"),
        },
        {
          id: "reports",
          icon: BarChart3,
          labelKey: "admin.reports",
          descriptionKey: "more.hint.reports",
          to: `${base}/reports/directory`,
          state: { from: `${base}/more` },
          show: hasPermission("reports.view"),
        },
      ],
    },
    {
      id: "people",
      headingKey: "more.group.people",
      rows: [
        {
          id: "employees",
          icon: Users,
          labelKey: "hub.people.employees",
          descriptionKey: "more.hint.employees",
          to: `${base}/settings/hub/people`,
          show: hasPermission("employees.view"),
        },
        {
          id: "roles",
          icon: ShieldCheck,
          labelKey: "more.rolesAccess",
          descriptionKey: "more.hint.roles",
          to: `${base}/settings/roles`,
          show: canManagePeople,
        },
        {
          id: "co-owners",
          icon: Crown,
          labelKey: "more.coOwnersAccess",
          descriptionKey: "more.hint.coOwners",
          to: `${base}/settings/hub/people/co-owners`,
          show: canSeeCoOwners,
        },
        {
          id: "activity",
          icon: ClipboardList,
          labelKey: "more.activityAudit",
          descriptionKey: "more.hint.activity",
          to: `${base}/activity`,
          show: hasPermission("activity.view"),
        },
      ],
    },
    {
      id: "business-setup",
      headingKey: "more.group.businessSetup",
      rows: [
        {
          id: "branches",
          icon: Building2,
          labelKey: "settings.menu.branches",
          descriptionKey: "more.hint.branches",
          to: `${base}/settings/hub/branches`,
          // Branch management belongs to the main Owner. Hiding the door matches the
          // grant's canManageBranches = false and the server trigger.
          show: canSettings && isOwner,
        },
        {
          id: "business-profile",
          icon: Store,
          labelKey: "settings.menu.businessProfile",
          descriptionKey: "more.hint.businessProfile",
          to: `${base}/settings/business`,
          show: canSettings,
        },
        {
          id: "business-settings",
          icon: Settings,
          labelKey: "admin.settings",
          descriptionKey: "more.hint.settings",
          to: `${base}/settings`,
          show: canSettings,
        },
      ],
    },
    {
      id: "account",
      headingKey: "more.group.account",
      rows: [
        {
          id: "profile",
          icon: UserCog,
          labelKey: "more.profile",
          descriptionKey: "more.hint.profile",
          to: `${base}/settings/profile`,
          show: canSettings,
        },
        {
          id: "security",
          icon: KeyRound,
          labelKey: "more.security",
          descriptionKey: "more.hint.security",
          to: `${base}/settings/security`,
          show: canSettings,
        },
        {
          id: "preferences",
          icon: SlidersHorizontal,
          labelKey: "more.preferences",
          descriptionKey: "more.hint.preferences",
          to: `${base}/settings/preferences`,
          show: canSettings,
        },
        {
          id: "guide",
          icon: Compass,
          labelKey: "more.guide",
          descriptionKey: "more.hint.guide",
          to: `${base}/guide`,
          show: true,
        },
        {
          id: "ownership-transfer",
          icon: ArrowRightLeft,
          labelKey: "coOwner.ownershipTransfer",
          descriptionKey: "more.hint.ownershipTransfer",
          to: `${base}/ownership-transfer`,
          show: canReceiveOwnershipTransfer,
        },
        {
          id: "logout",
          icon: LogOut,
          labelKey: "more.signOut",
          descriptionKey: "more.hint.signOut",
          to: "",
          show: true,
          danger: true,
          onClick: signOut,
        },
      ],
    },
  ];

  const allRows = groups.flatMap((group) => group.rows);
  const shortcutCandidates = SHORTCUT_IDS
    .map((id) => allRows.find((row) => row.id === id && row.show))
    .filter((row): row is MoreRow => Boolean(row));
  const defaultShortcutIds = shortcutCandidates.slice(0, 4).map((row) => row.id);
  const activeShortcutIds = (shortcutIds ?? defaultShortcutIds).filter((id) =>
    shortcutCandidates.some((row) => row.id === id),
  );
  const activeShortcuts = shortcutCandidates.filter((row) => activeShortcutIds.includes(row.id));

  function toggleShortcut(id: string) {
    const next = activeShortcutIds.includes(id)
      ? activeShortcutIds.filter((shortcutId) => shortcutId !== id)
      : [...activeShortcutIds, id];
    setShortcutIds(next);
    try {
      window.localStorage.setItem(shortcutStorageKey, JSON.stringify(next));
    } catch {
      // A private-mode or full-storage failure must not stop the shortcut from working now.
    }
  }

  function shortcutTile(row: MoreRow) {
    const Icon = row.icon;
    return (
      <button
        key={row.id}
        type="button"
        onClick={() => navigate(row.to, { state: row.state })}
        className="ds-pressable flex h-[76px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-tile)] px-1.5 text-center"
        style={{
          background: "var(--surface-2)",
          // Exactly four tiles fill one row; further picks scroll instead of shrinking.
          width: "calc((100% - 24px) / 4)",
        }}
        data-testid={`more-shortcut-${row.id}`}
      >
        <Icon size={18} style={{ color: "var(--text-secondary)" }} />
        <span className="text-10 font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
          {t(row.labelKey)}
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="admin-more-page"
    >
      <StatusBar />

      <section
        className="mx-4 mt-3 rounded-[var(--radius-card)] p-4"
        style={{ background: "var(--tone-card)" }}
        data-testid="admin-more-header"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-20 font-bold">{t("admin.more")}</h1>
            <p className="mt-1 text-12" style={{ color: "var(--text-secondary)" }}>
              {t("more.subtitle")}
            </p>
          </div>
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            <LayoutGrid size={18} />
          </span>
        </div>
      </section>

      {/* The shortcut boxes sit on the page, not inside the header card. */}
      <section className="mx-4 mt-4" data-testid="admin-more-shortcuts">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <p
            className="text-10 font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("more.shortcuts.label")}
          </p>
          <button
            type="button"
            onClick={() => setShortcutSheetOpen(true)}
            aria-haspopup="dialog"
            className="ds-pressable text-12 font-semibold"
            style={{ color: "var(--text-secondary)" }}
            data-testid="more-shortcut-customize"
          >
            {t("settings.customize")}
          </button>
        </div>
        {activeShortcuts.length === 0 ? (
          <button
            type="button"
            onClick={() => setShortcutSheetOpen(true)}
            className="ds-pressable flex h-[76px] w-full items-center justify-center rounded-[var(--radius-tile)] px-3 text-center text-12 font-semibold"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            {t("more.shortcuts.empty")}
          </button>
        ) : (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
            {activeShortcuts.map((row) => shortcutTile(row))}
          </div>
        )}
      </section>

      {groups.map((group) => {
        const rows = group.rows.filter((row) => row.show);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="mt-4" data-testid={`more-group-${group.id}`}>
            <ListCard
              section={t(group.headingKey)}
              variant="plain"
              separated={false}
              sectionSeparator
            >
              {rows.map((row) => (
                <ListRow
                  key={row.id}
                  icon={row.icon}
                  title={t(row.labelKey)}
                  description={t(row.descriptionKey)}
                  danger={row.danger}
                  testId={`more-row-${row.id}`}
                  onClick={row.onClick ?? (() => navigate(row.to, { state: row.state }))}
                  trailing={row.danger ? undefined : chevron}
                />
              ))}
            </ListCard>
          </section>
        );
      })}

      <div className="h-8" />

      <Sheet
        open={shortcutSheetOpen}
        title={t("more.shortcuts.title")}
        onClose={() => setShortcutSheetOpen(false)}
      >
        <div className="px-4 pt-1" data-testid="more-shortcuts-sheet">
          <p className="px-1 pb-2 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("more.shortcuts.hint")}
          </p>
          {shortcutCandidates.map((row) => {
            const Icon = row.icon;
            const selected = activeShortcutIds.includes(row.id);
            return (
              <ListRow
                key={row.id}
                icon={Icon}
                title={t(row.labelKey)}
                description={t(row.descriptionKey)}
                selected={selected}
                testId={`more-shortcut-toggle-${row.id}`}
                onClick={() => toggleShortcut(row.id)}
                trailing={<Checkbox checked={selected} />}
              />
            );
          })}
          <button
            type="button"
            onClick={() => setShortcutSheetOpen(false)}
            className="ds-btn-primary mt-3 w-full"
            data-testid="more-shortcuts-done"
          >
            {t("settings.done")}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
