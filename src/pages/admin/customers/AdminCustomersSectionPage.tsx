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
import { pkToday } from "@/lib/pkDate";
import { summariseCustomerCollection } from "@/lib/customerCredit";
import CollectionPlate from "@/components/customers/CollectionPlate";
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
          // The customer receipt book, not the general ledger: this row belongs to the customer
          // section, and the payments screen states both directions for the whole business
          // (owner's instruction, 2026-10-30).
          to: `${base}/customers/payments`,
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
      <NavHeader title={t("settings.menu.customers")} backTo={`${base}/settings`} historyBack />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold leading-tight">{t("hub.customers.collectionTitle")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("hub.customers.collectionSubtitle")}
        </p>
      </div>

      {/* Three figures, unboxed — the one thing this section is for (owner's correction,
          2026-10-29): what is owed, what is not late yet, and what is. It is deliberately NOT the
          account list's plate: that screen is the credit book and needs the collection progress and
          its three counts, while this screen is the door to the four jobs and only has to say how
          much money is out there and how much of it is late. Same type, same spacing, different
          job — so the two screens no longer look like one screen rendered twice. */}
      <div className="px-4 pt-4">
        <CollectionPlate summary={summary} ready={ready} testId="customers-hub-collection" />
      </div>

      {/* The four jobs.

 UNBOXED, like every other section hub (owner's correction, 2026-10-28):
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
