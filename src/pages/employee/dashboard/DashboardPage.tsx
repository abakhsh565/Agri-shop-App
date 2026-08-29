import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useSalesStore } from "@/stores/salesStore";
import PullToRefresh from "@/components/ui/PullToRefresh";
import { useCustomersStore } from "@/stores/customersStore";
import { formatSmartDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { ShoppingCart, CreditCard, ChevronRight, Bell, Search, ArrowRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
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
  const { items: notifications, unread, load, subscribe, markAllRead } = useNotificationStore();
  const { language } = useThemeStore();
  const navigate = useNavigate();
  const t = useT();
  const [showNotifs, setShowNotifs] = useState(false);
  const allSales = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);

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
  const today = now;
  const hour = today.getHours();
  const greetingKey =
    hour < 12 ? "dashboard.greeting.morning"
    : hour < 17 ? "dashboard.greeting.afternoon"
    : "dashboard.greeting.evening";

  const dateStr = today.toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", {
    weekday: "long", day: "numeric", month: "long",
  });

  // Live metrics
  const todayStr = today.toISOString().split("T")[0];
  const todaySales = mockSales.filter((s) => !s.isVoided && s.createdAt.startsWith(todayStr));
  const salesToUse = todaySales.length > 0 ? todaySales : mockSales.filter((s) => !s.isVoided);
  const totalAmount  = salesToUse.reduce((s, x) => s + x.totalAmount, 0);
  const paidAmount   = salesToUse.filter((s) => s.paymentType === "full").reduce((s, x) => s + x.amountPaid, 0);
  const creditAmount = salesToUse.filter((s) => s.paymentType !== "full").reduce((s, x) => s + x.outstandingBalance, 0);
  const txCount      = salesToUse.length;
  const productsSold = salesToUse.reduce((s, x) => s + x.items.length, 0);
  const qtySold      = salesToUse.reduce((s, x) => s + x.items.reduce((q, it) => q + it.qty, 0), 0);
  const recentSales  = mockSales.filter((s) => !s.isVoided).slice(0, 3);
  const badgeCount   = unread();

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
        <div className="absolute inset-0 z-40" onClick={() => setShowNotifs(false)}>
          <div
            className="absolute top-[88px] right-4 w-[280px] rounded-[16px] shadow-2xl overflow-hidden z-50 animate-scale-in"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
              <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {t("dashboard.notifications")}
              </p>
            </div>
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noNotifications")}</p>
              </div>
            ) : (
              notifications.map((n) => {
                const route = employeeNotifRoute(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => { if (route) { navigate(route); setShowNotifs(false); } }}
                    className="w-full text-left px-4 py-3 active:bg-black/5 transition-colors"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{n.title}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{n.body}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <StatusBar />

      {/* ── Greeting bar ── */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <button
          onClick={() => navigate("/employee/settings")}
          className="flex items-center justify-center rounded-full shrink-0 size-[44px] font-bold text-[15px] transition-transform active:scale-95 overflow-hidden"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            firstName.charAt(0).toUpperCase()
          )}
        </button>

        <div className="flex flex-col flex-1 min-w-0">
          <p className="font-bold text-[17px] truncate" style={{ color: "var(--text-primary)" }}>
            {t(greetingKey)}, {firstName}
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{dateStr}</p>
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
              <span className="absolute top-1 right-1 bg-red-500 text-white text-[8px] font-bold rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-[2px]">
                {badgeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Metric card — brand lime ── */}
      <div className="px-4 animate-fade-in-up">
        <div
          className="rounded-[16px] p-5 cursor-pointer transition-transform active:scale-[0.98]"
          style={{ background: "var(--brand)" }}
          onClick={() => navigate("/employee/sales", { state: { tab: "all" } })}
        >
          {/* Label */}
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("dashboard.todaySales")} — {firstName}
          </p>

          {/* Total */}
          <p className="text-[34px] font-bold leading-none mb-4" style={{ color: "#0a0a0a" }}>
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
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                  {t("dashboard.paid")}
                </p>
                <p className="text-[18px] font-bold" style={{ color: "#0a0a0a" }}>
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
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                  {t("dashboard.credit")}
                </p>
                <p className="text-[18px] font-bold" style={{ color: "#0a0a0a" }}>
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
      </div>



      {/* ── Quick Actions ── */}
      <div className="px-4 pt-4 animate-fade-in-up delay-75">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("dashboard.quickActions")}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/employee/sale")}
            className="flex-1 h-12 rounded-full font-bold text-[14px] flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <ShoppingCart size={15} strokeWidth={2.5} />
            {t("dashboard.newSale")}
          </button>
          <button
            onClick={() => navigate("/employee/customers")}
            className="flex-1 h-12 rounded-full font-bold text-[14px] flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            <CreditCard size={15} strokeWidth={2} />
            {t("dashboard.recordPayment")}
          </button>
        </div>
      </div>

      {/* ── Recent Sales ── */}
      <div className="px-4 pt-5 pb-4 animate-fade-in-up delay-150">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("dashboard.recentSales")}
        </p>
        <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
          {recentSales.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-2xl mb-1">📋</p>
              <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>No sales yet today</p>
            </div>
          ) : recentSales.map((sale, i) => {
            const cImg = getCustomerImg(sale.customerId);
            const cBg = initBgColor(sale.customerName);
            return (
            <button
              key={sale.id}
              onClick={() => navigate(`/employee/sales/${sale.id}`)}
              className="flex items-center px-4 py-3.5 w-full text-left transition-colors active:opacity-70"
              style={{
                borderBottom: i < recentSales.length - 1 ? "1px solid var(--divider)" : "none",
                background: "var(--background)",
              }}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {cImg ? (
                  <img src={cImg} alt={sale.customerName} className="size-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="size-9 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold" style={{ background: cBg, color: "#fff" }}>
                    {sale.customerName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now)}</p>
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>Sold by: {sale.employeeName}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 ml-auto shrink-0">
                <span className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                  {formatRs(sale.totalAmount)}
                </span>
                {sale.paymentType !== "full" ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                    Credit
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}>
                    Paid
                  </span>
                )}
              </div>
            </button>
            );
          })}
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}
