import { useEffect, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useThemeStore } from "@/stores/themeStore";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { ArrowUpCircle, ArrowDownCircle, RefreshCw, Package } from "lucide-react";

interface Movement {
  id: string;
  type: "sale" | "purchase" | "adjustment" | "return";
  productName: string;
  variantName: string;
  qtyChange: number;
  qtyAfter: number;
  reference?: string;
  reason?: string;
  createdAt: string;
}

export default function StockMovementHistoryPage() {
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const products = useProductsStore((s) => s.products);
  const sales = useSalesStore((s) => s.sales);
  const now = useCurrentTime();
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Build movements from available data
    const movs: Movement[] = [];

    // Sale deductions
    for (const sale of sales) {
      if (sale.isVoided) continue;
      for (const item of sale.items) {
        movs.push({
          id: `sale-${sale.id}-${item.variantId}`,
          type: "sale",
          productName: item.productName,
          variantName: item.variantName,
          qtyChange: -item.qty,
          qtyAfter: 0,
          reference: sale.saleNumber,
          createdAt: sale.createdAt,
        });
      }
    }

    // Sort by date descending
    movs.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    setMovements(movs);
    setLoading(false);
  }, [sales, products]);

  function movementIcon(type: string) {
    switch (type) {
      case "sale": return <ArrowDownCircle size={18} style={{ color: "var(--error)" }} />;
      case "purchase": return <ArrowUpCircle size={18} style={{ color: "#22c55e" }} />;
      case "adjustment": return <RefreshCw size={18} style={{ color: "var(--brand)" }} />;
      case "return": return <ArrowUpCircle size={18} style={{ color: "#3b82f6" }} />;
      default: return <Package size={18} style={{ color: "var(--text-secondary)" }} />;
    }
  }

  function movementLabel(type: string) {
    switch (type) {
      case "sale": return "Sale deduction";
      case "purchase": return "Stock-in";
      case "adjustment": return "Manual adjustment";
      case "return": return "Return";
      default: return type;
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("admin.stockMovements")} />

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.loadingMovements")}</p>
        </div>
      ) : movements.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 gap-2">
          <Package size={32} style={{ color: "var(--text-secondary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.noStockMovements")}</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("admin.movementsAppearAfter")}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {movements.map((mov, i) => (
            <div
              key={mov.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: i < movements.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
                {movementIcon(mov.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{mov.productName}</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {mov.variantName} · {movementLabel(mov.type)} {mov.reference ? `· ${mov.reference}` : ""}
                </p>
              </div>
              <div className="text-end shrink-0">
                <p className="text-sm font-bold" style={{ color: mov.qtyChange > 0 ? "#22c55e" : "var(--error)" }}>
                  {mov.qtyChange > 0 ? "+" : ""}{mov.qtyChange}
                </p>
                <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(mov.createdAt, now, t)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
