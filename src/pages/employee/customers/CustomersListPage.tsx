import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import PullToRefresh from "@/components/ui/PullToRefresh";
import { SkeletonList } from "@/components/ui/Skeleton";
import CollectionPlate from "@/components/customers/CollectionPlate";
import SearchBar from "@/components/ui/SearchBar";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { hasPermission } from "@/lib/tenantContext";
import { Plus, ChevronRight, SlidersHorizontal, Check, UserRound } from "lucide-react";
import type { Customer } from "@/types";
import { isCreditOverdue } from "@/lib/signalEngine";
import { pkToday } from "@/lib/pkDate";
import {
  creditUsedPct,
  customerCreditState,
  summariseCustomerCollection,
  type CustomerCreditState,
} from "@/lib/customerCredit";

type SortKey = "outstanding" | "name" | "recent";
/**
 * This screen is the CREDIT book, not the address book (owner's correction, 2026-10-29): every
 * row here is an account that currently owes the branch something. "All" therefore means all
 * accounts with a balance, and the only narrower view worth a chip is the late ones.
 */
type CreditFilter = "all" | "overdue";

const SORT_OPTIONS: { key: SortKey; labelKey: "customers.sortBalance" | "customers.sortName" | "customers.sortNewest" }[] = [
  { key: "outstanding", labelKey: "customers.sortBalance" },
  { key: "name", labelKey: "customers.sortName" },
  { key: "recent", labelKey: "customers.sortNewest" },
];

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16", "#3b82f6", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#ef4444", "#10b981"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function sortCustomers(list: Customer[], sort: SortKey): Customer[] {
  const sorted = [...list];
  if (sort === "outstanding") {
    sorted.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  } else if (sort === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return sorted;
}

/**
 * The account list: who buys from this branch, what they owe it, and whether that debt is late.
 *
 * SHAPE (owner's reference, 2026-10-28): two headline counts, the search with its sort control,
 * four filters — All, Outstanding, Overdue, Paid — and one card per customer carrying the
 * figure, the limit it is measured against, and the state a reader would otherwise have to
 * work out from the date.
 *
 * THE FOUR FILTERS ARE THE APP'S OWN STATES. Outstanding is a balance above zero; Overdue is
 * the S1 rule (`isCreditOverdue`), the same test Reminders and Home use; Paid is the absence of
 * a balance. A customer with no credit limit keeps saying "cash customer" rather than showing a
 * usage bar measured against zero.
 *
 * THE COUNTS ARE THE LIST'S OWN ROWS, so the figures at the top can never describe a different
 * population from the cards below. Balances are the working branch's (`get_branch_customer_balances`,
 * 0242), not the shop-wide running columns.
 */
