import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency, productLowStockThreshold } from "@/lib/formatters";
import { AlertTriangle, Package, Truck, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { SkeletonList } from "@/components/ui/Skeleton";

/**
 * Inventory alerts, on the app's own tones.
 *
 * Every colour on this screen used to be a literal taken from a light-mode comp: pale
 * `#FEF2F2` and `#FFFBEB` row surfaces, `#FECACA` and `#FDE68A` borders, `#991B1B` text. On
 * the light theme that reads as intended; on the dark theme the same literals stay pale, so
 * the alerts shouted out of a near-black page and the untinted third summary card looked
 * like it belonged to a different screen.
 *
 * The tones are now the mode-aware tokens the rest of the app already uses — `--error-bg`,
 * `--error`, `--warning-bg`, `--warning` — which are alpha-based, so they darken with the
 * theme instead of fighting it. Severity lives in the leading tile and the section label,
 * the way the dashboard's own alerts card does it, and the rows are the shared grouped list
 * rather than one bordered box each.
 */
export default function InventoryAlertsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const products = useProductsStore((s) => s.products);
  const companies = useCompaniesStore((s) => s.companies);
  // Read both stores unconditionally: short-circuiting a hook call is what
  // crashed this screen, since React must see the same hooks every render.
  const productsReady = useProductsStore((s) => s.ready);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const ready = productsReady && companiesReady;

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
  const allClear = outOfStock.length === 0 && lowStock.length === 0 && totalPayable === 0;

  /**
   * One summary count. The tint is a function of the count, so a shop with nothing wrong
   * sees three identical resting cards instead of two pretending to be warnings.
   */
  const summary = (label: string, count: number, tone: "error" | "warning" | "plain") => {
    const lit = count > 0 && tone !== "plain";
    return (
      <div
        className="flex-1 min-w-0 rounded-[var(--radius-card)] p-3.5"
        style={{
          background: lit
            ? tone === "error"
              ? "var(--error-bg)"
              : "var(--warning-bg)"
            : "var(--surface-2)",
        }}
      >
        <p className="ds-section-label truncate" style={{ color: "var(--text-secondary)" }}>
          {label}
        </p>
        <p
          className="text-20 font-bold mt-0.5"
          style={{ color: lit ? (tone === "error" ? "var(--error)" : "var(--warning)") : "var(--text-primary)" }}
        >
          {count}
        </p>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("alerts.inventoryTitle")} />

      {!ready ? (
        <SkeletonList rows={4} tile />
      ) : (
        <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
          {/* Three equal cards. `min-w-0` and a truncating label, because "Reorder" and its
              Urdu counterpart are both longer than a third of the width. */}
          <div className="flex gap-2.5">
            {summary(t("admin.outOfStock"), outOfStock.length, "error")}
            {summary(t("admin.lowStock"), lowStock.length, "warning")}
            {summary(t("admin.reorder"), reorderNeeded.length, "plain")}
          </div>

          {/* ── Supplier payables ──────────────────────────────────────────────── */}
          {totalPayable > 0 && (
            <div>
              <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("admin.supplierPayableDue")}
              </p>
              <ListCard>
                <ListRow
                  onClick={() => navigate("/admin/companies")}
                  tile={
                    <div
                      className="size-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--error-bg)", color: "var(--error)" }}
                    >
                      <Truck size={16} />
                    </div>
                  }
                  title={t("admin.supplierPayableDue")}
                  meta={t("common.totalDue", { amount: formatCurrency(totalPayable) })}
                  trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                />
              </ListCard>
            </div>
          )}

          {/* ── Out of stock ───────────────────────────────────────────────────── */}
          {outOfStock.length > 0 && (
            <div>
              <p className="ds-section-label mb-2" style={{ color: "var(--error)" }}>
                {t("products.outOfStock")}
              </p>
              <ListCard>
                {outOfStock.map((p) => (
                  <ListRow
                    key={p.id}
                    onClick={() => navigate("/admin/inventory/" + p.id + "/adjust")}
                    tile={
                      <div
                        className="size-9 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--error-bg)", color: "var(--error)" }}
                      >
                        <Package size={16} />
                      </div>
                    }
                    title={p.name}
                    meta={t("common.unitsInStock", { count: p.stockQty })}
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  />
                ))}
              </ListCard>
            </div>
          )}

          {/* ── Low stock ──────────────────────────────────────────────────────── */}
          {lowStock.length > 0 && (
            <div>
              <p className="ds-section-label mb-2" style={{ color: "var(--warning)" }}>
                {t("products.lowStock")}
              </p>
              <ListCard>
                {lowStock.map((p) => (
                  <ListRow
                    key={p.id}
                    onClick={() => navigate("/admin/inventory/" + p.id + "/adjust")}
                    tile={
                      <div
                        className="size-9 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--warning-bg)", color: "var(--warning)" }}
                      >
                        <AlertTriangle size={16} />
                      </div>
                    }
                    title={p.name}
                    meta={t("common.unitsThreshold", { count: p.stockQty, threshold: thresholdFor(p) })}
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  />
                ))}
              </ListCard>
            </div>
          )}

          {/* ── All clear ──────────────────────────────────────────────────────── */}
          {allClear && (
            <div
              className="rounded-[var(--radius-card)] p-8 flex flex-col items-center gap-3"
              style={{ background: "var(--tone-card)" }}
            >
              <div
                className="size-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
              >
                <Package size={20} />
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
      )}
    </div>
  );
}
