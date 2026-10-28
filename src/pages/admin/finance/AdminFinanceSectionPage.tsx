import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  ChevronRight,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/credit/CreditListScreen";
import FinanceMovementRow from "@/components/finance/FinanceMovementRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hubSection } from "@/lib/settingsHub";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { loadPaymentLedger, type LedgerPayment } from "@/lib/paymentLedger";
import { formatCurrency } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";
import { cashTakenInMonth, recentMovements } from "@/lib/financeSummary";

/**
 * Finance, as one screen: what the branch collected, what it is owed and what it owes, the
 * four jobs inside the section, and the money that moved most recently.
 *
 * SHAPE (owner's reference, 2026-10-29): the section's name, its one-sentence purpose and the
 * branch these figures describe, then one tinted summary card holding the month's recorded cash
 * with receivables and payables under it, the three month counts beneath that, then the
 * section's jobs and the last three recorded payments. This is the same anatomy Cash position
 * draws — the hub and the screen it opens are read as one family — and the same grammar as the
 * Sales, Products & Inventory, Customers & Credit and Purchases & Suppliers hubs.
 *
 * EVERY FIGURE IS A REAL ONE, AND EACH HAS ONE DEFINITION.
 *   - Recorded cash comes from `lib/financeSummary`, the same month arithmetic the branch
 *     overview uses, and it is money taken on this month's sales — never a made-up balance.
 *   - Receivables are the branch's customer balances the database derives (0242); payables are
 *     the supplier balances from the same read. They are shown next to each other and never
 *     netted, because one is money coming and the other is money going.
 *   - Recent activity is the payments ledger the Payments screen already reads, newest first.
 *
 * NO FAKE CONTROLS, AND NO INVENTED MONEY. The reference drew a bank-style cash position. The
 * app records what came in and what went out; it holds no opening till balance, so the number
 * is labelled "recorded cash" and captioned with the period it covers. A figure that could not
 * be read is "—", never zero.
 */
