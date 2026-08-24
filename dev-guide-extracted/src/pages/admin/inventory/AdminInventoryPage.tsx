import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useProductsStore } from "@/stores/productsStore";
import { getStockStatus, getStockStatusColor } from "@/lib/formatters";
import StatusBar from "@/components/ui/StatusBar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { rpcDeleteProduct } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import type { ProductCategory, Product } from "@/types";

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
                <div
                  className="size-9 rounded-[10px] flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: dotColor + "22", color: dotColor }}
                >
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{p.company}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => navigate(`/admin/inventory/${p.id}/adjust`)}
                    className="h-7 px-3 rounded-full text-[11px] font-bold transition-colors active:opacity-70"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    {t("admin.adjustStock")}
                  </button>
                  <button
                    aria-label="Edit product"
                    onClick={() => navigate(`/admin/inventory/${p.id}/edit`)}
                    className="size-7 rounded-full flex items-center justify-center active:opacity-70"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    aria-label="Delete product"
                    onClick={() => setToDelete(p)}
                    className="size-7 rounded-full flex items-center justify-center active:opacity-70"
                    style={{ background: "var(--surface-2)", color: "var(--error)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Variants */}
              {p.variants.map((v, vi) => {
                const status = getStockStatus(v.stockQty, v.lowStockThreshold);
                const statusColor = getStockStatusColor(status);
                return (
                  <div
                    key={v.id}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: vi < p.variants.length - 1 ? "1px solid var(--divider)" : "none" }}
                  >
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                      {v.expiryDate && (
                        <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                          Exp: {v.expiryDate}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                        {v.stockQty} units
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
