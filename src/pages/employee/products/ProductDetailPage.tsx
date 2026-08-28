import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { CategoryChip } from "@/components/ui/Badge";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { formatCurrency, getStockStatusColor } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { rpcDeleteProduct } from "@/lib/db";
import { Pencil, Camera, TrendingUp, Barcode, Trash2, Copy, Package, AlertTriangle } from "lucide-react";
import { barcodeToSvg } from "@/lib/barcode";

const CATEGORY_LABEL: Record<string, string> = {
  spray: "Sprays", seed: "Seeds", fertilizer: "Fertilizer", other: "Other",
};

function initBgColor(name: string) {
  const colors = ["#3b82f6","#84cc16","#f59e0b","#8b5cf6","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function stockStatusLabel(status: string) {
  if (status === "in_stock")    return "In Stock";
  if (status === "low_stock")   return "Low Stock";
  if (status === "out_of_stock") return "Out of Stock";
  return "Expired";
}

export default function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const isAdmin = base === "/admin";
  const products = useProductsStore((s) => s.products);
  const product = products.find((p) => p.id === productId);
  const { addToast } = useUIStore();

  const [showImageEdit, setShowImageEdit] = useState(false);
  const [toDelete, setToDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleImageChange(url: string | null) {
    if (!productId) return;
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase
        .from("products")
        .update({ image_url: url })
        .eq("id", productId);
      if (error) throw new Error(error.message);
      await useProductsStore.getState().load();
      setShowImageEdit(false);
      addToast(url ? "Image updated" : "Image removed", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not save image", "error");
    }
  }

  async function confirmDelete() {
    if (!product) return;
    setDeleting(true);
    try {
      const res = await rpcDeleteProduct({ id: product.id });
      await useProductsStore.getState().load();
      addToast(
        res.deactivated
          ? `${product.name} has sales history — archived`
          : `${product.name} deleted`,
        "success"
      );
      navigate(-1);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not delete.", "error");
    } finally {
      setDeleting(false);
      setToDelete(false);
    }
  }

  if (!product) return null;
  const bg = initBgColor(product.name);

  // Compute stock status
  const totalStock = product.stockQty;
  const hasVariants = product.variants.length > 0;
  const minThreshold = hasVariants
    ? Math.min(...product.variants.map((v) => v.lowStockThreshold))
    : 5;
  const stockStatus =
    totalStock === 0 ? "out_of_stock" : totalStock <= minThreshold ? "low_stock" : "in_stock";
  const stockColor = getStockStatusColor(stockStatus);

  // Price range
  const prices = product.variants.map((v) => v.sellingPrice);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader
        title="Product Details"
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

      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {/* ── HERO CARD: Image + Name + Category + Stock Badge + Price ── */}
        <div
          className="rounded-[16px] p-4 flex gap-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <div className="relative shrink-0">
            {isAdmin ? (
              <ImageUpload
                bucket="product-images"
                shape="square"
                value={product.imageUrl ?? null}
                onChange={handleImageChange}
                label="Photo"
              />
            ) : product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="size-20 rounded-2xl object-cover" />
            ) : (
              <div
                className="size-20 rounded-2xl flex items-center justify-center text-2xl font-bold"
                style={{ background: bg + "22", color: bg }}
              >
                {product.name.charAt(0)}
              </div>
            )}
            {!isAdmin && (
              <button
                onClick={() => setShowImageEdit(true)}
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center shadow"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                <Camera size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{product.name}</p>
              <p className="text-sm truncate" style={{ color: "var(--text-secondary)" }}>{product.company}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <CategoryChip label={CATEGORY_LABEL[product.category]} />
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: stockColor, background: stockColor + "22" }}
                >
                  {stockStatusLabel(stockStatus)}
                </span>
              </div>
            </div>
            <div className="flex items-end justify-between mt-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Price</p>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {prices.length > 1
                    ? `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`
                    : formatCurrency(minPrice)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Stock</p>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {totalStock} {product.baseUnit}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── BARCODE (inside product card if exists) ── */}
        {product.barcode && (
          <div
            className="rounded-[14px] p-3 flex items-center gap-3"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
          >
            <div dangerouslySetInnerHTML={{ __html: barcodeToSvg(product.barcode, { height: 40, showText: true, width: 160 }) }} className="flex-1" />
            <button
              onClick={() => { navigator.clipboard.writeText(product.barcode!).then(() => addToast("Barcode copied", "success")).catch(() => {}); }}
              className="size-8 rounded-full flex items-center justify-center shrink-0 active:opacity-70"
              style={{ background: "var(--surface-2)" }}
            >
              <Copy size={14} style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        )}

        {/* ── INVENTORY CARD: Stock Summary + Variants grouped together ── */}
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ border: "1px solid var(--divider)" }}
        >
          {/* Card header */}
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--surface-2)" }}>
            <div className="flex items-center gap-2">
              <Package size={14} style={{ color: "var(--brand)" }} />
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Inventory
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Total</p>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{totalStock} {product.baseUnit}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Variants</p>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{product.variants.length}</p>
              </div>
            </div>
          </div>

          {/* Variants list */}
          {product.variants.map((v, i) => {
            const available = Math.floor(product.stockQty / v.unitSize);
            const vStatus = available === 0 ? "out_of_stock" : available <= v.lowStockThreshold ? "low_stock" : "in_stock";
            const vColor = getStockStatusColor(vStatus);
            return (
              <div
                key={v.id}
                className="flex items-center justify-between px-4 py-3.5"
                style={{ borderTop: "1px solid var(--divider)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {v.unitSize} {product.baseUnit} · {formatCurrency(v.sellingPrice)}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                    {available}
                  </p>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ color: vColor, background: vColor + "22" }}
                  >
                    {stockStatusLabel(vStatus)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── ADMIN ACTIONS: Management (separated from destructive) ── */}
        {isAdmin && (
          <>
            <div
              className="rounded-[14px] overflow-hidden"
              style={{ border: "1px solid var(--divider)" }}
            >
              <button
                onClick={() => navigate(`/admin/inventory/${product.id}/adjust`)}
                className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
                style={{ color: "var(--text-primary)" }}
              >
                <TrendingUp size={16} style={{ color: "var(--brand)" }} />
                Adjust Stock
              </button>
              <button
                onClick={() => navigate(`/admin/inventory/barcodes?product=${product.id}`)}
                className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
                style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
              >
                <Barcode size={16} style={{ color: "var(--brand)" }} />
                Generate Barcode
              </button>
            </div>

            {/* Destructive action — visually separated */}
            <button
              onClick={() => setToDelete(true)}
              className="flex items-center justify-center gap-2 w-full h-11 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
              style={{ border: "1.5px solid #ef4444", color: "#ef4444", background: "transparent" }}
            >
              <Trash2 size={14} />
              Delete Product
            </button>
          </>
        )}
      </div>

      {/* Employee image edit modal */}
      {showImageEdit && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowImageEdit(false)}
        >
          <div
            className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4 items-center"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Update Photo</p>
            <ImageUpload
              bucket="product-images"
              shape="square"
              value={product.imageUrl ?? null}
              onChange={handleImageChange}
              label="Upload new photo"
            />
            <button
              onClick={() => setShowImageEdit(false)}
              className="w-full h-12 rounded-full text-sm font-bold"
              style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={toDelete}
        title="Delete product?"
        message={`"${product.name}" will be removed. If it has past sales, it's archived instead of deleted.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(false)}
      />
    </div>
  );
}
