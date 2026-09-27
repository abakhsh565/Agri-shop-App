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
import { Plus, Trash2, Scan, ChevronRight, AlertTriangle } from "lucide-react";
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

/**
 * One pack, when the owner sells the product in more than one.
 *
 * This is the *advanced* shape and it is folded away by default — see the note below.
 */
interface PackDraft {
  id?: string;
  name: string;
  sellingPrice: string;
  costPrice: string;
  unitSize: string;
  qtyStep: string;
  lowStockThreshold: string;
  stockQty: string;
}

const emptyPack = (baseUnit: BaseUnit, lowStockThreshold: number): PackDraft => ({
  name: "",
  sellingPrice: "",
  costPrice: "",
  unitSize: baseUnit === "piece" ? "1" : "0.5",
  qtyStep: "1",
  lowStockThreshold: String(lowStockThreshold),
  stockQty: "",
});

/**
 * Adding a product. The whole design is one decision: **what can be derived is not asked.**
 *
 * A shopkeeper adding a sack of urea knows four things — what it is, who supplied it, what
 * it costs, what he sells it for — and one number he looks at the shelf for, how many he
 * has. The form he used to get asked eleven more questions, most of them the database's
 * words for its own columns: *pack name*, *unit size*, *quantity step*, *base unit*,
 * *barcode*, *low-stock threshold*. Six lines of small grey text explained them, and
 * explainer text is the receipt for a form that was not thought through: a field that needs
 * a caption to be understood is the wrong field.
 *
 * So the common case — **one product, one pack**, which is nearly every product in a shop
 * like this — is now seven inputs and two picks, and it carries no help text at all:
 *
 *     photo · name · supplier · category · sell for · cost · you have (+ unit) · warn at
 *
 * Everything else is either **derived** or **folded away**:
 *
 *   • one pack → its name is the unit it is sold in, its size is 1, its step is 1. Asking
 *     someone to name a pack they only have one of is the form talking to itself.
 *   • the unit is not a section called "Base Unit" — it sits next to the quantity, where
 *     the owner is already thinking in kilos or pieces.
 *   • "Warn me when only 20 left" is one sentence with the input inside it, so it says what
 *     it does without a word of help text. It starts at the shop's number (Settings →
 *     Stock alerts) rather than a hidden 5, which is where the old form's mystery number
 *     came from.
 *   • barcode, and selling in several packs, live behind **More options**.
 *
 * And one thing is deliberately *not* offered: **editing stock**. The catalogue does not own
 * stock — `update_product` refuses it by design (0145), because stock belongs to the
 * movement path. The old form offered an editable box anyway, accepted the typing, threw it
 * away and reported "Updated". On Edit the figure is shown read-only next to the one action
 * that does change it.
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
  const firstVariant = existing?.variants[0];

  // Arriving from Company Details → Add Product, the supplier is already decided by
  // where the owner tapped. Asking for it again is the repetition this removes; the
  // field is shown, not asked, and the product is linked to that company.
  const [searchParams] = useSearchParams();
  const presetCompanyId = searchParams.get("companyId") || "";
  const returnTo = readReturnTo(searchParams, "/admin/products");
  const presetCompany = companies.find((c) => c.id === presetCompanyId);
  const companyLocked = Boolean(presetCompany) && !isEdit;

  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [category, setCategory] = useState<ProductCategory>(existing?.category ?? "spray");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(existing?.baseUnit ?? "piece");

  // The seven things that are actually asked.
  const [sellPrice, setSellPrice] = useState(firstVariant ? String(firstVariant.sellingPrice) : "");
  const [costPrice, setCostPrice] = useState(firstVariant ? String(firstVariant.costPrice) : "");
  const [stockQty, setStockQty] = useState(existing ? String(existing.stockQty) : "");
  const [warnAt, setWarnAt] = useState(
    firstVariant ? String(firstVariant.lowStockThreshold) : String(DEFAULT_STOCK_ALERT_SETTINGS.threshold)
  );

  // ...and the folded-away ones.
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const [showMore, setShowMore] = useState(false);
  // A product that already sells in several packs opens with them showing, so nothing it
  // holds is hidden behind a control the owner has no reason to look for.
  const [multiPack, setMultiPack] = useState((existing?.variants.length ?? 0) > 1);
  const [packs, setPacks] = useState<PackDraft[]>([]);

  const [shopAlerts, setShopAlerts] = useState<StockAlertSettings>(DEFAULT_STOCK_ALERT_SETTINGS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!presetCompany) return;
    if (companyLocked || isEdit) setCompany(presetCompany.name);
  }, [companyLocked, presetCompany, isEdit]);

  // A new product is watched at the shop's own number, so the owner never has to wonder
  // where the number came from — and it is theirs to change in Settings.
  useEffect(() => {
    let alive = true;
    loadStockAlertSettings().then((settings) => {
      if (!alive) return;
      setShopAlerts(settings);
      if (!isEdit) setWarnAt((current) =>
        current === String(DEFAULT_STOCK_ALERT_SETTINGS.threshold) ? String(settings.threshold) : current
      );
    });
    return () => { alive = false; };
  }, [isEdit]);

  /**
   * The packs the form will save.
   *
   * In the single-pack case — the common one — there is nothing to read from the advanced
   * fields, so the one pack is *built* from the seven visible answers. On Edit the pack
   * keeps the identity it already has (its id, its name, what is in one, its step) and only
   * its prices and alert level are rewritten, so opening this screen and pressing Save can
   * never quietly rename a pack or change what it contains.
   */
  function packsToSave(): Omit<PackDraft, "stockQty">[] {
    if (multiPack) return packs.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name !== "");
    const unitLabel = t(BASE_UNITS.find((u) => u.key === baseUnit)?.i18nKey ?? "products.unit.piece");
    return [{
      id: firstVariant?.id,
      name: isEdit && firstVariant ? firstVariant.name : unitLabel,
      sellingPrice: sellPrice,
      costPrice,
      unitSize: firstVariant ? String(firstVariant.unitSize) : "1",
      qtyStep: firstVariant ? String(firstVariant.qtyStep) : "1",
      lowStockThreshold: warnAt,
    }];
  }

  function numeric(raw: string, fallback = 0): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function addPack() {
    setPacks((ps) => [...ps, emptyPack(baseUnit, shopAlerts.threshold)]);
  }
  function setPack(i: number, patch: Partial<PackDraft>) {
    setPacks((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removePack(i: number) {
    setPacks((ps) => ps.filter((_, idx) => idx !== i));
  }

  /** Turning multi-pack on starts from what is already on screen, so nothing is retyped. */
  function toggleMultiPack() {
    setMultiPack((on) => {
      if (on) return false;
      if (packs.length > 0) return true;
      setPacks([{
        id: firstVariant?.id,
        name: firstVariant?.name ?? "",
        sellingPrice: sellPrice,
        costPrice,
        unitSize: firstVariant ? String(firstVariant.unitSize) : "1",
        qtyStep: firstVariant ? String(firstVariant.qtyStep) : "1",
        lowStockThreshold: warnAt,
        stockQty,
      }]);
      return true;
    });
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError(t("copy.enterProductName")); return; }
    if (!company.trim()) { setError(t("copy.selectSupplier")); return; }

    const saving = packsToSave();
    if (saving.length === 0) { setError(t("copy.addOneUnit")); return; }
    if (saving.some((p) => Number(p.sellingPrice) <= 0)) { setError(t("copy.sellingPriceFor", { name: name.trim() })); return; }

    const finalBarcode = barcode.trim() || generateProductBarcode(name.trim());

    // A ref, not `loading`: React batches, so two taps in one task both read the
    // pre-render `false` and the same product is created twice, opening its stock twice.
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
          imageUrl: imageUrl ?? undefined,
          barcode: finalBarcode,
          variants: saving.map((p) => ({
            id: p.id,
            name: p.name,
            sellingPrice: numeric(p.sellingPrice),
            costPrice: numeric(p.costPrice),
            unitSize: numeric(p.unitSize, 1) || 1,
            qtyStep: numeric(p.qtyStep, 1) || 1,
            lowStockThreshold: Math.floor(numeric(p.lowStockThreshold, shopAlerts.threshold)),
          })),
        });
        await useProductsStore.getState().load();
        addToast(t("copy.updated", { name: name.trim() }), "success");
      } else {
        // `stockQty` rides with its own pack in the multi-pack case: the variant is the
        // stock of record (0128), and the database reads opening stock from there, so a
        // pack that arrives with 3 of them recorded should arrive with 3 on the shelf.
        const withStock = multiPack
          ? packs
              .map((p, i) => ({ p, saved: saving[i] }))
              .filter((row) => row.saved)
              .map(({ p, saved }) => ({ ...saved, stockQty: numeric(p.stockQty) }))
          : [{ ...saving[0], stockQty: numeric(stockQty) }];

        await rpcCreateProduct({
          name: name.trim(),
          company: company.trim(),
          category,
          baseUnit,
          stockQty: numeric(stockQty),
          imageUrl: imageUrl ?? undefined,
          barcode: finalBarcode,
          variants: withStock.map((v) => ({
            name: v.name,
            sellingPrice: numeric(v.sellingPrice),
            costPrice: numeric(v.costPrice),
            unitSize: numeric(v.unitSize, 1) || 1,
            qtyStep: numeric(v.qtyStep, 1) || 1,
            lowStockThreshold: Math.floor(numeric(v.lowStockThreshold, shopAlerts.threshold)),
            stockQty: v.stockQty,
          })),
        });
        addToast(t("copy.addedToInventory", { name: name.trim() }), "success");
      }
      clearNav();
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
  const labelCls = "ds-section-label mb-1.5";
  const unitLabel = t(BASE_UNITS.find((u) => u.key === baseUnit)?.i18nKey ?? "products.unit.piece");
  const herePath = isEdit ? `/admin/inventory/${productId}/edit` : "/admin/inventory/new";
  const supplierHint = dependencyHint("supplier", t, {
    base: "/admin",
    returnTo: backToSelf(herePath, returnTo, "/admin/products"),
  });

  const cellLabel = "text-10 font-medium mb-1";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={isEdit ? t("products.editProduct") : t("products.addButton")} />

        <div className="flex flex-col gap-3.5 p-4">
          {/* ── What it is. The picture sits beside the name instead of owning the top of
                 the screen: it is optional, and it was the largest thing on the form. ── */}
          <div className="rounded-[var(--radius-card)] p-3.5 flex flex-col gap-3.5" style={{ background: "var(--tone-card)" }}>
            <div className="flex items-start gap-3">
              <ImageUpload
                bucket="product-images"
                value={imageUrl}
                onChange={setImageUrl}
                shape="square"
                size={56}
                label={t("common.addPhoto")}
              />
              <div className="flex-1 min-w-0">
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.productName")}</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("addProduct.namePlaceholder")}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={fieldStyle}
                />
              </div>
            </div>

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
                  /* This form refuses to save without a supplier, so an empty picker used to
                     be a dead end: the user was told nothing was available and had to leave,
                     create one, and come back to a cleared form. */
                  emptyLabel={supplierHint.title}
                  emptyAction={
                    supplierHint.action
                      ? { label: supplierHint.action.label, onClick: () => navigate(supplierHint.action!.to) }
                      : undefined
                  }
                />
              )}
            </div>

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
          </div>

          {/* ── The two numbers that decide what this product earns, side by side. ── */}
          <div className="rounded-[var(--radius-card)] p-3.5" style={{ background: "var(--tone-card)" }}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.sellFor")}</p>
                <input type="number" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)}
                  placeholder="0" data-testid="product-sell-price"
                  className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
              </div>
              <div>
                <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.costsYou")}</p>
                <input type="number" inputMode="decimal" value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
                  placeholder="0" data-testid="product-cost-price"
                  className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
              </div>
            </div>
          </div>

          {/* ── How many, in the unit the owner already thinks in. ── */}
          {!multiPack && (
            <div className="rounded-[var(--radius-card)] p-3.5" style={{ background: "var(--tone-card)" }}>
              <div className="flex items-center gap-2">
                <p className="text-13 font-semibold shrink-0" style={{ color: "var(--text-primary)" }}>
                  {t("addProduct.haveQty")}
                </p>
                {isEdit ? (
                  <span className="text-15 font-bold" style={{ color: "var(--text-primary)" }} data-testid="product-stock-readonly">
                    {existing ? existing.stockQty : 0}
                  </span>
                ) : (
                  <input type="number" inputMode="decimal" value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                    placeholder="0" data-testid="product-stock"
                    className="w-20 h-10 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                )}
                <div className="flex gap-1 ms-auto shrink-0">
                  {BASE_UNITS.map((u) => (
                    <button key={u.key} onClick={() => setBaseUnit(u.key)}
                      className="h-8 px-2.5 rounded-full text-11 font-bold transition-colors"
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
              {isEdit && (
                <button
                  type="button"
                  onClick={() => navigate(`/admin/inventory/${productId}/adjust`)}
                  className="text-xs font-semibold mt-2 underline underline-offset-2"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("addProduct.adjustStock")}
                </button>
              )}
            </div>
          )}

          {/* ── When to be warned. One sentence with the input inside it, so it explains
                 itself and needs no caption. ── */}
          {!multiPack && (
            <div className="rounded-[var(--radius-card)] p-3.5 flex items-center gap-2 flex-wrap" style={{ background: "var(--tone-card)" }}>
              <AlertTriangle size={15} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
              <span className="text-13" style={{ color: "var(--text-primary)" }}>{t("addProduct.warnAt")}</span>
              <input type="number" inputMode="numeric" value={warnAt} onChange={(e) => setWarnAt(e.target.value)}
                placeholder="0" data-testid="product-warn-at"
                className="w-16 h-9 rounded-[var(--radius-card)] px-2 text-sm text-center outline-none" style={fieldStyle} />
              <span className="text-13" style={{ color: "var(--text-primary)" }}>{t("addProduct.warnLeft")}</span>
            </div>
          )}

          {/* ── Everything advanced, folded away. Closed unless the data needs it. ── */}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            data-testid="product-more-options"
            className="flex items-center gap-1.5 self-start text-13 font-semibold ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            <ChevronRight
              size={14}
              style={{ transform: showMore ? "rotate(90deg)" : isUrdu ? "rotate(180deg)" : undefined }}
            />
            {t("addProduct.moreOptions")}
          </button>

          {showMore && (
            <div className="flex flex-col gap-3.5">
              <div className="rounded-[var(--radius-card)] p-3.5" style={{ background: "var(--tone-card)" }}>
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
                    data-testid="product-scan"
                    className="h-12 w-12 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
                  >
                    <Scan size={16} style={{ color: "var(--brand-dark)" }} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!name.trim()) { addToast(t('products.enterNameFirst'), "error"); return; }
                    if (barcode.trim()) { addToast(t('products.barcodeExists'), "error"); return; }
                    const generated = generateProductBarcode(name.trim());
                    setBarcode(generated);
                    addToast(t("copy.barcodeMade", { code: generated }), "success");
                  }}
                  className="text-xs font-semibold mt-2 underline underline-offset-2"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("products.generateBarcode")}
                </button>
              </div>

              {/* Several packs is the exception, so it is a switch the owner turns on
                  rather than a section he has to read past. */}
              <div className="rounded-[var(--radius-card)] p-3.5 flex items-center justify-between gap-3" style={{ background: "var(--tone-card)" }}>
                <span className="text-13" style={{ color: "var(--text-primary)" }}>{t("addProduct.multiPack")}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={multiPack}
                  aria-label={t("addProduct.multiPack")}
                  onClick={toggleMultiPack}
                  data-testid="product-multi-pack"
                  className="relative w-12 h-6 rounded-full transition-all duration-300 shrink-0"
                  style={{ background: multiPack ? "var(--brand)" : "var(--muted)" }}
                >
                  <span
                    className="absolute top-1 w-4 h-4 rounded-full transition-all duration-300"
                    style={{
                      insetInlineStart: multiPack ? "calc(100% - 20px)" : "4px",
                      background: multiPack ? "#0a0a0a" : "var(--text-secondary)",
                    }}
                  />
                </button>
              </div>

              {multiPack && (
                <div className="flex flex-col gap-2.5">
                  {packs.map((p, i) => (
                    <div key={i} className="rounded-[var(--radius-card)] p-3.5" style={{ background: "var(--tone-card)" }}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.packName")}</p>
                          <input value={p.name} onChange={(e) => setPack(i, { name: e.target.value })}
                            placeholder={t("addProduct.unitNamePlaceholder")}
                            className="w-full h-10 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                        </div>
                        {packs.length > 1 && (
                          <button onClick={() => removePack(i)} aria-label={t("common.remove")}
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-4"
                            style={{ background: "var(--surface-2)", color: "var(--error)" }}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div>
                          <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.sellFor")}</p>
                          <input type="number" inputMode="decimal" value={p.sellingPrice} onChange={(e) => setPack(i, { sellingPrice: e.target.value })}
                            placeholder="0" className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                        </div>
                        <div>
                          <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.costsYou")}</p>
                          <input type="number" inputMode="decimal" value={p.costPrice} onChange={(e) => setPack(i, { costPrice: e.target.value })}
                            placeholder="0" className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                        </div>
                        <div>
                          <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.unitSize", { unit: unitLabel })}</p>
                          <input type="number" inputMode="decimal" value={p.unitSize} onChange={(e) => setPack(i, { unitSize: e.target.value })}
                            placeholder="1" className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                        </div>
                        <div>
                          <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.qtyStep")}</p>
                          <input type="number" inputMode="decimal" value={p.qtyStep} onChange={(e) => setPack(i, { qtyStep: e.target.value })}
                            placeholder="1" className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                        </div>
                        {!isEdit && (
                          <div>
                            <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.haveQty")}</p>
                            <input type="number" inputMode="decimal" value={p.stockQty} onChange={(e) => setPack(i, { stockQty: e.target.value })}
                              placeholder="0" className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                          </div>
                        )}
                        <div>
                          <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.warnAt")}</p>
                          <input type="number" inputMode="numeric" value={p.lowStockThreshold} onChange={(e) => setPack(i, { lowStockThreshold: e.target.value })}
                            placeholder="0" className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none" style={fieldStyle} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button onClick={addPack} className="flex items-center gap-1 text-xs font-bold self-start" style={{ color: "var(--brand-dark)" }}>
                    <Plus size={14} /> {t("product.addUnit")}
                  </button>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading}
          data-testid="product-save"
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? t("common.saving") : isEdit ? t("products.saveChanges") : t("products.addButton")}
        </button>
      </div>
    </div>
  );
}
