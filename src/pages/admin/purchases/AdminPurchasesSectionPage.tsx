import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Download,
  PackagePlus,
  Plus,
  ReceiptText,
  Share2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import SectionActionsSheet, {
  SectionActionsButton,
  type SectionAction,
} from "@/components/ui/SectionActionsSheet";
import Button from "@/components/ui/Button";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import EmptyState from "@/components/ui/EmptyState";
import ListCard from "@/components/ui/ListCard";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { fetchPurchases, fetchSupplierPayments, type SupplierPaymentEntry } from "@/lib/db";
import type { Purchase } from "@/types";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";

/**
 * Purchases & Suppliers — the owner's buying desk.
 *
 * THE SCREEN OPENS WITH THE SUPPLIER ACCOUNT. Paid to suppliers, the number of payments,
 * outstanding, total purchase and the last payment are the figures the owner needs before the
 * jobs and recent deliveries. The all-dates pill states the account's period, and the card is
 * not a second report.
 *
 * ONE CARD, NOT TWO COMPETING SURFACES. The previous debt hero and this-month pair are replaced
 * by the account card, so the same money is not stated twice. Supplier count stays on the
 * Suppliers row where it belongs.
 *
 * WHERE THE FIGURES COME FROM:
 *   - Paid and outstanding are the branch supplier ledger (0242); paid is billed minus outstanding,
 *     the same definition as the supplier payable screen.
 *   - Payment count is read from the supplier payment rows already fetched.
 *   - The supplier count stays on the Suppliers row.
 *
 * NULL IS NOT ZERO. A read that has not answered prints "—"; a failed read never becomes a
 * confident zero.
 *
 * ALL FOUR JOBS REMAIN. Suppliers, purchase history, supplier payments and outstanding payables
 * still open exactly where they did. The overflow carries those supplier actions beside export
 * and share.
 */
