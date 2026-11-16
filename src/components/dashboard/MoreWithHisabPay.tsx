import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Barcode,
  Banknote,
  BarChart3,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  HandCoins,
  Landmark,
  LayoutGrid,
  PackagePlus,
  ReceiptText,
  Search,
  ShieldCheck,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import SearchBar from "@/components/ui/SearchBar";
import { useT, type I18nKey } from "@/lib/i18n";
import { hasPermission } from "@/lib/tenantContext";
import { useDir } from "@/lib/dirContext";

type GroupId = "credit" | "stock" | "purchases" | "money" | "shop";

interface ShopAction {
  id: string;
  icon: LucideIcon;
  labelKey: I18nKey;
  group: GroupId;
  to: string;
  /** Screens the role cannot open are not offered; the tile would only 404 or bounce. */
  permission?: Parameters<typeof hasPermission>[0];
  /**
   * The words a shop owner actually types. The Urdu label already matches in Urdu script;
   * these carry the everyday terms (udhaar, baqaya, kharcha, bill) so search is not a
   * test of whether the person knows the app's vocabulary.
   */
  keywords: string[];
}

/**
 * Every destination here is a screen that already exists — this grid is a second door to
 * them, not a second implementation.
 *
 * The order is the owner's own list (2026-11-16): the first page is the money he handles
 * every day — the day's cash first (count the till and record it), then credit decisions,
 * alerts, udhaar recovery, reminders, the customer book and recording money — because a page
 * behind a swipe may as well not exist. Page two is what those decisions lead to (what the
 * shop owes, the money book, reports); page three is the shelf and the shop itself.
 *
 * SETUP AND HELP ARE NOT COUNTER JOBS (owner, 2026-11-16). Branches and the App guide were
 * dropped from here: both already have doors in Settings and the header, and on this grid
 * they pushed the jobs a counter actually performs onto later pages.
 */
