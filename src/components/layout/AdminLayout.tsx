import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingBag, Package, ScanLine, Menu, X } from "lucide-react";
import { useT, tNow } from "@/lib/i18n";
import ToastContainer from "@/components/ui/Toast";
import NavTracker from "@/components/ui/NavTracker";
import FirstRunGate from "@/components/education/FirstRunGate";
import ContextHelp from "@/components/education/ContextHelp";
import { useBootstrapData } from "@/stores/useBootstrapData";
import { isTopLevel } from "@/lib/navDepth";
import { Suspense, useState, useEffect, useRef } from "react";
import useOverlayScrollLock from "@/hooks/useOverlayScrollLock";
import ScanButton from "@/components/ui/ScanButton";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { clearNav } from "@/lib/navContext";
import BackButtonHandler from "@/components/ui/BackButtonHandler";
import AssistantFab from "@/components/layout/AssistantFab";
import { useOfflineStore } from "@/stores/offlineStore";
import { getPendingCount } from "@/lib/offlineQueue";
import { useAuthStore } from "@/stores/authStore";
import PINInput from "@/components/ui/PINInput";
import { verifyPinDetailed } from "@/lib/pinLock";
import { useShopStore } from "@/stores/shopStore";
import ShopSwitcherSheet from "@/components/shop/ShopSwitcherSheet";
import ShopAccessNotice, { useNoActiveShop } from "@/components/shop/ShopAccessNotice";

const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

const TAB_DEFS = [
  { key: "admin.dashboard" as const, icon: LayoutDashboard, path: "/admin/dashboard" },
  { key: "admin.sales"     as const, icon: ShoppingBag,     path: "/admin/sales"     },
  { key: "scan"            as const, icon: ScanLine,        path: "__scan__"         },
  { key: "admin.inventory" as const, icon: Package,         path: "/admin/products"    },
  // The fifth slot is the business hub, not Settings. Settings is configuration and account
  // state; the work of the business belongs in More, where its groups are one tap from every
  // shell screen instead of four levels inside an account page. `/admin/more` is the canonical
  // address again, and Settings is reached from this hub.
  { key: "admin.more"      as const, icon: Menu,            path: "/admin/more",     labelKey: "nav.more" },
];

