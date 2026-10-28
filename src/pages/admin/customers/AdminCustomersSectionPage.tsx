import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  BellRing,
  ChevronRight,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { summariseCustomerCollection } from "@/lib/customerCredit";
import { hasPermission } from "@/lib/tenantContext";

/**
 * Customers & Credit, as one screen: what the branch is owed and how much has come back, the
 * accounts it is owed by, and the four jobs that follow.
 *
 * SHAPE (owner's reference, 2026-10-28): the section's title and subtitle, one collection plate
 * carrying the outstanding total, the collection bar and three counts, then the four
 * destinations — Outstanding Credit, Customer Payments, Credit Limit Requests and Payment
 * Reminders. The customer search that briefly sat in the plate was removed at the owner's
 * request: this screen is the way into the four jobs, not a second customer list.
 *
 * EVERY FIGURE IS THE BRANCH'S OWN. The customers are the rows the store already loaded, with
 * the money derived for the working branch (0242), and the summary is computed from those same
 * rows by `lib/customerCredit` — so the plate can never disagree with the list behind it.
 * "Overdue" is the app's S1 rule, not a second date comparison.
 */
export default function AdminCustomersSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  const todayISO = pkToday();
  const summary = useMemo(
    () => summariseCustomerCollection(customers, todayISO),
    [customers, todayISO],
  );

  // Each row is a screen this account can actually open. The routes carry the same grants
  // (`payments.view`, `alerts.view`); drawing a row for a screen the guard will bounce away
  // from is a button that ends in a refusal.
  const actions: { id: string; icon: LucideIcon; title: string; hint: string; to: string }[] = [
    // The account list keeps one plain way in. The search that used to sit in the plate was
    // removed at the owner's request; without this row the four jobs would be the only doors
    // on the screen, and every customer would be reachable only through a balance.
    {
      id: "all",
      icon: Users,
      title: t("hub.customers.all"),
      hint: t("hub.customers.allHint"),
      to: `${base}/customers`,
    },
    {
      id: "outstanding",
      icon: Wallet,
      title: t("hub.customers.outstanding"),
      hint: t("hub.customers.outstandingHint"),
      to: `${base}/customers/outstanding`,
    },
    ...(hasPermission("payments.view")
      ? [{
          id: "payments",
          icon: ArrowLeftRight,
          title: t("hub.customers.payments"),
          hint: t("hub.customers.paymentsHint"),
          to: `${base}/payments`,
        }]
      : []),
    ...(hasPermission("alerts.view")
      ? [
          {
            id: "requests",
            icon: ShieldCheck,
            title: t("hub.customers.creditRequests"),
            hint: t("hub.customers.requestsHint"),
            to: `${base}/customers/credit-requests`,
          },
          {
            id: "reminders",
            icon: BellRing,
            title: t("hub.customers.reminders"),
            hint: t("hub.customers.remindersHint"),
            to: `${base}/customers/reminders`,
          },
        ]
      : []),
  ];

  const count = (value: number) => (ready ? value : "—");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="customers-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("settings.menu.customers")} backTo={`${base}/settings`} />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold leading-tight">{t("hub.customers.collectionTitle")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("hub.customers.collectionSubtitle")}
        </p>
      </div>

      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="customers-hub-collection"
        >
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("receivable.totalOutstanding")}
          </p>
          <p
            className="text-22 font-bold mt-1 tabular-nums break-words"
            data-testid="customers-hub-outstanding"
          >
            {ready ? formatCurrency(summary.due) : "—"}
          </p>

          <div className="flex items-baseline justify-between gap-3 mt-4">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("receivable.progress")}
            </p>
            <p
              className="text-12 font-bold tabular-nums"
              style={{ color: summary.progressPct > 0 ? "var(--brand-dark)" : "var(--text-secondary)" }}
            >
              {ready ? `${summary.progressPct}%` : "—"}
            </p>
          </div>
          <div
            className="mt-2 h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--surface-2)" }}
            role="progressbar"
            aria-valuenow={summary.progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("receivable.progress")}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, summary.progressPct))}%`,
                background: "var(--brand)",
              }}
            />
          </div>
          <div className="flex items-end justify-between gap-3 mt-2">
            <div className="min-w-0">
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("overall.collected")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">
                {ready ? formatCurrency(summary.collected) : "—"}
              </p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("receivable.totalDue")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">
                {ready ? formatCurrency(summary.billed) : "—"}
              </p>
            </div>
          </div>

          {/* Three counts, each naming the population it counts — never a number the reader has
              to guess the meaning of. */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-[var(--radius-tile)] px-3 py-2" style={{ background: "var(--surface-2)" }}>
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("receivable.customers")}</p>
              <p className="text-16 font-bold mt-0.5 tabular-nums">{count(summary.accounts)}</p>
              <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{t("receivable.accounts")}</p>
            </div>
            <div className="rounded-[var(--radius-tile)] px-3 py-2" style={{ background: "var(--surface-2)" }}>
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("receivable.pending")}</p>
              <p className="text-16 font-bold mt-0.5 tabular-nums">{count(summary.pending)}</p>
              <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{t("receivable.haveBalance")}</p>
            </div>
            <div className="rounded-[var(--radius-tile)] px-3 py-2" style={{ background: "var(--surface-2)" }}>
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("receivable.overdue")}</p>
              <p
                className="text-16 font-bold mt-0.5 tabular-nums"
                style={{ color: summary.overdue > 0 ? "var(--error)" : "var(--text-primary)" }}
              >
                {count(summary.overdue)}
              </p>
              <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{t("receivable.followUp")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* The four jobs. UNBOXED, like every other section hub (owner's correction, 2026-10-28):
          this was the one section screen drawing its rows on a card, so the same four-row list
          read as a different kind of control here than on Sales or Products & Inventory. Every
          row is a different place, so a card around them drew a second edge without grouping
          anything. `ListRow` still owns the height, insets and press state. */}
      <div className="pt-4 pb-6">
        {actions.map((action) => (
          <ListRow
            key={action.id}
            testId={`hub-row-${action.id}`}
            icon={action.icon}
            title={action.title}
            description={action.hint}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={() => navigate(action.to)}
          />
        ))}
      </div>
    </div>
  );
}
