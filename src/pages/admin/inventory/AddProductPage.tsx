import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import SelectorField from "@/components/ui/SelectorField";
import { backToSelf, dependencyHint, readReturnTo } from "@/lib/dependencyGraph";
import LogoTile from "@/components/ui/LogoTile";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { rpcCreateProduct, rpcUpdateProduct } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { clearNav } from "@/lib/navContext";
import type { ProductCategory, BaseUnit } from "@/types";
import { Plus, Trash2, Scan } from "lucide-react";
import { generateProductBarcode } from "@/lib/barcode";

const CATEGORIES: { key: ProductCategory; i18nKey: string }[] = [
  { key: "spray", i18nKey: "products.category.spray" },
  { key: "seed", i18nKey: "products.category.seed" },
  { key: "fertilizer", i18nKey: "products.category.fertilizer" },
  { key: "other", i18nKey: "products.category.other" },
];

const BASE_UNITS: { key: BaseUnit; i18nKey: string }[] = [
  { key: "kg", i18nKey: "products.unit.kg" },
  { key: "liter", i18nKey: "products.unit.liter" },
  { key: "piece", i18nKey: "products.unit.piece" },
];

interface VariantDraft {
  id?: string;
  name: string;
  sellingPrice: string;
  costPrice: string;
  unitSize: string;
  qtyStep: string;
  lowStockThreshold: string;
}

const emptyVariant = (baseUnit: BaseUnit): VariantDraft => ({
  name: "", sellingPrice: "", costPrice: "",
  unitSize: baseUnit === "piece" ? "1" : "0.5",
  qtyStep: "1",
  lowStockThreshold: "5",
});

