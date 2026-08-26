import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useProductsStore } from "@/stores/productsStore";
import { getStockStatus, getStockStatusColor, getStockStatusLabel, formatCurrency } from "@/lib/formatters";
import StatusBar from "@/components/ui/StatusBar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { rpcDeleteProduct } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { Search, Plus, Pencil, Trash2, MoreVertical, TrendingUp } from "lucide-react";
import type { ProductCategory, Product } from "@/types";
import { barcodeToSvg } from "@/lib/barcode";

function initBgColor(name: string) {
  const colors = ["#3b82f6","#84cc16","#f59e0b","#8b5cf6","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

const CATEGORY_KEYS: Record<string, "products.all" | "products.spray" | "products.seed" | "products.fertilizer"> = {
  all: "products.all",
  spray: "products.spray",
  seed: "products.seed",
  fertilizer: "products.fertilizer",
};

const CATEGORY_DOT: Record<string, string> = {
  spray: "#3b82f6", seed: "#84cc16", fertilizer: "#f59e0b", other: "#8b5cf6",
};

function stockStatusLabel(status: string) {
  if (status === "in_stock")    return "In Stock";
  if (status === "low_stock")   return "Low Stock";
  if (status === "out_of_stock") return "Out of Stock";
  return "Expired";
}

export default function AdminInventoryPage() {
  const { language } = useThemeStore();
  const t = useT();
  const navigate = useNavigate();
  const isUrdu = language === "ur";
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const { addToast } = useUIStore();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<"all" | ProductCategory>("all");
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await rpcDeleteProduct({ id: toDelete.id });
      await useProductsStore.getState().load();
      addToast(
        res.deactivated
          ? `${toDelete.name} has sales history — archived instead of deleted`
          : `${toDelete.name} deleted`,
        "success"
      );
      setToDelete(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not delete product.", "error");
    } finally {
      setDeleting(false);
    }
  }

  const FILTERS: { key: "all" | ProductCategory }[] = [
    { key: "all" }, { key: "spray" }, { key: "seed" }, { key: "fertilizer" },
  ];

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.company.toLowerCase().includes(search.toLowerCase());
    const matchCat = cat === "all" || p.category === cat;
    return matchSearch && matchCat;
  });

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Header */}
      <div className="relative flex items-center justify-center h-11">
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.inventory")}</p>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div
          className="flex items-center gap-2 h-10 rounded-full px-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <Search size={14} style={{ color: "var(--text-secondary)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("products.search")}
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ color: "var(--text-secondary)" }}>×</button>
          )}
        </div>
      </div>

      {/* Category filters */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {FILTERS.map(({ key }) => (
          <button
            key={key}
            onClick={() => setCat(key)}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors"
            style={{
              background: cat === key ? "var(--brand)" : "var(--surface-2)",
              color: cat === key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {t(CATEGORY_KEYS[key])}
          </button>
        ))}
      </div>

      {/* Product list with all variants */}
      {ready && filtered.length === 0 && (
        <div className="flex flex-col items-center py-16 gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No products yet</p>
        </div>
      )}
      <div className="flex flex-col mx-4 gap-3 pb-24">
        {filtered.map((p) => {
          const dotColor = CATEGORY_DOT[p.category] ?? "#888";
          return (
            <div
              key={p.id}
              className="rounded-[14px] overflow-hidden"
              style={{ border: "1px solid var(--divider)", background: "var(--surface)" }}
            >
              {/* Product header */}
              <div
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--divider)" }}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="size-10 rounded-[10px] object-cover shrink-0" />
                ) : (
                  <div
                    className="size-10 rounded-[10px] flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ background: dotColor + "22", color: dotColor }}
                  >
                    {p.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{p.company}</p>
                  {p.barcode && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>{p.barcode}</span>
                      <div dangerouslySetInnerHTML={{ __html: barcodeToSvg(p.barcode, { height: 18, showText: false, width: 60 }) }} className="shrink-0" />
                    </div>
                  )}
                </div>
                <div className="relative shrink-0">
                  <button
                    onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                    className="size-7 rounded-full flex items-center justify-center active:opacity-70"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  >
                    <MoreVertical size={14} />
                  </button>
                  {openMenu === p.id && (
                    <div
                      className="absolute right-0 top-9 w-44 rounded-[12px] shadow-xl z-50 overflow-hidden"
                      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                    >
                      <button
                        onClick={() => { setOpenMenu(null); navigate(`/admin/inventory/${p.id}/adjust`); }}
                        className="flex items-center gap-2 w-full px-3 py-3 text-left text-[12px] font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        <TrendingUp size={13} /> {t("admin.adjustStock")}
                      </button>
                      <button
                        onClick={() => { setOpenMenu(null); navigate(`/admin/inventory/${p.id}/edit`); }}
                        className="flex items-center gap-2 w-full px-3 py-3 text-left text-[12px] font-medium border-t"
                        style={{ color: "var(--text-primary)", borderColor: "var(--divider)" }}
                      >
                        <Pencil size={13} /> Edit Product
                      </button>
                      <button
                        onClick={() => { setOpenMenu(null); setToDelete(p); }}
                        className="flex items-center gap-2 w-full px-3 py-3 text-left text-[12px] font-medium border-t"
                        style={{ color: "var(--error)", borderColor: "var(--divider)" }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Variants */}
              {/* Stock summary */}
              <div className="flex items-center justify-between px-4 py-2" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--divider)" }}>
                <p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Total stock</p>
                <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{p.stockQty} {p.baseUnit}</p>
              </div>

              {/* Variants */}
              {p.variants.map((v, vi) => {
                const available = Math.floor(p.stockQty / v.unitSize);
                const status = available === 0 ? "out_of_stock" : available <= v.lowStockThreshold ? "low_stock" : "in_stock";
                const statusColor = getStockStatusColor(status);
                return (
                  <div
                    key={v.id}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: vi < p.variants.length - 1 ? "1px solid var(--divider)" : "none" }}
                  >
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Unit: {v.unitSize} {p.baseUnit} · Price: {formatCurrency(v.sellingPrice)}</p>
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
          );
        })}
      </div>

      {/* Floating Add Product — stays above the bottom tab bar while scrolling */}
      <div
        className="fixed left-0 right-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
          <button
            onClick={() => navigate("/admin/inventory/new")}
            className="pointer-events-auto h-13 pl-4 pr-5 rounded-full flex items-center gap-2 text-sm font-bold shadow-lg active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> Product
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete product?"
        message={
          toDelete
            ? `"${toDelete.name}" will be removed from the catalogue. If it has past sales, it's archived (kept for records) instead of deleted.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
