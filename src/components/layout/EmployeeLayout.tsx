import { Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Home, Receipt, ScanLine, Package, Users, Wifi, WifiOff, X, Menu,
  Landmark, Truck, UsersRound, type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useOfflineStore } from "@/stores/offlineStore";
import { getPendingCount } from "@/lib/offlineQueue";
import PINInput from "@/components/ui/PINInput";
import { Suspense, useState, useEffect, useRef } from "react";
import useOverlayScrollLock from "@/hooks/useOverlayScrollLock";
import { verifyPinDetailed } from "@/lib/pinLock";
import { useUIStore } from "@/stores/uiStore";
import { useProductsStore } from "@/stores/productsStore";
import ToastContainer from "@/components/ui/Toast";
import NavTracker from "@/components/ui/NavTracker";
import FirstRunGate from "@/components/education/FirstRunGate";
import ContextHelp from "@/components/education/ContextHelp";
import { useT, tNow, type I18nKey } from "@/lib/i18n";
import { useBootstrapData } from "@/stores/useBootstrapData";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { resolveEmployeeWorkspace } from "@/lib/employeeWorkspace";
import ShopSwitcherSheet from "@/components/shop/ShopSwitcherSheet";
import ShopAccessNotice, { useNoActiveShop } from "@/components/shop/ShopAccessNotice";
import { isTopLevel } from "@/lib/navDepth";
import { clearNav } from "@/lib/navContext";
import BackButtonHandler from "@/components/ui/BackButtonHandler";
import AssistantFab from "@/components/layout/AssistantFab";

interface EmployeeTab {
  key: string;
  labelKey: I18nKey;
  icon: LucideIcon;
  path: string;
}

/**
 * The employee bar, derived from the grants the server returned for the active branch.
 *
 * Home and More always exist. Between them sit at most three destinations, chosen from the
 * modules this account may actually open. The primary module is inferred from permissions, not
 * from a role name or a department: somebody who can ring up a sale gets Sales first, somebody
 * who can adjust stock gets Inventory first, and somebody who can only read the money book gets
 * Finance first. Scan appears only when both the sale and product reads it needs are held.
 */
function buildEmployeeTabs(user: ReturnType<typeof useAuthStore.getState>["user"]): EmployeeTab[] {
  const home: EmployeeTab = { key: "nav.home", labelKey: "nav.home", icon: Home, path: "/employee/dashboard" };
  const more: EmployeeTab = { key: "nav.more", labelKey: "nav.more", icon: Menu, path: "/employee/more" };
  const has = (code: string) =>
    user?.membershipRole === "owner" || (user?.permissions ?? []).includes(code);

  const canSales = has("sales.view");
  const canCreateSale = has("sales.create");
  const canProducts = has("products.view");
  const canEditProduct = has("products.edit");
  const canInventoryAdjust = has("inventory.adjust");
  const canCustomers = has("customers.view");
  const canPurchases = has("purchases.view");
  const canFinance = has("payments.view");
  const canTeam = has("employees.view");
  const showScan = canSales && canCreateSale && canProducts;

  // The `key` is also the `data-tour` handle the education system already points at. Keep the
  // established `nav.*` names for the original tabs; a friendlier internal label would silently
  // orphan every tour step that highlights them.
  const byKey: Record<string, EmployeeTab & { show: boolean }> = {
    sales: { key: "nav.sales", labelKey: "nav.sales", icon: Receipt, path: "/employee/sales", show: canSales },
    products: { key: "nav.products", labelKey: "nav.products", icon: Package, path: "/employee/products", show: canProducts },
    customers: { key: "nav.customers", labelKey: "nav.customers", icon: Users, path: "/employee/customers", show: canCustomers },
    purchases: { key: "nav.purchases", labelKey: "nav.purchases", icon: Truck, path: "/employee/purchases", show: canPurchases },
    finance: { key: "nav.finance", labelKey: "nav.finance", icon: Landmark, path: "/employee/finance", show: canFinance },
    team: { key: "nav.team", labelKey: "nav.team", icon: UsersRound, path: "/employee/team", show: canTeam },
  };

  // The same resolver the dashboard uses, so the tab bar and the home workspace cannot
  // disagree about what this role is. See `src/lib/employeeWorkspace.ts`.
  const primary = resolveEmployeeWorkspace(has);

  const preference: Record<string, string[]> = {
    sales: ["sales", "products", "customers", "team", "purchases", "finance"],
    products: ["products", "purchases", "sales", "customers", "team", "finance"],
    finance: ["finance", "purchases", "customers", "sales", "products", "team"],
    purchases: ["purchases", "products", "customers", "sales", "team", "finance"],
    customers: ["customers", "sales", "products", "purchases", "finance", "team"],
    team: ["team", "sales", "customers", "purchases", "products", "finance"],
  };

  const ordered = (preference[primary ?? "sales"] ?? [])
    .map((key) => byKey[key])
    .filter((item): item is EmployeeTab & { show: boolean } => Boolean(item?.show));

  const middle: EmployeeTab[] = ordered.slice(0, showScan ? 2 : 3);
  if (showScan && middle.length > 0) {
    middle.splice(1, 0, {
      key: "scan",
      labelKey: "scan",
      icon: ScanLine,
      path: "__scan__",
    });
  }

  return [home, ...middle, more];
}

