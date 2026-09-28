import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  UserCheck,
  ShoppingCart,
  BarChart2,
  CreditCard,
  Settings,
  History,
  AlertTriangle,
  Calculator,
  ScanLine,
  ChevronRight,
  Compass,
  Plus,
  Store,
  Check,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import BusinessSettingsSheet from "@/components/ui/BusinessSettingsSheet";
import { useOwnerRows, type SuiteGroup } from "@/lib/ownerRows";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import BranchEditSheet from "@/components/shop/BranchEditSheet";
import DeleteTargetSheet, { branchDeleteSubject } from "@/components/shop/DeleteTargetSheet";
import { useT, type I18nKey } from "@/lib/i18n";
import { branchContextLabel } from "@/lib/branchContext";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";
import { useShopStore } from "@/stores/shopStore";
import type { BranchSummary } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";

/**
 * Where a row sits inside its group. An id the group's `order` does not name keeps the row
 * visible and puts it after the ones that were named, rather than dropping it.
 */
function rankIn(group: (typeof GROUPS)[number], id: string): number {
  const index = group.order.indexOf(id);
  return index === -1 ? group.order.length : index;
}

/**
 * The owner suite menu.
 *
 * Rows use the same treatment as Settings — `ListCard` + `ListRow` with a plain thin-stroke
 * leading icon at the icon token's size in `--text-secondary`, and the 52px separator inset
 * that icon implies. They previously carried a per-row coloured square tile, which was the
 * one place in the app that read as a different visual language: the reference uses a
 * coloured tile only for an entity that has a *logo to show*, never as decoration for a
 * navigation row. Matching Settings also means `--icon` now governs these glyphs.
 *
 * `labelKey` is typed as `I18nKey`, so a key that does not exist fails `tsc` instead of
 * silently rendering the raw key; the hardcoded English `label:` fallbacks this file used to
 * carry are gone, since every entry resolves through the dictionary in both languages.
 */
/**
 * `anchor` is the guided tour's handle on this row: the real row element carries
 * `data-tour`, so the tour can ring the row itself instead of approximating where
 * it might be. Additive — it changes nothing about how a row looks or behaves.
 */
interface MenuRow {
  id: string;
  labelKey: I18nKey;
  icon: LucideIcon;
  path: string;
  anchor: string;
}

/**
 * The same twelve rows, grouped by the question they answer.
 *
 * One flat list of twelve was a wall the eye had to read top to bottom to find anything, and
 * the order was the order the features were built in, not the order a shopkeeper thinks in.
 * Each group now carries a title and holds the rows that belong under it:
 *
 *   • **Money** — what came in, what was paid out, what it earned.
 *   • **Stock** — what is on the shelf, how it got there, what to buy next.
 *   • **People** — who buys from you and who sells to you.
 *   • **App** — the guide and the settings.
 *
 * Within a group the rows stay in the order they are used most. Nothing else changed: same
 * labels, same icons, same routes, and every row keeps the `data-tour` anchor the guided tour
 * rings it by.
 *
 * A group holds two kinds of row: the ones that always live here (`rows`) and the ones that
 * come from the shared catalogue and can be moved to Settings (`ownerOrder`). `order` names
 * every id the group can show, in the order it reads in, so a catalogue row takes its place
 * among the fixed ones — Inventory stays the first row under Stock, which is where it has
 * always been, whether or not it is still here. An id the group forgot falls to the end rather
 * than vanishing.
 */
const GROUPS: Array<{
  group: SuiteGroup;
  sectionKey: I18nKey;
  rows: MenuRow[];
  /** Every row id this group can show, in reading order. */
  order: string[];
}> = [
  {
    group: "money",
    sectionKey: "more.groupMoney",
    rows: [
      { id: "payments", labelKey: "admin.payments", icon: CreditCard, path: "/payments", anchor: "more:payments" },
      { id: "dailyCash", labelKey: "admin.dailyCash", icon: Calculator, path: "/payments/daily-cash", anchor: "more:dailyCash" },
      { id: "reports", labelKey: "admin.reports", icon: BarChart2, path: "/reports", anchor: "more:reports" },
    ],
    order: ["payments", "dailyCash", "reports"],
  },
  {
    group: "stock",
    sectionKey: "more.groupStock",
    rows: [
      { id: "purchases", labelKey: "admin.purchases", icon: ShoppingCart, path: "/purchases", anchor: "more:purchases" },
      { id: "movements", labelKey: "admin.stockMovements", icon: History, path: "/inventory/movements", anchor: "more:movements" },
      { id: "reorder", labelKey: "admin.reorderSuggestions", icon: AlertTriangle, path: "/inventory/reorder", anchor: "more:reorder" },
      { id: "barcodes", labelKey: "admin.generateBarcodes", icon: ScanLine, path: "/inventory/barcodes", anchor: "more:barcodes" },
    ],
    // Inventory leads the group; Crop configuration is setup, so it follows the daily rows.
    order: ["inventory", "purchases", "movements", "reorder", "barcodes", "crops"],
  },
  {
    group: "people",
    sectionKey: "more.groupPeople",
    // Companies and Employees are catalogue rows (they can be moved to Settings), so they are
    // not repeated here — they arrive through `rowsOn("suite")` with their own group.
    rows: [
      { id: "customers", labelKey: "admin.customers", icon: UserCheck, path: "/customers", anchor: "more:customers" },
    ],
    order: ["customers", "companies", "employees", "roles"],
  },
  {
    group: "app",
    sectionKey: "more.groupApp",
    rows: [
      { id: "guide", labelKey: "edu.guide.title", icon: Compass, path: "/guide", anchor: "more:guide" },
      { id: "settings", labelKey: "admin.settings", icon: Settings, path: "/settings", anchor: "more:settings" },
    ],
    order: ["guide", "settings"],
  },
];

