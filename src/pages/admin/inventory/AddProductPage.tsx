import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import SelectorField from "@/components/ui/SelectorField";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import LogoTile from "@/components/ui/LogoTile";
import { backToSelf, dependencyHint, readReturnTo } from "@/lib/dependencyGraph";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { rpcCreateProduct, rpcUpdateProduct } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT, type I18nKey } from "@/lib/i18n";
import { clearNav } from "@/lib/navContext";
import type { ProductCategory, BaseUnit } from "@/types";
import { Plus, Trash2, Lock, Check, ChevronDown, RefreshCw } from "lucide-react";
import { generateProductBarcode } from "@/lib/barcode";
import { DEFAULT_STOCK_ALERT_SETTINGS, loadStockAlertSettings, type StockAlertSettings } from "@/lib/stockAlerts";
import {
  packUnitsFor,
  toBaseUnit,
  fromBaseUnit,
  packSizeLabel,
  packSizeSignature,
  packUnitLabelKey,
  type PackDisplayUnit,
} from "@/lib/packSize";

/**
 * Adding a product, and — since 0158 — actually saving one.
 *
 * The screen asks the questions a shopkeeper can answer, in the order he thinks about a new
 * line: **what it is → what kind of thing it is → what he sells it in → one card per pack**.
 * A pack card carries its size, what it cost, what it sells for, how many are on the shelf,
 * and when to warn him. That is the whole form.
 *
 * Three things are deliberately *not* asked, because the app can know them:
 *
 *   • **The barcode.** It was a field whose typing was thrown away — `create_product` never
 *     wrote it, so every product in the database had none (12 of 12), and the label screen
 *     existed only to repair that. The database now mints one per product (0158) and keeps it
 *     unique per shop, so the code the shop scans is one the app made and can reprint.
 *   • **The pack's name.** It is derived from the size — "10 KG", "500 Gram" — because that
 *     is what it is called out loud. The field appears only when two packs of the same size
 *     would otherwise share a name, which is the one case where the bill would be ambiguous.
 *   • **Stock, on an existing pack.** The catalogue does not own stock: `update_product`
 *     refuses it by design (0145) and a trigger refuses the write to the product's rollup.
 *     The figure is shown read-only beside the one action that does change it, because a box
 *     that accepts typing and discards it is what made this screen untrustworthy.
 *
 * The unit chips decide what every number on the page means, so they come *before* the pack
 * cards rather than beside a quantity: the database stores a pack size in the product's own
 * unit, and 0.5 is five hundred gram of a product sold by weight and five hundred millilitres
 * of one sold by volume. A shop only sells those two things, so those are the two chips.
 */

/** The units a NEW product may be created in. The database enforces the same two (0158). */
const FORM_UNITS: BaseUnit[] = ["kg", "liter"];

/**
 * The three categories the form offers.
 *
 * The database enum has seven, and the form deliberately does not. "Spray" and "Pesticide"
 * are the same thing bought for the same reason, "Equipment" is not sold by weight at all,
 * and a shop that files a product under "Other" can never find it again — so the four ways
 * to lose a product are gone rather than offered. Nothing is deleted: a product already
 * stored under one of them keeps it (see `categoryChoices`).
 */
const QUICK_CATEGORIES: ProductCategory[] = ["pesticide", "seed", "fertilizer"];

const categoryKey = (c: ProductCategory) => `products.category.${c}` as I18nKey;

/**
 * One pack, as the form holds it while it is being typed.
 *
 * Numbers are strings because that is what an input holds; the conversion to what the
 * database wants happens once, in `packPayload`, rather than while the owner is typing.
 */