export default function AdminLayout() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  useBootstrapData();
  // One place for every sheet, dialog and cropper: while one is open the list behind it holds still.
  useOverlayScrollLock();
  const noActiveShop = useNoActiveShop();
  const { user, isLocked, lock, unlock, logout } = useAuthStore();
  const refreshPermissions = useAuthStore((s) => s.refreshPermissions);
  const { setOnline, syncQueue } = useOfflineStore();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Online/offline detection + auto-sync
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      addToast(tNow("copy.backOnline"), "success");
      syncQueue();
    };
    const handleOffline = () => {
      setOnline(false);
      addToast(tNow("copy.wentOffline"), "warning");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Check initial pending ops count
    const pending = getPendingCount();
    if (pending > 0) {
      setOnline(navigator.onLine);
    }
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Session lock timer (same as employee side)
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
        result.status === "locked" ? tNow("copy.pinLocked")
          : result.status === "error" ? tNow("copy.pinCheckFailed")
          : tNow("copy.pinWrong"),
        "error",
      );
    }
  }

  function activeTab() {
    const path = location.pathname;
    // Home first, and it has to be stated: the Dashboard tab opened the dashboard but nothing
    // lit it, because every branch below named a section and the landing screen named none.
    // A tab that is the current screen and does not say so reads as a tab that did not work.
    if (path.startsWith("/admin/dashboard")) return "/admin/dashboard";
    if (path.startsWith("/admin/sales"))     return "/admin/sales";
    if (path.startsWith("/admin/products") || path.startsWith("/admin/inventory")) return "/admin/products";
    // Every other business screen is one of More's doors, including Settings and the
    // `/settings/hub/*` sections. Keeping More lit is what makes it read as the menu that owns
    // the screen, rather than a fifth tab that goes dark whenever it is used.
    return "/admin/more";
  }

  const active = activeTab();
  const showTabBar = isTopLevel(location.pathname);

  // Scan button in nav triggers camera scan → lookup product or open Add Product
  // Which shop this session is working in is asked of the database when the shell mounts —
  // that is the whole of "restore the right shop after a reload": the answer comes from the
  // server, not from the shop this device last wrote down. It also re-runs for a different
  // account signing in on the same device.
  const loadShops = useShopStore((s) => s.load);
  const userId = user?.id;
  useEffect(() => {
    if (userId) void loadShops();
  }, [loadShops, userId]);

  // Re-read what this account may see when the shell mounts. The permissions carried on
  // the stored user are a snapshot from sign-in; an owner editing a role — or unticking a
  // dashboard block — hours later has to reach the phone that is already open.
  useEffect(() => {
    if (userId) void refreshPermissions();
  }, [refreshPermissions, userId]);

  const resolveByCode = useProductsStore((s) => s.resolveByCode);
  const { addToast } = useUIStore();
  const [scanning, setScanning] = useState(false);
  const [showManualScan, setShowManualScan] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");

  async function handleNavScan() {
    setScanning(true);
    try {
      const { scanFromCamera } = await import("@/lib/barcode");
      const result = await scanFromCamera({
        hint: t("scan.pointAtBarcode"),
        cancel: t("common.cancel"),
      });
      if (result) {
        const product = await resolveByCode(result.barcode);
        if (product) {
          // Go to Variant Selection → Cart → Checkout (same as employee)
          navigate(`/admin/sale/products/${product.id}`);
        } else {
          addToast(tNow("copy.noProductForCode", { code: result.barcode }), "error");
        }
      } else {
        setShowManualScan(true);
      }
    } catch {
      setShowManualScan(true);
    } finally {
      setScanning(false);
    }
  }

  async function handleManualScanSubmit() {
    if (manualBarcode.trim().length >= 3) {
      const product = await resolveByCode(manualBarcode.trim());
      if (product) {
        // Go to Variant Selection → Cart → Checkout (same as employee)
        navigate(`/admin/sale/products/${product.id}`);
      } else {
        addToast(tNow("copy.noProductForCode", { code: manualBarcode }), "error");
      }
      setManualBarcode("");
      setShowManualScan(false);
    }
  }

  return (
    <div
      className="flex flex-col min-h-full w-full relative"
      style={{ background: "var(--background)" }}
    >
      <NavTracker />
      <BackButtonHandler />
      <ToastContainer />

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
                the owner's screens with nothing in them. */}
            {noActiveShop ? <ShopAccessNotice /> : <Outlet />}
          </div>
        </Suspense>
      </div>

      {/* Education: the first-run welcome and the guided tour. Mounted here, inside the
          shell, so a tour step can move between the screens it teaches without the
          overlay ever having to exist outside a signed-in app. */}
      <FirstRunGate />
      <ContextHelp />

      {/* The shop selector, mounted once for the whole shell. Screens open it through
          `useShopStore.openSwitcher()` rather than each mounting their own copy — one
          selector, one mount, one place where switching is decided. */}
      <ShopSwitcherSheet />

      {/* The assistant, off the bar and within thumb reach of home. See AssistantFab. */}
      {location.pathname === "/admin/dashboard" && <AssistantFab path="/admin/assistant" />}

      {/* ── Bottom tab bar (5 tabs) — only on top-level navigation screens ── */}
      {showTabBar && (
      <div
        className="fixed bottom-0 start-0 end-0 max-w-[480px] mx-auto flex items-start pt-2 border-t"
        style={{
          background: "var(--surface)",
          borderColor: "var(--divider)",
          height: "var(--tabbar-height)",
          // Explicit layering, so this can never drift into the overlay band again:
          // below sheets/dialogs/toasts (z-50) and above ordinary page content.
          zIndex: 30,
          paddingBottom: "0px",
          paddingLeft: "16px",
          paddingRight: "16px",
        }}
      >
        {/* Every tab carries an explicit 44px floor. The icon+label stack is only ~41px tall
            on its own, and the accessibility lane measures real rendered boxes: with the
            assistant tab added, five sub-44px targets per route were counted (55 across the
            admin routes) and the frozen structural baseline − which may only shrink −
            refused the growth. The floor is the app's to meet, not the baseline's to record. */}
        {TAB_DEFS.map(({ key, icon: Icon, path, labelKey }) => {
          if (path === "__scan__") {
            return (
              <button
                key="scan"
                onClick={handleNavScan}
                disabled={scanning}
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
                  {scanning ? "..." : t(key)}
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
                {t(labelKey ?? key)}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
