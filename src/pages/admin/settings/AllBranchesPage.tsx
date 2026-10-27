import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2, ChevronRight, FileText, LayoutGrid, Loader2, Store, TrendingUp,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import BranchKindChip from "@/components/ui/BranchKindChip";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";
import { branchKind } from "@/lib/branchKind";
import { branchPlaceLine } from "@/lib/branchContext";
import { formatCurrency } from "@/lib/formatters";

/** The three ways out of a branch card. */
type BranchAction = "details" | "performance" | "reports";

/**
 * Every branch this account may work in, as cards.
 *
 * This is where the Branches section's first row — "All branches" — lands, and it is the one
 * screen that answers "which branches do I have, and what is in each of them" before the account
 * has decided where to work. Everything on a card is REAL: the name, the place, the kind and the
 * sales figure all come from `get_my_branches()` (the same read the switcher and the Branches
 * block on Settings use), which means no card can show a number this account is not entitled to
 * see — a figure the caller may not read arrives as null and is drawn as "—", never as zero.
 *
 * ONE FIGURE, AND THE PERIOD IS NAMED. The sales figure is the branch's sales billed to date —
 * the same number, under the same words ("Sales to date"), that the Business Overview's branch
 * comparison shows. Period-scoped per-branch figures are not in that read: sales arrive per
 * branch as a lifetime total, and the period reports are scoped to the branch the account is
 * WORKING in. Saying "this month" here would be inventing a window the read does not have, so
 * the line says what the number is.
 *
 * TWO COUNTRIES OF THE SAME FACT, said as the owner reads them: "Authorized branches" is what
 * this account may enter, "Active branches" is which of those are open. The read only returns
 * branches that are both, so the two figures agree today; they are separate because they are
 * separate questions — and when an archived branch becomes visible to this screen, the second
 * figure is the one that moves.
 *
 * THE THREE ACTIONS ARE NOT THE SAME KIND OF THING, and they are drawn from what each really
 * does:
 *
 *   Details      — the branch's own page (name, place, marketplace, roles, who is responsible,
 *                  delete). Facts about the branch, so it needs no branch context: it opens
 *                  straight away.
 *   Performance  — the Business Overview FOR that branch, and
 *   Reports      — that branch's reports.
 *
 * The last two are branch-scoped screens in a one-branch-at-a-time app: the loaded ledger is the
 * working branch's, so opening them without working in that branch would show another branch's
 * numbers under this branch's name. Each therefore switches the working branch first — the same
 * act, with the same words, as the branch switcher — and only then navigates.
 */
