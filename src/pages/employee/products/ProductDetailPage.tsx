import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Photo from "@/components/ui/Photo";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ImageCrop from "@/components/ui/ImageCrop";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { CategoryChip } from "@/components/ui/Badge";
import { unitWord } from "@/lib/inventoryView";
import { useProductsStore } from "@/stores/productsStore";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { formatCurrency, getStockStatusColor } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";
import { rpcDeleteProduct, rpcDeleteProductBarcode, rpcPreviewProductBarcode, rpcSetProductBarcode } from "@/lib/db";
import { Pencil, TrendingUp, Barcode, Trash2, Copy, Download, Package, Camera, Loader2, Bell } from "lucide-react";
import { getRecommendationsForProduct, type CustomerCropRecord } from "@/lib/recommendationEngine";
import { loadCustomerCropRows } from "@/lib/reminderEngine";
import RecommendationReasonLine from "@/components/recommendations/RecommendationReason";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { barcodeToSvg } from "@/lib/barcode";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { useT } from "@/lib/i18n";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { categoryDisplayName } from "@/lib/catalogue";
import { SkeletonList } from "@/components/ui/Skeleton";

// Pesticide and spray are one shelf (0162): a row still stored under the old name reads as
// the same word a person would say, rather than as undefined.
const CATEGORY_LABEL_KEY: Record<string, string> = {
  pesticide: "category.pesticide", spray: "category.pesticide", seed: "category.seed", fertilizer: "category.fertilizer", other: "category.other",
};

