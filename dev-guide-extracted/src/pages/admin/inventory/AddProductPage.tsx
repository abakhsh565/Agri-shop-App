import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { rpcCreateProduct, rpcUpdateProduct } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import type { ProductCategory } from "@/types";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

const CATEGORIES: { key: ProductCategory; label: string }[] = [
  { key: "spray", label: "Spray" },
  { key: "seed", label: "Seed" },
  { key: "fertilizer", label: "Fertilizer" },
  { key: "other", label: "Other" },
];

interface VariantDraft {
  id?: string;
  name: string;
  sellingPrice: string;
  costPrice: string;
  stockQty: string;
  lowStockThreshold: string;
}

const emptyVariant = (): VariantDraft => ({
  name: "", sellingPrice: "", costPrice: "", stockQty: "", lowStockThreshold: "5",
});

export default function AddProductPage() {
  const navigate = useNavigate();
  const { productId } = useParams();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const companies = useCompaniesStore((s) => s.companies);
  const existing = useProductsStore((s) => s.products.find((p) => p.id === productId));
  const isEdit = Boolean(productId);

  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [category, setCategory] = useState<ProductCategory>(existing?.category ?? "spray");
  const [variants, setVariants] = useState<VariantDraft[]>(
    existing && existing.variants.length > 0
      ? existing.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sellingPrice: String(v.sellingPrice),
          costPrice: String(v.costPrice),
          stockQty: String(v.stockQty),
          lowStockThreshold: String(v.lowStockThreshold),
        }))
      : [emptyVariant()]
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function setVariant(i: number, patch: Partial<VariantDraft>) {
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function addVariant() { setVariants((vs) => [...vs, emptyVariant()]); }
  function removeVariant(i: number) { setVariants((vs) => vs.filter((_, idx) => idx !== i)); }

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Enter the product name."); return; }
    if (!company.trim()) { setError("Select a supplier / company."); return; }
    const clean = variants.filter((v) => v.name.trim() !== "");
    if (clean.length === 0) { setError("Add at least one unit / variant with a name."); return; }
    for (const v of clean) {
      if (Number(v.sellingPrice) <= 0) { setError(`Enter a selling price for "${v.name}".`); return; }
    }

    setLoading(true);
    try {
      if (isEdit && productId) {
        await rpcUpdateProduct({
          id: productId,
          name: name.trim(),
          company: company.trim(),
          category,
          imageUrl: imageUrl ?? undefined,
          variants: clean.map((v) => ({
            id: v.id,
            name: v.name.trim(),
            sellingPrice: Number(v.sellingPrice) || 0,
            costPrice: Number(v.costPrice) || 0,
            lowStockThreshold: Math.max(0, Number(v.lowStockThreshold) || 5),
          })),
        });
        await useProductsStore.getState().load();
        addToast(`${name.trim()} updated`, "success");
      } else {
        await rpcCreateProduct({
          name: name.trim(),
          company: company.trim(),
          category,
          imageUrl: imageUrl ?? undefined,
          variants: clean.map((v) => ({
            name: v.name.trim(),
            sellingPrice: Number(v.sellingPrice) || 0,
            costPrice: Number(v.costPrice) || 0,
            stockQty: Math.max(0, Number(v.stockQty) || 0),
            lowStockThreshold: Math.max(0, Number(v.lowStockThreshold) || 5),
          })),
        });
        addToast(`${name.trim()} added to inventory`, "success");
      }
      navigate("/admin/inventory", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product.");
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "text-[11px] font-bold uppercase mb-2 tracking-wider";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={isEdit ? "Edit Product" : "Add Product"} backLabel="Inventory" backTo="/admin/inventory" />

        <div className="flex flex-col gap-5 p-4">
          {/* Photo */}
          <div className="flex justify-center pt-1">
            <ImageUpload bucket="product-images" value={imageUrl} onChange={setImageUrl} shape="square" label="Add photo" />
          </div>

          {/* Name */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Product Name</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Karate Insecticide"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          {/* Company */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Supplier / Company</p>
            <div className="relative">
              <select value={company} onChange={(e) => setCompany(e.target.value)}
                className="w-full h-12 rounded-[24px] px-4 pr-10 text-sm outline-none appearance-none" style={fieldStyle}>
                <option value="">Select supplier…</option>
                {companies.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
            </div>
          </div>

          {/* Category */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  className="h-9 px-4 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: category === c.key ? "var(--brand)" : "var(--surface-2)",
                    color: category === c.key ? "#0a0a0a" : "var(--text-secondary)",
                    border: category === c.key ? "none" : "1px solid var(--divider)",
                  }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Variants */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className={labelCls} style={{ color: "var(--text-secondary)", marginBottom: 0 }}>Units / Variants</p>
              <button onClick={addVariant} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--brand-dark)" }}>
                <Plus size={14} /> Add unit
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {variants.map((v, i) => (
                <div key={i} className="rounded-[14px] p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <input value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="Unit name — e.g. 500ml, 50kg"
                      className="flex-1 h-10 rounded-[20px] px-3 text-sm outline-none" style={fieldStyle} />
                    {variants.length > 1 && (
                      <button onClick={() => removeVariant(i)} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--surface-2)", color: "var(--error)" }}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Selling price" value={v.sellingPrice} onChange={(x) => setVariant(i, { sellingPrice: x })} style={fieldStyle} />
                    <NumField label="Base cost" value={v.costPrice} onChange={(x) => setVariant(i, { costPrice: x })} style={fieldStyle} />
                    <NumField
                      label={isEdit && v.id ? "Current stock (adjust separately)" : "Opening stock"}
                      value={v.stockQty}
                      onChange={(x) => setVariant(i, { stockQty: x })}
                      style={fieldStyle}
                      readOnly={isEdit && Boolean(v.id)}
                    />
                    <NumField label="Low-stock alert" value={v.lowStockThreshold} onChange={(x) => setVariant(i, { lowStockThreshold: x })} style={fieldStyle} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Product"}
        </button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, style, readOnly = false }: {
  label: string; value: string; onChange: (v: string) => void; style: React.CSSProperties; readOnly?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly} disabled={readOnly}
        placeholder="0" className="w-full h-10 rounded-[20px] px-3 text-sm outline-none disabled:opacity-60"
        style={style} />
    </div>
  );
}
