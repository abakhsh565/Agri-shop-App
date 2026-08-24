import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Home, Receipt, ScanLine, Package, MoreHorizontal, Wifi, WifiOff } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useOfflineStore } from "@/stores/offlineStore";
import PINInput from "@/components/ui/PINInput";
import { useState, useEffect, useRef } from "react";
import { verifyPin } from "@/lib/pinLock";
import { useUIStore } from "@/stores/uiStore";
import { useProductsStore } from "@/stores/productsStore";
import ToastContainer from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { useBootstrapData } from "@/stores/useBootstrapData";
import { isTopLevel } from "@/lib/navDepth";

const TAB_DEFS = [
  { key: "nav.home" as const,    icon: Home,          path: "/employee/dashboard" },
  { key: "nav.sales" as const,   icon: Receipt,       path: "/employee/sales"     },
  { key: "scan" as const,        icon: ScanLine,      path: "__scan__"            },
  { key: "nav.products" as const,icon: Package,       path: "/employee/products"  },
  { key: "admin.more" as const,  icon: MoreHorizontal, path: "/employee/more"      },
];

const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export default function EmployeeLayout() {
  const t = useT();
  const { user, isLocked, lock, unlock, logout } = useAuthStore();
  const { addToast } = useUIStore();
  const { isOnline, pendingQueue, setOnline, syncQueue, isSyncing } = useOfflineStore();
  const navigate = useNavigate();
  const location = useLocation();
  useBootstrapData();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Offline detection
  useEffect(() => {
    function handleOnline()  { setOnline(true);  addToast("Back online — syncing pending sales", "success"); }
    function handleOffline() { setOnline(false); addToast("You are offline. Sales will queue locally.", "warning"); }
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
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
    const ok = await verifyPin(user.id, p);
    if (ok) {
      unlock();
      setPin("");
      setPinError(false);
    } else {
      setPinError(true);
      setPinShake(true);
      setTimeout(() => setPinShake(false), 500);
      setPin("");
      addToast("Incorrect PIN. Try again.", "error");
    }
  }

  function activeTab() {
    const path = location.pathname;
    if (path.startsWith("/employee/sale"))      return "/employee/sales";
    if (path.startsWith("/employee/sales"))     return "/employee/sales";
    if (path.startsWith("/employee/customers") || path.startsWith("/employee/settings")) return "/employee/more";
    if (path.startsWith("/employee/products"))  return "/employee/products";
    return "/employee/dashboard";
  }

  const active = activeTab();
  const showTabBar = isTopLevel(location.pathname);

  // Scan button handler
  const findByBarcode = useProductsStore((s) => s.findByBarcode);
  const { addToast: empAddToast } = useUIStore();
  const [empScanning, setEmpScanning] = useState(false);

  async function handleEmpNavScan() {
    setEmpScanning(true);
    try {
      const { scanFromCamera } = await import("@/lib/barcode");
      const result = await scanFromCamera();
      if (result) {
        const product = findByBarcode(result.barcode);
        if (product) {
          navigate(`/employee/sale/products/${product.id}`);
        } else {
          empAddToast(`No product found for "${result.barcode}"`, "error");
        }
      }
    } catch {
      empAddToast("Camera unavailable", "error");
    } finally {
      setEmpScanning(false);
    }
  }

  return (
    <div
      className="flex flex-col min-h-full w-full relative"
      style={{ background: "var(--background)" }}
    >
      <ToastContainer />

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div
          className="flex items-center justify-between px-4 py-2 animate-fade-in-down"
          style={{ background: "#1c1917", color: "#fef3c7" }}
        >
          <div className="flex items-center gap-2">
            <WifiOff size={14} />
            <span className="text-[12px] font-semibold">
              Offline mode — {pendingQueue.length > 0 ? `${pendingQueue.length} sale(s) queued` : "working locally"}
            </span>
          </div>
          <span className="text-[10px] opacity-60 uppercase tracking-wide">Auto-syncs on reconnect</span>
        </div>
      )}

      {/* ── Syncing banner ── */}
      {isOnline && isSyncing && (
        <div
          className="flex items-center gap-2 px-4 py-2 animate-fade-in-down"
          style={{ background: "rgba(132,204,22,0.12)", color: "var(--brand-dark)" }}
        >
          <Wifi size={14} className="animate-pulse" />
          <span className="text-[12px] font-semibold">Syncing {pendingQueue.length} queued sale(s)…</span>
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
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Enter your PIN to continue</p>
            </div>
            <PINInput value={pin} onChange={setPin} error={pinError} shake={pinShake} />
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="text-sm underline underline-offset-2"
              style={{ color: "var(--text-secondary)" }}
            >
              Not you? Sign out
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div
        className="flex flex-col flex-1 overflow-y-auto"
        style={{ paddingBottom: showTabBar ? "var(--tabbar-height)" : "0px" }}
      >
        <Outlet />
      </div>

      {/* ── Bottom tab bar (4 tabs) — only on top-level navigation screens ── */}
      {showTabBar && (
      <div
        className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto flex items-start pt-2 border-t"
        style={{
          background: "var(--surface)",
          borderColor: "var(--divider)",
          height: "var(--tabbar-height)",
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
                className="flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer transition-all"
              >
                <div
                  className="flex items-center justify-center rounded-full -mt-3"
                  style={{ width: 44, height: 44, background: "var(--brand)" }}
                >
                  <ScanLine size={22} strokeWidth={2.5} color="#0a0a0a" />
                </div>
                <span className="text-[10px] font-bold" style={{ color: "var(--brand)" }}>
                  {empScanning ? "..." : t(key)}
                </span>
              </button>
            );
          }
          const isActive = active === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer transition-all"
            >
              <Icon
                size={22}
                strokeWidth={isActive ? 2.5 : 1.5}
                style={{ color: isActive ? "var(--brand)" : "var(--text-secondary)" }}
              />
              <span
                className="text-[10px] transition-colors"
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