export default function AdminPurchasesSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);
  const branches = useShopStore((s) => s.branches);

  // The two ledgers this screen summarises. They are fetched here because no store holds them:
  // the purchases list and the payments ledger each read their own rows when opened.
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState<BalancePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { addToast } = useUIStore();

  /** The deliveries this screen lists, as a spreadsheet — read from the rows already in hand. */
  async function exportPurchases() {
    setMenuOpen(false);
    try {
      const csv = toCsv<Purchase>(
        [
          { label: t("receipt.date"), value: (p) => formatDate(p.createdAt) },
          { label: t("sales.saleNumber"), value: (p) => p.purchaseNumber },
          { label: t("common.supplier"), value: (p) => p.companyName },
          { label: t("common.total"), value: (p) => p.totalAmount },
          { label: t("common.paid"), value: (p) => p.amountPaid },
          { label: t("common.outstanding"), value: (p) => Math.max(0, p.outstandingPayable) },
        ],
        purchases,
      );
      const outcome = await exportCsv(csvFileName("purchases"), csv, t("settings.menu.purchases"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function sharePurchases() {
    setMenuOpen(false);
    // The suppliers' branch balance, not the sum of each bill's unpaid-at-delivery remainder. A
    // later payment settles the supplier, not one bill, so the per-bill sum kept reporting money
    // that had already been paid — the same defect the header figure was fixed for.
    const outstanding = companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0);
    const text =
      `${t("settings.menu.purchases")}\n` +
      `${t("common.total")}: ${formatCurrency(purchases.reduce((sum, p) => sum + p.totalAmount, 0))}\n` +
      `${t("common.outstanding")}: ${formatCurrency(outstanding)}`;
    try {
      const outcome = await exportText(text, t("settings.menu.purchases"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  const [payments, setPayments] = useState<SupplierPaymentEntry[]>([]);
  const [activityReady, setActivityReady] = useState(false);
  const [activityFailed, setActivityFailed] = useState(false);

  useEffect(() => {
    if (!companiesReady) void loadCompanies();
  }, [companiesReady, loadCompanies]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPurchases(), fetchSupplierPayments()])
      .then(([allPurchases, allPayments]) => {
        if (cancelled) return;
        setPurchases(allPurchases);
        setPayments(allPayments);
      })
      .catch(() => {
        // A figure that could not be read is shown as unknown, never as zero.
        if (!cancelled) setActivityFailed(true);
      })
      .finally(() => {
        if (!cancelled) setActivityReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const account = useMemo(() => {
    const billed = companies.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
    const due = companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0);
    const total = Math.max(billed, due);
    return { total, paid: Math.max(0, total - due), due };
  }, [companies]);
  const todayISO = pkToday();
  const weekStart = useMemo(() => {
    const d = new Date(`${todayISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [todayISO]);
  const periodWindow = useMemo(() => {
    switch (period) {
      case "today":
        return { from: todayISO, to: todayISO };
      case "week":
        return { from: weekStart, to: todayISO };
      case "month":
        return { from: `${todayISO.slice(0, 7)}-01`, to: todayISO };
      case "year":
        return { from: `${todayISO.slice(0, 4)}-01-01`, to: todayISO };
      case "custom":
        return { from: customFrom || todayISO, to: customTo || todayISO };
      default:
        return { from: "2000-01-01", to: todayISO };
    }
  }, [period, todayISO, weekStart, customFrom, customTo]);
  const filteredPayments = useMemo(
    () =>
      payments.filter((payment) => {
        const day = pkDateFromISO(payment.createdAt);
        return day >= periodWindow.from && day <= periodWindow.to;
      }),
    [payments, periodWindow.from, periodWindow.to],
  );
  const periodPaid =
    period === "all"
      ? account.paid
      : filteredPayments.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0);
  const lastPayment = useMemo(
    () =>
      [...filteredPayments].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      )[0] ?? null,
    [filteredPayments],
  );
  const lastPaymentSupplier = lastPayment
    ? companies.find((c) => c.id === lastPayment.companyId)?.name ?? null
    : null;
  const periodLabel = useMemo(() => {
    if (period === "all") return t("period.allDates");
    if (period === "today") return t("period.today");
    if (period === "week") return t("period.week");
    if (period === "month") return t("period.month");
    if (period === "year") return t("period.year");
    const day = (iso: string) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
    return `${day(periodWindow.from)} – ${day(periodWindow.to)}`;
  }, [period, periodWindow.from, periodWindow.to, t]);
  const recent = useMemo(
    () =>
      [...purchases]
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 3),
    [purchases],
  );

  const canRecord = hasPermission("purchases.create");
  const canSeeCompanies = hasPermission("companies.view");
  const canPay = hasPermission("payments.view");

  const branchOf = (purchase: Purchase) =>
    purchase.branchId ? branches.find((b) => b.id === purchase.branchId)?.name ?? null : null;

  /**
   * The jobs inside the section, in the catalogue's order. These are destinations, not figures:
   * the supplier count rides on the Suppliers row, where it explains the place it counts.
   */
  const jobs: {
    id: string;
    icon: LucideIcon;
    title: string;
    hint: string;
    to: string;
    value?: string;
  }[] = [
    ...(canSeeCompanies
      ? [
          {
            id: "suppliers",
            icon: Building2,
            title: t("hub.purchases.suppliers"),
            hint: t("purchasesHub.suppliersHint"),
            to: `${base}/companies`,
            value: companiesReady
              ? companies.length === 1
                ? t("purchasesHub.supplierCountOne")
                : t("purchasesHub.supplierCount", { count: String(companies.length) })
              : undefined,
          },
        ]
      : []),
    ...(hasPermission("purchases.view")
      ? [
          {
            id: "history",
            icon: ReceiptText,
            title: t("hub.purchases.history"),
            hint: t("purchasesHub.historyHint"),
            to: `${base}/purchases`,
          },
        ]
      : []),
    ...(canPay
      ? [
          {
            id: "payments",
            icon: ArrowLeftRight,
            title: t("hub.purchases.payments"),
            hint: t("purchasesHub.paymentsHint"),
            to: `${base}/purchases/payments`,
          },
        ]
      : []),
    ...(canSeeCompanies
      ? [
          {
            id: "payables",
            icon: Wallet,
            title: t("hub.purchases.payables"),
            hint: t("purchasesHub.payablesHint"),
            to: `${base}/purchases/payables`,
          },
        ]
      : []),
  ];

  const openSection = (to: string) => {
    setMenuOpen(false);
    navigate(to, { state: { from: `${base}/settings/hub/purchases` } });
  };

  const menuActions: SectionAction[] = [
    ...(canRecord
      ? [
          {
            id: "record",
            icon: Plus,
            title: t("purchasesHub.record"),
            description: t("purchasesHub.newHint"),
            onClick: () => openSection(`${base}/purchases/new`),
          },
        ]
      : []),
    ...(canSeeCompanies
      ? [
          {
            id: "suppliers",
            icon: Building2,
            title: t("hub.purchases.suppliers"),
            description: t("purchasesHub.suppliersHint"),
            onClick: () => openSection(`${base}/companies`),
          },
        ]
      : []),
    ...(canPay
      ? [
          {
            id: "payments",
            icon: ArrowLeftRight,
            title: t("hub.purchases.payments"),
            description: t("purchasesHub.paymentsHint"),
            onClick: () => openSection(`${base}/purchases/payments`),
          },
        ]
      : []),
    ...(canSeeCompanies
      ? [
          {
            id: "payables",
            icon: Wallet,
            title: t("hub.purchases.payables"),
            description: t("purchasesHub.payablesHint"),
            onClick: () => openSection(`${base}/purchases/payables`),
          },
        ]
      : []),
    {
      id: "export",
      icon: Download,
      title: t("data.export"),
      description: t("data.exportHint"),
      onClick: () => {
        void exportPurchases();
      },
    },
    {
      id: "share",
      icon: Share2,
      title: t("sales.shareReport"),
      description: t("sales.shareReportHint"),
      onClick: () => {
        void sharePurchases();
      },
    },
  ];

  const summaryBody = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("supplierPayments.paidInWindow")}
          </p>
          {companiesReady ? (
            <p
              className="text-26 font-bold mt-1 tabular-nums break-words"
              data-testid="purchases-hub-payments"
            >
              {formatCurrency(periodPaid)}
            </p>
          ) : (
            <Skeleton w="180px" h="28px" className="mt-1" />
          )}
        </div>
        <button
          type="button"
          onClick={() => setPeriodOpen(true)}
          aria-label={t("money.choosePeriod")}
          aria-haspopup="dialog"
          data-testid="purchases-hub-period"
          className="h-8 px-3 rounded-full flex items-center gap-1.5 shrink-0 text-11 font-semibold active:opacity-60"
          style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
        >
          <CalendarDays size={13} />
          {periodLabel}
        </button>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-10" style={{ color: "var(--text-secondary)" }}>
            {t("purchasesHub.paymentTransactions")}
          </p>
          {!activityReady ? (
            <Skeleton w="40px" h="18px" className="mt-1" />
          ) : activityFailed ? (
            <p className="text-14 font-bold mt-1">—</p>
          ) : (
            <p
              className="text-14 font-bold mt-1 tabular-nums"
              data-testid="purchases-hub-payment-count"
            >
              {filteredPayments.length.toLocaleString("en-PK")}
            </p>
          )}
        </div>
        <div className="min-w-0 text-end">
          <p className="text-10" style={{ color: "var(--text-secondary)" }}>
            {t("purchasesHub.totalOutstandingToSuppliers")}
          </p>
          {companiesReady ? (
            <p
              className="text-14 font-bold mt-1 tabular-nums break-words"
              style={{ color: "var(--error)" }}
              data-testid="purchases-hub-outstanding"
            >
              {formatCurrency(account.due)}
            </p>
          ) : (
            <div className="flex justify-end">
              <Skeleton w="80px" h="18px" className="mt-1" />
            </div>
          )}
        </div>
      </div>

      <div
        className="mt-4 pt-4 grid grid-cols-2 gap-4"
        style={{ borderTop: "1px solid var(--hairline)" }}
      >
        <div className="min-w-0">
          <p className="text-10" style={{ color: "var(--text-secondary)" }}>
            {t("purchasesHub.totalPurchases")}
          </p>
          {companiesReady ? (
            <p
              className="text-14 font-bold mt-1 tabular-nums break-words"
              data-testid="purchases-hub-total"
            >
              {formatCurrency(account.total)}
            </p>
          ) : (
            <Skeleton w="80px" h="18px" className="mt-1" />
          )}
        </div>
        <div className="min-w-0 text-end">
          <p className="text-10" style={{ color: "var(--text-secondary)" }}>
            {t("purchasesHub.lastPayment")}
          </p>
          {!activityReady ? (
            <Skeleton w="70px" h="18px" className="mt-1 ms-auto" />
          ) : activityFailed ? (
            <p className="text-14 font-bold mt-1">—</p>
          ) : lastPayment ? (
            <>
              <p
                className="text-14 font-bold mt-1 tabular-nums"
                data-testid="purchases-hub-last-payment"
              >
                {formatCurrency(lastPayment.amount)}
              </p>
              <p className="text-10 mt-1 break-words" style={{ color: "var(--text-secondary)" }}>
                {[lastPaymentSupplier, formatDate(lastPayment.createdAt)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          ) : (
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
              {period === "all"
                ? t("purchasesHub.noPayments")
                : t("supplierPayments.empty")}
            </p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="purchases-hub-page"
    >
      <StatusBar />
      {/* The navigation bar owns the visible title; this preserves the page's heading for
          screen-reader navigation without repeating the same words on screen. */}
      <h1 className="sr-only">{t("settings.menu.purchases")}</h1>
      <NavHeader
        title={t("settings.menu.purchases")}
        backTo={`${base}/settings`}
        historyBack
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("data.moreActions")}
            testId="purchases-actions"
          />
        }
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("settings.menu.purchases")}
        actions={menuActions}
      />

      <div className="px-4 pt-3 flex flex-col gap-3">
        <div
          data-testid="purchases-hub-payables-card"
          className="w-full rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
        >
          {summaryBody}
        </div>

        {activityFailed && (
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("purchasesHub.loadFailed")}
          </p>
        )}

        {canRecord && (
          <Button
            variant="cta"
            size="lg"
            fullWidth
            testId="purchases-hub-record"
            onClick={() => navigate(`${base}/purchases/new`)}
            className="gap-2"
          >
            <Plus size={17} />
            {t("purchasesHub.record")}
          </Button>
        )}
      </div>

      <div className="pt-5">
        <p className="ds-section px-4 mb-1">{t("purchasesHub.manage")}</p>
        {jobs.map((job) => {
          const Icon = job.icon;
          return (
            <ListRow
              key={job.id}
              testId={`hub-row-${job.id}`}
              icon={Icon}
              title={job.title}
              description={job.hint}
              value={job.value}
              trailing={
                <ChevronRight
                  size={14}
                  style={{ color: "var(--text-secondary)" }}
                  className="shrink-0"
                />
              }
              // The reader's step is recorded in router state as well as the journey stack: the
              // Suppliers list is a two-segment path that the tracker treats as a root, so the
              // stack is cleared on arrival and this is what its back arrow can still read.
              onClick={() =>
                navigate(job.to, { state: { from: `${base}/settings/hub/purchases` } })
              }
            />
          );
        })}
      </div>

      {!activityFailed && (
        <div className="px-4 pt-5 pb-8">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="ds-section">{t("purchasesHub.recent")}</p>
            {recent.length > 0 && (
              <button
                type="button"
                onClick={() => navigate(`${base}/purchases`)}
                data-testid="purchases-hub-view-history"
                className="text-11 font-semibold shrink-0 active:opacity-60"
                style={{ color: "var(--text-primary)" }}
              >
                {t("common.viewAll")}
              </button>
            )}
          </div>

          {!activityReady ? (
            <div className="flex flex-col gap-2">
              <Skeleton w="100%" h="66px" />
              <Skeleton w="100%" h="66px" />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState icon={PackagePlus} title={t("purchasesHub.noRecent")} />
          ) : (
            <ListCard>
              {recent.map((purchase) => {
                const due = Math.max(0, purchase.outstandingPayable);
                const branch = branchOf(purchase);
                return (
                  <ListRow
                    key={purchase.id}
                    testId={`purchases-hub-recent-${purchase.id}`}
                    icon={PackagePlus}
                    onClick={() => navigate(`${base}/purchases/${purchase.id}`)}
                    trailing={
                      <div className="text-end shrink-0">
                        <p className="text-13 font-bold tabular-nums">
                          {formatCurrency(purchase.totalAmount)}
                        </p>
                        <span
                          className="inline-block mt-1 text-9 font-bold px-2 py-0.5 rounded-full"
                          style={
                            due > 0
                              ? { color: "var(--warning)", background: "var(--surface-2)" }
                              : { color: "var(--text-secondary)", background: "var(--surface-2)" }
                          }
                        >
                          {due > 0 ? t("purchases.payableTag") : t("common.paidTag")}
                        </span>
                      </div>
                    }
                  >
                    <p className="text-13 font-semibold truncate">{purchase.companyName}</p>
                    <p
                      className="text-10 mt-0.5 truncate"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {[formatDate(purchase.createdAt), purchase.purchaseNumber, branch]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </ListRow>
                );
              })}
            </ListCard>
          )}
        </div>
      )}

      <BalanceDateSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title={t("period.sheetTitle")}
        value={period}
        from={customFrom}
        to={customTo}
        max={todayISO}
        onChange={(key, from, to) => {
          setPeriod(key);
          setCustomFrom(from);
          setCustomTo(to);
        }}
        testIdPrefix="purchases-hub-period"
      />
    </div>
  );
}
