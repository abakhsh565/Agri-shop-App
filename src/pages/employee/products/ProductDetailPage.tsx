import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { CategoryChip, StockBadge } from "@/components/ui/Badge";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { formatCurrency, getStockStatus, getStockStatusColor } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { rpcDeleteProduct } from "@/lib/db";
import { Pencil, Camera, TrendingUp, Barcode, Trash2 } from "lucide-react";
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

      <div className="px-4 pt-4">
        {/* Product image + name */}
        <div className="flex items-center gap-4 mb-4">
          {isAdmin ? (
            <ImageUpload
              bucket="product-images"
              shape="square"
              value={product.imageUrl ?? null}
              onChange={handleImageChange}
              label="Photo"
            />
          ) : product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="size-16 rounded-2xl object-cover shrink-0" />
          ) : (
            <div
              className="size-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: bg + "22", color: bg }}
            >
              {product.name.charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{product.name}</p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{product.company}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <CategoryChip label={CATEGORY_LABEL[product.category]} />
              {!isAdmin && (
                <button
                  onClick={() => setShowImageEdit(true)}
                  className="flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
                >
                  <Camera size={10} /> Photo
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barcode */}
        {product.barcode && (
          <div className="mb-4 rounded-[14px] p-3 flex items-center gap-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
            <div dangerouslySetInnerHTML={{ __html: barcodeToSvg(product.barcode, { height: 40, showText: true, width: 160 }) }} />
          </div>
        )}

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

        {/* Total Stock Summary */}
        <div
          className="rounded-[14px] p-4 mb-4 flex items-center justify-between"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Total Stock</p>
            <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              {product.stockQty} {product.baseUnit}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Variants</p>
            <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{product.variants.length}</p>
          </div>
        </div>

        {/* Pack Sizes and Stock */}
        <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>Pack Sizes & Stock</p>
        <div className="rounded-[14px] overflow-hidden mb-4" style={{ border: "1px solid var(--divider)" }}>
          {product.variants.map((v, i) => {
            const available = Math.floor(product.stockQty / v.unitSize);
            const status = available === 0 ? "out_of_stock" : available <= v.lowStockThreshold ? "low_stock" : "in_stock";
            const statusColor = getStockStatusColor(status);
            return (
              <div
                key={v.id}
                className="flex items-center justify-between p-4"
                style={{ borderBottom: i < product.variants.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    Unit: {v.unitSize} {product.baseUnit} · Price: {formatCurrency(v.sellingPrice)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                    {available} units
                  </p>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ color: statusColor, background: statusColor + "22" }}
                  >
                    {stockStatusLabel(status)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Admin Actions */}
        {isAdmin && (
          <>
            <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>Actions</p>
            <div className="rounded-[14px] overflow-hidden mb-6" style={{ border: "1px solid var(--divider)" }}>
              <button
                onClick={() => navigate(`/admin/inventory/${product.id}/adjust`)}
                className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
                style={{ color: "var(--text-primary)" }}
              >
                <TrendingUp size={16} style={{ color: "var(--brand)" }} />
                Adjust Stock
              </button>
              <button
                onClick={() => navigate(`/admin/inventory/${product.id}/edit`)}
                className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
                style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
              >
                <Pencil size={16} style={{ color: "var(--brand)" }} />
                Edit Product
              </button>
              <button
                onClick={() => navigate(`/admin/inventory/barcodes?product=${product.id}`)}
                className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
                style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
              >
                <Barcode size={16} style={{ color: "var(--brand)" }} />
                Generate Barcode
              </button>
              <button
                onClick={() => setToDelete(true)}
                className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
                style={{ color: "var(--error)", borderTop: "1px solid var(--divider)" }}
              >
                <Trash2 size={16} />
                Delete Product
              </button>
            </div>
          </>
        )}
      </div>

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
