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
import { Plus, Trash2, Scan, AlertTriangle } from "lucide-react";
import { generateProductBarcode } from "@/lib/barcode";
import { DEFAULT_STOCK_ALERT_SETTINGS, loadStockAlertSettings, type StockAlertSettings } from "@/lib/stockAlerts";

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

/**
 * A pack the form has not filled in yet. `lowStockThreshold` is the shop's own number
 * rather than a literal 5: the old form defaulted to `"5"` and there was no field for it
 * anywhere, so every product silently alerted at a number its owner had never seen.
 */
const emptyVariant = (baseUnit: BaseUnit, lowStockThreshold: number): VariantDraft => ({
  name: "", sellingPrice: "", costPrice: "",
  unitSize: baseUnit === "piece" ? "1" : "0.5",
  qtyStep: "1",
  lowStockThreshold: String(lowStockThreshold),
});

/**
 * Adding a product — or changing one.
 *
 * The form asks three questions in the order a shopkeeper thinks about a new line, and
 * says so:
 *
 *   1. **What it is** — the photo, the name a customer uses, the barcode, who supplies it,
 *      and which kind of thing it is.
 *   2. **How you sell it** — one card per pack: what the customer asks for, what is in one,
 *      what it costs, what it sells for, how many at a time, and when to warn you.
 *   3. **Stock** — how many are on the shelf.
 *
 * Two things were wrong here before and are worth stating, because they are what made the
 * screen unreadable:
 *
 *   • **The alert number was invisible.** `lowStockThreshold` was in the form's state, was
 *     sent to the database on every save, and was shown on the product list, the product
 *     page, Reorder Suggestions and the dashboard — and there was no field for it. The
 *     screen never said that stocking was watched at all, let alone at what number. It is
 *     now a labelled field on every pack, pre-filled with the shop's number from Settings.
 *
 *   • **The stock field on Edit could not save.** The catalogue does not own stock:
 *     `update_product` refuses `stock_qty` on purpose (migration 0145), because stock is
 *     owned by the movement path — sales, purchases, returns, adjustments. The form still
 *     offered an editable box, accepted the typing, discarded it, and reported "Updated".
 *     On Edit it is now a read-only figure that says where stock is actually changed and
 *     links straight there.
 */
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

  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");

  // The shop's own stock-alert policy (Settings → Stock alerts). A new product starts at
  // the shop's number, so the number it alerts at is one the owner has actually chosen.
  const [shopAlerts, setShopAlerts] = useState<StockAlertSettings>(DEFAULT_STOCK_ALERT_SETTINGS);

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
      : [emptyVariant(existing?.baseUnit ?? "piece", DEFAULT_STOCK_ALERT_SETTINGS.threshold)]
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!presetCompany) return;
    // New product from a supplier's own page: the supplier is decided, so it is locked.
    // Edit mode: never locked (the owner must still be able to correct it), but a
    // supplier that arrived in the URL IS chosen — that is what makes "create the
    // missing supplier and continue" land with the choice already made.
    if (companyLocked || isEdit) setCompany(presetCompany.name);
  }, [companyLocked, presetCompany, isEdit]);

  useEffect(() => {
    let alive = true;
    loadStockAlertSettings().then((settings) => {
      if (!alive) return;
      setShopAlerts(settings);
      // Only a number the owner has not touched is replaced, so this can never overwrite
      // what they typed while the policy was still being read.
      if (!isEdit) {
        setVariants((vs) =>
          vs.map((v) =>
            v.lowStockThreshold === String(DEFAULT_STOCK_ALERT_SETTINGS.threshold)
              ? { ...v, lowStockThreshold: String(settings.threshold) }
              : v
          )
        );
      }
    });
    return () => { alive = false; };
  }, [isEdit]);

  function setVariant(i: number, patch: Partial<VariantDraft>) {
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function addVariant() {
    setVariants((vs) => [...vs, emptyVariant(baseUnit, shopAlerts.threshold)]);
  }
  function removeVariant(i: number) { setVariants((vs) => vs.filter((_, idx) => idx !== i)); }

  /**
   * Read a threshold the owner typed.
   *
   * `Number(raw) || fallback` would read a deliberate `0` — "only tell me when it is
   * actually gone" — as "nothing was entered" and quietly substitute the shop's number.
   * Zero is a real answer, so it is parsed rather than defaulted.
   */
  function parseThreshold(raw: string): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : shopAlerts.threshold;
  }

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
            lowStockThreshold: parseThreshold(v.lowStockThreshold),
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
            // database reads opening stock from. With a single pack that figure is
            // unambiguously its stock; several packs share the one opening count, which
            // the hint under the field now says out loud instead of leaving the owner to
            // infer it from two adjacent numbers in different units.
            ...(clean.length === 1 ? { stockQty: Number(stockQty) || 0 } : {}),
            name: v.name.trim(),
            sellingPrice: Number(v.sellingPrice) || 0,
            costPrice: Number(v.costPrice) || 0,
            unitSize: Number(v.unitSize) || 1,
            qtyStep: Number(v.qtyStep) || 1,
            lowStockThreshold: parseThreshold(v.lowStockThreshold),
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

        <div className="flex flex-col gap-3 p-4">
          {/* ── What it is ─────────────────────────────────────────────────────────── */}
          <SectionHeading>{t("addProduct.sectionWhat")}</SectionHeading>

          {/* Photo */}
          <div className="flex justify-center">
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
                aria-label={t("scan.pointAtBarcode")}
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

          {/* ── How you sell it ────────────────────────────────────────────────────── */}
          <SectionHeading>{t("addProduct.sectionSell")}</SectionHeading>

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

          {/* Packs */}
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
                  {/* Labelled, then the field, then the hint — the same order every other
                      field on this form uses. A bare placeholder above the hint read as an
                      unexplained box, which is the habit this screen is being fixed for. */}
                  <p className="text-10 font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{t("addProduct.packName")}</p>
                  <div className="flex items-center gap-2">
                    <input value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder={t("addProduct.unitNamePlaceholder")}
                      className="flex-1 h-10 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                    {variants.length > 1 && (
                      <button onClick={() => removeVariant(i)} aria-label={t("common.remove")} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--surface-2)", color: "var(--error)" }}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <p className="text-9 mt-0.5 mb-2" style={{ color: "var(--text-secondary)" }}>{t("addProduct.packNameHint")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label={t("addProduct.sellFor")} value={v.sellingPrice} onChange={(x) => setVariant(i, { sellingPrice: x })} style={fieldStyle} />
                    <NumField label={t("addProduct.costsYou")} value={v.costPrice} onChange={(x) => setVariant(i, { costPrice: x })} style={fieldStyle} />
                    <NumField label={t("addProduct.unitSize", { unit: unitLabel })} value={v.unitSize} onChange={(x) => setVariant(i, { unitSize: x })} style={fieldStyle}
                      hint={baseUnit === "piece" ? t("addProduct.hintPiece") : t("addProduct.hintFraction", { unit: baseUnit === "kg" ? "g" : "ml" })} />
                    <NumField label={t("addProduct.qtyStep")} value={v.qtyStep} onChange={(x) => setVariant(i, { qtyStep: x })} style={fieldStyle}
                      hint={t("addProduct.qtyStepHint")} />
                  </div>

                  {/* When to be warned about this pack. It is the pack's own number, which
                      is why it sits inside the pack's card; the hint names the shop's number
                      so the owner can see what they are overriding. */}
                  <div className="mt-2 pt-2.5" style={{ borderTop: "1px solid var(--divider)" }}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="shrink-0 mt-2" style={{ color: "var(--text-secondary)" }} />
                      <div className="flex-1">
                        <NumField label={t("addProduct.warnAt")} value={v.lowStockThreshold} onChange={(x) => setVariant(i, { lowStockThreshold: x })} style={fieldStyle}
                          hint={t("addProduct.warnAtHint", { count: String(shopAlerts.threshold) })} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Stock ──────────────────────────────────────────────────────────────── */}
          <SectionHeading>{t("addProduct.sectionStock")}</SectionHeading>

          {/* On create this is the opening count. On edit the catalogue does not own stock
              at all — `update_product` refuses `stock_qty` by design (0145) — so the field
              is read-only and says where stock is actually changed. It used to be editable
              and accepted the typing, which is why changing it appeared to do nothing. */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
              {isEdit ? t("products.stock") : t("addProduct.openingStock")} ({unitLabel})
            </p>
            {isEdit ? (
              <>
                <div className="w-full h-12 rounded-[var(--radius-input)] px-4 flex items-center" style={{ ...fieldStyle, opacity: 0.7 }}>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {existing ? `${existing.stockQty} ${unitLabel}` : "—"}
                  </span>
                </div>
                <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("addProduct.stockReadOnly")}
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/admin/inventory/${productId}/adjust`)}
                  className="text-xs font-semibold mt-1.5 underline underline-offset-2"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("addProduct.adjustStock")}
                </button>
              </>
            ) : (
              <>
                <input type="number" inputMode="numeric" value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                  placeholder="0" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
                <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("addProduct.openingStockHint", { unit: unitLabel })}
                </p>
              </>
            )}
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

/**
 * The heading over a group of fields.
 *
 * A single field is labelled with `ds-section-label`; three parts of one form need a step
 * up from that, or the eye has no way to find the boundaries. Deliberately the smallest
 * type that reads as a heading rather than a fourth size of label.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>{children}</p>
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
      {/* Not forced left-to-right: these hints are translated prose that happens to end in
          a unit token, and pinning the direction mangled the Urdu sentence. */}
      {hint && <p className="text-9 mt-0.5" style={{ color: "var(--text-secondary)" }}>{hint}</p>}
    </div>
  );
}
