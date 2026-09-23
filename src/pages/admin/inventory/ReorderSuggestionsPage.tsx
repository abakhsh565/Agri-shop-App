import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useThemeStore } from "@/stores/themeStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { getStockStatus, getStockStatusColor, formatCurrency } from "@/lib/formatters";
import { Package, AlertTriangle, ArrowRight, ShoppingCart } from "lucide-react";
import { useT } from "@/lib/i18n";
import { SkeletonList } from "@/components/ui/Skeleton";

export default function ReorderSuggestionsPage() {
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const companies = useCompaniesStore((s) => s.companies);
  // Read both stores unconditionally: short-circuiting a hook call is what
  // crashed this screen, since React must see the same hooks every render.
  const productsReady = useProductsStore((s) => s.ready);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const ready = productsReady && companiesReady;

  const suggestions = useMemo(() => {
    const rows: {
      productId: string;
      productName: string;
      company: string;
      variantId: string;
      variantName: string;
      stockQty: number;
      threshold: number;
      urgency: number; // percentage below threshold
      status: string;
    }[] = [];

    for (const p of products) {
      const available = p.variants.length > 0
        ? Math.floor(p.stockQty / (p.variants[0]?.unitSize ?? 1))
        : 0;
      const threshold = p.variants[0]?.lowStockThreshold ?? 5;
      if (p.stockQty <= threshold) {
        for (const v of p.variants) {
          const vAvailable = Math.floor(p.stockQty / v.unitSize);
          rows.push({
            productId: p.id,
            productName: p.name,
            company: p.company,
            variantId: v.id,
            variantName: v.name,
            stockQty: p.stockQty,
            threshold,
            urgency: threshold > 0
              ? ((threshold - p.stockQty) / threshold) * 100
              : 100,
            status: vAvailable === 0 ? "out_of_stock" : "low_stock",
          });
        }
      }
    }

    // Sort by urgency (most urgent first)
    return rows.sort((a, b) => b.urgency - a.urgency);
  }, [products]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("admin.reorderSuggestions")} />

      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] p-3" style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)" }}>
          <AlertTriangle size={16} style={{ color: "#d97706" }} />
          <p className="text-xs" style={{ color: "#92400e" }}>
            {suggestions.length === 0
              ? t("admin.wellStocked")
              : t("admin.needRestocking", { count: suggestions.length })}
          </p>
        </div>
      </div>

      {!ready ? (
        <SkeletonList rows={4} tile />
      ) : suggestions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 gap-2">
          <Package size={32} style={{ color: "var(--text-secondary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.noRestockingNeeded")}</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("admin.allAboveThresholds")}</p>
        </div>
      ) : (
        <div className="flex flex-col mx-4 gap-3 pb-24">
          {suggestions.map((s, i) => {
            const color = getStockStatusColor(s.status as any);
            return (
              <div
                key={`${s.productId}-${s.variantId}`}
                className="rounded-[var(--radius-card)] overflow-hidden"
                style={{ border: "1px solid var(--divider)", background: "var(--surface)" }}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: color + "22" }}>
                    <Package size={16} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{s.productName}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.company} · {s.variantName}</p>
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-sm font-bold" style={{ color }}>{s.stockQty} {t("common.left")}</p>
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("common.thresholdValue", { value: s.threshold })}</p>
                  </div>
                </div>

                {/* Urgency bar */}
                <div className="px-4 pb-3">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(5, 100 - s.urgency))}%`, background: color }}
                    />
                  </div>
                </div>

                {/* Action — order from this supplier */}
                <div className="px-4 pb-3">
                  <button
                    onClick={() => {
                      const supplier = companies.find(c => c.name === s.company);
                      navigate(supplier ? `/admin/purchases/new?companyId=${supplier.id}` : `/admin/purchases/new`);
                    }}
                    className="flex items-center justify-center gap-2 w-full h-10 rounded-full text-xs font-bold transition-colors active:opacity-70"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    <ShoppingCart size={13} /> {t("common.orderFrom", { name: s.company })} <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