interface PackDraft {
  /** Set on a pack that already exists, so saving cannot duplicate it. */
  id?: string;
  /**
   * When this pack expires, or empty.
   *
   * Expiry belongs to the pack and not to the product: the same 10 KG bag is dated
   * differently depending on when it was bought, and seed and pesticide both go off. It is
   * optional because not every shop keeps it — but the column existed with nothing ever
   * writing it, so "we don't track expiry" and "we track it and it is always empty" looked
   * identical in the database.
   */
  expiryDate: string;
  /** What is on the shelf for this pack, in items. Editable only while creating. */
  stockQty: string;
  sellingPrice: string;
  costPrice: string;
  /** The size as typed, in `sizeUnit`. */
  sizeValue: string;
  sizeUnit: PackDisplayUnit;
  /** Items per tap in the sale screen. */
  qtyStep: string;
  lowStockThreshold: string;
  /** A name the owner typed, used only when the derived one would clash. */
  typedName: string;
  /** True when this pack's name may not be derived — a legacy or custom name. */
  named: boolean;
}

/** The one sheet this screen still opens. */
type SheetTarget = { kind: "unit"; pack: number } | null;

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

  // Arriving from Company Details → Add Product, the supplier is already decided by where
  // the owner tapped. Asking for it again is the repetition this screen removes; the field
  // is shown, not asked, and the product is linked to that company.
  const [searchParams] = useSearchParams();
  const presetCompanyId = searchParams.get("companyId") || "";
  const returnTo = readReturnTo(searchParams, "/admin/products");
  const presetCompany = companies.find((c) => c.id === presetCompanyId);
  const companyLocked = Boolean(presetCompany) && !isEdit;

  const [sheet, setSheet] = useState<SheetTarget>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [category, setCategory] = useState<ProductCategory>(existing?.category ?? "pesticide");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>((existing?.baseUnit as BaseUnit) ?? "kg");
  /**
   * The code the shop scans. It stopped being a field whose typing was thrown away in 0158:
   * `create_product` writes it into `product_barcodes` (unique per shop, one primary per
   * product) and refuses a code already in use, and it mints one when this is left empty.
   */
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const [packs, setPacks] = useState<PackDraft[]>([]);
  const [shopAlerts, setShopAlerts] = useState<StockAlertSettings>(DEFAULT_STOCK_ALERT_SETTINGS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);

  /**
   * A product that predates the two-unit rule keeps the unit it already has.
   *
   * It is offered as a third chip rather than dropped, because an edit must never silently
   * re-denominate a product: opening an old row and pressing Save would otherwise move it
   * from "1 piece" to "1 kg" without anyone deciding that.
   */
  const unitChoices = useMemo<BaseUnit[]>(() => {
    const stored = (existing?.baseUnit ?? "kg") as BaseUnit;
    return FORM_UNITS.includes(stored) ? FORM_UNITS : [stored, ...FORM_UNITS];
  }, [existing?.baseUnit]);

  /** A pack that has never existed, starting from the shop's own alert number. */
  function blankPack(threshold: number): PackDraft {
    return {
      stockQty: "",
      sellingPrice: "",
      costPrice: "",
      sizeValue: "",
      sizeUnit: packUnitsFor(baseUnit)[0],
      qtyStep: "1",
      lowStockThreshold: String(threshold),
      typedName: "",
      named: false,
      expiryDate: "",
    };
  }

  // The packs a product already has, read back in the unit they were written in: 0.5 becomes
  // "500 Gram" here, which is the whole point of the conversion module.
  useEffect(() => {
    if (!existing) return;
    const storedUnit = existing.baseUnit ?? "kg";
    setPacks(
      existing.variants.map((v) => {
        const shown = fromBaseUnit(v.unitSize, storedUnit);
        const derived = packSizeLabel(v.unitSize, storedUnit, t);
        return {
          id: v.id,
          stockQty: String(v.stockQty),
          sellingPrice: String(v.sellingPrice),
          costPrice: String(v.costPrice),
          sizeValue: String(shown.value),
          sizeUnit: shown.unit,
          qtyStep: String(v.qtyStep),
          lowStockThreshold: String(v.lowStockThreshold),
          // `<input type="date">` speaks yyyy-mm-dd, which is also what the column holds.
          expiryDate: v.expiryDate ? String(v.expiryDate).slice(0, 10) : "",
          typedName: v.name,
          // A name that matches its own derivation stays derived, so it follows the size if
          // the owner changes it; only a name someone actually chose is preserved as typed.
          named: v.name.trim() !== "" && v.name.trim() !== derived,
        };
      })
    );
    // `t` is stable for a language; re-running on it would fight a language switch mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  // A new product starts with one pack, watched at the shop's number — so the field is never
  // a mystery value, and it is the owner's own number from Settings → Stock alerts.
  useEffect(() => {
    let alive = true;
    loadStockAlertSettings().then((settings) => {
      if (!alive) return;
      setShopAlerts(settings);
      if (!existing) {
        setPacks((ps) => (ps.length ? ps : [blankPack(settings.threshold)]));
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  useEffect(() => {
    if (!presetCompany) return;
    if (companyLocked || isEdit) setCompany(presetCompany.name);
  }, [companyLocked, presetCompany, isEdit]);

  const units = packUnitsFor(baseUnit);
  const unitLabelFor = (unit: PackDisplayUnit) => t(packUnitLabelKey(unit));

  function setPack(i: number, patch: Partial<PackDraft>) {
    setPacks((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPack() {
    setPacks((ps) => [...ps, blankPack(shopAlerts.threshold)]);
  }
  function removePack(i: number) {
    setPacks((ps) => ps.filter((_, idx) => idx !== i));
  }

  /** What each pack is stored as, before it is given a name. */
  const storedSizes = useMemo(
    () => packs.map((p) => toBaseUnit(p.sizeValue, p.sizeUnit)),
    [packs]
  );

  /**
   * Two packs of the same size cannot both be called "10 KG", because that name is what
   * appears on the bill, in the pack picker and on a return. Those — and only those — are
   * asked to be named.
   */
  const clashes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const size of storedSizes) {
      const key = packSizeSignature(size, baseUnit);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return storedSizes.map((size) => (counts.get(packSizeSignature(size, baseUnit)) ?? 0) > 1);
  }, [storedSizes, baseUnit]);

  const derivedName = (i: number) => packSizeLabel(storedSizes[i], baseUnit, t);
  const nameFor = (i: number) =>
    packs[i].named || clashes[i] ? packs[i].typedName.trim() || derivedName(i) : derivedName(i);

  function numeric(raw: string, fallback = 0): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) {
      setError(t("copy.enterProductName"));
      return;
    }
    if (!company.trim()) {
      setError(t("copy.selectSupplier"));
      return;
    }
    if (packs.length === 0) {
      setError(t("copy.addOneUnit"));
      return;
    }
    if (packs.some((p) => !(Number(p.sizeValue) > 0))) {
      setError(t("copy.enterPackSize"));
      return;
    }
    if (packs.some((p) => !(Number(p.sellingPrice) > 0))) {
      setError(t("copy.sellingPriceFor", { name: name.trim() }));
      return;
    }
    const names = packs.map((_, i) => nameFor(i));
    if (clashes.some(Boolean) && new Set(names).size !== names.length) {
      setError(t("copy.nameThosePacks"));
      return;
    }


    // A ref, not `loading`: React batches, so two taps in one task both read the pre-render
    // `false` and the same product is created twice, opening its stock twice.
    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    try {
      const variants = packs.map((p, i) => ({
        id: p.id,
        name: nameFor(i),
        sellingPrice: numeric(p.sellingPrice),
        costPrice: numeric(p.costPrice),
        unitSize: storedSizes[i],
        // Not asked on this screen any more. The value is carried through untouched so
        // editing a pack that was set up to sell by the crate cannot reset it to one, and a
        // new pack starts at one — one tap, one item.
        qtyStep: Math.max(1, Math.round(numeric(p.qtyStep, 1) || 1)),
        lowStockThreshold: Math.floor(numeric(p.lowStockThreshold, shopAlerts.threshold)),
        stockQty: Math.floor(numeric(p.stockQty)),
        // Empty clears the date; the database distinguishes "no expiry" from "not mentioned".
        expiryDate: p.expiryDate || null,
      }));

      if (isEdit && productId) {
        await rpcUpdateProduct({
          id: productId,
          name: name.trim(),
          company: company.trim(),
          category,
          baseUnit,
          imageUrl: imageUrl ?? undefined,
          barcode: barcode.trim() || undefined,
          variants,
        });
        await useProductsStore.getState().load();
        addToast(t("copy.updated", { name: name.trim() }), "success");
      } else {
        await rpcCreateProduct({
          name: name.trim(),
          company: company.trim(),
          category,
          baseUnit,
          imageUrl: imageUrl ?? undefined,
          barcode: barcode.trim() || undefined,
          variants,
        });
        await useProductsStore.getState().load();
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
  // One label for every field on the screen. There used to be two — an uppercase section
  // label on the top fields and a 10px caption inside a pack — so the same kind of thing was
  // announced in two different sizes, and the smaller one read as an afterthought.
  const labelCls = "text-11 font-medium mb-1.5";
  const cellLabel = labelCls;
  /**
   * The category chips on the Products screen, exactly: same height, same type, same two
   * tones. A second chip style that is nearly the same is how a design system drifts.
   */
  const chipCls = "shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors";
  const chip = (active: boolean) =>
    ({
      background: active ? "var(--brand)" : "var(--surface-2)",
      color: active ? "#0a0a0a" : "var(--text-secondary)",
    }) as const;

  const herePath = isEdit ? `/admin/inventory/${productId}/edit` : "/admin/inventory/new";
  const supplierHint = dependencyHint("supplier", t, {
    base: "/admin",
    returnTo: backToSelf(herePath, returnTo, "/admin/products"),
  });

  /**
   * The three chips, plus one more only when this product is already filed elsewhere.
   *
   * An old product stored as "spray" must not be re-filed just because someone opened it
   * and pressed Save, so its own category is shown as a fourth chip rather than hidden.
   */
  const categoryChoices = useMemo(() => {
    const set = new Set<ProductCategory>([...QUICK_CATEGORIES, category]);
    return [...QUICK_CATEGORIES, ...[...set].filter((c) => !QUICK_CATEGORIES.includes(c))];
  }, [category]);

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={isEdit ? t("products.editProduct") : t("products.addButton")} />

        <div className="flex flex-col gap-3.5 p-4">
          {/* ── What it is, and how it is sold ────────────────────────────────────
              One card, not three. Every field that describes the product rather than a pack
              lives here, because a box per question made a short form look like a long one:
              the eye had to re-enter a new surface to answer "what kind of thing is it?". */}
          <div className="rounded-[var(--radius-card)] p-3.5 flex flex-col gap-4" style={{ background: "var(--tone-card)" }}>
            {/* The app's one upload block, at its normal size: the 150 it used to be asked
                for pushed the only optional field on the screen to the whole top of it. */}
            <div className="flex justify-center pt-1">
              <ImageUpload
                bucket="product-images"
                value={imageUrl}
                onChange={setImageUrl}
                shape="circle"
                size={112}
                label={t("addProduct.uploadImage")}
              />
            </div>

            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.productName")}</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("addProduct.namePlaceholder")}
                data-testid="product-name"
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                style={fieldStyle}
              />
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

            {/* The code the shop scans. Optional, because the database mints one when this
                is empty — but it is a real field now, not the one whose typing used to be
                discarded on save. */}
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("addProduct.barcode")}</p>
              <div className="flex gap-2">
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder={t("addProduct.barcodePlaceholder")}
                  data-testid="product-barcode"
                  dir="ltr"
                  className="flex-1 min-w-0 h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none font-mono"
                  style={fieldStyle}
                />
                <button
                  type="button"
                  onClick={() => setBarcode(generateProductBarcode(name.trim() || "PRODUCT", packs.length))}
                  data-testid="product-barcode-generate"
                  className="h-12 px-3.5 rounded-[var(--radius-input)] flex items-center gap-1.5 text-12 font-semibold shrink-0"
                  style={fieldStyle}
                >
                  <RefreshCw size={14} style={{ color: "var(--text-secondary)" }} />
                  {t("addProduct.barcodeGenerate")}
                </button>
              </div>
            </div>

            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("inline.category")}</p>
              <div className="flex flex-wrap gap-2">
                {categoryChoices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    data-testid={`product-category-${c}`}
                    className={chipCls}
                    style={chip(category === c)}
                  >
                    {t(categoryKey(c))}
                  </button>
                ))}
              </div>
            </div>

            {/* The unit decides what every number below it means, so it is asked here, with
                the product, rather than beside a quantity further down. */}
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("addProduct.unitLabel")}</p>
              <div className="flex flex-wrap gap-2">
                {unitChoices.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setBaseUnit(u)}
                    data-testid={`product-unit-${u}`}
                    className={chipCls}
                    style={chip(baseUnit === u)}
                  >
                    {t(packUnitLabelKey(u as PackDisplayUnit))}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── One card per pack ────────────────────────────────────────────────── */}
          {packs.map((p, i) => (
            <div key={p.id ?? `new-${i}`} className="rounded-[var(--radius-card)] p-3.5 flex flex-col gap-2.5" style={{ background: "var(--tone-card)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
                  {t("addProduct.variantTitle", { n: String(i + 1) })}
                </p>
                {packs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePack(i)}
                    aria-label={t("common.remove")}
                    data-testid={`product-pack-remove-${i}`}
                    className="size-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--surface-2)", color: "var(--error)" }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {/* The size and the unit beside it are one answer, so they are one control:
                  the unit offered is decided by the product's unit above, never free. */}
              <div>
                <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.packSize")}</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.sizeValue}
                    onChange={(e) => setPack(i, { sizeValue: e.target.value })}
                    data-testid={`product-pack-size-${i}`}
                    className="flex-1 h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setSheet({ kind: "unit", pack: i })}
                    disabled={units.length < 2}
                    data-testid={`product-pack-unit-${i}`}
                    className="h-11 px-3 rounded-[var(--radius-card)] flex items-center gap-1.5 text-13 font-semibold shrink-0 disabled:opacity-100"
                    style={fieldStyle}
                  >
                    {unitLabelFor(p.sizeUnit)}
                    {units.length > 1 && <ChevronDown size={14} style={{ color: "var(--text-secondary)" }} />}
                  </button>
                </div>
              </div>

              {/* Asked only when the derived name would be ambiguous on the bill. */}
              {(p.named || clashes[i]) && (
                <div>
                  <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.packName")}</p>
                  <input
                    value={p.typedName}
                    onChange={(e) => setPack(i, { typedName: e.target.value })}
                    placeholder={derivedName(i)}
                    data-testid={`product-pack-name-${i}`}
                    className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                  {clashes[i] && (
                    <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                      {t("addProduct.packNameClash")}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.costsYou")}</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.costPrice}
                    onChange={(e) => setPack(i, { costPrice: e.target.value })}
                    data-testid={`product-pack-cost-${i}`}
                    className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.sellFor")}</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.sellingPrice}
                    onChange={(e) => setPack(i, { sellingPrice: e.target.value })}
                    data-testid={`product-pack-sell-${i}`}
                    className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                </div>
              </div>

              {/* How many are on the shelf: the one quantity the database stores per pack.
                  On a new pack it is the opening stock, recorded as a movement so the shelf
                  has a beginning; on an existing one it is a fact, not an input. */}
              <div>
                <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.itemsLabel")}</p>
                {isEdit && p.id ? (
                  <div className="flex items-center gap-2">
                    <span className="h-11 px-3 rounded-[var(--radius-card)] flex items-center text-sm font-semibold flex-1" style={fieldStyle} data-testid={`product-pack-stock-${i}`}>
                      {Math.floor(numeric(p.stockQty))} {t("addProduct.itemsWord")}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/inventory/${productId}/adjust`)}
                      className="text-xs font-semibold underline underline-offset-2 shrink-0"
                      style={{ color: "var(--brand-dark)" }}
                    >
                      {t("addProduct.adjustStock")}
                    </button>
                  </div>
                ) : (
                  <input
                    type="number"
                    inputMode="numeric"
                    value={p.stockQty}
                    onChange={(e) => setPack(i, { stockQty: e.target.value })}
                    data-testid={`product-pack-stock-${i}`}
                    className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                )}
              </div>

              {/* When to be warned, on one line with its number: the heading says what the
                  policy is and the control sits beside it, instead of a box inside a box
                  pushing a single small number to the bottom of the card. */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>{t("addProduct.stockAlerts")}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-12 shrink-0" style={{ color: "var(--text-secondary)" }}>{t("addProduct.minLeft")}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={p.lowStockThreshold}
                      onChange={(e) => setPack(i, { lowStockThreshold: e.target.value })}
                      data-testid={`product-pack-warn-${i}`}
                      /* Same type size as every other input on the screen: a number typed
                         here is the same kind of thing as a number typed above. */
                      className="w-16 h-10 rounded-[var(--radius-tile)] px-2 text-sm text-center outline-none"
                      style={fieldStyle}
                    />
                    <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("addProduct.itemsWord")}</span>
                  </div>
                </div>
                {Number(p.lowStockThreshold) !== shopAlerts.threshold && (
                  <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                    {t("addProduct.minLeftShop", { count: String(shopAlerts.threshold) })}
                  </p>
                )}
              </div>

              {/* When this batch goes off. Optional, and per pack rather than per product,
                  because that is what the shelf is: the same bag bought twice carries two
                  dates. Empty means "not tracked", which is a real answer. */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-11 font-medium" style={{ color: "var(--text-secondary)" }}>{t("addProduct.expiryDate")}</p>
                  {p.expiryDate && (
                    <button
                      type="button"
                      onClick={() => setPack(i, { expiryDate: "" })}
                      className="text-11 font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t("common.clear")}
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={p.expiryDate}
                  onChange={(e) => setPack(i, { expiryDate: e.target.value })}
                  data-testid={`product-pack-expiry-${i}`}
                  className="w-full h-11 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                  style={fieldStyle}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addPack}
            data-testid="product-add-variant"
            className="flex items-center gap-1.5 self-start text-13 font-bold ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            <Plus size={15} /> {t("addProduct.addAnotherVariant")}
          </button>

          {error && <p className="text-xs" style={{ color: "var(--error)" }} data-testid="product-error">{error}</p>}
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

      {/* ── The pack-size unit ─────────────────────────────────────────────────── */}
      <Sheet
        open={sheet?.kind === "unit"}
        title={t("addProduct.packUnitTitle")}
        onClose={() => setSheet(null)}
        closeButton={false}
      >
        <div className="px-4">
          <ListCard>
            {sheet?.kind === "unit" &&
              packUnitsFor(baseUnit).map((u) => (
                <ListRow
                  key={u}
                  title={unitLabelFor(u)}
                  emphasis
                  selected={packs[sheet.pack]?.sizeUnit === u}
                  testId={`product-pack-unit-option-${u}`}
                  onClick={() => {
                    // The number is kept exactly as typed and only its meaning changes: the
                    // owner is choosing what the number says. Re-scaling it here would turn
                    // "500" → Gram into a five-hundred-kilo pack while he was still deciding.
                    setPack(sheet.pack, { sizeUnit: u });
                    setSheet(null);
                  }}
                  trailing={
                    packs[sheet.pack]?.sizeUnit === u ? (
                      <Check size={20} style={{ color: "var(--brand-dark)" }} className="shrink-0" />
                    ) : undefined
                  }
                />
              ))}
          </ListCard>
        </div>
      </Sheet>
    </div>
  );
}