function initBgColor(name: string | null | undefined) {
  const colors = ["#3b82f6","#84cc16","#f59e0b","#8b5cf6","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function stockStatusLabel(status: string, t: any) {
  if (status === "in_stock")    return t("products.inStock");
  if (status === "low_stock")   return t("products.lowStock");
  if (status === "out_of_stock") return t("products.outOfStock");
  return "Expired";
}

export default function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  // Which actions this person may take is the owner's grants, not which shell they are in:
  // a granted `products.create`/`products.edit` must show up as a working control on the
  // employee side too, and an ungranted one must not be offered at all.
  const canEditProduct = hasPermission("products.edit");
  const canAdjustStock = hasPermission("inventory.adjust");
  const canDeleteProduct = hasPermission("products.delete");
  // The pack's unit word comes from `lib/inventoryView`, the same one the stock screens say a
  // quantity in — so a pack reads the same here as it does on the shelf it sits on.
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const product = products.find((p) => p.id === productId);
  // The shelf this product is filed on, when it has one (0259).
  const categories = useCatalogueStore((s) => s.categories);
  const shelf = product?.categoryId
    ? categories.find((c) => c.id === product.categoryId) ?? null
    : null;
  const { addToast } = useUIStore();

  const [toDelete, setToDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [barcodeToDelete, setBarcodeToDelete] = useState(false);
  const [barcodeDeleting, setBarcodeDeleting] = useState(false);
  // A ref, not the state flag: React batches, so two taps in one task both read the pre-render
  // `false` and the same code would be retired twice.
  const barcodeDeletingRef = useRef(false);
  /** A code being made for this product, and the guard that stops a second tap making two. */
  const [barcodeMinting, setBarcodeMinting] = useState(false);
  const barcodeMintingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The picture waiting behind the framing screen; nothing is uploaded until it is confirmed.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setEditName(product?.name ?? "");
    setEditImageUrl(product?.imageUrl ?? null);
    setEditing(true);
  }

  /** Choosing a picture only opens the frame; the upload happens once it is confirmed. */
  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setPendingImage(file);
  }

  async function uploadProductImage(file: File) {
    setPendingImage(null);
    setUploading(true);
    try {
      const url = await uploadImage("product-images", file);
      setEditImageUrl(url);
    } catch {
      addToast("Image upload failed", "error");
    } finally {
      setUploading(false);
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
      addToast(t("sale.productUpdated"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("sale.failedToComplete"), "error");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Taking the code off the product. The database retires it rather than forgetting it — it is
   * spent, so it can never be handed to another product — and no sale is touched, because a
   * sale references the product and the variant, never the code.
   */
  async function confirmDeleteBarcode() {
    if (!product?.barcode || barcodeDeletingRef.current) return;
    barcodeDeletingRef.current = true;
    setBarcodeDeleting(true);
    try {
      await rpcDeleteProductBarcode(product.id, "barcode removed on the product screen");
      await useProductsStore.getState().load();
      addToast(t("products.barcodeRemoved"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("errors.barcodeDeleteFailed"), "error");
    } finally {
      barcodeDeletingRef.current = false;
      setBarcodeDeleting(false);
      setBarcodeToDelete(false);
    }
  }

  /**
   * Making a code for a product that has none — here, and not on another screen.
   *
   * This button used to open the print-labels page with the product named in the query, which
   * prefilled nothing and selected nothing: the owner arrived at a list with "0 selected", and
   * nothing was made or shown (owner's report, 2026-10-26, after removing a barcode). Making a
   * code is a decision about THIS product, so it happens on this screen: the shop's own
   * generator picks a free code, `set_product_barcode` attaches it, and the plate appears
   * because the product is reloaded. The print page is still one tap away — via this same row
   * once a code exists, which is when printing labels is the thing left to do.
   */
  async function handleGenerateBarcode() {
    if (!product || barcodeMintingRef.current) return;
    barcodeMintingRef.current = true;
    setBarcodeMinting(true);
    try {
      const code = await rpcPreviewProductBarcode(product.name);
      await rpcSetProductBarcode(product.id, code, "generated");
      await useProductsStore.getState().load();
      addToast(t("products.barcodeGenerated", { code }), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("errors.barcodeMintFailed"), "error");
    } finally {
      barcodeMintingRef.current = false;
      setBarcodeMinting(false);
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

  if (!product) return productsReady ? null : <SkeletonList rows={4} />;
  const bg = initBgColor(product.name);

  // Compute stock status
  const totalStock = product.stockQty;
  const hasVariants = product.variants.length > 0;
  const minThreshold = hasVariants
    ? Math.min(...product.variants.map((v) => v.lowStockThreshold))
    : 5;
  const stockStatus =
    totalStock <= 0 ? "out_of_stock" : totalStock <= minThreshold ? "low_stock" : "in_stock";
  const stockColor = getStockStatusColor(stockStatus);

  // Price range
  const prices = product.variants.map((v) => v.sellingPrice);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("sale.productDetails")} />

      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {/* ── HERO CARD: Image + Name + Category + Stock Badge ── */}
        <div
          className="rounded-[var(--radius-card)] p-4 flex gap-3 items-center"
          style={{ background: "var(--tone-card)" }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          <div className="shrink-0">
            <Photo
              src={product.imageUrl}
              alt={product.name}
              className="size-14 rounded-[var(--radius-tile)] object-cover"
              fallback={
                <div
                  className="size-14 rounded-[var(--radius-tile)] flex items-center justify-center text-xl font-bold"
                  style={{ background: bg + "22", color: bg }}
                >
                  {product.name.charAt(0)}
                </div>
              }
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>{product.name}</p>
            {/* The supplier alone. The category already has its own chip on the line below,
                so naming it here too read as the same fact stated twice on one card. */}
            <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
              {product.company}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* The shop's own shelf when the product is filed on one (0259); the fixed kind
                  still answers for a row that predates it. */}
              <CategoryChip
                label={
                  shelf
                    ? categoryDisplayName(shelf, t)
                    : t(CATEGORY_LABEL_KEY[product.category] as any)
                }
              />
              <span
                className="text-10 font-bold px-2 py-0.5 rounded-full"
                style={{ color: stockColor, background: stockColor + "22" }}
              >
                {stockStatusLabel(stockStatus, t)}
              </span>
            </div>
          </div>
        </div>

        {/* ── QUICK INFO: Price + Stock + Variants in a clean row ── */}
        <div
          className="rounded-[var(--radius-card)] p-4 grid grid-cols-3 gap-3"
          style={{ border: "1px solid var(--divider)" }}
        >
          <div className="text-center">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("products.price")}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {prices.length > 1
                ? `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`
                : formatCurrency(minPrice)}
            </p>
          </div>
          <div className="text-center" style={{ borderLeft: "1px solid var(--divider)", borderRight: "1px solid var(--divider)" }}>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {activeBranchName
                ? t("products.stockInBranch", { branch: activeBranchName })
                : t("products.stock")}
            </p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {t("common.itemsCount", { count: String(totalStock) })}
            </p>
          </div>
          <div className="text-center">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("products.variantsLabel")}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {product.variants.length}
            </p>
          </div>
        </div>

        {/* ── BARCODE (inside product card if exists) ── */}
        {product.barcode && (
          <div
            className="rounded-[var(--radius-card)] p-3 flex items-center gap-3"
            style={{ background: "var(--tone-card)" }}
          >
            {/* A barcode is read by reflected light, and needs white space beside it to be read
                at all. Drawn straight onto the card it was black bars on a near-black plate: the
                bars were there, and effectively invisible. Same literal white as the label
                screen, for the same reason — a barcode is not a themed surface. */}
            <div
              className="flex-1 min-w-0 bg-white rounded-[var(--radius-tile)] px-3 py-2 flex justify-center"
              data-testid="product-barcode-plate"
            >
              <div dangerouslySetInnerHTML={{ __html: barcodeToSvg(product.barcode, { height: 40, showText: true, width: 160 }) }} />
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => { navigator.clipboard.writeText(product.barcode!).then(() => addToast(t("sale.copyBarcode"), "success")).catch(() => {}); }}
                className="size-8 rounded-full flex items-center justify-center active:opacity-70"
                style={{ background: "var(--surface-2)" }}
                title={t("sale.copyBarcode")}
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
                  addToast(t("sale.downloadBarcode"), "success");
                }}
                className="size-8 rounded-full flex items-center justify-center active:opacity-70"
                style={{ background: "var(--surface-2)" }}
                title={t("sale.downloadBarcode")}
              >
                <Download size={14} style={{ color: "var(--text-secondary)" }} />
              </button>
              {/* The third of the three things a shop does with a code it can see: nothing else
                  in the app takes one off a product, so a wrong code had no way out except
                  clearing the field inside an edit form nobody thinks to open. It sits with
                  the other two — copy and download — because that is where the code is.
                  Follows `products.edit`, the grant its RPC checks: the database refuses a
                  caller without it, and a button that can only fail is not a control. */}
              {canEditProduct && (
                <button
                  onClick={() => setBarcodeToDelete(true)}
                  data-testid="product-barcode-delete"
                  className="size-8 rounded-full flex items-center justify-center active:opacity-70"
                  style={{ background: "var(--surface-2)" }}
                  title={t("products.deleteBarcode")}
                  aria-label={t("products.deleteBarcode")}
                >
                  <Trash2 size={14} style={{ color: "var(--error)" }} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── VARIANTS: one row per pack, saying what it costs and what this branch holds ──
            Reshaped to the owner's reference: the pack's own name leads, then the two facts a
            shopkeeper reads before anything else about it — the price it sells at and how much
            of it is on the shelf. The quantity is coloured by its own state, so "0 bottles"
            cannot be read as healthy, and the row opens the pack where a quantity is adjusted. */}
        <div>
          {/* "Pack sizes", not "Variants": the tile above already counts the variants, and two
              headings with the same word on one screen read as two different lists. */}
          {/* The same muted group label the customers card below uses, not a second heading
              style on one screen. */}
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("products.packSizesTitle")}
          </p>
          {product.variants.length === 0 ? (
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("products.noVariants")}</p>
          ) : (
            <ListCard>
              {product.variants.map((v) => {
                const available = v.stockQty ?? 0;
                const vStatus = available <= 0 ? "out_of_stock" : available <= v.lowStockThreshold ? "low_stock" : "in_stock";
                const vColor = getStockStatusColor(vStatus);
                return (
                  <ListRow
                    key={v.id}
                    testId={`variant-${v.id}`}
                    onClick={
                      canAdjustStock ? () => navigate(`${base}/inventory/${product.id}/adjust`) : undefined
                    }
                    trailing={
                      /* What the pack holds and whether that is healthy, on the row's own line:
                         a bare number cannot say whether "0" means empty shelf or full one. */
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
                          {available}
                        </span>
                        <span
                          className="text-10 font-bold px-2 py-0.5 rounded-full"
                          style={{ color: vColor, background: vColor + "22" }}
                        >
                          {stockStatusLabel(vStatus, t)}
                        </span>
                      </div>
                    }
                  >
                    <div className="flex flex-col min-w-0">
                      <p className="text-13 font-bold truncate" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                      {/* Size · price — the two facts a shopkeeper reads before the quantity. */}
                      <p className="text-12 mt-1 truncate" style={{ color: "var(--text-secondary)" }}>
                        {v.unitSize} {unitWord(product.baseUnit, t)} · {formatCurrency(v.sellingPrice)}
                      </p>
                    </div>
                  </ListRow>
                );
              })}
            </ListCard>
          )}
        </div>

        {/* ── CUSTOMERS LIKELY TO WANT THIS ── */}
        <ProductCustomerRecommendations productId={product.id} />

        {/* ── ALL ACTIONS: Edit + Adjust + Barcode + Delete (unified) ── */}
        <div
          className="rounded-[var(--radius-card)] overflow-hidden"
          style={{ border: "1px solid var(--divider)" }}
        >
          {canEditProduct && (
            <button
              onClick={() => navigate(`${base}/inventory/${product.id}/edit`)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-13 font-medium active:opacity-70"
              style={{ color: "var(--text-primary)" }}
            >
              <Pencil size={16} style={{ color: "var(--brand)" }} />
              {t("products.editProduct")}
            </button>
          )}
          {canAdjustStock && (
            <button
              onClick={() => navigate(`${base}/inventory/${product.id}/adjust`)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-13 font-medium active:opacity-70"
              style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
            >
              <TrendingUp size={16} style={{ color: "var(--brand)" }} />
              {t("products.adjustStock")}
            </button>
          )}
          {canEditProduct && (
            <button
              onClick={() =>
                product.barcode
                  ? navigate(`${base}/inventory/barcodes?product=${product.id}`)
                  : void handleGenerateBarcode()
              }
              disabled={barcodeMinting}
              data-testid="product-barcode-generate"
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-13 font-medium active:opacity-70 disabled:opacity-60"
              style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
            >
              {barcodeMinting
                ? <Loader2 size={16} className="animate-spin" style={{ color: "var(--brand)" }} />
                : <Barcode size={16} style={{ color: "var(--brand)" }} />}
              {t("products.generateBarcode")}
            </button>
          )}
          {canDeleteProduct && (
            <button
              onClick={() => setToDelete(true)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-start text-13 font-medium active:opacity-70"
              style={{ color: "var(--error)", borderTop: "1px solid var(--divider)" }}
            >
              <Trash2 size={16} />
              {t("products.deleteProduct")}
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
            style={{ background: "var(--tone-sheet)", border: "1px solid var(--divider)", borderBottom: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
            <p className="text-base font-bold text-center mb-5" style={{ color: "var(--text-primary)" }}>{t("products.editProduct")}</p>
            {/* Image in popup */}
            <div className="flex flex-col items-center mb-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-[var(--radius-tile)] overflow-hidden flex items-center justify-center text-2xl font-bold" style={{ background: initBgColor(editName), color: "#fff" }}>
                  {uploading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Photo src={editImageUrl} className="w-full h-full object-cover" fallback={editName.charAt(0)} />
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -end-1 w-7 h-7 rounded-full flex items-center justify-center shadow"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  <Camera size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            {/* Name input */}
            <div className="mb-5">
              <label className="ds-section-label mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("common.productName")}</label>
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }}
                className="w-full h-12 px-4 rounded-full text-sm font-bold outline-none"
                style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              >{t("common.cancel")}</button>
              <button
                onClick={saveEdit}
                disabled={saving || !editName.trim()}
                className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >{saving ? t("common.saving") : t("common.save")}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={toDelete}
        title={t("products.confirmDelete")}
        message={t("products.deleteConfirmBody", { name: product.name })}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(false)}
      />

      <ConfirmDialog
        open={barcodeToDelete}
        title={t("products.deleteBarcode")}
        message={t("products.deleteBarcodeBody", {
          code: product.barcode ?? "",
          name: product.name,
        })}
        confirmLabel={t("common.delete")}
        destructive
        loading={barcodeDeleting}
        onConfirm={confirmDeleteBarcode}
        onCancel={() => setBarcodeToDelete(false)}
      />

      {/* The packet is framed before it is stored: the hero tile and the product rows all draw it
          in a fixed square, so the owner chooses the part that survives the cut. */}
      {pendingImage && (
        <ImageCrop
          file={pendingImage}
          aspect={1}
          onCancel={() => setPendingImage(null)}
          onConfirm={(file) => void uploadProductImage(file)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ProductCustomerRecommendations — the growers whose crop
   this product fits right now, best-matched first
   ═══════════════════════════════════════════════════════ */
function ProductCustomerRecommendations({ productId }: { productId: string }) {
  const t = useT();
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const customersReady = useCustomersStore((s) => s.ready);
  const sales = useSalesStore((s) => s.sales);
  // The whole crop row per customer, so acreage and the planting date can rank the list
  // instead of only a name deciding whether the crop matches.
  const [cropsByCustomer, setCropsByCustomer] = useState<Record<string, CustomerCropRecord[]>>({});
  const [cropsLoaded, setCropsLoaded] = useState(false);

  useEffect(() => {
    if (!customersReady) void useCustomersStore.getState().load();
    // The buying history is what decides who is *not* asked again inside the month, so it has to
    // be in memory. Without this the section appeared or vanished depending on whether the owner
    // had happened to open a screen that loads sales first: one product, two different answers.
    if (!useSalesStore.getState().ready) void useSalesStore.getState().load();
  }, [customersReady]);

  /**
   * Every customer's crops, then the answer — in that order.
   *
   * `cropsLoaded` exists so the section says "nothing to suggest" once, when it means it,
   * instead of flashing that sentence while the questions are still being asked. The crops are
   * fetched together rather than one promise at a time, so the answer cannot arrive in pieces.
   */
  useEffect(() => {
    if (!customersReady) return;
    let alive = true;
    const active = customers.filter((c) => !c.isArchived);
    if (active.length === 0) {
      setCropsLoaded(true);
      return;
    }
    Promise.all(active.map(async (c) => [c.id, await loadCustomerCropRows(c.id)] as const))
      .then((rows) => {
        if (!alive) return;
        setCropsByCustomer(Object.fromEntries(rows));
        setCropsLoaded(true);
      })
      .catch(() => {
        if (alive) setCropsLoaded(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customersReady, customers.length]);

  const product = products.find((p) => p.id === productId);
  if (!product) return null;

  // The section is always on the page. It used to return null whenever it had nothing to say,
  // which is indistinguishable from a feature that was never built — and left the owner no way
  // to tell "no customer fits this" from "this screen is broken".
  const recs =
    customersReady && cropsLoaded
      ? getRecommendationsForProduct(product, {
          customers,
          sales,
          products,
          customerCrops: cropsByCustomer,
        })
      : [];

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
    <div
      className="rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--tone-card)" }}
      data-testid="product-recommendations"
    >
      <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>
        {t("products.customersLikely")}
      </p>
      {!customersReady || !cropsLoaded ? (
        <SkeletonList rows={2} tile />
      ) : recs.length === 0 ? (
        <p className="text-12" style={{ color: "var(--text-secondary)" }} data-testid="product-recommendations-empty">
          {t("products.noCustomersLikely")}
        </p>
      ) : (
      <ListCard>
        {recs.map((rec) => (
          <ListRow
            key={rec.subject.id}
            tile={
              /* The same round avatar as the customer's own screens: a photo that appeared
                 as a rounded tile here and a circle there read as a different person. */
              <Photo
                src={rec.subject.imageUrl}
                alt={rec.subject.name}
                className="w-10 h-10 rounded-full object-cover shrink-0"
                style={{ background: "var(--surface-2)" }}
                fallback={
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-12 font-bold shrink-0"
                    style={{ background: getAvatarColor(rec.subject.name), color: "#fff" }}
                  >
                    {getInitials(rec.subject.name)}
                  </div>
                }
              />
            }
            trailing={
            <button
              className="size-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              onClick={() => {
                const phone = (rec.subject.phone || '').replace(/[^0-9+]/g, '');
                const waPhone = phone.startsWith('+') ? phone.slice(1) : phone.startsWith('0') ? '92' + phone.slice(1) : phone;
                const firstName = rec.subject.name.split(' ')[0];
                let msg = '';
                // The message the owner SENDS a farmer: it must be in the language
                // the owner is reading, not always English.
                const waParams = { name: firstName, product: product.name, crop: rec.crop };
                if (rec.tag === 'missing_from_basket') {
                  msg = t('whatsapp.orderReminder', waParams);
                } else if (rec.tag === 'due_again') {
                  msg = t('whatsapp.restockReminder', waParams);
                } else {
                  msg = t('whatsapp.inSeasonReminder', waParams);
                }
                window.open('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(msg), '_blank');
              }}
            >
              <Bell size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
            }
          >
            <div className="min-w-0">
              <p className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>
                {rec.subject.name}
              </p>
              <RecommendationReasonLine reason={rec.reasons[0]} />
            </div>
          </ListRow>
        ))}
      </ListCard>
      )}
    </div>
  );
}
