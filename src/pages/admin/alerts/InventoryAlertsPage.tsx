import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency, productLowStockThreshold } from "@/lib/formatters";
import { AlertTriangle, Package, Truck, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function InventoryAlertsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const products = useProductsStore((s) => s.products);
  const companies = useCompaniesStore((s) => s.companies);

  // Categorize products with the shared inventory rule (see
  // productLowStockThreshold): the product total is its variants' total, measured
  // against the most demanding variant threshold, and it is only "low" when there
  // is still stock to sell.
  const thresholdFor = (p: (typeof products)[number]) => productLowStockThreshold(p.variants);
  const outOfStock = products.filter((p) => p.stockQty <= 0);
  const lowStock = products.filter((p) => {
    if (p.stockQty <= 0) return false;
    return p.stockQty <= thresholdFor(p);
  });
  const reorderNeeded = products.filter((p) => {
    if (p.stockQty <= thresholdFor(p)) return false;
    return p.stockQty <= thresholdFor(p) * 2;
  });

  const totalPayable = companies.reduce((s, c) => s + c.outstandingPayable, 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("alerts.inventoryTitle")} />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {/* Summary cards */}
        <div className="flex gap-2.5">
          <div
            className="flex-1 rounded-[14px] p-3.5"
            style={{ background: outOfStock.length > 0 ? "#FEE2E2" : "var(--surface-2)" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: outOfStock.length > 0 ? "#DC2626" : "var(--text-secondary)" }}>{t("admin.outOfStock")}</p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: outOfStock.length > 0 ? "#991B1B" : "var(--text-primary)" }}>{outOfStock.length}</p>
          </div>
          <div
            className="flex-1 rounded-[14px] p-3.5"
            style={{ background: lowStock.length > 0 ? "#FEF3C7" : "var(--surface-2)" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: lowStock.length > 0 ? "#D97706" : "var(--text-secondary)" }}>{t("admin.lowStock")}</p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: lowStock.length > 0 ? "#92400E" : "var(--text-primary)" }}>{lowStock.length}</p>
          </div>
          <div
            className="flex-1 rounded-[14px] p-3.5"
            style={{ background: "var(--surface-2)" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("admin.reorder")}</p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{reorderNeeded.length}</p>
          </div>
        </div>

        {/* Supplier payable alert */}
        {totalPayable > 0 && (
          <button
            onClick={() => navigate("/admin/companies")}
            className="flex items-center gap-3 rounded-[14px] p-4 transition-opacity active:opacity-70 text-start w-full"
            style={{ background: "#FCEBEB" }}
          >
            <Truck size={18} color="#A32D2D" className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium" style={{ color: "#791F1F" }}>{t("admin.supplierPayableDue")}</p>
              <p className="text-[12px] mt-0.5" style={{ color: "#A32D2D" }}>{formatCurrency(totalPayable)} total due</p>
            </div>
            <ChevronRight size={14} color="#A32D2D" />
          </button>
        )}

        {/* Out of stock */}
        {outOfStock.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#DC2626" }}>
              {t("products.outOfStock")}
            </p>
            <div className="flex flex-col gap-2">
              {outOfStock.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate("/admin/inventory/" + p.id + "/adjust")}
                  className="flex items-center gap-3 rounded-[14px] p-3.5 transition-opacity active:opacity-70 text-start w-full"
                  style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}
                >
                  <div
                    className="size-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "#FEE2E2" }}
                  >
                    <Package size={16} color="#DC2626" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                    <p className="text-[11px]" style={{ color: "#DC2626" }}>0 units in stock</p>
                  </div>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Low stock */}
        {lowStock.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#D97706" }}>
              {t("products.lowStock")}
            </p>
            <div className="flex flex-col gap-2">
              {lowStock.map((p) => {
                const threshold = productLowStockThreshold(p.variants);
                return (
                  <button
                    key={p.id}
                    onClick={() => navigate("/admin/inventory/" + p.id + "/adjust")}
                    className="flex items-center gap-3 rounded-[14px] p-3.5 transition-opacity active:opacity-70 text-start w-full"
                    style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}
                  >
                    <div
                      className="size-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "#FEF3C7" }}
                    >
                      <AlertTriangle size={16} color="#D97706" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                      <p className="text-[11px]" style={{ color: "#D97706" }}>{p.stockQty} units — threshold: {threshold}</p>
                    </div>
                    <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* All clear */}
        {outOfStock.length === 0 && lowStock.length === 0 && totalPayable === 0 && (
          <div
            className="rounded-[14px] p-8 flex flex-col items-center gap-3"
            style={{ border: "1px solid var(--divider)" }}
          >
            <div
              className="size-12 rounded-full flex items-center justify-center"
              style={{ background: "#E3F3D9" }}
            >
              <Package size={20} color="#3B6D11" />
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {t("admin.inventoryHealthy")}
            </p>
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              {t("admin.noStockAlerts")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