const ACTIONS: ShopAction[] = [
  {
    id: "daily-cash",
    icon: Banknote,
    labelKey: "shopAction.dailyCash",
    group: "money",
    to: "/admin/payments/daily-cash",
    permission: "payments.view",
    keywords: ["daily cash", "counter cash", "galla", "hisab", "گلا", "حساب"],
  },
  {
    id: "credit-requests",
    icon: ShieldCheck,
    labelKey: "shopAction.creditRequests",
    group: "credit",
    to: "/admin/customers/credit-requests",
    permission: "customers.view",
    keywords: ["credit limit", "credit request", "approval", "limit barhana", "حد ادھار"],
  },
  {
    id: "alerts",
    icon: BellRing,
    labelKey: "shopAction.alerts",
    group: "shop",
    to: "/admin/alerts/reminders",
    permission: "alerts.view",
    keywords: ["alerts", "action center", "triage", "alert", "اطلاع", "تنبیہ"],
  },
  {
    id: "collect-udhaar",
    icon: HandCoins,
    labelKey: "shopAction.collectUdhaar",
    group: "credit",
    to: "/admin/customers/outstanding",
    permission: "customers.view",
    keywords: ["udhaar", "udhar", "baqaya", "outstanding", "credit", "recovery", "ادھار", "باقیہ"],
  },
  {
    id: "reminders",
    icon: BellRing,
    labelKey: "shopAction.reminders",
    group: "credit",
    to: "/admin/customers/reminders",
    permission: "customers.view",
    keywords: ["reminder", "reminders", "yaad dilana", "follow up", "یاد دہانی"],
  },
  {
    id: "customers",
    icon: Users,
    labelKey: "shopAction.customers",
    group: "credit",
    to: "/admin/customers",
    permission: "customers.view",
    keywords: ["customers", "khatta", "khata", "ledger", "کھاتہ", "گاہک"],
  },
  {
    id: "new-customer",
    icon: UserPlus,
    labelKey: "shopAction.newCustomer",
    group: "credit",
    to: "/admin/customers/new",
    permission: "customers.view",
    keywords: ["customer", "add customer", "naya customer", "grahak", "گاہک", "نیا گاہک"],
  },
  {
    id: "record-money",
    icon: Landmark,
    labelKey: "shopAction.recordMoney",
    group: "money",
    to: "/admin/settings/hub/finance/record",
    permission: "payments.view",
    keywords: ["expense", "kharcha", "kharch", "income", "record money", "خرچ", "آمدنی"],
  },
  {
    id: "payables",
    icon: ClipboardList,
    labelKey: "shopAction.payables",
    group: "purchases",
    to: "/admin/purchases/payables",
    permission: "purchases.view",
    keywords: ["payable", "supplier udhaar", "baqaya", "دینا", "واجب الادا"],
  },
  {
    id: "money",
    icon: Wallet,
    labelKey: "shopAction.money",
    group: "money",
    to: "/admin/payments",
    permission: "payments.view",
    keywords: ["money", "cash", "statement", "paisa", "روپیہ", "کیش"],
  },
  {
    id: "reports",
    icon: BarChart3,
    labelKey: "shopAction.reports",
    group: "money",
    to: "/admin/reports/directory",
    permission: "reports.view",
    keywords: ["report", "reports", "sales report", "رپورٹ", "خلاصہ"],
  },
  {
    id: "profit",
    icon: TrendingUp,
    labelKey: "shopAction.profit",
    group: "money",
    to: "/admin/reports/profit",
    permission: "reports.view",
    keywords: ["profit report", "munafa", "net profit", "منافع", "نفع"],
  },
  {
    id: "purchases",
    icon: Truck,
    labelKey: "shopAction.purchases",
    group: "purchases",
    to: "/admin/purchases",
    permission: "purchases.view",
    keywords: ["purchase", "purchases", "kharid", "bill", "خریداری", "بل"],
  },
  {
    id: "suppliers",
    icon: Building2,
    labelKey: "shopAction.suppliers",
    group: "purchases",
    to: "/admin/companies",
    permission: "purchases.view",
    keywords: ["supplier", "company", "companies", "جرار", "کمپنی", "سپلائر"],
  },
  {
    id: "supplier-payments",
    icon: ReceiptText,
    labelKey: "shopAction.supplierPayments",
    group: "purchases",
    to: "/admin/purchases/payments",
    permission: "purchases.view",
    keywords: ["supplier payment", "paid to supplier", "ادائیگی", "سپلائر"],
  },
  {
    id: "add-product",
    icon: PackagePlus,
    labelKey: "shopAction.addProduct",
    group: "stock",
    to: "/admin/inventory/new",
    permission: "products.view",
    keywords: ["add product", "new item", "naya maal", "item add", "نیا مال", "پروڈکٹ"],
  },
  {
    id: "stock-prices",
    icon: Boxes,
    labelKey: "shopAction.stockPrices",
    group: "stock",
    to: "/admin/inventory/stockvalues",
    permission: "products.view",
    keywords: ["stock", "price", "prices", "rate", "maal", "اسٹاک", "قیمت"],
  },
  {
    id: "reorder",
    icon: ClipboardList,
    labelKey: "shopAction.reorder",
    group: "stock",
    to: "/admin/inventory/reorder",
    permission: "products.view",
    keywords: ["reorder", "khatam", "low stock", "restock", "مانگ", "ختم"],
  },
  {
    id: "barcodes",
    icon: Barcode,
    labelKey: "shopAction.barcodes",
    group: "stock",
    to: "/admin/inventory/barcodes",
    permission: "products.view",
    keywords: ["barcode", "label", "sticker", "پرنٹ", "بارکوڈ"],
  },
  {
    id: "low-stock",
    icon: AlertTriangle,
    labelKey: "shopAction.lowStock",
    group: "stock",
    to: "/admin/alerts/inventory",
    permission: "alerts.view",
    keywords: ["low stock", "out of stock", "khatam", "alert", "ختم", "اسٹاک کم"],
  },
  {
    id: "expiry",
    icon: CalendarClock,
    labelKey: "shopAction.expiry",
    group: "stock",
    to: "/admin/alerts/expiry",
    permission: "alerts.view",
    keywords: ["expiry", "expire", "date", "kharab", "میعاد", "تاریخ"],
  },
  {
    id: "employees",
    icon: Users,
    labelKey: "shopAction.employees",
    group: "shop",
    to: "/admin/employees",
    permission: "employees.view",
    keywords: ["employee", "staff", "team", "mulazim", "ملازم", "عملہ"],
  },
  // Branches and the App guide left this grid (owner, 2026-11-16): both are setup/help
  // destinations that Settings and the header already own, and they were pushing the counter's
  // own jobs onto later pages.
];

const GROUPS: Array<{ id: GroupId; labelKey: I18nKey }> = [
  { id: "credit", labelKey: "shopAction.group.credit" },
  { id: "stock", labelKey: "shopAction.group.stock" },
  { id: "purchases", labelKey: "shopAction.group.purchases" },
  { id: "money", labelKey: "shopAction.group.money" },
  { id: "shop", labelKey: "shopAction.group.shop" },
];

/** Eight actions per page; the ninth cell is the door to everything else. */
const PER_PAGE = 8;

/**
 * "More with HisabPay" — the discovery surface under Quick alerts.
 *
 * A shop owner opens this app for a handful of jobs, and the rest of what the app can do is
 * only discoverable if it is shown. So: a paged 3×3 grid of the jobs that exist, and a
 * searchable sheet for the ones that did not fit — searchable in the owner's own words, not
 * in the app's screen names.
 */