const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export default function EmployeeLayout() {
  const t = useT();
  const { user, isLocked, lock, unlock, logout } = useAuthStore();
  const refreshPermissions = useAuthStore((s) => s.refreshPermissions);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const { addToast } = useUIStore();
  const { isOnline, setOnline, syncQueue, isSyncing, pendingOpsCount } = useOfflineStore();
  const navigate = useNavigate();
  const location = useLocation();
  useBootstrapData();
  // The same lock the owner shell uses: a sheet over a list does not let the list move underneath.
  useOverlayScrollLock();
  // Which shop this session works in is the server's answer, not this device's — the owner
  // shell asks the same question for its header. Here there is nothing to switch, but the
  // answer is still the difference between "this employee can work" and "this account is in
  // no shop", and the second one has to be said out loud rather than rendered as empty screens.
  const loadShops = useShopStore((s) => s.load);
  const userId = user?.id;
  useEffect(() => {
    if (userId) void loadShops();
  }, [loadShops, userId]);
  // A branch change can change the assigned role, so the tab bar must not keep the previous
  // branch's grants. Re-read the effective permissions when the shell mounts and whenever the
  // active branch moves; the server remains the authority.
  useEffect(() => {
    if (userId) void refreshPermissions();
  }, [refreshPermissions, userId, activeBranchId]);
  const noActiveShop = useNoActiveShop();
  const tabs = buildEmployeeTabs(user);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  // Online/offline detection + auto-sync
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      addToast("Back online — syncing data", "success");
      syncQueue();
    };
    const handleOffline = () => {
      setOnline(false);
      addToast("You are offline. Sales will queue locally.", "warning");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const pending = getPendingCount();
    if (pending > 0) {
      setOnline(navigator.onLine);
    }
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Session lock timer
  function resetLockTimer() {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => lock(), LOCK_TIMEOUT_MS);
  }

  useEffect(() => {
    resetLockTimer();
    const events = ["touchstart", "click", "keydown"];
    events.forEach((e) => window.addEventListener(e, resetLockTimer));
    return () => {
      if (lockTimer.current) clearTimeout(lockTimer.current);
      events.forEach((e) => window.removeEventListener(e, resetLockTimer));
    };
  }, []);

  useEffect(() => {
    if (pin.length === 4) handlePINSubmit(pin);
  }, [pin]);

  async function handlePINSubmit(p: string) {
    if (!user) return;
    const result = await verifyPinDetailed(user.id, p);
    if (result.status === "ok") {
      unlock();
      setPin("");
      setPinError(false);
    } else {
      setPinError(true);
      setPinShake(true);
      setTimeout(() => setPinShake(false), 500);
      setPin("");
      addToast(
        result.status === "locked" ? t("copy.pinLocked")
          : result.status === "error" ? t("copy.pinCheckFailed")
          : t("copy.pinWrong"),
        "error",
      );
    }
  }

  function activeTab() {
    const path = location.pathname;
    if (path.startsWith("/employee/dashboard")) return "/employee/dashboard";
    if (path.startsWith("/employee/sale"))      return "/employee/sales";
    if (path.startsWith("/employee/sales"))     return "/employee/sales";
    if (path.startsWith("/employee/customers")) return "/employee/customers";
    if (path.startsWith("/employee/products") || path.startsWith("/employee/stock")) return "/employee/products";
    if (path.startsWith("/employee/finance")) return "/employee/finance";
    if (path.startsWith("/employee/purchases")) return "/employee/purchases";
    if (path.startsWith("/employee/team")) return "/employee/team";
    // More owns every door that is not one of the four primary destinations, including the
    // assistant, reports and account screens. That keeps the menu lit while it is being used.
    return "/employee/more";
  }

  const active = activeTab();
  const showTabBar = isTopLevel(location.pathname);

  // Scan button handler
  const resolveByCode = useProductsStore((s) => s.resolveByCode);
  const { addToast: empAddToast } = useUIStore();
  const [empScanning, setEmpScanning] = useState(false);
  const [showManualScan, setShowManualScan] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");

  async function handleEmpNavScan() {
    setEmpScanning(true);
    try {
      const { scanFromCamera } = await import("@/lib/barcode");
      const result = await scanFromCamera({
        hint: t("scan.pointAtBarcode"),
        cancel: t("common.cancel"),
      });
      if (result) {
        const product = await resolveByCode(result.barcode);
        if (product) {
          navigate(`/employee/sale/products/${product.id}`);
        } else {
          // Was an English sentence built here by hand, so an employee reading Urdu was
          // told the code was unknown in a language the shop does not use.
          empAddToast(tNow("copy.noProductForCode", { code: result.barcode }), "error");
        }
      } else {
        setShowManualScan(true);
      }
    } catch {
      setShowManualScan(true);
    } finally {
      setEmpScanning(false);
    }
  }

  async function handleManualScanSubmit() {
    if (manualBarcode.trim().length >= 3) {
      const product = await resolveByCode(manualBarcode.trim());
      if (product) {
        navigate(`/employee/sale/products/${product.id}`);
      } else {
        empAddToast(`No product found for "${manualBarcode}"`, "error");
      }
      setManualBarcode("");
      setShowManualScan(false);
    }
  }

  // Hiding a tab is not authorization. The same path rules that choose the bar also protect a
  // direct URL, so a typed address cannot open a module the active branch's role does not hold.
  const requiredPermission = (() => {
    const path = location.pathname;
    if (path.startsWith("/employee/customers/new")) return "customers.create";
    if (path.includes("/record-payment") || /\/customers\/[^/]+\/payments/.test(path)) return "customers.payments";
    if (path.startsWith("/employee/customers")) return "customers.view";
    if (path.startsWith("/employee/sale")) return "sales.create";
    if (path.startsWith("/employee/sales")) return "sales.view";
    if (path.startsWith("/employee/products") || path.startsWith("/employee/inventory") || path.startsWith("/employee/stock")) return "products.view";
    if (path.startsWith("/employee/finance")) return "payments.view";
    if (path.startsWith("/employee/purchases/new")) return "purchases.create";
    if (path.startsWith("/employee/purchases/payments")) return "payments.view";
    if (path.startsWith("/employee/purchases")) return "purchases.view";
    if (path.startsWith("/employee/companies/new")) return "companies.create";
    if (path.startsWith("/employee/companies")) return "companies.view";
    if (path.startsWith("/employee/team")) return "employees.view";
    if (path.startsWith("/employee/activity")) return "activity.view";
    return null;
  })();

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/employee/dashboard" replace />;
  }

  return (
    <div
      className="flex flex-col min-h-full w-full relative"
      style={{ background: "var(--background)" }}
    >
      <NavTracker />
      <BackButtonHandler />
      <ToastContainer />
      <ShopSwitcherSheet />

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div
          className="flex items-center justify-between px-4 py-2 animate-fade-in-down"
          style={{ background: "#1c1917", color: "#fef3c7" }}
        >
          <div className="flex items-center gap-2">
            <WifiOff size={14} />
            <span className="text-12 font-semibold">
              {t("common.offline")} — {pendingOpsCount > 0
                ? t("common.offlineQueued", { count: pendingOpsCount })
                : t("common.offlineWorkingLocally")}
            </span>
          </div>
          <span className="text-10 opacity-60 uppercase tracking-wide">{t("common.autoSyncOnReconnect")}</span>
        </div>
      )}

      {/* ── Syncing banner ── */}
      {isOnline && isSyncing && (
        <div
          className="flex items-center gap-2 px-4 py-2 animate-fade-in-down"
          style={{ background: "rgba(132,204,22,0.12)", color: "var(--brand-dark)" }}
        >
          <Wifi size={14} className="animate-pulse" />
          <span className="text-12 font-semibold">Syncing {pendingOpsCount} queued change(s)…</span>
        </div>
      )}

      {/* ── Session lock overlay ── */}
      {isLocked && (
        <div
          className="absolute inset-0 z-50 flex flex-col"
          style={{ background: "var(--background)" }}
        >
          <div className="safe-top" />
          <div className="flex flex-col flex-1 items-center justify-center px-6 gap-8">
            <div className="flex flex-col items-center gap-2 text-center animate-fade-in-up">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-2 text-xl font-bold"
                style={{ background: "var(--muted)", color: "var(--text-primary)" }}
              >
                {user?.name?.charAt(0).toUpperCase()}
              </div>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{user?.name}</p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("auth.pinPrompt")}</p>
            </div>
            <PINInput value={pin} onChange={setPin} error={pinError} shake={pinShake} />
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="text-sm underline underline-offset-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("auth.notYouSignOut")}
            </button>
          </div>
        </div>
      )}

      {/* ── Manual Scan Modal ── */}
      {showManualScan && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "var(--scrim)" }}
          onClick={() => setShowManualScan(false)}
        >
          <div
            className="w-full max-w-[480px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--tone-sheet)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("common.scanBarcode")}</p>
              <button onClick={() => setShowManualScan(false)} aria-label={t("common.close")} style={{ color: "var(--text-secondary)" }}><X size={16} /></button>
            </div>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("scan.cameraUnavailable")}
            </p>
            <input
              autoFocus
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleManualScanSubmit()}
              placeholder={t("common.barcodePlaceholder")}
              className="w-full h-12 rounded-full px-4 text-sm outline-none font-mono"
              style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
            />
            <button
              onClick={handleManualScanSubmit}
              disabled={manualBarcode.trim().length < 3}
              className="w-full h-12 rounded-full font-bold text-sm disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("scan.lookUpProduct")}
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div
        data-app-scroll
        className="flex flex-col flex-1 overflow-y-auto"
        style={{ paddingBottom: showTabBar ? "var(--tabbar-height)" : "0px" }}
      >
        <Suspense fallback={<div className="flex items-center justify-center flex-1" style={{ color: "var(--text-secondary)" }}><div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" /></div>}>
          {/* Screens cross-fade on navigation. Keyed on the path so the animation
              restarts per route, and opacity/transform only, so a route change
              never forces a layout pass mid-transition. */}
          {/* `flex-1` reproduces what a page root as a direct flex child did: at least
              as tall as its content, and filling the viewport when it is shorter. */}
          <div key={location.pathname} className="ds-anim-screen flex flex-col w-full flex-1">
            {/* An account the database accepts nothing from is told so, instead of being shown
                the employee's screens with nothing in them. */}
            {noActiveShop ? <ShopAccessNotice /> : <Outlet />}
          </div>
        </Suspense>
      </div>

      {/* Education: the employee's own tour and first-run welcome — the same gate as the
          owner shell, teaching the employee's steps rather than the owner's. */}
      <FirstRunGate />
      <ContextHelp />

      {/* The assistant, off the bar and within thumb reach of home. It answers on the employee's
          own session — from what this account can already open — so it is safe to put in front
          of everyone; it is simply not a place you go to look. See AssistantFab. */}
      {location.pathname === "/employee/dashboard" && <AssistantFab path="/employee/assistant" />}

      {/* ── Bottom tab bar — only on top-level navigation screens ── */}
      {showTabBar && (
      <div
        className="fixed bottom-0 start-0 end-0 max-w-[480px] mx-auto flex items-start pt-2 border-t"
        style={{
          background: "var(--surface)",
          borderColor: "var(--divider)",
          height: "var(--tabbar-height)",
          // Below overlays (z-50), above ordinary page content — same contract as the
          // admin shell, so a sheet can never be hidden behind the nav in either shell.
          zIndex: 30,
          paddingBottom: "var(--safe-bottom)",
          paddingLeft: "16px",
          paddingRight: "16px",
        }}
      >
        {/* Every tab carries an explicit 44px floor, the same contract as the admin shell:
            the icon+label stack is only ~41px tall on its own, and a rendered-box audit
            counts anything under 44px as an undersized finger target. */}
        {tabs.map(({ key, labelKey, icon: Icon, path }) => {
          if (path === "__scan__") {
            return (
              <button
                key="scan"
                onClick={handleEmpNavScan}
                disabled={empScanning}
                data-tour="tab:scan"
                className="ds-pressable flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer min-h-[44px]"
              >
                <div
                  className="flex items-center justify-center rounded-full -mt-3"
                  style={{ width: 44, height: 44, background: "var(--brand)" }}
                >
                  <ScanLine size={22} strokeWidth={2.5} color="#0a0a0a" />
                </div>
                <span className="text-10 font-bold" style={{ color: "var(--brand)" }}>
                  {empScanning ? "..." : t(labelKey)}
                </span>
              </button>
            );
          }
          const isActive = active === path;
          return (
            <button
              key={path}
              onClick={() => { clearNav(); navigate(path); }}
              data-tour={`tab:${key}`}
              className="ds-pressable flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer min-h-[44px]"
            >
              <Icon
                size={22}
                strokeWidth={isActive ? 2.5 : 1.5}
                style={{ color: isActive ? "var(--brand)" : "var(--text-secondary)" }}
              />
              <span
                className="text-10 transition-colors"
                style={{
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? "var(--brand)" : "var(--text-secondary)",
                }}
              >
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