export default function AdminFinanceSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);

  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);

  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  // The payments ledger has no store: it is read when a screen needs it and kept here.
  const [entries, setEntries] = useState<LedgerPayment[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);

  const canPayments = hasPermission("payments.view");
  const canCustomers = hasPermission("customers.view");
  const canCompanies = hasPermission("companies.view");

  useEffect(() => {
    if (!salesReady) void loadSales();
    if (!customersReady) void loadCustomers();
    if (!companiesReady) void loadCompanies();
  }, [
    salesReady, loadSales,
    customersReady, loadCustomers,
    companiesReady, loadCompanies,
  ]);

  useEffect(() => {
    let live = true;
    loadPaymentLedger()
      .then((ledger) => {
        if (live) setEntries(ledger.entries);
      })
      .catch(() => {
        // An unread ledger is drawn as unknown, not as "no money moved".
        if (live) setLedgerFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const month = pkToday().substring(0, 7);
  const branch = useShopStore((s) => s.activeBranchName);
  const cash = useMemo(() => cashTakenInMonth(sales, month), [sales, month]);
  // The same month the cash figure covers, counted: the three tiles under the summary describe
  // the rows the Payments screen lists, so the hub and that screen cannot disagree about how
  // many movements made the month.
  const monthEntries = useMemo(
    () => (entries ?? []).filter((entry) => pkDateFromISO(entry.createdAt).startsWith(month)),
    [entries, month],
  );
  const counts = useMemo(
    () => ({
      all: monthEntries.length,
      in: monthEntries.filter((entry) => entry.direction === "in").length,
      out: monthEntries.filter((entry) => entry.direction === "out").length,
    }),
    [monthEntries],
  );
  const receivables = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0),
    [customers],
  );
  const payables = useMemo(
    () => companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0),
    [companies],
  );
  const recent = useMemo(() => recentMovements(entries ?? []), [entries]);

  /**
   * The four jobs, in the catalogue's order and with the catalogue's destinations.
   *
   * The labels and `to` come from `lib/settingsHub` — the same rows the Settings menu reads — so
   * this screen cannot send a reader somewhere the menu does not name, or rename a job on one
   * screen only. What the page owns is the icon, the one-line hint and the permission each job
   * asks for.
   */
  const JOB_LOOK: Record<string, { icon: LucideIcon; hint: string; allowed: boolean }> = {
    cash: { icon: Banknote, hint: t("financeHub.cashRowHint"), allowed: canPayments },
    receivables: { icon: HandCoins, hint: t("financeHub.receivablesRowHint"), allowed: canCustomers },
    payables: { icon: Building2, hint: t("financeHub.payablesRowHint"), allowed: canCompanies },
    transactions: { icon: ArrowLeftRight, hint: t("financeHub.transactionsRowHint"), allowed: canPayments },
  };
  const jobs = (hubSection("finance")?.rows ?? [])
    .filter((row) => JOB_LOOK[row.id]?.allowed)
    .map((row) => ({
      id: row.id,
      ...JOB_LOOK[row.id],
      title: t(row.labelKey),
      to: `${base}${row.to}`,
    }));

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="finance-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("settings.menu.finance")} backTo={`${base}/settings`} />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold">{t("financeHub.cashRecorded")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("financeHub.subtitle")}
        </p>
        {/* The same line, in the same place, as Cash position: which branch these figures
            describe. The section's screens are read as one family. */}
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
          {t("creditList.scope", { branch: branch ?? t("hub.inventory.selectedBranch") })}
        </p>
      </div>

      {/* The figure the section opens with, in the shape of the cash screen it opens: one
          tinted surface holding the month's figure with what is owed in each direction under
          it, then the three counts of the rows those directions come from. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="finance-hub-summary"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("cashPosition.thisMonth")}
          </p>
          {salesReady ? (
            <p
              className="text-22 font-bold mt-1 tabular-nums break-words"
              style={{ color: "var(--brand-dark)" }}
              data-testid="finance-hub-cash"
            >
              {formatCurrency(cash)}
            </p>
          ) : (
            <Skeleton w="140px" h="26px" className="mt-1" />
          )}
          <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
            {t("financeHub.cashHint")}
          </p>

          <div className="flex items-end justify-between gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--success)" }} />
                {t("hub.finance.receivables")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                data-testid="finance-hub-receivables"
              >
                {customersReady ? formatCurrency(receivables) : "—"}
              </p>
              <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {t("overall.oweYou")}
              </p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--error)" }} />
                {t("hub.finance.payables")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                data-testid="finance-hub-payables"
              >
                {companiesReady ? formatCurrency(payables) : "—"}
              </p>
              <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {t("overall.youOwe")}
              </p>
            </div>
          </div>
        </div>

        {/* The three counts behind the list the section opens. Figures only — the jobs below
            are the controls. */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          {entries ? (
            <>
              <StatTile
                testId="finance-hub-tile-movements"
                label={t("cashPosition.movements")}
                value={counts.all}
                caption={t("cashPosition.thisMonth")}
              />
              <StatTile
                testId="finance-hub-tile-received"
                label={t("cashPosition.received")}
                value={counts.in}
                caption={t("payments.moneyReceivedHint")}
                color={counts.in > 0 ? "var(--success)" : undefined}
              />
              <StatTile
                testId="finance-hub-tile-paid"
                label={t("cashPosition.paid")}
                value={counts.out}
                caption={t("payments.moneyPaidHint")}
                color={counts.out > 0 ? "var(--error)" : undefined}
              />
            </>
          ) : (
            <>
              <Skeleton w="100%" h="72px" />
              <Skeleton w="100%" h="72px" />
              <Skeleton w="100%" h="72px" />
            </>
          )}
        </div>
      </div>

      <p className="ds-section px-4 mt-6 mb-1">{t("financeHub.financialOverview")}</p>

      <div className="pb-1">
        {jobs.map((job) => (
          <ListRow
            key={job.id}
            testId={`hub-row-${job.id}`}
            icon={job.icon}
            title={job.title}
            description={job.hint}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={() => navigate(job.to)}
          />
        ))}
      </div>

      <p className="ds-section px-4 mt-5 mb-2">{t("financeHub.recent")}</p>

      {!entries ? (
        ledgerFailed ? (
          <p className="px-4 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("financeHub.loadFailed")}
          </p>
        ) : (
          <div className="px-4">
            <Skeleton w="100%" h="56px" />
            <Skeleton w="100%" h="56px" className="mt-2" />
          </div>
        )
      ) : recent.length === 0 ? (
        <p className="px-4 text-12" style={{ color: "var(--text-secondary)" }}>
          {t("financeHub.noRecent")}
        </p>
      ) : (
        <div className="flex flex-col px-4">
          {recent.map((entry) => (
            <FinanceMovementRow
              key={entry.id}
              entry={entry}
              testId={`finance-hub-movement-${entry.id}`}
            />
          ))}
        </div>
      )}

      {canPayments && (
        <div className="px-4 mt-2 pb-8 flex justify-start">
          <button
            type="button"
            onClick={() => navigate(`${base}/payments`)}
            className="flex items-center gap-1 text-12 font-semibold active:opacity-70"
            style={{ color: "var(--brand-dark)" }}
            data-testid="finance-hub-view-transactions"
          >
            {t("financeHub.viewTransactions")}
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
