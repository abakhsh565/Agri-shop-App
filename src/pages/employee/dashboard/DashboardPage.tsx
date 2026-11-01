import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import PullToRefresh from "@/components/ui/PullToRefresh";
import { useCustomersStore } from "@/stores/customersStore";
import { formatSmartDateTime, translateNotification } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { canSeeDashboard, hasPermission } from "@/lib/tenantContext";
import { generateReminders } from "@/lib/reminderEngine";
import { useThemeStore } from "@/stores/themeStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { ShoppingCart, CreditCard, ChevronRight, ChevronDown, Bell, Search, ArrowRight, ClipboardList, MapPin } from "lucide-react";
import { pkToday, pkDateFromISO } from "@/lib/pkDate";
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmployeePersonaWidgets from "@/components/employee/dashboard/PersonaWidgets";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

/** Employee notifications — always go to specific detail when entity_id exists */
function employeeNotifRoute(n: AppNotification): string | null {
  if (n.entity_id) {
    switch (n.kind) {
      case "sale": return "/employee/sales/" + n.entity_id;
      case "return": return "/employee/sales/" + n.entity_id;
      case "payment": return "/employee/sales"; // payment links to sales list
      case "low_stock": return "/employee/products"; // general alert
      case "stock_adjust": return "/employee/products"; // general alert
      default: return null;
    }
  }
  // No entity_id → list page
  switch (n.kind) {
    case "sale": case "return": case "payment": return "/employee/sales";
    case "low_stock": case "stock_adjust": return "/employee/products";
    default: return null;
  }
}

