import { useNavigate } from "react-router-dom";
import { CalendarClock, CalendarX, PackageCheck, TriangleAlert } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import StockRow from "@/components/inventory/StockRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import { useShopStore } from "@/stores/shopStore";
import { EXPIRY_WARNING_DAYS } from "@/lib/signalEngine";
import { expiryItems, unitWord } from "@/lib/inventoryView";
import { formatDate } from "@/lib/formatters";

/**
 * Expiry alerts: the packs whose date is coming, soonest first.
 *
 * WHAT THIS SCREEN CAN HONESTLY SAY. This app records one date per pack
 * (`product_variants.expiry_date`) — there is no batch number and no per-batch quantity in the
 * data, so the rows name the pack and its date rather than inventing a batch code and a count
 * for it. The window is `EXPIRY_WARNING_DAYS` (the S9 rule) — the same one the business overview
 * and the branch cards use — which is why a pack that is already out of date is on this screen
 * too rather than hidden until someone changes a filter.
 *
 * A row opens the product, where the pack's dates and history live and where a quantity is
 * adjusted when the goods have to be written off.
 */
export default function ExpiryAlertsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const branch = useShopStore((s) => s.activeBranchName);

  const items = expiryItems(products);
  const expired = items.filter((item) => item.expired);
  const expiringSoon = items.filter((item) => !item.expired);

  const figure = (label: string, count: number, tone: "error" | "warning", testId: string) => {
    const lit = count > 0;
    return (
      <div
        className="flex-1 min-w-0 rounded-[var(--radius-card)] p-3.5"
        style={{ background: lit ? (tone === "error" ? "var(--error-bg)" : "var(--warning-bg)") : "var(--surface-2)" }}
      >
        <p className="ds-section-label truncate" style={{ color: "var(--text-secondary)" }}>
          {label}
        </p>
        <p
          className="text-20 font-bold mt-0.5"
          style={{ color: lit ? (tone === "error" ? "var(--error)" : "var(--warning)") : "var(--text-primary)" }}
          data-testid={testId}
        >
          {ready ? count : "—"}
        </p>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="expiry-alerts-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.inventory.expiring")} backTo={`${base}/settings/hub/inventory`} />

      <div className="flex gap-2.5 px-4 pt-3">
        {figure(t("expiry.expiringSoon"), expiringSoon.length, "warning", "expiry-soon")}
        {figure(t("expiry.expired"), expired.length, "error", "expiry-expired")}
      </div>

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : items.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-3">
          <div
            className="size-12 rounded-full flex items-center justify-center"
            style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
          >
            <PackageCheck size={20} />
          </div>
          <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("expiry.none")}
          </p>
          <p className="text-11 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("expiry.noneWhy", { days: EXPIRY_WARNING_DAYS })}
          </p>
        </div>
      ) : (
        <div className="pb-8">
          <p className="text-15 font-bold px-4 mt-5 mb-2">{t("expiry.packs")}</p>
          <ListCard className="mx-4">
            {items.map((item) => (
              <StockRow
                key={item.key}
                testId={`expiry-item-${item.key}`}
                icon={item.expired ? CalendarX : CalendarClock}
                title={item.productName}
                line={item.variantName}
                note={`${t("expiry.expiresOn", { date: formatDate(item.expiryDate) })}${branch ? ` · ${branch}` : ""}`}
                statusLabel={item.expired ? t("expiry.expired") : t("expiry.expiringSoon")}
                statusColor={item.expired ? "var(--error)" : "var(--warning)"}
                onClick={() => navigate(`${base}/products/${item.productId}`)}
              />
            ))}
          </ListCard>
          <div className="px-4 pt-4 flex items-center gap-2">
            <TriangleAlert size={14} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
              {t("expiry.scopeNote", { days: EXPIRY_WARNING_DAYS })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