export default function CustomersListPage() {
  const navigate = useNavigate();
  const { state, search: addressQuery } = useLocation();
  const base = useShellBase();
  const t = useT();
  // The customer ledger opens from the Customers section, and from the Reports hub's tile.
  const returnTo = useReturnTo(
    base === "/admin" ? `${base}/settings/hub/customers` : `${base}/dashboard`,
  );
  const todayISO = pkToday();

  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);

  const initialFilter: CreditFilter = "all";
  const cropFilter = state?.cropFilter as string | undefined;
  const [creditFilter, setCreditFilter] = useState<CreditFilter>(initialFilter);
  // A search started on Customers & Credit arrives as `?q=` and lands here, where searching the
  // account list actually happens — one search field, one implementation.
  const [search, setSearch] = useState(
    () => new URLSearchParams(addressQuery).get("q") ?? "",
  );
  const [sort, setSort] = useState<SortKey>("outstanding");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  // Close sort menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    }
    if (showSortMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSortMenu]);

  // Load customer crops for filtering
  const getCustomerCrops = (customerId: string): string[] => {
    try {
      const raw = localStorage.getItem("customer_crops_" + customerId);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const filtered = customers.filter((c) => {
    // Only accounts that owe something. A settled customer is not a credit account, and listing
    // every name ever added made the owner scroll past people who have no money on this book.
    if (c.isArchived || c.outstandingBalance <= 0) return false;
    const term = search.trim().toLowerCase();
    const matchSearch = !term || c.name.toLowerCase().includes(term) || c.phone.includes(term);
    const matchState = creditFilter === "all" || isCreditOverdue(c, todayISO);
    return matchSearch && matchState &&
      (!cropFilter || getCustomerCrops(c.id).includes(cropFilter));
  });

  const sorted = sortCustomers(filtered, sort);
  // The headline is the branch's own rows, summarised by the same function the Customers &
  // Credit screen uses — one rule for "owed" and one rule for "late" across both screens.
  const summary = useMemo(
    () => summariseCustomerCollection(customers, todayISO),
    [customers, todayISO],
  );

  async function handleRefresh() {
    await useCustomersStore.getState().load();
  }

  const filters: { key: CreditFilter; label: string }[] = [
    { key: "all", label: t("products.all") },
    { key: "overdue", label: t("receivable.overdue") },
  ];

  /** The chip that says which of the four states the card is in. */
  const stateChip = (status: CustomerCreditState) => {
    const label =
      status === "overdue"
        ? t("receivable.overdue")
        : status === "not_due"
          ? t("customers.notYetDue")
          : status === "no_due_date"
            ? t("reminder.statusNoDueDate")
            : t("reminder.statusPaid");
    const color =
      status === "overdue"
        ? "var(--error)"
        : status === "not_due"
          ? "var(--text-secondary)"
          : status === "no_due_date"
            ? "var(--text-tertiary)"
            : "var(--brand-dark)";
    return (
      <span
        className="text-10 font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ color, background: "var(--surface-2)" }}
      >
        {label}
      </span>
    );
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div
        className="flex flex-col w-full min-h-full"
        style={{ background: "var(--background)" }}
        data-testid="customers-list-page"
      >
        <StatusBar />
        <NavHeader
          title={t("settings.menu.customers")}
          backTo={returnTo}
        />

        {/* The header is the collection plate (owner's reference, 2026-10-29): what the branch is
            owed, how much of that has come back, and the three populations that make the figure
            up. Every number here is the list's own rows, summarised by
            `summariseCustomerCollection` — the same function the Customers & Credit screen uses —
            so the plate can never describe a different population from the cards under it, and
            "overdue" is the app's S1 rule rather than a second date comparison written here. */}
        <div className="px-4 pt-1">
          <h1 className="text-22 font-bold leading-tight">{t("hub.customers.collectionTitle")}</h1>
          <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("hub.customers.collectionSubtitle")}
          </p>
        </div>

        {/* Three figures, unboxed, and nothing else (owner's correction, 2026-10-29): what these
            accounts owe, what is not late yet, and what is. This is the screen the owner opens
            after tapping Customers, so it answers the money question at a glance — no progress
            bar, no collection totals, no count tiles. The full collection plate stays on the
            Customers & Credit section, which is the screen that reports on the book. Unboxed so
            the two screens cannot be mistaken for one another. */}
        <div className="px-4 pt-5 grid grid-cols-3 gap-3">
          <div className="min-w-0">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("receivable.totalOutstanding")}
            </p>
            <p
              className="text-18 font-bold mt-1 tabular-nums break-words"
              data-testid="customers-total-outstanding"
            >
              {ready ? formatCurrency(summary.due) : "—"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("receivable.pending")}
            </p>
            <p className="text-18 font-bold mt-1 tabular-nums break-words" data-testid="customers-pending">
              {ready ? formatCurrency(summary.due - summary.overdueDue) : "—"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("receivable.overdue")}
            </p>
            <p
              className="text-18 font-bold mt-1 tabular-nums break-words"
              data-testid="customers-overdue"
              style={{ color: summary.overdueDue > 0 ? "var(--error)" : "var(--text-primary)" }}
            >
              {ready ? formatCurrency(summary.overdueDue) : "—"}
            </p>
          </div>
        </div>

        {/* Search + sort */}

        <div className="px-4 pt-3 pb-3 flex gap-2 items-center">
          <SearchBar
            containerClass="flex-1 min-w-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder={t("customers.search")}
          />

          <div className="relative" ref={sortMenuRef}>
            <button
              type="button"
              onClick={() => setShowSortMenu(!showSortMenu)}
              aria-label={t("common.sort")}
              aria-expanded={showSortMenu}
              className="size-10 rounded-full flex items-center justify-center shrink-0 active:opacity-70"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
            >
              <SlidersHorizontal size={16} />
            </button>

            {showSortMenu && (
              <div
                className="absolute end-0 top-12 w-52 rounded-[var(--radius-card)] shadow-xl overflow-hidden z-50"
                style={{ background: "var(--surface)" }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setSort(opt.key); setShowSortMenu(false); }}
                    className="flex items-center justify-between w-full px-4 py-3 text-start active:opacity-70"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                  >
                    <span
                      className="text-13 font-semibold"
                      style={{ color: sort === opt.key ? "var(--brand-dark)" : "var(--text-primary)" }}
                    >
                      {t(opt.labelKey)}
                    </span>
                    {sort === opt.key && <Check size={16} style={{ color: "var(--brand)" }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Two views of the credit book: everyone who owes, or only the late ones. */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setCreditFilter(f.key)}
              aria-pressed={creditFilter === f.key}
              className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
              style={{
                background: creditFilter === f.key ? "var(--brand)" : "var(--surface-2)",
                color: creditFilter === f.key ? "#0a0a0a" : "var(--text-secondary)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {cropFilter && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={() => navigate(".", { state: { ...state, cropFilter: undefined } })}
              className="h-8 px-3 rounded-full text-12 font-semibold flex items-center gap-2"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
            >
              {cropFilter}
              <span aria-hidden>×</span>
            </button>
          </div>
        )}

        {!ready ? (
          <SkeletonList rows={5} tile />
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 gap-2">
            <UserRound size={28} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-14 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
              {search ? t("sale.noCustomersMatch") : creditFilter === "overdue" ? t("customers.noneFound") : t("customers.noneOwing")}
            </p>
            {!search && creditFilter === "all" && (
              <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
                {t("customers.addNew")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 px-4 pb-24">
            {sorted.map((c) => {
              const bg = initBgColor(c.name);
              const hasDebt = c.outstandingBalance > 0;
              const used = creditUsedPct(c);
              const status = customerCreditState(c, todayISO);

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`${base}/customers/${c.id}`)}
                  data-testid={`customer-row-${c.id}`}
                  className="rounded-[var(--radius-card)] p-3.5 text-start active:opacity-70"
                  style={{ background: "var(--surface)" }}
                >
                  <div className="flex items-start gap-3">
                    {c.imageUrl ? (
                      <img
                        src={c.imageUrl}
                        alt=""
                        className="rounded-full shrink-0 size-11 object-cover"
                      />
                    ) : (
                      <div
                        className="flex items-center justify-center rounded-full shrink-0 size-11 text-16 font-bold"
                        style={{ background: bg, color: "#fff" }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-15 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                            {c.name}
                          </p>
                          <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                            {c.phone}
                          </p>
                        </div>
                        <div className="shrink-0 text-end">
                          <p
                            className="text-13 font-bold tabular-nums"
                            style={{ color: hasDebt ? "var(--text-primary)" : "var(--text-secondary)" }}
                          >
                            {hasDebt ? formatCurrency(c.outstandingBalance) : t("customers.noOutstanding")}
                          </p>
                          <ChevronRight size={14} className="ms-auto mt-1" style={{ color: "var(--text-secondary)" }} />
                        </div>
                      </div>

                      {/* How much of the limit is used. A limit of zero is not a bar measured at
                          full width, it is no limit at all — the row says so instead. */}
                      {used != null ? (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${used}%`,
                                background:
                                  status === "overdue"
                                    ? "var(--error)"
                                    : used >= 80
                                      ? "var(--warning)"
                                      : "var(--brand)",
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1.5">
                            <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                              {used}{t("credit.percentUsed")}
                            </p>
                            {stateChip(status)}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 mt-2">
                          <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                            {t("customers.creditLimit")} — {t("customers.noLimitSet")}
                          </p>
                          <span
                            className="text-10 font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                          >
                            {t("credit.cashCustomer")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Add Customer — shown to whoever holds `customers.create`, the grant the create
          RPC checks, rather than to the admin shell alone. */}
      {hasPermission("customers.create") && (
        <div
          className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40 px-4 flex justify-end"
          style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
        >
          <button
            type="button"
            onClick={() => navigate(`${base}/customers/new`)}
            className="pointer-events-auto ps-4 pe-5 rounded-full flex items-center gap-2 text-14 font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> {t("customers.addNew")}
          </button>
        </div>
      )}
    </PullToRefresh>
  );
}
