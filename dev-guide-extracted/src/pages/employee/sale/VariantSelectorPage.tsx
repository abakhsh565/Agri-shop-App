import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { StockBadge } from "@/components/ui/Badge";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { formatCurrency, getStockStatus } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";

export default function VariantSelectorPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const { addItem } = useCartStore();
  const { addToast } = useUIStore();

  const products = useProductsStore((s) => s.products);
  const product = products.find((p) => p.id === productId);
  const [selectedVariantId, setSelectedVariantId] = useState(product?.variants[0]?.id ?? "");
  const [qty, setQty] = useState(1);

  if (!product) return null;

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);

  function handleAdd() {
    if (!selectedVariant) return;
    addItem({
      productId: product!.id,
      productName: product!.name,
      variantId: selectedVariant.id,
      variantName: selectedVariant.name,
      qty,
      unitPrice: selectedVariant.sellingPrice,
      lineTotal: selectedVariant.sellingPrice * qty,
      maxQty: selectedVariant.stockQty,
    });
    addToast(`${product!.name} (${selectedVariant.name}) added to cart`, "success");
    navigate(`${base}/sale/cart`);
  }

  return (
    <div className="flex flex-col bg-white w-full min-h-full">
      <StatusBar />
      <NavHeader title="Product Details" backTo={`${base}/sale/products`} />

      {/* Product header card */}
      <div className="mx-4 mt-3 bg-[#f5f5f5] rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-lg font-bold text-black">{product.name}</p>
          <p className="text-xs text-[#888]">{product.company}</p>
        </div>
        <button
          onClick={() => navigate(`${base}/sale/products`)}
          className="h-8 px-3 rounded-full border border-black text-xs font-medium text-black"
        >
          Change
        </button>
      </div>

      {/* Variant selector */}
      <div className="px-4 pt-5">
        <p className="text-xs font-bold text-black uppercase mb-3">Select Variant</p>
        <div className="flex flex-col gap-2">
          {product.variants.map((v) => {
            const stock = getStockStatus(v.stockQty, v.lowStockThreshold);
            const isOOS = stock === "out_of_stock";
            const isSelected = v.id === selectedVariantId;
            return (
              <button
                key={v.id}
                onClick={() => !isOOS && setSelectedVariantId(v.id)}
                disabled={isOOS}
                className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                  isSelected ? "border-black" : "border-[#e5e5e5]"
                } ${isOOS ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <div className="text-left">
                  <p className="text-sm font-medium text-black">{v.name}</p>
                  <p className="text-xs text-[#888]">{formatCurrency(v.sellingPrice)} — {v.stockQty} in stock</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-black" : "border-[#ccc]"}`}>
                  {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-black" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quantity */}
      <div className="px-4 pt-5">
        <p className="text-xs font-bold text-black uppercase mb-3">Quantity</p>
        <div className="flex items-center justify-between border border-black rounded-xl h-[52px] px-4">
          <QuantityCounter
            qty={qty}
            onChange={setQty}
            max={selectedVariant?.stockQty}
          />
        </div>
        {selectedVariant && (
          <p className="text-xs text-[#888] mt-2">{selectedVariant.stockQty} remaining in stock</p>
        )}
      </div>

      <div className="flex-1" />

      {/* Add to Cart */}
      <div className="p-4">
        <Button
          fullWidth
          size="lg"
          onClick={handleAdd}
          disabled={!selectedVariant || selectedVariant.stockQty === 0}
        >
          Add to Cart
        </Button>
      </div>
    </div>
  );
}
