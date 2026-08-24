import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { CategoryChip, StockBadge } from "@/components/ui/Badge";
import { useProductsStore } from "@/stores/productsStore";
import { formatCurrency, getStockStatus } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { Lock, Pencil } from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  spray: "Sprays", seed: "Seeds", fertilizer: "Fertilizer", other: "Other",
};

export default function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const isAdmin = base === "/admin";
  const products = useProductsStore((s) => s.products);
  const product = products.find((p) => p.id === productId);

  if (!product) return null;

  return (
    <div className="flex flex-col bg-white w-full min-h-full">
      <StatusBar />
      <NavHeader
        title="Product Details"
        backLabel="Products"
        backTo={`${base}/products`}
        right={
          isAdmin ? (
            <button
              onClick={() => navigate(`/admin/inventory/${product.id}/edit`)}
              className="flex items-center gap-1 h-8 px-3 rounded-full text-xs font-bold active:opacity-70"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              <Pencil size={13} /> Edit
            </button>
          ) : undefined
        }
      />

      <div className="px-4 pt-4">
        {/* Product name + category */}
        <div className="flex items-center gap-3 mb-2">
          <p className="text-xl font-bold text-black">{product.name}</p>
          <CategoryChip label={CATEGORY_LABEL[product.category]} />
        </div>

        {/* Company */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded bg-[#f5f5f5] flex items-center justify-center text-xs font-bold text-black">
            {product.company.charAt(0)}
          </div>
          <p className="text-sm text-[#888]">{product.company}</p>
        </div>

        {/* Read-only notice (employees only) */}
        {!isAdmin && (
          <div className="flex items-start gap-3 bg-[#f5f5f5] rounded-xl p-3 mb-5">
            <Lock size={14} className="text-[#888] mt-0.5 shrink-0" />
            <p className="text-xs text-[#888]">Catalog editing restricted. Contact store admin for changes.</p>
          </div>
        )}

        {/* Pack sizes */}
        <p className="text-xs font-bold text-[#888] uppercase mb-3">Pack Sizes and Pricing</p>
        <div className="border border-[#e5e5e5] rounded-xl overflow-hidden">
          {product.variants.map((v, i) => {
            const status = getStockStatus(v.stockQty, v.lowStockThreshold);
            return (
              <div
                key={v.id}
                className={`flex items-center justify-between p-4 ${i < product.variants.length - 1 ? "border-b border-[#e5e5e5]" : ""}`}
              >
                <div>
                  <p className="text-sm font-bold text-black">{v.name}</p>
                  <p className="text-xs text-[#888]">
                    {formatCurrency(v.sellingPrice)} — {v.stockQty} units available
                  </p>
                </div>
                <StockBadge status={status} outline />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
