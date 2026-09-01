import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { CategoryChip } from "@/components/ui/Badge";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { formatCurrency, getStockStatusColor } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { rpcDeleteProduct } from "@/lib/db";
import { Pencil, TrendingUp, Barcode, Trash2, Copy, Download, Package, Camera, Loader2, Bell } from "lucide-react";
import { getRecommendationsForProduct } from "@/lib/recommendationEngine";
import { loadCustomerCrops } from "@/lib/reminderEngine";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { barcodeToSvg } from "@/lib/barcode";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";

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

  const [toDelete, setToDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setEditName(product?.name ?? "");
    setEditImageUrl(product?.imageUrl ?? null);
    setEditing(true);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage("product-images", file);
      setEditImageUrl(url);
    } catch {
      addToast("Image upload failed", "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveEdit() {
    if (!editName.trim() || !product) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("products")
        .update({ name: editName.trim(), image_url: editImageUrl })
        .eq("id", product.id);
      if (error) throw error;
      await useProductsStore.getState().load();
      setEditing(false);
      addToast("Product updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to update", "error");
    } finally {
      setSaving(false);
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
      navigate(`${base}/products`);
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
      <NavHeader title="Product Details" />

      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {/* ── HERO CARD: Image + Name + Category + Stock Badge ── */}
        <div
          className="rounded-[16px] p-4 flex gap-3 items-center"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          <div className="shrink-0">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="size-14 rounded-xl object-cover" />
            ) : (
              <div
                className="size-14 rounded-xl flex items-center justify-center text-xl font-bold"
                style={{ background: bg + "22", color: bg }}
              >
                {product.name.charAt(0)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>{product.name}</p>
            <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{product.company}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <CategoryChip label={CATEGORY_LABEL[product.category]} />
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: stockColor, background: stockColor + "22" }}
              >
                {stockStatusLabel(stockStatus)}
              </span>
            </div>
          </div>
        </div>

        {/* ── QUICK INFO: Price + Stock + Variants in a clean row ── */}
        <div
          className="rounded-[14px] p-4 grid grid-cols-3 gap-3"
          style={{ border: "1px solid var(--divider)" }}
        >
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Price</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {prices.length > 1
                ? `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`
                : formatCurrency(minPrice)}
            </p>
          </div>
          <div className="text-center" style={{ borderLeft: "1px solid var(--divider)", borderRight: "1px solid var(--divider)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Stock</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {totalStock} {product.baseUnit}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Variants</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {product.variants.length}
            </p>
          </div>
        </div>

        {/* ── BARCODE (inside product card if exists) ── */}
        {product.barcode && (
          <div
            className="rounded-[14px] p-3 flex items-center gap-3"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
          >
            <div dangerouslySetInnerHTML={{ __html: barcodeToSvg(product.barcode, { height: 40, showText: true, width: 160 }) }} className="flex-1" />
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => { navigator.clipboard.writeText(product.barcode!).then(() => addToast("Barcode copied", "success")).catch(() => {}); }}
                className="size-8 rounded-full flex items-center justify-center active:opacity-70"
                style={{ background: "var(--surface-2)" }}
                title="Copy barcode"
              >
                <Copy size={14} style={{ color: "var(--text-secondary)" }} />
              </button>
              <button
                onClick={() => {
                  const svg = barcodeToSvg(product.barcode!, { height: 60, showText: true });
                  const blob = new Blob([svg], { type: "image/svg+xml" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `barcode-${product.name.replace(/\s+/g, "-")}-${product.barcode}.svg`;
                  a.click();
                  URL.revokeObjectURL(url);
                  addToast("Barcode downloaded", "success");
                }}
                className="size-8 rounded-full flex items-center justify-center active:opacity-70"
                style={{ background: "var(--surface-2)" }}
                title="Download barcode"
              >
                <Download size={14} style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>
          </div>
        )}

        {/* ── PACK SIZES: Variant details ── */}
        <div>
          <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>Pack Sizes</p>
          <div
            className="rounded-[14px] overflow-hidden"
            style={{ border: "1px solid var(--divider)" }}
          >

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
        </div>

        {/* ── CUSTOMERS LIKELY TO WANT THIS ── */}
        <ProductCustomerRecommendations productId={product.id} />

        {/* ── ALL ACTIONS: Edit + Adjust + Barcode + Delete (unified) ── */}
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ border: "1px solid var(--divider)" }}
        >
          {isAdmin && (
            <button
              onClick={() => navigate(`/admin/inventory/${product.id}/edit`)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-[13px] font-medium active:opacity-70"
              style={{ color: "var(--text-primary)" }}
            >
              <Pencil size={16} style={{ color: "var(--brand)" }} />
              Edit Product
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => navigate(`/admin/inventory/${product.id}/adjust`)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-[13px] font-medium active:opacity-70"
              style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
            >
              <TrendingUp size={16} style={{ color: "var(--brand)" }} />
              Adjust Stock
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => navigate(`/admin/inventory/barcodes?product=${product.id}`)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-[13px] font-medium active:opacity-70"
              style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
            >
              <Barcode size={16} style={{ color: "var(--brand)" }} />
              Generate Barcode
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setToDelete(true)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-[13px] font-medium active:opacity-70"
              style={{ color: "var(--error)", borderTop: "1px solid var(--divider)" }}
            >
              <Trash2 size={16} />
              Delete Product
            </button>
          )}
        </div>
      </div>

      {/* Edit Product Bottom Sheet */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setEditing(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md rounded-t-[24px] p-6 pb-8 animate-slide-up"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", borderBottom: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
            <p className="text-base font-bold text-center mb-5" style={{ color: "var(--text-primary)" }}>Edit Product</p>
            {/* Image in popup */}
            <div className="flex flex-col items-center mb-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center text-2xl font-bold" style={{ background: initBgColor(editName), color: "#fff" }}>
                  {uploading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : editImageUrl ? (
                    <img src={editImageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    editName.charAt(0)
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center shadow"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  <Camera size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            {/* Name input */}
            <div className="mb-5">
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Product Name</label>
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }}
                className="w-full h-12 px-4 rounded-full text-sm font-bold outline-none"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              >Cancel</button>
              <button
                onClick={saveEdit}
                disabled={saving || !editName.trim()}
                className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >{saving ? "Saving..." : "Save"}</button>
            </div>
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

/* ═══════════════════════════════════════════════════════
   ProductCustomerRecommendations — shows customers who
   likely want this product based on crop + basket gaps
   ═══════════════════════════════════════════════════════ */
function ProductCustomerRecommendations({ productId }: { productId: string }) {
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const customersReady = useCustomersStore((s) => s.ready);
  const sales = useSalesStore((s) => s.sales);
  const [cropsMap, setCropsMap] = useState<Record<string, string[]>>({});

  // Load crops from Supabase for all customers
  useEffect(() => {
    if (!customersReady) useCustomersStore.getState().load();
    // Load crops for all active customers
    customers.filter(c => !c.isArchived).forEach(c => {
      loadCustomerCrops(c.id).then(crops => {
        setCropsMap(prev => ({ ...prev, [c.id]: crops }));
      });
    });
  }, [customersReady, customers.length]);

  const product = products.find((p) => p.id === productId);
  if (!product || !customersReady || customers.length === 0) return null;

  const recs = getRecommendationsForProduct(product, { customers, sales, products, customerCropsMap: cropsMap });
  if (recs.length === 0) return null;

  function getInitials(name: string): string {
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  }

  function getAvatarColor(name: string): string {
    const colors = ["#65a30d", "#2563eb", "#7c3aed", "#db2777", "#ea580c"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  return (
    <div className="rounded-[16px] p-4" style={{ background: "var(--surface-2)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>
        CUSTOMERS LIKELY TO WANT THIS
      </p>
      <div className="flex flex-col">
        {recs.map((rec, i) => (
          <div
            key={rec.customer.id}
            className="flex items-center gap-3 py-3"
            style={{ borderBottom: i < recs.length - 1 ? "1px solid var(--divider)" : "none" }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
              style={{ background: getAvatarColor(rec.customer.name), color: "#fff" }}
            >
              {getInitials(rec.customer.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                {rec.customer.name}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {rec.reason}
              </p>
            </div>
            <button
              className="size-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              onClick={() => {
                const phone = (rec.customer.phone || '').replace(/[^0-9+]/g, '');
                const waPhone = phone.startsWith('+') ? phone.slice(1) : phone.startsWith('0') ? '92' + phone.slice(1) : phone;
                const firstName = rec.customer.name.split(' ')[0];
                let msg = '';
                if (rec.reasonTag === 'missing_from_basket') {
                  msg = `Hi ${firstName}, the ${product.name} is needed for your ${rec.cropName} season but we haven't seen an order yet. Would you like me to set one aside for you?`;
                } else if (rec.reasonTag === 'due_again') {
                  msg = `Hi ${firstName}, it's been a while since your last ${product.name} order for ${rec.cropName}. Time to restock?`;
                } else {
                  msg = `Hi ${firstName}, ${product.name} is in season for your ${rec.cropName} — thought you might need it.`;
                }
                window.open('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(msg), '_blank');
              }}
            >
              <Bell size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
