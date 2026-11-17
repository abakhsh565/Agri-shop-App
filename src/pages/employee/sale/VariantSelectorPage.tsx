import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Photo from "@/components/ui/Photo";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { formatCurrency } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { ProductVariant } from "@/types";

/**
 * Available units of a variant = its own stock of record (the level sales deduct
 * from), floored to the sale step so the counter can never exceed real stock.
 */
function availableUnits(variant: { stockQty: number; qtyStep: number }): number {
  const step = variant.qtyStep > 0 ? variant.qtyStep : 1;
  return Math.floor(variant.stockQty / step) * step;
}

/**
 * The product page's pack list, one counter per pack.
 *
 * The screen used to be a radio group with a single quantity under it: four packs meant picking
 * one, adding it, coming back and doing the whole thing again for the second pack. A shopkeeper
 * selling three of the 250ml and one of the litre was doing four trips for one sale (owner,
 * 2026-11-17). So each pack now carries its own counter, every pack can hold a number at once,
 * and one Add to Cart takes all of them.
 *
 * The counters start at what the cart already holds for that pack — the page is the same sale,
 * so opening a pack that is already in the basket should not read zero and silently duplicate it.
 */
export default function VariantSelectorPage() {
  const t = useT();
  const { productId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const addItem = useCartStore((s) => s.addItem);
  const cartItems = useCartStore((s) => s.items);
  const { addToast } = useUIStore();

  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const product = products.find((p) => p.id === productId);

  /** Every pack's number, keyed by variant id. Zero means "not in this sale". */
  const [staged, setStaged] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const item of cartItems) {
      if (item.productId === productId) seed[item.variantId] = item.qty;
    }
    return seed;
  });

  const stagedVariants = useMemo(
    () =>
      (product?.variants ?? [])
        .map((v) => ({ variant: v, qty: staged[v.id] ?? 0 }))
        .filter((row) => row.qty > 0),
    [product?.variants, staged],
  );

  const stagedUnits = stagedVariants.reduce((sum, row) => sum + row.qty, 0);
  const stagedTotal = stagedVariants.reduce(
    (sum, row) => sum + row.qty * row.variant.sellingPrice,
    0,
  );

  if (!product) return productsReady ? null : <SkeletonList rows={4} />;

  function setQty(variant: ProductVariant, qty: number) {
    setStaged((prev) => ({ ...prev, [variant.id]: qty }));
  }

  function handleAdd() {
    if (!product || stagedVariants.length === 0) return;
    for (const { variant, qty } of stagedVariants) {
      const maxUnits = availableUnits(variant);
      addItem({
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.name,
        qty,
        unitPrice: variant.sellingPrice,
        unitSize: variant.unitSize,
        baseUnit: product.baseUnit,
        lineTotal: variant.sellingPrice * qty,
        maxQty: maxUnits,
        qtyStep: variant.qtyStep,
      });
    }
    addToast(t("sale.addedPacks", { count: String(stagedVariants.length) }), "success");
    navigate(`${base}/sale/cart`);
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("sale.productDetails")} />

      {/* Product header card */}
      <div className="mx-4 mt-3 rounded-[var(--radius-tile)] p-4 flex items-center gap-3 justify-between" style={{ background: "var(--surface-2)" }}>
        <Photo
          src={product.imageUrl}
          alt={product.name}
          className="w-12 h-12 rounded-[var(--radius-tile)] object-cover shrink-0"
          fallback={null}
        />
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{product.name}</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{product.company}</p>
        </div>
        <button
          onClick={() => navigate(`${base}/sale/products`)}
          className="h-8 px-3 rounded-full text-xs font-medium"
          style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
        >
          {t("common.change")}
        </button>
      </div>

      {/* Packs — one card each, a counter on the trailing side */}
      <div className="px-4 pt-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-13 font-semibold" style={{ color: "var(--text-secondary)" }}>
            {t("common.selectSellableUnit")}
          </p>
          <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
            {t("sale.pickVariantsHint")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {product.variants.map((v) => {
            const units = availableUnits(v);
            const oos = units === 0;
            const qty = staged[v.id] ?? 0;
            const chosen = qty > 0;
            return (
              <div
                key={v.id}
                className="rounded-[var(--radius-tile)] p-3 flex items-center gap-3"
                style={{
                  background: "var(--surface)",
                  border: `1px solid ${chosen ? "var(--brand)" : "var(--divider)"}`,
                  opacity: oos ? 0.45 : 1,
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {v.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(v.sellingPrice)} ·{" "}
                    {oos ? t("products.outOfStock") : `${units} ${t("common.units")}`}
                  </p>
                  {product.baseUnit !== "piece" && (
                    <p className="text-11 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {v.unitSize} {product.baseUnit}
                    </p>
                  )}
                </div>
                <div className="shrink-0 w-[132px]">
                  <QuantityCounter
                    size="sm"
                    min={0}
                    qty={oos ? 0 : qty}
                    onChange={(next) => setQty(v, next)}
                    max={units || undefined}
                    step={v.qtyStep}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-4" />

      {/* One Add to Cart for every pack that has a number */}
      <div className="p-4 pb-6">
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {stagedUnits > 0
              ? `${stagedVariants.length} ${stagedVariants.length === 1 ? t("sale.packOne") : t("sale.packMany")} · ${stagedUnits} ${stagedUnits === 1 ? t("sale.unitOne") : t("common.units")}`
              : t("sale.pickVariantsEmpty")}
          </p>
          <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(stagedTotal)}
          </p>
        </div>
        <div className="rounded-full overflow-hidden">
          <Button
            fullWidth
            size="lg"
            onClick={handleAdd}
            disabled={stagedVariants.length === 0}
          >
            {t("sale.addToCart")}
          </Button>
        </div>
      </div>
    </div>
  );
}
