import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Building2,
  ChevronRight,
  PackagePlus,
  Plus,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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
import { pkToday } from "@/lib/pkDate";
import {
  purchasesInMonth,
  summariseSupplierPayable,
  supplierPaymentsInMonth,
} from "@/lib/supplierPayable";

/**
 * Purchases & Suppliers, as one screen: what the branch bought this month, what it still owes,
 * who it buys from, the four jobs inside the section, and the last deliveries recorded.
 *
 * SHAPE (owner's reference, 2026-10-28): the section's name and its one-sentence purpose, the
 * branch and period the figures are read for, four figures in a 2×2 block, then Quick actions
 * and the last three purchases. Same anatomy as the Customers & Credit and Products & Inventory
 * hubs, so all three parts of the business are read the same way.
 *
 * EVERY FIGURE IS A REAL ONE, AND EACH HAS ONE DEFINITION.
 *   - Purchases and supplier payments this month come from the rows themselves (`fetchPurchases`,
 *     `fetchSupplierPayments`), filtered by the PK calendar month.
 *   - Outstanding payables and the supplier count come from `companies` — the balance the
 *     database derives for this branch (0242), never a sum of the deliveries below (that is a
 *     different question and the documented way this screen used to lie).
 *   - "Overdue" is `lib/supplierPayable`, the same test the payable screens use.
 *
 * QUICK ACTIONS ARE THE JOBS THE APP ACTUALLY HAS. The reference listed Purchase Returns; there
 * is no purchase-returns screen, so it is not drawn — a row that opens nothing is a dead end.
 * "Outstanding payables" opens the supplier payable screen, which is the list behind the figure
 * above; it is not a second copy of it.
 *
 * NO FAKE CONTROLS. The reference drew branch and period as dropdowns; the branch is the working
 * branch this screen reads (the app never mixes branches into one read) and the period is fixed
 * to this month, so both are stated as context instead of pretending to be filters.
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

  const todayISO = pkToday();
  const month = todayISO.substring(0, 7);
  const book = useMemo(() => summariseSupplierPayable(companies, todayISO), [companies, todayISO]);
  const spentThisMonth = purchasesInMonth(purchases, month);
  const paidThisMonth = supplierPaymentsInMonth(payments, month);
  const recent = purchases.slice(0, 3);

  const branchOf = (purchase: Purchase) =>
    purchase.branchId ? branches.find((b) => b.id === purchase.branchId)?.name ?? null : null;

  /**
   * One of the four figures: its name, the amount or count, and the period or population the
   * figure measures. The caption is not decoration — "This month" is what keeps a monthly total
   * from being read as a lifetime one.
   */
  const figure = (
    label: string,
    value: string,
    caption: string,
    testId: string,
    tone?: "error",
  ) => (
    <div
      className="rounded-[var(--radius-card)] p-3.5"
      style={{ background: "var(--tone-card)" }}
      data-testid={testId}
    >
      <p className="text-11" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p
        className="text-18 font-bold mt-1 tabular-nums break-words"
        style={tone === "error" ? { color: "var(--error)" } : undefined}
      >
        {value}
      </p>
      <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>{caption}</p>
    </div>
  );

  const jobs: { id: string; icon: LucideIcon; title: string; hint: string; to: string }[] = [
    ...(hasPermission("companies.view")
      ? [{
          id: "suppliers",
          icon: Building2,
          title: t("hub.purchases.suppliers"),
          hint: t("purchasesHub.suppliersHint"),
          to: `${base}/companies`,
        }]
      : []),
    ...(hasPermission("purchases.view")
      ? [{
          id: "history",
          icon: ReceiptText,
          title: t("hub.purchases.history"),
          hint: t("purchasesHub.historyHint"),
          to: `${base}/purchases`,
        }]
      : []),
    ...(hasPermission("payments.view")
      ? [{
          id: "payments",
          icon: ArrowLeftRight,
          title: t("hub.purchases.payments"),
          hint: t("purchasesHub.paymentsHint"),
          to: `${base}/payments`,
        }]
      : []),
    ...(hasPermission("companies.view")
      ? [{
          id: "payables",
          icon: Wallet,
          title: t("hub.purchases.payables"),
          hint: t("purchasesHub.payablesHint"),
          to: `${base}/settings/overview/suppliers`,
        }]
      : []),
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="purchases-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("settings.menu.purchases")} backTo={`${base}/settings`} />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold leading-tight">{t("settings.menu.purchases")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("purchasesHub.subtitle")}
        </p>
      </div>

      {/* Four figures, two by two, each naming what it measures. The month is part of each
          caption, so no separate period chip is needed — and the branch is the one the app is
          already reading, stated by the shell rather than repeated here. */}
      <div className="grid grid-cols-2 gap-2 px-4 pt-4">
        {figure(
          t("purchasesHub.totalPurchases"),
          activityReady ? (activityFailed ? "—" : formatCurrency(spentThisMonth)) : "—",
          t("purchasesHub.thisMonth"),
          "purchases-hub-total",
        )}
        {figure(
          t("hub.purchases.payables"),
          companiesReady ? formatCurrency(book.outstanding) : "—",
          t("purchasesHub.remaining"),
          "purchases-hub-outstanding",
          book.outstanding > 0 ? "error" : undefined,
        )}
        {figure(
          t("payable.suppliers"),
          companiesReady ? String(book.accounts) : "—",
          t("purchasesHub.activeCompanies"),
          "purchases-hub-suppliers",
        )}
        {figure(
          t("hub.purchases.payments"),
          activityReady ? (activityFailed ? "—" : formatCurrency(paidThisMonth)) : "—",
          t("purchasesHub.thisMonth"),
          "purchases-hub-payments",
        )}
      </div>

      <p className="ds-section px-4 mt-6 mb-2">{t("purchasesHub.quickActions")}</p>

      {/* The section's one write action, drawn as a card: it creates something rather than
          opening a list, so it reads as the primary job. */}
      {hasPermission("purchases.create") && (
        <div className="px-4">
          <button
            type="button"
            onClick={() => navigate(`${base}/purchases/new`)}
            data-testid="hub-row-new"
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
            style={{ background: "var(--tone-card)" }}
          >
            <span
              className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
              style={{ background: "var(--surface-2)" }}
            >
              <Plus size={20} style={{ color: "var(--brand-dark)" }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("hub.purchases.new")}
              </span>
              <span className="block text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("purchasesHub.newHint")}
              </span>
            </span>
            <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
          </button>
        </div>
      )}

      <div className="pt-1 pb-2">
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

      <p className="ds-section px-4 mt-5 mb-2">{t("purchasesHub.recent")}</p>

      {!activityReady ? (
        <div className="px-4">
          <Skeleton w="100%" h="68px" />
          <Skeleton w="100%" h="68px" className="mt-2" />
        </div>
      ) : activityFailed ? (
        <p className="px-4 text-12" style={{ color: "var(--text-secondary)" }}>
          {t("purchasesHub.loadFailed")}
        </p>
      ) : recent.length === 0 ? (
        <p className="px-4 text-12" style={{ color: "var(--text-secondary)" }}>
          {t("purchasesHub.noRecent")}
        </p>
      ) : (
        <div className="flex flex-col gap-2 px-4">
          {recent.map((purchase) => {
            const due = Math.max(0, purchase.outstandingPayable);
            const branch = branchOf(purchase);
            return (
              <button
                key={purchase.id}
                type="button"
                onClick={() => navigate(`${base}/purchases/${purchase.id}`)}
                data-testid={`purchases-hub-recent-${purchase.id}`}
                className="rounded-[var(--radius-card)] p-3.5 text-start active:opacity-70"
                style={{ background: "var(--tone-card)" }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="size-9 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <PackagePlus size={16} style={{ color: "var(--text-secondary)" }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-13 font-bold truncate">{purchase.companyName}</p>
                    <p className="text-10 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {formatDate(purchase.createdAt)}
                      {branch ? ` · ${branch}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-13 font-bold tabular-nums">{formatCurrency(purchase.totalAmount)}</p>
                    <span
                      className="inline-block mt-1 text-10 font-bold px-2 py-0.5 rounded-full"
                      style={
                        due > 0
                          ? { color: "var(--warning)", background: "var(--surface-2)" }
                          : { color: "var(--brand-dark)", background: "var(--surface-2)" }
                      }
                    >
                      {due > 0 ? t("purchases.payableTag") : t("common.paidTag")}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* The way to the whole ledger sits under the rows, start-aligned so it reads as the
          continuation of the list rather than a stray control at the edge. */}
      <div className="px-4 mt-3 pb-8 flex justify-start">
        <button
          type="button"
          onClick={() => navigate(`${base}/purchases`)}
          className="flex items-center gap-1 text-12 font-semibold active:opacity-70"
          style={{ color: "var(--brand-dark)" }}
          data-testid="purchases-hub-view-history"
        >
          {t("purchasesHub.viewHistory")}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
