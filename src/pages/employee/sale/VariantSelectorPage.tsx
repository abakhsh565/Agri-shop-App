import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { formatCurrency } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { SkeletonList } from "@/components/ui/Skeleton";

/**
 * Available units of a variant = its own stock of record (the level sales deduct
 * from), floored to the sale step so the counter can never exceed real stock.
 */
function availableUnits(variant: { stockQty: number; qtyStep: number }): number {
  const step = variant.qtyStep > 0 ? variant.qtyStep : 1;
  return Math.floor(variant.stockQty / step) * step;
}

function stockStatusLabel(variant: { stockQty: number; qtyStep: number }): string {
  const units = availableUnits(variant);
  if (units <= 0) return "Out of stock";
  return `${units} available`;
}

export default function VariantSelectorPage() {
  const t = useT();
  const { productId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const { addItem } = useCartStore();
  const { addToast } = useUIStore();

  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const product = products.find((p) => p.id === productId);
  const [selectedVariantId, setSelectedVariantId] = useState(product?.variants[0]?.id ?? "");
  const [qty, setQty] = useState(product?.variants[0]?.qtyStep ?? 1);

  if (!product) return productsReady ? null : <SkeletonList rows={4} />;

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);
  const maxUnits = selectedVariant ? availableUnits(selectedVariant) : 0;
  const isOOS = maxUnits === 0;

  function handleAdd() {
    if (!selectedVariant) return;
    addItem({
      productId: product!.id,
      productName: product!.name,
      variantId: selectedVariant.id,
      variantName: selectedVariant.name,
      qty,
      unitPrice: selectedVariant.sellingPrice,
      unitSize: selectedVariant.unitSize,
      baseUnit: product!.baseUnit,
      lineTotal: selectedVariant.sellingPrice * qty,
      maxQty: maxUnits,
      qtyStep: selectedVariant.qtyStep,
    });
    addToast(`${product!.name} (${selectedVariant.name}) added to cart`, "success");
    navigate(`${base}/sale/cart`);
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("sale.productDetails")} />

      {/* Product header card */}
      <div className="mx-4 mt-3 rounded-[var(--radius-tile)] p-4 flex items-center gap-3 justify-between" style={{ background: "var(--surface-2)" }}>
        {product.imageUrl && (
          <img src={product.imageUrl} alt={product.name} className="w-12 h-12 rounded-[var(--radius-tile)] object-cover shrink-0" />
        )}
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

      {/* Stock summary */}
      <div className="mx-4 mt-2 px-3 py-2 rounded-[var(--radius-tile)]" style={{ background: "var(--surface)" }}>
        <p className="text-11" style={{ color: "var(--text-secondary)" }}>
          Total stock: <span className="font-bold" style={{ color: "var(--text-primary)" }}>{product.stockQty} {product.baseUnit}</span>
        </p>
      </div>

      {/* Variant selector */}
      <div className="px-4 pt-4">
        <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>{t("common.selectSellableUnit")}</p>
        <div className="flex flex-col gap-2">
          {product.variants.map((v) => {
            const units = availableUnits(v);
            const isSelected = v.id === selectedVariantId;
            const oos = units === 0;
            return (
              <button
                key={v.id}
                onClick={() => {
                  if (!oos) {
                    setSelectedVariantId(v.id);
                    setQty(v.qtyStep);
                  }
                }}
                disabled={oos}
                className="flex items-center justify-between p-4 rounded-[var(--radius-tile)] transition-colors"
                style={{
                  border: `1px solid ${isSelected ? "var(--text-primary)" : "var(--divider)"}`,
                  opacity: oos ? 0.4 : 1,
                  cursor: oos ? "not-allowed" : "pointer",
                }}
              >
                <div className="text-start">
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(v.sellingPrice)} per unit · {units > 0 ? `${units} available` : "Out of stock"}
                  </p>
                </div>
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={{ borderColor: isSelected ? "var(--text-primary)" : "var(--divider)" }}
                >
                  {isSelected && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--text-primary)" }} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quantity */}
      <div className="px-4 pt-3.5">
        <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>{t("admin.quantity")}</p>
        <div className="flex items-center justify-between rounded-[var(--radius-tile)] h-[52px] px-4" style={{ border: "1px solid var(--divider)" }}>
          <QuantityCounter
            qty={qty}
            onChange={setQty}
            max={maxUnits > 0 ? maxUnits : undefined}
            step={selectedVariant?.qtyStep ?? 1}
          />
        </div>
        {selectedVariant && (
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
            {stockStatusLabel(selectedVariant)} ·
            {product.baseUnit !== "piece" && ` ${selectedVariant.unitSize} ${product.baseUnit} per unit`}
          </p>
        )}
      </div>

      <div className="flex-1" />

      {/* Add to Cart */}
      <div className="p-4 pb-6">
        <Button
          fullWidth
          size="lg"
          onClick={handleAdd}
          disabled={!selectedVariant || isOOS}
        >
          {t("sale.addToCart")}
        </Button>
      </div>
    </div>
  );
}
