import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingBag, Package, ScanLine, MoreHorizontal } from "lucide-react";
import { useT } from "@/lib/i18n";
import ToastContainer from "@/components/ui/Toast";
import { useBootstrapData } from "@/stores/useBootstrapData";
import { isTopLevel } from "@/lib/navDepth";
import { useState } from "react";
import ScanButton from "@/components/ui/ScanButton";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";

const TAB_DEFS = [
  { key: "admin.dashboard" as const, icon: LayoutDashboard, path: "/admin/dashboard" },
  { key: "admin.sales"     as const, icon: ShoppingBag,     path: "/admin/sales"     },
  { key: "scan"            as const, icon: ScanLine,        path: "__scan__"         },
  { key: "admin.inventory" as const, icon: Package,         path: "/admin/inventory" },
  { key: "admin.more"      as const, icon: MoreHorizontal,  path: "/admin/more"      },
];

export default function AdminLayout() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  useBootstrapData();

  function activeTab() {
    const path = location.pathname;
    if (path.startsWith("/admin/sales"))     return "/admin/sales";
    if (path.startsWith("/admin/inventory") || path.startsWith("/admin/inventory/movements") || path.startsWith("/admin/inventory/reorder")) return "/admin/inventory";
    if (path.startsWith("/admin/customers")) return "/admin/customers";
    if (path.startsWith("/admin/more") ||
        path.startsWith("/admin/employees") ||
        path.startsWith("/admin/companies") ||
        path.startsWith("/admin/purchases") ||
        path.startsWith("/admin/reports") ||
        path.startsWith("/admin/settings") ||
        path.startsWith("/admin/payments") ||
        path.startsWith("/admin/products"))  return "/admin/more";
    return "/admin/dashboard";
  }

  const active = activeTab();
  const showTabBar = isTopLevel(location.pathname);

  // Scan button in nav triggers camera scan → lookup product or open Add Product
  const findByBarcode = useProductsStore((s) => s.findByBarcode);
  const { addToast } = useUIStore();
  const [scanning, setScanning] = useState(false);

  async function handleNavScan() {
    setScanning(true);
    try {
      const { scanFromCamera } = await import("@/lib/barcode");
      const result = await scanFromCamera();
      if (result) {
        const product = findByBarcode(result.barcode);
        if (product) {
          navigate(`/admin/inventory/${product.id}/edit`);
        } else {
          navigate(`/admin/inventory/new`);
          addToast(`Barcode "${result.barcode}" — no product found. Create new?`, "info");
        }
      }
    } catch {
      addToast("Camera unavailable", "error");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div
      className="flex flex-col min-h-full w-full relative"
      style={{ background: "var(--background)" }}
    >
      <ToastContainer />

      {/* ── Main content ── */}
      <div
        className="flex flex-col flex-1 overflow-y-auto"
        style={{ paddingBottom: showTabBar ? "var(--tabbar-height)" : "0px" }}
      >
        <Outlet />
      </div>

      {/* ── Bottom tab bar (5 tabs) — only on top-level navigation screens ── */}
      {showTabBar && (
      <div
        className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto flex items-start pt-2 border-t"
        style={{
          background: "var(--surface)",
          borderColor: "var(--divider)",
          height: "var(--tabbar-height)",
          paddingBottom: "0px",
          paddingLeft: "16px",
          paddingRight: "16px",
        }}
      >
        {TAB_DEFS.map(({ key, icon: Icon, path }) => {
          if (path === "__scan__") {
            return (
              <button
                key="scan"
                onClick={handleNavScan}
                disabled={scanning}
                className="flex flex-col items-center justify-center flex-1 gap-1 cursor-pointer transition-all"
              >
                <div
                  className="flex items-center justify-center rounded-full -mt-3"
                  style={{ width: 44, height: 44, background: "var(--brand)" }}
                >
                  <ScanLine size={22} strokeWidth={2.5} color="#0a0a0a" />
                </div>
                <span className="text-[10px] font-bold" style={{ color: "var(--brand)" }}>
                  {scanning ? "..." : t(key)}
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