export default function MoreWithHisabPay() {
  const t = useT();
  const navigate = useNavigate();
  const { isRtl } = useDir();
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");

  const actions = ACTIONS.filter((a) => !a.permission || hasPermission(a.permission));
  if (actions.length === 0) return null;

  const pages: ShopAction[][] = [];
  for (let i = 0; i < actions.length; i += PER_PAGE) pages.push(actions.slice(i, i + PER_PAGE));

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? actions.filter((a) =>
        [t(a.labelKey), t(GROUPS.find((g) => g.id === a.group)!.labelKey), ...a.keywords]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : actions;

  function goTo(to: string) {
    setSheetOpen(false);
    setQuery("");
    navigate(to);
  }

  function goPage(index: number) {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: (isRtl ? -1 : 1) * index * el.clientWidth, behavior: "smooth" });
  }

  function tile(action: ShopAction, compact = false) {
    const Icon = action.icon;
    return (
      <button
        key={action.id}
        type="button"
        onClick={() => goTo(action.to)}
        className={`ds-pressable flex flex-col items-center justify-center gap-1.5 rounded-[var(--radius-tile)] px-1.5 text-center ${
          compact ? "h-[74px]" : "h-[84px]"
        }`}
        style={{ background: "var(--surface)" }}
        data-testid={`home-action-${action.id}`}
      >
        <Icon size={20} strokeWidth={1.7} style={{ color: "var(--text-primary)" }} />
        <span
          className="text-10 font-semibold leading-tight line-clamp-2"
          style={{ color: "var(--text-primary)" }}
        >
          {t(action.labelKey)}
        </span>
      </button>
    );
  }

  return (
    <>
      <section className="pt-5" data-testid="home-more-actions">
        <div className="flex items-center justify-between gap-3 px-4 mb-3">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {t("shopAction.title")}
          </p>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="text-12 font-semibold"
            style={{ color: "var(--brand-dark)" }}
            data-testid="home-more-actions-open"
          >
            {t("shopAction.seeAll")}
          </button>
        </div>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            const width = el.clientWidth || 1;
            setPage(Math.min(pages.length - 1, Math.round(Math.abs(el.scrollLeft) / width)));
          }}
          className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
          data-testid="home-more-actions-pager"
        >
          {pages.map((group, index) => (
            <div key={index} className="w-full shrink-0 snap-start px-4">
              <div className="grid grid-cols-3 gap-2.5">
                {group.map((action) => tile(action))}
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="ds-pressable flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-tile)] px-1.5 text-center"
                  style={{ background: "var(--tone-card)" }}
                  data-testid="home-more-actions-see-all-tile"
                >
                  <LayoutGrid size={20} strokeWidth={1.7} style={{ color: "var(--text-primary)" }} />
                  <span
                    className="text-10 font-semibold leading-tight line-clamp-2"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {t("shopAction.seeAll")}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {pages.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {pages.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goPage(index)}
                aria-label={t("shopAction.page", { count: String(index + 1) })}
                className="size-1.5 rounded-full transition-colors"
                style={{
                  background: page === index ? "var(--brand-dark)" : "var(--divider)",
                }}
              />
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={sheetOpen}
        title={t("shopAction.title")}
        onClose={() => {
          setSheetOpen(false);
          setQuery("");
        }}
      >
        <div className="px-4 pt-1" data-testid="home-actions-sheet">
          {/* The app's one search field, not a hand-rolled pill: `ds-field` carries the theme's
              own fill and hairline edge, so it stops reading as a light grey box on black and as
              a dirty box on white (owner, 2026-11-16). */}
          <SearchBar
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shopAction.searchPlaceholder")}
            aria-label={t("shopAction.searchPlaceholder")}
            onClear={() => setQuery("")}
            data-testid="home-actions-search"
          />

          {matches.length === 0 && (
            <p
              className="px-1 pt-8 text-center text-12"
              style={{ color: "var(--text-secondary)" }}
              data-testid="home-actions-empty"
            >
              {t("shopAction.empty", { query: query.trim() })}
            </p>
          )}

          {GROUPS.map((group) => {
            const rows = matches.filter((a) => a.group === group.id);
            if (rows.length === 0) return null;
            return (
              <div key={group.id} className="pt-4">
                <p className="ds-section-label px-1 pb-2" style={{ color: "var(--text-secondary)" }}>
                  {t(group.labelKey)}
                </p>
                <div className="grid grid-cols-3 gap-2.5">{rows.map((a) => tile(a, true))}</div>
              </div>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