export default function AllBranchesPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { isRtl } = useDir();

  const branches = useShopStore((s) => s.branches);
  const branchesLoading = useShopStore((s) => s.branchesLoading);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const branchesError = useShopStore((s) => s.branchesError);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const switchBranch = useShopStore((s) => s.switchBranch);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const { addToast } = useUIStore();

  const [query, setQuery] = useState("");
  /** The branch whose action is in flight, so only that card shows the waiting mark. */
  const [opening, setOpening] = useState<string | null>(null);
  /**
   * The re-entry guard, and it is a ref on purpose: a state variable is still false for the
   * second tap in the same task — which is what a double tap is — and two switches would then
   * race, with the second navigation landing on whichever branch answered last.
   */
  const openingRef = useRef(false);

  // Read on arrival, not once at sign-in: this is the list a branch is added to or removed from,
  // so it is the screen that has to be right immediately after somebody changes something —
  // here or on another phone. `branchesLoaded` keeps repeat visits free.
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  // The search asks the question the person is asking — by name, or by where the branch is. A
  // branch with no pin carries neither, so it simply does not match rather than matching
  // everything.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter((branch) =>
      [branch.name, branch.place?.address, branch.place?.label]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [branches, query]);

  const authorized = branches.length;
  const active = branches.filter((branch) => branch.membershipStatus === "active").length;

  /**
   * One way out of a card.
   *
   * The waiting mark is state (`opening`), but the GUARD is `openingRef` — the ref is claimed
   * synchronously, so a second tap in the same task is refused before React has re-rendered.
   * While an action is in flight every action is refused, so a second tap cannot start a second
   * switch or navigate to a screen whose branch is still the old one.
   */
  async function openBranch(branch: BranchSummary, action: BranchAction) {
    if (openingRef.current) return;

    if (action === "details") {
      navigate(`${base}/settings/branches/${branch.id}`);
      return;
    }

    openingRef.current = true;
    setOpening(branch.id);
    try {
      if (branch.id !== activeBranchId) {
        const result = await switchBranch(branch.id);
        if (!result.ok) {
          addToast(
            t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"),
            "error",
          );
          return;
        }
        addToast(t("shop.switched", { shop: branch.name }), "success");
      }
      navigate(`${base}${action === "performance" ? "/settings/branch-details" : "/reports"}`);
    } finally {
      openingRef.current = false;
      setOpening(null);
    }
  }

  /** A branch card's one figure: what it says, what it is worth, and whether it is a window. */
  function Figure({ label, value, note }: { label: string; value: number | null; note: string }) {
    return (
      <div className="min-w-0">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <p className="text-20 font-bold mt-1 tabular-nums break-words">
          {value != null ? value.toLocaleString("en-PK") : "—"}
        </p>
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>{note}</p>
      </div>
    );
  }

  /** One of a card's three actions. The glyph carries the meaning; the word confirms it. */
  function ActionTile({
    icon: Icon, label, testId, busy, onPress,
  }: {
    icon: LucideIcon;
    label: string;
    testId: string;
    busy: boolean;
    onPress: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onPress}
        data-testid={testId}
        // A tone step back from the card, not a border: resting surfaces in this app are
        // separated by tone, and an outlined box inside a card reads as a field.
        className="h-14 rounded-[var(--radius-tile)] flex flex-col items-center justify-center gap-1 ds-pressable"
        style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
      >
        {busy
          ? <Loader2 size={18} strokeWidth={1.8} className="animate-spin" />
          : <Icon size={18} strokeWidth={1.8} />}
        <span className="text-11 font-semibold text-center leading-tight px-1">{label}</span>
      </button>
    );
  }

  const loading = !branchesLoaded && branchesLoading;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="all-branches-page"
    >
      <StatusBar />
      {/* A step back into the Branches section, which is where this row lives. */}
      <NavHeader title={t("branches.title")} backTo={`${base}/settings/hub/branches`} />

      {/* What the list below is, and the two counts that describe it. The counts are drawn from
          the same rows the cards are, so the summary cannot disagree with the list. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="branches-summary"
        >
          <p className="text-16 font-bold" data-testid="branches-summary-title">
            {t("branches.title")}
          </p>
          <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("branches.subtitle")}
          </p>

          {loading ? (
            <div className="mt-3"><SkeletonList rows={1} bare tile={false} /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 mt-3.5">
              <Figure
                label={t("branches.authorized")}
                value={authorized}
                note={t("branches.authorizedHint")}
              />
              <Figure
                label={t("branches.active")}
                value={active}
                note={t("branches.activeHint")}
              />
            </div>
          )}
        </div>
      </div>

      {/* One search field, the app's own. */}
      {!loading && !branchesError && branches.length > 0 && (
        <div className="px-4 pt-3.5">
          <SearchBar
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            placeholder={t("branches.searchPlaceholder")}
            aria-label={t("branches.searchPlaceholder")}
            data-testid="branches-search"
          />
        </div>
      )}

      <div className="px-4 pt-3.5 pb-8 flex flex-col gap-3">
        {loading && <SkeletonList rows={3} />}

        {!loading && branchesError === "load_failed" && (
          <EmptyState
            icon={Store}
            title={t("branches.loadFailed")}
            action={{ label: t("common.tryAgain"), onClick: () => void loadBranches() }}
          />
        )}

        {!loading && !branchesError && branches.length === 0 && (
          <EmptyState icon={Store} title={t("shop.noneOwned")} />
        )}

        {!loading && !branchesError && branches.length > 0 && matches.length === 0 && (
          <EmptyState icon={Store} title={t("branches.noMatch")} subtitle={query.trim()} />
        )}

        {!loading && !branchesError && matches.map((branch) => {
          const kind = branchKind(t, branch.isMain);
          const isCurrent = branch.id === activeBranchId;
          // The same line the branch's own page opens with, from `lib/branchContext` — one
          // derivation, so the two screens cannot describe the same branch differently.
          const where = branchPlaceLine(branch);
          return (
            <div
              key={branch.id}
              data-testid={`branch-card-${branch.id}`}
              className="rounded-[var(--radius-card)] overflow-hidden"
              style={{ background: "var(--tone-card)" }}
            >
              {/* The card's top half is the way into the branch itself. Its Sales figure and the
                  three actions below are the things you came here to compare and open, so they
                  are not squeezed into the same tap target as "open this branch". */}
              <button
                type="button"
                onClick={() => void openBranch(branch, "details")}
                data-testid={`branch-card-open-${branch.id}`}
                className="w-full text-start p-4 flex items-start gap-3 ds-pressable"
              >
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: isCurrent ? "var(--brand)" : "var(--tone-sunken)",
                    color: isCurrent ? "#0a0a0a" : "var(--text-secondary)",
                  }}
                  aria-hidden="true"
                >
                  <Store size={16} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-16 font-bold truncate">{branch.name}</span>
                    {kind && <BranchKindChip isMain={branch.isMain} label={kind} />}
                    {isCurrent && (
                      <span className="text-10 font-semibold shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {t("shop.current")}
                      </span>
                    )}
                  </span>
                  <span
                    className="block text-12 mt-1 truncate"
                    style={{ color: "var(--text-secondary)" }}
                    data-testid={`branch-card-where-${branch.id}`}
                  >
                    {where ?? t("branches.noLocation")}
                  </span>
                  {/* Which branch this is, and whether it is open — the same word the Employees
                      list uses for a live membership, so "active" means one thing in this app. */}
                  <span
                    className="flex items-center gap-1.5 text-12 mt-1.5"
                    style={{ color: "var(--brand-dark)" }}
                    data-testid={`branch-card-status-${branch.id}`}
                  >
                    <CheckCircle2 size={13} />
                    {t(branch.membershipStatus === "active" ? "employees.active" : "employees.invited")}
                  </span>
                </span>

                <ChevronRight
                  size={16}
                  className="shrink-0 mt-1"
                  style={{
                    color: "var(--text-secondary)",
                    transform: isRtl ? "rotate(180deg)" : undefined,
                  }}
                />
              </button>

              <div className="px-4 pb-4">
                <div className="pt-3.5" style={{ borderTop: "1px solid var(--divider)" }}>
                  {/* The branch's own sales figure, and the words that say what it is. A figure
                      this account may not read arrives as null and is never drawn as zero. */}
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                        {t("overall.salesToDate")}
                      </p>
                      <p
                        className="text-18 font-bold mt-0.5 tabular-nums break-words"
                        data-testid={`branch-card-sales-${branch.id}`}
                      >
                        {branch.salesTotal != null ? formatCurrency(branch.salesTotal) : "—"}
                      </p>
                    </div>
                    <p className="text-11 shrink-0" style={{ color: "var(--text-tertiary)" }}>
                      {t("sales.allTime")}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <ActionTile
                      icon={LayoutGrid}
                      label={t("branches.actionDetails")}
                      testId={`branch-action-details-${branch.id}`}
                      busy={false}
                      onPress={() => void openBranch(branch, "details")}
                    />
                    <ActionTile
                      icon={TrendingUp}
                      label={t("branches.actionPerformance")}
                      testId={`branch-action-performance-${branch.id}`}
                      busy={opening === branch.id}
                      onPress={() => void openBranch(branch, "performance")}
                    />
                    <ActionTile
                      icon={FileText}
                      label={t("branches.actionReports")}
                      testId={`branch-action-reports-${branch.id}`}
                      busy={opening === branch.id}
                      onPress={() => void openBranch(branch, "reports")}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