export default function MoreMenuPage() {
  const navigate = useNavigate();
  const t = useT();
  const base = useShellBase();
  // A chevron points along the reading direction, so in RTL the "onward" direction is
  // left. Mirrored by rotation, which is the pattern this app already uses elsewhere
  // (GroupDetailPage) rather than a second convention.
  const { isRtl } = useDir();
  const activeShopName = useShopStore((s) => s.activeShopName);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const membershipRole = useAuthStore((s) => s.user?.membershipRole);
  const { rowsOn } = useOwnerRows();
  // Crop configuration is a sheet, not a screen, so it opens here exactly as it opens from
  // Settings — one sheet, whichever screen the row is currently on.
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Branches ──────────────────────────────────────────────────────────────────
  const branches = useShopStore((s) => s.branches);
  const branchesLoading = useShopStore((s) => s.branchesLoading);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const branchesError = useShopStore((s) => s.branchesError);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const [editing, setEditing] = useState<BranchSummary | null>(null);
  const [deleting, setDeleting] = useState<BranchSummary | null>(null);

  /**
   * Read the branches when this screen is opened, not once at sign-in.
   *
   * This is the screen where a branch is added or removed, so it is the one screen that has
   * to be right immediately after somebody changes something — on this phone or another
   * one. `branchesLoaded` keeps the repeat visits free.
   */
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  // What one branch holds. One derivation, shared with Home (`lib/branchContext`), because
  // two screens writing the same sentence is how they start disagreeing about the same
  // branch.
  const branchContext = (b: BranchSummary) => branchContextLabel(t, b);

  // What this account is in THIS shop — the same three words Settings uses. It used to be a
  // constant ("Owner access") printed for everyone who opened this screen.
  const roleLabel =
    membershipRole === "owner" ? t("settings.owner")
    : membershipRole === "admin" ? t("emp.admin")
    : t("search.employee");

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />

      {/* Top card — the shop this account is working in.
          The overline used to be the constant "Main Shop", a name that belonged to no shop on
          this device; the loudest line now carries the real name, read from the server. The
          whole card opens the shop selector, because "which shop am I in" and "switch shop"
          are one question — and it is the first thing on the screen furthest from accidentally
          leaving it.

          The three lines keep the hierarchy the card had (12 overline / 18 title / 12 below), so
          the shop name is the loudest thing on the screen while the four group titles below it
          still read as headings. */}
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => openSwitcher()}
          data-testid="shop-card"
          className="w-full text-start rounded-[var(--radius-card)] p-4 ds-pressable"
          style={{ background: "var(--brand)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-12 font-bold" style={{ color: "rgba(0,0,0,0.6)" }}>
              {t("shop.yourShop")}
            </p>
            <p
              className="flex items-center gap-1 text-11 font-bold shrink-0"
              style={{ color: "rgba(0,0,0,0.6)" }}
            >
              {t("shop.switch")}
              <ChevronRight
                size={13}
                style={{ transform: isRtl ? "rotate(180deg)" : undefined }}
              />
            </p>
          </div>
          <p className="text-18 font-bold mt-0.5 truncate" style={{ color: "#0a0a0a" }}>
            {activeShopName ?? t("shop.yourShop")}
          </p>
          <p className="text-12 mt-1 truncate" style={{ color: "rgba(0,0,0,0.55)" }}>
            {roleLabel}
          </p>
        </button>
      </div>

      {/* ── Branches ──
          The owner's own screen for the branches this account runs: the one it registered
          with first (renameable, never deletable), then every branch added afterwards, each
          with the two things management means — edit it, or remove it. A row is not a
          navigation target: which branch you are WORKING in is the card above, and mixing
          "open this branch" into the same row as "delete this branch" is how the wrong one
          gets tapped. */}
      <div className="px-4 pt-4" data-testid="branches-section">
        <ListCard section={t("branches.title")}>
          {branchesLoading && branches.length === 0 && (
            <div data-testid="branches-loading">
              <SkeletonList rows={2} />
            </div>
          )}

          {!branchesLoading && branches.length === 0 && (
            <ListRow
              title={t(branchesError === "load_failed" ? "branches.loadFailed" : "shop.noneOwned")}
              testId="branches-empty"
              trailing={
                branchesError === "load_failed" ? (
                  <Button variant="outline" size="sm" onClick={() => void loadBranches()}>
                    {t("common.tryAgain")}
                  </Button>
                ) : undefined
              }
            />
          )}

          {branches.map((branch) => {
            // "Which one am I in" is read from the ONE owner of that fact — the same value
            // the header and every query follow — rather than from the row's own snapshot,
            // so a switch marks the right row without waiting for this list to reload.
            const isCurrent = branch.id === activeShopId;
            return (
            <ListRow
              key={branch.id}
              testId={`branch-row-${branch.id}`}
              tile={
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: isCurrent ? "var(--brand)" : "var(--tone-sunken)",
                    color: isCurrent ? "#0a0a0a" : "var(--text-secondary)",
                  }}
                  aria-hidden="true"
                >
                  <Store size={16} />
                </div>
              }
              title={branch.name}
              // One state, not two: the branch you are in is the more useful fact, and the
              // main one is already first in the list with its own note in the edit sheet.
              qualifier={
                isCurrent ? t("branches.mine") : branch.isMain ? t("branches.main") : undefined
              }
              meta={branchContext(branch)}
              trailing={
                <div className="flex items-center gap-3 shrink-0">
                  {isCurrent && (
                    <Check size={16} style={{ color: "var(--brand-dark)" }} />
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(branch)}
                    data-testid={`branch-edit-action-${branch.id}`}
                    className="text-12 font-bold ds-pressable"
                    style={{ color: "var(--brand-dark)" }}
                  >
                    {t("branches.edit")}
                  </button>
                  {/* The main branch has no Delete at all: it is refused by the database,
                      and a control that exists only to be refused is a lie about what is
                      possible. Renaming it is how it is managed. */}
                  {!branch.isMain && (
                    <button
                      type="button"
                      onClick={() => setDeleting(branch)}
                      data-testid={`branch-delete-action-${branch.id}`}
                      className="text-12 font-bold ds-pressable"
                      style={{ color: "var(--error)" }}
                    >
                      {t("branches.delete")}
                    </button>
                  )}
                </div>
              }
            />
            );
          })}

          {/* The way in, as a row of the same list rather than a button floating under it:
              adding a branch belongs to the set of branches, and it is the last thing in
              that set because it is the newest. */}
          <ListRow
            testId="branches-create"
            icon={Plus}
            title={t("branches.create")}
            meta={t("branches.createHint")}
            // `create` rather than the plain open: this row asked for a new branch, and the
            // sheet opens on the name step instead of making the person find the link again.
            onClick={() => openSwitcher("create")}

          />
        </ListCard>

      </div>

      {/* Editing and deleting are one sheet each, mounted here rather than inside a row, so
          there is exactly one of each and nothing is left half-open when the list changes. */}
      {editing && (
        <BranchEditSheet
          branch={editing}
          onClose={() => setEditing(null)}
          onRenamed={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteTargetSheet
          subject={branchDeleteSubject(deleting)}
          onClose={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      )}

      {/* One titled card per group. The card title is the same section label the rest of the
          app uses above a list, so a group of rows here reads exactly like a group of rows
          anywhere else. */}
      {GROUPS.map((group) => {
        // One list per group: the rows that always live here, plus the catalogue rows that are
        // on this screen right now, sorted into the group's own reading order.
        const entries = [
          ...group.rows.map((row) => ({ kind: "route" as const, ...row })),
          ...rowsOn("suite")
            .filter((row) => row.group === group.group)
            .map((row) => ({
              kind: "owner" as const,
              id: row.id,
              labelKey: row.labelKey,
              icon: row.icon,
              path: row.path,
              anchor: row.anchor,
              metaKey: row.metaKey,
            })),
        ].sort((a, b) => rankIn(group, a.id) - rankIn(group, b.id));

        return (
          <div key={group.sectionKey} className="px-4 pt-4">
            <ListCard section={t(group.sectionKey)}>
              {entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <ListRow
                    key={entry.id}
                    anchor={entry.anchor}
                    icon={Icon}
                    // A catalogue row whose `path` is null opens a sheet rather than a screen —
                    // the same sheet Settings opens, so there is one of it in the app.
                    onClick={() => (entry.path ? navigate(`${base}${entry.path}`) : setSheetOpen(true))}
                    title={t(entry.labelKey)}
                    meta={entry.kind === "owner" && entry.metaKey ? t(entry.metaKey) : undefined}
                    trailing={
                      <ChevronRight
                        size={14}
                        className="ds-row-chevron shrink-0"
                        style={{ color: "var(--text-secondary)", transform: isRtl ? "rotate(180deg)" : undefined }}
                      />
                    }
                  />
                );
              })}
            </ListCard>
          </div>
        );
      })}

      {sheetOpen && <BusinessSettingsSheet onClose={() => setSheetOpen(false)} onSave={() => {}} />}

      <div className="pb-4" />
    </div>
  );
}