export default function AddProductPage() {
  const navigate = useNavigate();
  const { productId } = useParams();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const companies = useCompaniesStore((s) => s.companies);
  const existing = useProductsStore((s) => s.products.find((p) => p.id === productId));
  const isEdit = Boolean(productId);

  // Arriving from Company Details → Add Product, the supplier is already decided by
  // where the owner tapped. Asking for it again is the repetition this removes; the
  // field is shown, not asked, and the product is linked to that company.
  const [searchParams] = useSearchParams();
  const presetCompanyId = searchParams.get("companyId") || "";
  const returnTo = readReturnTo(searchParams, "/admin/products");
  const presetCompany = companies.find((c) => c.id === presetCompanyId);
  const companyLocked = Boolean(presetCompany) && !isEdit;

  useEffect(() => {
    if (!presetCompany) return;
    // New product from a supplier's own page: the supplier is decided, so it is locked.
    // Edit mode: never locked (the owner must still be able to correct it), but a
    // supplier that arrived in the URL IS chosen — that is what makes "create the
    // missing supplier and continue" land with the choice already made.
    if (companyLocked || isEdit) setCompany(presetCompany.name);
  }, [companyLocked, presetCompany, isEdit]);

  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");

  // The product's blocking dependency. The supplier form is sent back to THIS form,
  // and this form's own `returnTo` rides along, so a product created for a sale still
  // lands back in the sale after the supplier detour.
  const herePath = isEdit ? `/admin/inventory/${productId}/edit` : "/admin/inventory/new";
  const supplierHint = dependencyHint("supplier", t, {
    base: "/admin",
    returnTo: backToSelf(herePath, returnTo, "/admin/products"),
  });
  const [category, setCategory] = useState<ProductCategory>(existing?.category ?? "spray");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(existing?.baseUnit ?? "piece");
  const [stockQty, setStockQty] = useState(existing ? String(existing.stockQty) : "");
  // Display label for the base unit (the raw token is a storage value, not copy)
  const unitLabel = t(BASE_UNITS.find((u) => u.key === baseUnit)?.i18nKey ?? "products.unit.piece");
  const [variants, setVariants] = useState<VariantDraft[]>(
    existing && existing.variants.length > 0
      ? existing.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sellingPrice: String(v.sellingPrice),
          costPrice: String(v.costPrice),
          unitSize: String(v.unitSize),
          qtyStep: String(v.qtyStep),
          lowStockThreshold: String(v.lowStockThreshold),
        }))
      : [emptyVariant(existing?.baseUnit ?? "piece")]
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);

  function setVariant(i: number, patch: Partial<VariantDraft>) {
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function addVariant() { setVariants((vs) => [...vs, emptyVariant(baseUnit)]); }
  function removeVariant(i: number) { setVariants((vs) => vs.filter((_, idx) => idx !== i)); }

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError(t("copy.enterProductName")); return; }
    if (!company.trim()) { setError(t("copy.selectSupplier")); return; }
    const clean = variants.filter((v) => v.name.trim() !== "");
    if (clean.length === 0) { setError(t("copy.addOneUnit")); return; }
    for (const v of clean) {
      if (Number(v.sellingPrice) <= 0) { setError(t("copy.sellingPriceFor", { name: v.name })); return; }
    }

    // Auto-generate barcode if empty
    const finalBarcode = barcode.trim() || generateProductBarcode(name.trim());

    // A ref, not `loading`: React batches, so two taps in one task both read the
    // pre-render `false` and the same product is created twice, opening its stock
    // twice with it.
    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    try {
      if (isEdit && productId) {
        await rpcUpdateProduct({
          id: productId,
          name: name.trim(),
          company: company.trim(),
          category,
          baseUnit,
          stockQty: Number(stockQty) || 0,
          imageUrl: imageUrl ?? undefined,
          barcode: finalBarcode,
          variants: clean.map((v) => ({
            id: v.id,
            name: v.name.trim(),
            sellingPrice: Number(v.sellingPrice) || 0,
            costPrice: Number(v.costPrice) || 0,
            unitSize: Number(v.unitSize) || 1,
            qtyStep: Number(v.qtyStep) || 1,
            lowStockThreshold: Math.max(0, Number(v.lowStockThreshold) || 5),
          })),
        });
        await useProductsStore.getState().load();
        addToast(t("copy.updated", { name: name.trim() }), "success");
      } else {
        await rpcCreateProduct({
          name: name.trim(),
          company: company.trim(),
          category,
          baseUnit,
          stockQty: Number(stockQty) || 0,
          imageUrl: imageUrl ?? undefined,
          barcode: finalBarcode,
          variants: clean.map((v) => ({
            // The variant is the stock of record (0128) and this is where the
            // database reads opening stock from, but the form collects ONE figure.
            // With a single unit row that figure is unambiguously its stock; the
            // form cannot express per-unit opening stock for several units, which
            // is recorded as an open decision rather than guessed at.
            ...(clean.length === 1 ? { stockQty: Number(stockQty) || 0 } : {}),
            name: v.name.trim(),
            sellingPrice: Number(v.sellingPrice) || 0,
            costPrice: Number(v.costPrice) || 0,
            unitSize: Number(v.unitSize) || 1,
            qtyStep: Number(v.qtyStep) || 1,
            lowStockThreshold: Math.max(0, Number(v.lowStockThreshold) || 5),
          })),
        });
        addToast(t("copy.addedToInventory", { name: name.trim() }), "success");
      }
      clearNav();
      // A workflow that needed this product sent us here (the sale's product step);
      // going back to it is what makes "create it and carry on" true rather than
      // "create it and find your own way back to the sale".
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveProductFailed"));
    } finally {
      savingRef.current = false;
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "ds-section-label mb-2";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={isEdit ? t("products.editProduct") : t("products.addButton")} />

        <div className="flex flex-col gap-5 p-4">
          {/* Photo */}
          <div className="flex justify-center pt-1">
            <ImageUpload bucket="product-images" value={imageUrl} onChange={setImageUrl} shape="square" label={t("addProduct.addPhoto")} />
          </div>

          {/* Name */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.productName")}</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("addProduct.namePlaceholder")}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          {/* Barcode */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.barcode")}</p>
            <div className="flex gap-2">
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value.toUpperCase())}
                placeholder={t("addProduct.skuPlaceholder")}
                className="flex-1 h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none font-mono"
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { scanFromCamera } = await import("@/lib/barcode");
                    const result = await scanFromCamera({
                      hint: t("scan.pointAtBarcode"),
                      cancel: t("common.cancel"),
                    });
                    if (result) {
                      setBarcode(result.barcode.toUpperCase());
                      addToast(t("copy.barcodeRead", { code: result.barcode }), "success");
                    }
                  } catch {
                    addToast(t('products.cameraUnavailable'), "error");
                  }
                }}
                className="h-12 w-12 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
              >
                <Scan size={16} style={{ color: "var(--brand-dark)" }} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!name.trim()) {
                  addToast(t('products.enterNameFirst'), "error");
                  return;
                }
                if (barcode.trim()) {
                  addToast(t('products.barcodeExists'), "error");
                  return;
                }
                const generated = generateProductBarcode(name.trim());
                setBarcode(generated);
                addToast(t("copy.barcodeMade", { code: generated }), "success");
              }}
              className="text-xs font-semibold mt-1.5 underline underline-offset-2"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("products.generateBarcode")}
            </button>
          </div>

          {/* Company */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("supplier.selectLabel")}</p>
            {companyLocked ? (
              <div className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm flex items-center gap-3" style={{ ...fieldStyle, opacity: 0.8 }}>
                <LogoTile name={presetCompany?.name ?? company} src={presetCompany?.logoUrl} size={28} />
                <span style={{ color: "var(--text-primary)" }}>{presetCompany?.name}</span>
              </div>
            ) : (
              <SelectorField
                value={company}
                options={companies.map((c) => ({ value: c.name, label: c.name, logoSrc: c.logoUrl }))}
                placeholder={t("supplier.selectSupplier")}
                title={t("supplier.selectLabel")}
                onChange={setCompany}
                searchable
                /* This form refuses to save without a supplier, so an empty picker
                   used to be a dead end: the user was told nothing was available and
                   had to leave, create one, and come back to a cleared form. The
                   action is tertiary because it sits inside the product form, which
                   is where the main task is — not a second primary button. */
                emptyLabel={supplierHint.title}
                emptyAction={
                  supplierHint.action
                    ? { label: supplierHint.action.label, onClick: () => navigate(supplierHint.action!.to) }
                    : undefined
                }
              />
            )}
          </div>

          {/* Category */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("inline.category")}</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  className="h-9 px-4 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: category === c.key ? "var(--brand)" : "var(--surface-2)",
                    color: category === c.key ? "#0a0a0a" : "var(--text-secondary)",
                    border: category === c.key ? "none" : "1px solid var(--divider)",
                  }}>
                  {t(c.i18nKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Base Unit */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("inline.base_unit")}</p>
            <div className="flex gap-2">
              {BASE_UNITS.map((u) => (
                <button key={u.key} onClick={() => setBaseUnit(u.key)}
                  className="h-9 px-4 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: baseUnit === u.key ? "var(--brand)" : "var(--surface-2)",
                    color: baseUnit === u.key ? "#0a0a0a" : "var(--text-secondary)",
                    border: baseUnit === u.key ? "none" : "1px solid var(--divider)",
                  }}>
                  {t(u.i18nKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Stock (product-level) */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("products.stock")} ({unitLabel})</p>
            <input type="number" inputMode="numeric" value={stockQty} onChange={(e) => setStockQty(e.target.value)}
              placeholder="0" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
            <p className="text-10 mt-1" style={{ color: "var(--text-secondary)", direction: "ltr" }}>
              {t("products.actualInventoryHint", { unit: unitLabel })}
            </p>
          </div>

          {/* Variants */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className={labelCls} style={{ color: "var(--text-secondary)", marginBottom: 0 }}>{t("common.unitsVariants")}</p>
              <button onClick={addVariant} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--brand-dark)" }}>
                <Plus size={14} /> {t("product.addUnit")}
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {variants.map((v, i) => (
                <div key={i} className="rounded-[var(--radius-card)] p-3.5" style={{ background: "var(--tone-card)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <input value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder={t("addProduct.unitNamePlaceholder")}
                      className="flex-1 h-10 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                    {variants.length > 1 && (
                      <button onClick={() => removeVariant(i)} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--surface-2)", color: "var(--error)" }}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label={t("addProduct.sellingPricePerUnit")} value={v.sellingPrice} onChange={(x) => setVariant(i, { sellingPrice: x })} style={fieldStyle} />
                    <NumField label={t("addProduct.baseCostPerUnit", { unit: unitLabel })} value={v.costPrice} onChange={(x) => setVariant(i, { costPrice: x })} style={fieldStyle} />
                    <NumField label={t("addProduct.unitSize", { unit: unitLabel })} value={v.unitSize} onChange={(x) => setVariant(i, { unitSize: x })} style={fieldStyle}
                      hint={baseUnit === "piece" ? t("addProduct.hintPiece") : t("addProduct.hintFraction", { unit: baseUnit === "kg" ? "g" : "ml" })} />
                    <NumField label={t("addProduct.qtyStep")} value={v.qtyStep} onChange={(x) => setVariant(i, { qtyStep: x })} style={fieldStyle}
                      hint={t("addProduct.qtyStepHint")} />
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
          {loading ? t("common.saving") : isEdit ? t("products.saveChanges") : t("products.addButton")}
        </button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, style, readOnly = false, hint }: {
  label: string; value: string; onChange: (v: string) => void; style: React.CSSProperties; readOnly?: boolean; hint?: string;
}) {
  return (
    <div>
      <p className="text-10 font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly} disabled={readOnly}
        placeholder="0" className="w-full h-10 rounded-[var(--radius-card)] px-3 text-sm outline-none disabled:opacity-60"
        style={style} />
      {hint && <p className="text-9 mt-0.5" style={{ color: "var(--text-secondary)", direction: "ltr" }}>{hint}</p>}
    </div>
  );
}
