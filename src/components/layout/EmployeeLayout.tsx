import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Home, Receipt, ScanLine, Package, Users, Wifi, WifiOff, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useOfflineStore } from "@/stores/offlineStore";
import { getPendingCount } from "@/lib/offlineQueue";
import PINInput from "@/components/ui/PINInput";
import { Suspense, useState, useEffect, useRef } from "react";
import { verifyPinDetailed } from "@/lib/pinLock";
import { useUIStore } from "@/stores/uiStore";
import { useProductsStore } from "@/stores/productsStore";
import ToastContainer from "@/components/ui/Toast";
import NavTracker from "@/components/ui/NavTracker";
import FirstRunGate from "@/components/education/FirstRunGate";
import ContextHelp from "@/components/education/ContextHelp";
import { useT } from "@/lib/i18n";
import { useBootstrapData } from "@/stores/useBootstrapData";
import { isTopLevel } from "@/lib/navDepth";
import { clearNav } from "@/lib/navContext";
import BackButtonHandler from "@/components/ui/BackButtonHandler";

const TAB_DEFS = [
  { key: "nav.home" as const,    icon: Home,          path: "/employee/dashboard" },
  { key: "nav.sales" as const,   icon: Receipt,       path: "/employee/sales"     },
  { key: "scan" as const,        icon: ScanLine,      path: "__scan__"            },
  { key: "nav.products" as const,icon: Package,       path: "/employee/products"  },
  { key: "nav.customers" as const, icon: Users,       path: "/employee/customers"  },
];

const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export default function EmployeeLayout() {
  const t = useT();
  const { user, isLocked, lock, unlock, logout } = useAuthStore();
  const { addToast } = useUIStore();
  const { isOnline, setOnline, syncQueue, isSyncing, pendingOpsCount } = useOfflineStore();
  const navigate = useNavigate();
  const location = useLocation();
  useBootstrapData();
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
    if (path.startsWith("/employee/sale"))      return "/employee/sales";
    if (path.startsWith("/employee/sales"))     return "/employee/sales";
    if (path.startsWith("/employee/customers")) return "/employee/customers";
    if (path.startsWith("/employee/products"))  return "/employee/products";
    return "/employee/dashboard";
  }

  const active = activeTab();
  const showTabBar = isTopLevel(location.pathname);

  // Scan button handler
  const findByBarcode = useProductsStore((s) => s.findByBarcode);
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
        const product = findByBarcode(result.barcode);
        if (product) {
          navigate(`/employee/sale/products/${product.id}`);
        } else {
          empAddToast(`No product found for "${result.barcode}"`, "error");
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

  function handleManualScanSubmit() {
    if (manualBarcode.trim().length >= 3) {
      const product = findByBarcode(manualBarcode.trim());
      if (product) {
        navigate(`/employee/sale/products/${product.id}`);
      } else {
        empAddToast(`No product found for "${manualBarcode}"`, "error");
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
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowManualScan(false)}
        >
          <div
            className="w-full max-w-[480px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }}
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
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
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
            <Outlet />
          </div>
        </Suspense>
      </div>

      {/* Education: the employee's own tour and first-run welcome — the same gate as the
          owner shell, teaching the employee's steps rather than the owner's. */}
      <FirstRunGate />
      <ContextHelp />

      {/* ── Bottom tab bar (4 tabs) — only on top-level navigation screens ── */}
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
        {TAB_DEFS.map(({ key, icon: Icon, path }) => {
          if (path === "__scan__") {
            return (
              <button
                key="scan"
                onClick={handleEmpNavScan}
                disabled={empScanning}
                data-tour="tab:scan"
                className="ds-pressable flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer"
              >
                <div
                  className="flex items-center justify-center rounded-full -mt-3"
                  style={{ width: 44, height: 44, background: "var(--brand)" }}
                >
                  <ScanLine size={22} strokeWidth={2.5} color="#0a0a0a" />
                </div>
                <span className="text-10 font-bold" style={{ color: "var(--brand)" }}>
                  {empScanning ? "..." : t(key)}
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
              className="ds-pressable flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer"
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
                {t(key)}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