function formatRs(n: number) {
  return "Rs. " + n.toLocaleString("en-PK");
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { items: notifications, unread, load, subscribe, markAllRead, markOneRead, ready: notificationsReady } = useNotificationStore();
  const { language } = useThemeStore();
  const navigate = useNavigate();
  const t = useT();
  const [showNotifs, setShowNotifs] = useState(false);
  const allSales = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);
  // The branch this person is working in. A person enrolled in one branch has nothing to
  // switch to, so the control only exists when the server returned more than one.
  const branches = useShopStore((s) => s.branches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  // Read both stores unconditionally: short-circuiting a hook call is what
  // crashed this screen, since React must see the same hooks every render.
  const salesReady = useSalesStore((s) => s.ready);
  const customersReady = useCustomersStore((s) => s.ready);
  const ready = salesReady && customersReady;

  function getCustomerImg(customerId: string) {
    return customers.find((c) => c.id === customerId)?.imageUrl;
  }

  // Filter to only this employee's sales
  const mockSales = allSales.filter((s) => s.employeeId === user?.id || s.employeeName === user?.name);

  // Share the same live Supabase feed as the admin, filtered to this persona.
  useEffect(() => {
    load();
    const unsub = subscribe();
    return unsub;
  }, []);

  const isUrdu = language === "ur";
  const firstName = user?.name?.split(" ")[0] ?? "Ahmed";
  const now = useCurrentTime();
  // The header states where this person is working, not who they are or what time it is:
  // the branch is the one fact that changes what every number below means.
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const branchPlace = activeBranch?.place ?? null;
  // A branch with coordinates but no map label falls back to its own name in `place`. Showing
  // that would print the branch twice, so in that case the address is the useful second line.
  const branchLocation = branchPlace
    ? (branchPlace.label && branchPlace.label !== activeBranchName ? branchPlace.label : branchPlace.address)
    : null;

  // Live metrics
  const todayStr = pkToday();
  const todaySales = mockSales.filter((s) => !s.isVoided && pkDateFromISO(s.createdAt) === todayStr);
  const salesToUse = todaySales.length > 0 ? todaySales : mockSales.filter((s) => !s.isVoided);
  const totalAmount  = salesToUse.reduce((s, x) => s + x.totalAmount, 0);
  const paidAmount   = salesToUse.filter((s) => s.paymentType === "full").reduce((s, x) => s + x.amountPaid, 0);
  const creditAmount = salesToUse.filter((s) => s.paymentType !== "full").reduce((s, x) => s + x.outstandingBalance, 0);
  const txCount      = salesToUse.length;
  const productsSold = salesToUse.reduce((s, x) => s + x.items.length, 0);
  const qtySold      = salesToUse.reduce((s, x) => s + x.items.reduce((q, it) => q + it.qty, 0), 0);
  const recentSales  = mockSales.filter((s) => !s.isVoided).slice(0, 3);
  const badgeCount   = unread();
  // Spec EMP-DASH-HOME: today's sales, transactions, customers served, paid/credit.
  const customersServed = new Set(salesToUse.map((s) => s.customerId).filter(Boolean)).size;
  // Dashboard visibility is a per-role decision, not a side effect of holding a
  // permission. Both answers must be true: the owner selected the block for the role,
  // and the employee holds the permission the block needs. The database filters the
  // same list again, so this is the rendering half of the rule, not the enforcement.
  const showSales = canSeeDashboard("sales_overview") && hasPermission("sales.view");

  async function handleRefresh() {
    await useSalesStore.getState().load();
    await load();
  }

  function handleBell() {
    setShowNotifs((v) => !v);
    markAllRead();
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div
      className="flex flex-col w-full min-h-full relative"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      {/* ── Notification overlay ── */}
      {showNotifs && (
        <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setShowNotifs(false)}>
          <div
            className="fixed top-[88px] end-4 w-[280px] rounded-[var(--radius-card)] shadow-2xl overflow-hidden animate-scale-in flex flex-col"
            style={{ zIndex: 61, background: "var(--surface)", border: "1px solid var(--divider)", maxHeight: "360px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — clickable → full notifications page */}
            <button
              onClick={() => { navigate("/employee/notifications"); setShowNotifs(false); }}
              className="px-4 py-3 flex items-center justify-between shrink-0 w-full active:opacity-70 transition-opacity"
              style={{ borderBottom: "1px solid var(--divider)" }}
            >
              <p className="ds-section-label" style={{ color: "var(--text-primary)" }}>
                {t("dashboard.notifications")}
              </p>
              <div className="flex items-center gap-2">
                {unread() > 0 && (
                  <span className="text-10 font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
                    {unread()}
                  </span>
                )}
                <span className="text-10" style={{ color: "var(--text-secondary)" }}>{t("common.viewAll")}</span>
              </div>
            </button>
            {/* Scrollable unread list */}
            <div className="overflow-y-auto flex-1" style={{ maxHeight: "310px" }}>
              {notificationsReady && notifications.filter(n => !n.read).length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noNotifications") || "No new notifications"}</p>
                </div>
              ) : (
                notifications.filter(n => !n.read).slice(0, 5).map((n) => {
                  const tr = translateNotification(n.kind, n.title, n.body, t);
                  return (
                    <button
                      key={n.id}
                      onClick={() => { markOneRead(n.id); setShowNotifs(false); }}
                      className="w-full text-start px-4 py-3 active:bg-black/5 transition-colors"
                      style={{ borderBottom: "1px solid var(--divider)" }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--brand)" }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>{tr.title}</p>
                          {tr.body && <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{tr.body}</p>}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <StatusBar />

      {/* ── Greeting bar ── */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <button
          onClick={() => navigate("/employee/settings")}
          className="flex items-center justify-center rounded-full shrink-0 size-[44px] font-bold text-15 transition-transform active:scale-95 overflow-hidden"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            firstName.charAt(0).toUpperCase()
          )}
        </button>

        <div className="flex flex-col flex-1 min-w-0">
          {branches.length > 1 ? (
            <button
              type="button"
              data-testid="employee-branch-switch"
              onClick={() => openSwitcher()}
              className="flex items-center gap-1.5 self-start max-w-full active:opacity-60"
            >
              <span className="font-bold text-17 truncate" style={{ color: "var(--text-primary)" }}>
                {activeBranchName ?? t("audit.noBranch")}
              </span>
              {branchKind(t, activeBranch?.isMain) && (
                <span className="text-10 font-bold h-5 px-1.5 rounded-full flex items-center shrink-0"
                  style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                  {branchKind(t, activeBranch?.isMain)}
                </span>
              )}
              <ChevronDown size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
            </button>
          ) : (
            <p className="font-bold text-17 truncate flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
              <span className="truncate">{activeBranchName ?? t("audit.noBranch")}</span>
              {branchKind(t, activeBranch?.isMain) && (
                <span className="text-10 font-bold h-5 px-1.5 rounded-full flex items-center shrink-0"
                  style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                  {branchKind(t, activeBranch?.isMain)}
                </span>
              )}
            </p>
          )}
          {branchLocation && (
            <p
              data-testid="employee-branch-location"
              className="text-12 mt-0.5 flex items-center gap-1 min-w-0"
              style={{ color: "var(--text-secondary)" }}
            >
              <MapPin size={11} className="shrink-0" />
              <span className="truncate">{branchLocation}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate("/employee/search")}
            className="flex items-center justify-center rounded-full size-9 transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Search size={15} style={{ color: "var(--text-primary)" }} />
          </button>
          <button
            onClick={handleBell}
            className="flex items-center justify-center rounded-full size-9 relative transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Bell size={15} style={{ color: "var(--text-primary)" }} />
            {badgeCount > 0 && (
              <span className="absolute top-1 end-1 bg-red-500 text-white text-8 font-bold rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-[2px]">
                {badgeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Metric card — brand lime ── */}
      {/* `data-tour` anchors for the employee's own tour: the two blocks it teaches.
          Additive attributes only. */}
      {showSales && (<div className="px-4 animate-fade-in-up" data-tour="home:kpis">
        <div
          className="rounded-[var(--radius-card)] p-5 cursor-pointer transition-transform active:scale-[0.98]"
          style={{ background: "var(--brand)" }}
          onClick={() => navigate("/employee/sales", { state: { tab: "all" } })}
        >
          {/* Label */}
          <p className="ds-section-label mb-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("dashboard.todaySales")} — {firstName}
          </p>

          {/* Total */}
          <p className="text-34 font-bold leading-none mb-4" style={{ color: "#0a0a0a" }}>
            {formatRs(totalAmount)}
          </p>

          {/* Paid + Credit rows */}
          <div className="flex gap-6">
            {/* Paid */}
            <button
              onClick={(e) => { e.stopPropagation(); navigate("/employee/sales", { state: { tab: "paid" } }); }}
              className="flex items-center gap-3 group"
            >
              <div>
                <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.5)" }}>
                  {t("dashboard.paid")}
                </p>
                <p className="text-18 font-bold" style={{ color: "#0a0a0a" }}>
                  {paidAmount.toLocaleString("en-PK")}
                </p>
              </div>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center transition-transform group-active:scale-90"
                style={{ background: "rgba(0,0,0,0.15)" }}
              >
                <ArrowRight size={13} color="#0a0a0a" strokeWidth={2.5} />
              </div>
            </button>

            {/* Divider */}
            <div className="w-px" style={{ background: "rgba(0,0,0,0.15)" }} />

            {/* Credit */}
            <button
              onClick={(e) => { e.stopPropagation(); navigate("/employee/sales", { state: { tab: "credit" } }); }}
              className="flex items-center gap-3 group"
            >
              <div>
                <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.5)" }}>
                  {t("dashboard.credit")}
                </p>
                <p className="text-18 font-bold" style={{ color: "#0a0a0a" }}>
                  {formatRs(creditAmount)}
                </p>
              </div>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center transition-transform group-active:scale-90"
                style={{ background: "rgba(0,0,0,0.15)" }}
              >
                <ArrowRight size={13} color="#0a0a0a" strokeWidth={2.5} />
              </div>
            </button>
          </div>
        </div>
      </div>)}


      {/* ── Today's activity: Transactions · Customers served ── */}
      {showSales && (<div className="px-4 pt-3 flex gap-2.5 animate-fade-in-up delay-75">
        <div className="flex-1 rounded-[var(--radius-tile)] px-4 py-3" style={{ background: "var(--surface-2)" }}>
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {t("admin.transactions")}
          </p>
          <p className="text-18 font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{txCount}</p>
        </div>
        <div className="flex-1 rounded-[var(--radius-tile)] px-4 py-3" style={{ background: "var(--surface-2)" }}>
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {t("admin.customersServed")}
          </p>
          <p className="text-18 font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{customersServed}</p>
        </div>
      </div>)}

      {/* The persona blocks come before the quick actions for a non-sales workspace, so a
          finance or stock role opens on its own numbers instead of on a sales-shaped page. */}
      {!showSales && <EmployeePersonaWidgets salesOverviewVisible={false} />}

      {/* ── Quick Actions ── */}
      {(hasPermission("sales.create") || hasPermission("customers.payments")) && (<div className="px-4 pt-4 animate-fade-in-up delay-75" data-tour="home:actions">
        <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("dashboard.quickActions")}
        </p>
        <div className="flex gap-3">
          {hasPermission("sales.create") && (<button
            onClick={() => navigate("/employee/sale")}
            className="flex-1 h-12 rounded-full font-bold text-14 flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <ShoppingCart size={15} strokeWidth={2.5} />
            {t("dashboard.newSale")}
          </button>)}
          {hasPermission("customers.payments") && (<button
            onClick={() => navigate("/employee/customers")}
            className="flex-1 h-12 rounded-full font-bold text-14 flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            <CreditCard size={15} strokeWidth={2} />
            {t("dashboard.recordPayment")}
          </button>)}
        </div>
      </div>)}

      {/* ── Recent Sales ── */}
      {showSales && (<div className="px-4 pt-5 pb-4 animate-fade-in-up delay-150">
        <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("dashboard.recentSales")}
        </p>
        <ListCard>
          {!ready ? (
            <SkeletonList rows={3} tile bare />
          ) : recentSales.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <ClipboardList size={24} className="mx-auto block mb-1" style={{ color: "var(--text-tertiary)" }} />
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("admin.noSalesYetToday")}</p>
            </div>
          ) : recentSales.map((sale) => {
            const cImg = getCustomerImg(sale.customerId);
            const cBg = initBgColor(sale.customerName);
            return (
            <ListRow
              key={sale.id}
              onClick={() => navigate(`/employee/sales/${sale.id}`)}
              tile={cImg ? (
                <img src={cImg} alt={sale.customerName} className="size-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="size-9 rounded-full shrink-0 flex items-center justify-center text-11 font-bold" style={{ background: cBg, color: "#fff" }}>
                  {sale.customerName.charAt(0).toUpperCase()}
                </div>
              )}
              trailing={
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatRs(sale.totalAmount)}
                  </span>
                  {sale.paymentType !== "full" ? (
                    <span className="text-10 font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                      {t("common.creditTag")}
                    </span>
                  ) : (
                    <span className="text-10 font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}>
                      {t("common.paidTag")}
                    </span>
                  )}
                </div>
              }
            >
              <div className="min-w-0">
                <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now, t)}</p>
              </div>
            </ListRow>
            );
          })}
        </ListCard>
      </div>)}

      {showSales && <EmployeePersonaWidgets salesOverviewVisible />}
    </div>
    </PullToRefresh>
  );
}
