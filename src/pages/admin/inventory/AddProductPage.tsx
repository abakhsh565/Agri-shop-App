import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import DateField from "@/components/ui/DateField";
import SelectorField from "@/components/ui/SelectorField";
import InlineSelect from "@/components/ui/InlineSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import LogoTile from "@/components/ui/LogoTile";
import Checkbox from "@/components/ui/Checkbox";
import { backToSelf, dependencyHint, readReturnTo } from "@/lib/dependencyGraph";
import { useShellBase } from "@/lib/useShellBase";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { rpcCreateProduct, rpcUpdateProduct, rpcPreviewProductBarcode } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { clearNav } from "@/lib/navContext";
import type { PhysicalFormCode, ProductCategory } from "@/types";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { categoryDisplayName, categoryForKind, orderedCategories, unitLabel } from "@/lib/catalogue";
import {
  defaultUnitForForm,
  physicalFormLabelKey,
  resolveClassification,
  unitGroupForBaseUnit,
} from "@/lib/classification";
import { Plus, Trash2, Lock, RefreshCw } from "lucide-react";
import ScanButton from "@/components/ui/ScanButton";
import { DEFAULT_STOCK_ALERT_SETTINGS, loadStockAlertSettings, type StockAlertSettings } from "@/lib/stockAlerts";
import { markupPercent, sellingFromMarkup } from "@/lib/profit";
import { useShopStore } from "@/stores/shopStore";
import {
  deleteProductDraft,
  draftHasContent,
  draftNewId,
  getProductDraft,
  saveProductDraft,
  type ProductDraft,
} from "@/lib/productDraft";
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
 * The physical form decides what every number on the page means, so it comes before the pack
 * cards. The category supplies the possible forms, the chosen form supplies the unit family,
 * and the unit itself is selected automatically: the owner only chooses how the product arrives,
 * never a measurement system as a second, related question.
 */

/**
 * The shelf and the unit are the shop's own (0259).
 *
 * The form used to offer three of the seven categories and two units, both compiled in — which
 * meant a shelf the owner created on the Categories screen could never hold a product. Both
 * pickers now read `catalogueStore`, the same rows those screens manage, so creating a
 * "Wheat seed" shelf and then opening this form offers it without a reload.
 *
 * Nothing is lost by the change: every seeded shelf is offered (not just the three), and a
 * product filed under a kind whose shelf no longer exists still keeps its kind through the
 * fallback below.
 */

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
  /**
   * The same money as the two prices above, said as a percentage on cost. Derived, never
   * stored: the database keeps cost and selling price, and this is the third way to type
   * them — so it cannot drift out of step with what is saved.
   */
  markup: string;
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

/** A price moved: restate the markup from the prices, which stay the source of truth. */
function withMarkup(p: PackDraft): PackDraft {
  return { ...p, markup: markupPercent(Number(p.costPrice), Number(p.sellingPrice)) };
}

/**
 * The markup moved: write the selling price from it, against the cost it was measured on.
 *
 * With no cost price there is nothing to measure, so the selling price is left exactly as
 * typed and the hint beside the field says why nothing moved — silently ignoring the field
 * would look like the app had lost the number.
 */
function withSellingFromMarkup(p: PackDraft, markup: string): PackDraft {
  const next = sellingFromMarkup(Number(p.costPrice), markup);
  return next.sellingPrice === null ? { ...p, markup } : { ...p, markup, sellingPrice: next.sellingPrice };
}

export default function AddProductPage() {
  const navigate = useNavigate();
  // This screen answers under both shells: the owner habitually opens it from /admin, and an
  // employee who was granted `products.create` opens the same screen from /employee. Every
  // path it writes back to follows the shell it was opened in.
  const base = useShellBase();
  const { productId } = useParams();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const companies = useCompaniesStore((s) => s.companies);
  // The shop's own shelves and units (0259). Read here rather than fetched by this screen: the
  // shell loads them once, and the Categories/Units screens keep the same store current.
  const categories = useCatalogueStore((s) => s.categories);
  // Named `shopUnits`: `units` is already the pack's own unit list further down this screen.
  const shopUnits = useCatalogueStore((s) => s.units);
  const classifications = useCatalogueStore((s) => s.classifications);
  const catalogueReady = useCatalogueStore((s) => s.ready);
  const existing = useProductsStore((s) => s.products.find((p) => p.id === productId));
  const isEdit = Boolean(productId);

  // Arriving from Company Details → Add Product, the supplier is already decided by where
  // the owner tapped. Asking for it again is the repetition this screen removes; the field
  // is shown, not asked, and the product is linked to that company.
  const [searchParams] = useSearchParams();
  const presetCompanyId = searchParams.get("companyId") || "";
  const returnTo = readReturnTo(searchParams, `${base}/products`);
  const presetCompany = companies.find((c) => c.id === presetCompanyId);
  const companyLocked = Boolean(presetCompany) && !isEdit;

  /**
   * A draft this screen was opened to finish (`?draft=`), read once at first render.
   *
   * Read here rather than in an effect on purpose: an effect that filled the fields would
   * also be able to overwrite what someone had already typed into them, and "the draft loaded
   * a moment too late and replaced my typing" is not a bug anyone could see coming.
   */
  const activeShopId = useShopStore((s) => s.activeShopId);
  const draftParam = searchParams.get("draft") || "";
  const [resumed] = useState(() => (draftParam ? getProductDraft(activeShopId, draftParam) : null));
  const [imageUrl, setImageUrl] = useState<string | null>(
    resumed ? resumed.imageUrl : existing?.imageUrl ?? null
  );
  const [name, setName] = useState(resumed?.name ?? existing?.name ?? "");
  const [company, setCompany] = useState(resumed?.company ?? existing?.company ?? "");
  // A row still filed under the retired "Spray" name opens as Pesticide, so saving an edit
  // re-files it under the one name the shop now uses instead of preserving a category the
  // form no longer offers (0162). Nothing else about the product changes.
  const [category, setCategory] = useState<ProductCategory>(
    resumed?.category ??
      (existing?.category && existing.category !== "spray" ? existing.category : "pesticide")
  );
  // The shelf's own id. `category` above stays because the seven fixed kinds are what the
  // database stores for every report and recommendation; this is the name the shop filed it on.
  const [categoryId, setCategoryId] = useState(resumed?.categoryId ?? existing?.categoryId ?? "");
  const [baseUnit, setBaseUnit] = useState<string>(
    resumed?.baseUnit ?? existing?.baseUnit ?? "kg"
  );
  const [unitId, setUnitId] = useState(resumed?.unitId ?? existing?.unitId ?? "");
  const [physicalForm, setPhysicalForm] = useState<PhysicalFormCode | "">(
    resumed?.physicalForm ?? existing?.physicalForm ?? "",
  );
  const classificationTouched = useRef(false);
  /**
   * The code the shop scans. It stopped being a field whose typing was thrown away in 0158:
   * `create_product` writes it into `product_barcodes` (unique per shop, one primary per
   * product) and refuses a code already in use, and it mints one when this is left empty.
   */
  const [barcode, setBarcode] = useState(resumed?.barcode ?? existing?.barcode ?? "");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  // A ref, not `barcodeBusy`: React batches, so two taps in one task both read the pre-render
  // `false`, and a second generate would race the first.
  const barcodeBusyRef = useRef(false);
  const [packs, setPacks] = useState<PackDraft[]>(resumed?.packs ?? []);
  /**
   * "List on Farmer Marketplace" (0185).
   *
   * Off for a product being created, and read from the row when editing, so opening a listed
   * product and saving it cannot quietly unlist it. The switch is the owner's decision and the
   * database stores it as one: `update_product` distinguishes "not mentioned" from `false`, so an
   * unlisting is recorded rather than inferred.
   *
   * A draft carries it too, because a half-written product that was meant to be listed must not
   * come back unlisted.
   */
  const [marketplaceListed, setMarketplaceListed] = useState(
    resumed?.marketplaceListed ?? existing?.marketplaceListed ?? false
  );
  /**
   * Whether the switch has been moved by a person on this screen.
   *
   * It has to be tracked, because the row this screen edits can arrive AFTER the first render:
   * open `/admin/inventory/<id>/edit` by URL and the shell has not filled `productsStore` yet, so
   * every `useState` initializer above reads nothing. For the switch that was not a cosmetic lag.
   * The initial value was captured as `false` while `marketplaceInitial` (recomputed on every
   * render) became `true` a moment later, so `marketplaceChanged` said "the owner moved it" about
   * a switch nobody had touched — and the next save, about anything at all, wrote
   * `marketplaceListed: false` and unlisted a listed product. That is the exact defect the
   * marketplace lane exists to catch (measured 2026-10-14 on a product the form itself had just
   * listed).
   */
  const marketplaceTouched = useRef(false);
  /**
   * Adopt the row this screen edits, once it exists.
   *
   * WHY THIS IS NECESSARY, and not a nicety. This screen is opened by URL — a deep link, a
   * refresh, the browser's back button, the redirect after a save — and the row it edits lives in
   * `productsStore`, which the shell fills AFTER this component's first render. Every field above
   * reads that row in a `useState` initializer, so on all of those paths the form opened BLANK for a
   * product that exists. Measured 2026-10-14 on `/admin/inventory/<id>/edit`: the name and barcode
   * were empty while the packs filled in a moment later (their effect re-runs), and the marketplace
   * switch read `false` for a listed product — so `marketplaceChanged` said "the owner moved it"
   * about a switch nobody had touched and the next save, about anything at all, unlisted it.
   *
   * A field is only adopted while it still holds what this screen started it with, so a row that
   * arrives late can never overwrite what a person has typed.
   */
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (!isEdit || resumed || adoptedRef.current || !existing) return;
    adoptedRef.current = true;
    setName((v) => (v === "" ? existing.name ?? "" : v));
    setCompany((v) => (v === "" ? existing.company ?? "" : v));
    setBarcode((v) => (v === "" ? existing.barcode ?? "" : v));
    setImageUrl((v) => (v === null ? existing.imageUrl ?? null : v));
    // The retired "Spray" name stays folded into Pesticide, exactly as the initializers above do.
    setCategory((v) =>
      v === "pesticide" && existing.category && existing.category !== "spray" ? existing.category : v
    );
    setBaseUnit((v) =>
      v === "kg" && existing.baseUnit && existing.baseUnit !== "kg" ? existing.baseUnit : v
    );
    setCategoryId((v) => (v === "" ? existing.categoryId ?? "" : v));
    setUnitId((v) => (v === "" ? existing.unitId ?? "" : v));
    setPhysicalForm((v) => (v === "" ? existing.physicalForm ?? "" : v));
    if (!marketplaceTouched.current) setMarketplaceListed(existing.marketplaceListed === true);
  }, [isEdit, resumed, existing]);

  /**
   * Open on the shelf and unit the product already implies, once the catalogue arrives.
   *
   * A new product used to start on Pesticide/Kilogram because those were the first chips. Those
   * shelves still exist and still answer to those kinds, so `categoryForKind` finds them — and a
   * product whose row predates 0259 (a kind, no shelf) is opened on the shelf that kind already
   * belongs to rather than being left unfiled by a save that only touched something else.
   */
  const catalogueDefaultsRef = useRef(false);
  useEffect(() => {
    if (catalogueDefaultsRef.current || !catalogueReady) return;
    if (categories.length === 0 && shopUnits.length === 0) return;
    catalogueDefaultsRef.current = true;

    if (!categoryId) {
      const shelf = categoryForKind(category, categories);
      if (shelf) {
        setCategoryId(shelf.id);
        if (shelf.legacyCategory && !isEdit) setCategory(shelf.legacyCategory);
      }
    }
    if (!unitId && shopUnits.length > 0) {
      const match = shopUnits.find((u) => u.symbol.toLowerCase() === baseUnit.toLowerCase());
      if (match) {
        setUnitId(match.id);
        setBaseUnit(match.baseUnit);
        adoptUnitFamily(match.baseUnit);
      } else if (!isEdit) {
        // No match and nothing stored: a new product starts on the shop's first unit. An EDIT
        // keeps the unit it already has — a legacy "ton" must not become a kilogram because the
        // catalogue does not name it.
        setUnitId(shopUnits[0].id);
        setBaseUnit(shopUnits[0].baseUnit);
        adoptUnitFamily(shopUnits[0].baseUnit);
      }
    }
    // One read of the catalogue; the fields it fills are the person's to change afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueReady, categories, shopUnits]);
  /**
   * What the switch reads as the stored decision. On an edit, only a move away from this is
   * sent: the RPC treats an absent value as "unchanged", so a save that did not touch the
   * switch cannot unlist a listed product — not even if the row this device read was stale.
   */
  const marketplaceInitial = resumed?.marketplaceListed ?? existing?.marketplaceListed ?? false;
  const marketplaceChanged = marketplaceListed !== marketplaceInitial;
  const [shopAlerts, setShopAlerts] = useState<StockAlertSettings>(DEFAULT_STOCK_ALERT_SETTINGS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);

  /**
   * Leaving with something typed.
   *
   * A blocked navigation is the only seam that catches every way out of this screen at once —
   * the header's back arrow, the Android hardware back, a tab in the bottom bar, a deep link —
   * and it fires *before* the screen is unmounted, so the work is still in the fields when the
   * prompt appears. Anything less than this is a race with the router, and the person loses
   * what they typed whenever they lose it.
   *
   * `leavingRef` exists for the one navigation that must not be questioned: the redirect after
   * a successful save, when the fields still hold text but the product is already in stock.
   */
  const [askAboutDraft, setAskAboutDraft] = useState(false);
  const leavingRef = useRef(false);
  const typedSomething = draftHasContent({ name, company, barcode, packs });
  const canHoldDraft = !isEdit && Boolean(activeShopId) && typedSomething;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      canHoldDraft &&
      !leavingRef.current &&
      !savingRef.current &&
      currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state === "blocked") setAskAboutDraft(true);
  }, [blocker.state]);

  /** Carry out the navigation the person was already making. */
  function leaveNow() {
    leavingRef.current = true;
    if (blocker.state === "blocked") blocker.proceed();
    else navigate(returnTo, { replace: true });
  }

  /** Keep the work on this device, then go. */
  function handleSaveDraft() {
    const draft: ProductDraft = {
      id: resumed?.id ?? draftNewId(),
      updatedAt: new Date().toISOString(),
      shopId: activeShopId ?? "",
      name,
      company,
      category,
      categoryId: categoryId || undefined,
      baseUnit,
      unitId: unitId || undefined,
      physicalForm: selectedForm?.code,
      barcode,
      imageUrl,
      packs,
      marketplaceListed,
    };
    const outcome = saveProductDraft(draft);
    if (!outcome.ok) {
      // Storage refused it. Saying "saved" here would be the one lie that costs someone the
      // half-hour they just spent typing, so the prompt stays open and the toast is an error.
      addToast(t("draft.saveFailed"), "error");
      return;
    }
    setAskAboutDraft(false);
    addToast(outcome.droppedImage ? t("draft.savedNoPhoto") : t("draft.saved"), "success");
    // Land on the inventory list rather than wherever the back button was heading. The list
    // is the confirmation: the draft is now a row with its own chip, which is both the proof
    // it was kept and the way back to it. Saving it and landing somewhere it cannot be seen
    // is how a kept draft becomes a forgotten one.
    leavingRef.current = true;
    if (blocker.state === "blocked") blocker.reset();
    clearNav();
    navigate(`${base}/products`, { replace: true });
  }

  /** Throw the work away and go. The draft, if this screen was finishing one, goes too. */
  function handleDiscardDraft() {
    if (resumed) deleteProductDraft(activeShopId, resumed.id);
    setAskAboutDraft(false);
    leaveNow();
  }

  /** Stay, and let the router forget the navigation it was asked to make. */
  function handleKeepEditing() {
    setAskAboutDraft(false);
    if (blocker.state === "blocked") blocker.reset();
  }

  /** A pack that has never existed, starting from the shop's own alert number. */
  function blankPack(threshold: number): PackDraft {
    return {
      stockQty: "",
      sellingPrice: "",
      costPrice: "",
      markup: "",
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
          markup: markupPercent(v.costPrice, v.sellingPrice),
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

  /**
   * Make a code for this shop. The database does this, not the phone: only the shop knows
   * every code it has ever used, and a code made up here could be one this shop already retired.
   */
  async function handleGenerateBarcode() {
    if (barcodeBusyRef.current) return;
    barcodeBusyRef.current = true;
    setBarcodeBusy(true);
    try {
      setBarcode(await rpcPreviewProductBarcode(name.trim() || t("addProduct.unnamedProduct")));
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("errors.barcodeMintFailed"), "error");
    } finally {
      barcodeBusyRef.current = false;
      setBarcodeBusy(false);
    }
  }

  /**
   * Removing a barcode is done by clearing the field and saving, which is the plain reading of
   * an empty field and needs no second control. `update_product` retires the code it replaces
   * (0161), so the field is the whole of the delete path.
   */

  const units = packUnitsFor(baseUnit);
  const unitLabelFor = (unit: PackDisplayUnit) => t(packUnitLabelKey(unit));

  function setPack(i: number, patch: Partial<PackDraft>) {
    setPacks((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  /**
   * The next pack starts as a copy of the last, one size up.
   *
   * A shop sells the same thing in 5 KG, 10 KG and 25 KG bags at one cost and one margin, so
   * retyping every number for each pack was most of the work of adding a product. Only the
   * size moves (10 → 11), and it keeps moving while that size is already on the screen, so the
   * new card can never be born refused by the duplicate-size rule above.
   *
   * **Stock is deliberately not copied.** It is the one number on the card that describes the
   * shelf rather than the pack, and the database records it as an opening movement — copying it
   * would count stock into the shop that nobody put on the shelf.
   */
  function addPack() {
    setPacks((ps) => {
      if (ps.length === 0) return [blankPack(shopAlerts.threshold)];
      const last = ps[ps.length - 1];
      // A name somebody chose is not copied either: the new pack is a different size, and its
      // name has to come from that size or the bill would show the same pack twice.
      return [
        ...ps,
        {
          ...last,
          id: undefined,
          named: false,
          typedName: "",
          stockQty: "",
          sizeValue: nextSizeValue(ps, last),
        },
      ];
    });
  }

  /** `10` → `11`, skipping any size already in the list. A blank size has nothing to count up. */
  function nextSizeValue(ps: PackDraft[], last: PackDraft): string {
    const base = Number(last.sizeValue);
    if (!Number.isFinite(base) || base <= 0) return last.sizeValue;
    const used = new Set(
      ps
        .filter((p) => Number(p.sizeValue) > 0)
        .map((p) => packSizeSignature(toBaseUnit(p.sizeValue, p.sizeUnit), baseUnit))
    );
    let n = Math.ceil(base);
    while (used.has(packSizeSignature(toBaseUnit(n, last.sizeUnit), baseUnit)) && n < base + 1000) {
      n += 1;
    }
    return String(n);
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
   * Two packs of one size are refused — not renamed.
   *
   * The size *is* the pack's name: "10 KG" is what the bill, the pack picker and a return all
   * show, so two packs sharing it make every one of those ambiguous. The form used to answer
   * that by asking for a pet name on top of a size the shopkeeper had already typed, which is
   * the wrong repair — the number he can see is the one that is wrong, and changing it or its
   * unit is the whole fix. A size nobody has typed yet (blank, or not a number) is not a
   * clash; it is an empty box.
   */
  const clashes = useMemo(() => {
    const counts = new Map<string, number>();
    packs.forEach((p, i) => {
      if (!(Number(p.sizeValue) > 0)) return;
      const key = packSizeSignature(storedSizes[i], baseUnit);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return packs.map(
      (p, i) =>
        Number(p.sizeValue) > 0 && (counts.get(packSizeSignature(storedSizes[i], baseUnit)) ?? 0) > 1
    );
  }, [packs, storedSizes, baseUnit]);

  const derivedName = (i: number) => packSizeLabel(storedSizes[i], baseUnit, t);
  // A pack somebody deliberately named — a pack already on a receipt — keeps that name;
  // everything else is called what it is, which is what a bill needs.
  const nameFor = (i: number) =>
    packs[i].named ? packs[i].typedName.trim() || derivedName(i) : derivedName(i);

  function numeric(raw: string, fallback = 0): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /**
   * A quantity or an amount is never negative, and the field says so as it is typed.
   *
   * `numeric` above already refuses a negative at save time — but it refuses it by turning it
   * into 0, which means a `-5` typed into opening stock looked accepted, was stored as 0, and
   * the number on the screen was never the number that got saved. A field that cannot hold a
   * value it will not store is the honest version: the minus never lands.
   */
  function unsigned(raw: string): string {
    return raw.replace(/-/g, "");
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
    if (clashes.some(Boolean)) {
      setError(t("addProduct.packSizeDuplicate"));
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
          // Sent even when empty: this form shows the shelf, so an empty picker is a decision to
          // take the product off the shelf. `update_product` distinguishes the two cases.
          categoryId: categoryId || null,
          baseUnit,
          unitId: unitId || null,
          physicalForm: formForSave,
          imageUrl: imageUrl ?? undefined,
          // Only sent when the switch moved. `update_product` distinguishes "not mentioned"
          // from false on purpose, and this is that distinction being used honestly: a save
          // that never touched the switch leaves the stored decision exactly as it was, while
          // an actual unlisting still travels as `false` and is recorded as a decision.
          ...(marketplaceChanged ? { marketplaceListed } : {}),
          // Sent even when empty, because on an edit an empty field is a fact about the
          // product — it has no barcode — and not an omission. The database retires the code
          // it replaces. The create branch below sends nothing at all rather than an empty
          // string; since 0246 that means the same thing in both places: no code.
          barcode: barcode.trim(),
          variants,
        });
        await useProductsStore.getState().load();
        addToast(t("copy.updated", { name: name.trim() }), "success");
      } else {
        await rpcCreateProduct({
          name: name.trim(),
          company: company.trim(),
          category,
          categoryId: categoryId || undefined,
          baseUnit,
          unitId: unitId || undefined,
          physicalForm: formForSave,
          imageUrl: imageUrl ?? undefined,
          // Absent, not empty, when the field was left alone — and absent now means the product
          // has no barcode. `create_product` used to mint one for exactly this case (0246).
          barcode: barcode.trim() || undefined,
          // Sent on create unconditionally, including as false: there is no stored value to
          // preserve yet, so this screen's switch IS the first decision about the product.
          marketplaceListed,
          variants,
        });
        await useProductsStore.getState().load();
        addToast(t("copy.addedToInventory", { name: name.trim() }), "success");
      }
      // The draft became a real product: it is finished, so it stops waiting on the list.
      if (resumed) deleteProductDraft(activeShopId, resumed.id);
      leavingRef.current = true;
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
    background: "var(--field-bg)",
    color: "var(--text-primary)",
  } as const;
  // One label for every field on the screen. There used to be two — an uppercase section
  // label on the top fields and a 10px caption inside a pack — so the same kind of thing was
  // announced in two different sizes, and the smaller one read as an afterthought.
  const labelCls = "text-11 font-medium mb-1.5";
  const cellLabel = labelCls;
  const herePath = isEdit ? `${base}/inventory/${productId}/edit` : `${base}/inventory/new`;
  const supplierHint = dependencyHint("supplier", t, {
    base,
    returnTo: backToSelf(herePath, returnTo, `${base}/products`),
  });

  /**
   * The shelves and units, as the pickers offer them.
   *
   * A subcategory reads as "Pesticide › Insect powder": the parent's name first, because that is
   * the shelf the shopkeeper actually thinks in, and the child alone is ambiguous once a shop
   * has a few of them. The units carry their family as the second line for the same reason the
   * Units screen does.
   */
  const categoryOptions = useMemo(
    () =>
      orderedCategories(categories).map(({ category: shelf, parent }) => ({
        value: shelf.id,
        label: parent
          ? `${categoryDisplayName(parent, t)} › ${categoryDisplayName(shelf, t)}`
          : categoryDisplayName(shelf, t),
      })),
    [categories, t],
  );

  const classification = useMemo(
    () => resolveClassification(categoryId, categories, classifications),
    [categoryId, categories, classifications],
  );

  /**
   * The form to use, including the single-form automatic choice and a stored form that is no
   * longer in the profile. The latter keeps an existing product editable without reclassifying it.
   */
  const selectedForm = useMemo(() => {
    if (!classification) return null;
    if (physicalForm) {
      return classification.physicalForms.find((form) => form.code === physicalForm) ?? {
        code: physicalForm,
        unitGroups: [],
      };
    }
    // A new product opens on the category's first form, so the field always has one value.
    // An untouched legacy edit keeps its null form so an unrelated save cannot reclassify it.
    return !isEdit || classificationTouched.current
      ? classification.physicalForms[0] ?? null
      : null;
  }, [classification, physicalForm, isEdit]);

  /**
   * A legacy edit with no stored form sends null unless the owner actually touches the
   * classification. This keeps an unrelated edit from being refused after a profile changes.
   */
  const formForSave =
    isEdit && !classificationTouched.current
      ? physicalForm || null
      : selectedForm?.code ?? null;

  const formOptions = useMemo(() => {
    if (!classification) return [];
    const options = [...classification.physicalForms];
    if (physicalForm && !options.some((form) => form.code === physicalForm)) {
      options.push({ code: physicalForm, unitGroups: [] });
    }
    return options.map((form) => {
      const formLabel = t(physicalFormLabelKey(form.code));
      const unit = form.unitGroups.length > 0 ? defaultUnitForForm(form, shopUnits) : undefined;
      return {
        value: form.code,
        // The unit is part of the answer, not a second question. A closed field still shows
        // the one line the owner needs: "Liquid · Liter".
        label: unit ? `${formLabel} · ${unitLabel(unit)}` : formLabel,
      };
    });
    // `t` is stable for a language; the options follow the selected shelf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classification, physicalForm, shopUnits]);

  const automaticUnit = selectedForm ? defaultUnitForForm(selectedForm, shopUnits) : undefined;

  // One form means one family. Move the unit (and every pack's display unit) when the category
  // or form makes the current unit incompatible. An untouched edit keeps the stored unit.
  const classificationUnitKey = useRef("");
  useEffect(() => {
    if (!selectedForm || shopUnits.length === 0) return;
    const key = `${categoryId}:${selectedForm.code}`;
    if (classificationUnitKey.current === key) return;
    classificationUnitKey.current = key;
    if (isEdit && !classificationTouched.current) return;
    const current = shopUnits.find((unit) => unit.id === unitId);
    const group = current ? unitGroupForBaseUnit(current.baseUnit) : null;
    if (current && group && selectedForm.unitGroups.includes(group)) return;
    const next = defaultUnitForForm(selectedForm, shopUnits);
    if (next) chooseUnit(next.id);
  }, [selectedForm, categoryId, shopUnits, unitId, isEdit]);

  function choosePhysicalForm(next: string) {
    classificationTouched.current = true;
    setPhysicalForm(next as PhysicalFormCode);
  }

  /**
   * Move every pack onto the family the product is now measured in.
   *
   * A pack's size is stored in the product's own unit, so the unit chip is what its number
   * means. Changing the product from Kilogram to Bori left the pack still labelled "KG" while
   * the stored unit was pieces — the bill then said "10 KG" for ten pieces. The typed number is
   * kept (there is no honest conversion between families); only its unit is moved.
   */
  function adoptUnitFamily(family: string) {
    const familyUnits = packUnitsFor(family);
    setPacks((list) =>
      list.map((p) =>
        familyUnits.includes(p.sizeUnit) ? p : { ...p, sizeUnit: familyUnits[0] },
      ),
    );
  }

  /** Choosing a unit also chooses the family its pack sizes are written in. */
  function chooseUnit(nextId: string) {
    setUnitId(nextId);
    const unit = shopUnits.find((u) => u.id === nextId);
    if (unit) {
      setBaseUnit(unit.baseUnit);
      adoptUnitFamily(unit.baseUnit);
    }
  }

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
              One block, not three. Every field that describes the product rather than a pack
              lives here, because a box per question made a short form look like a long one:
              the eye had to re-enter a new surface to answer "what kind of thing is it?".

              The block has no surface of its own: the fields sit on the page, and the rules
              below separate the subjects (the product, each pack, the listing) rather than
              drawing boxes around them (owner's correction, 2026-10-31). */}
          <div className="flex flex-col gap-4">
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
                discarded on save.

                Three ways in, which is every way a barcode reaches a shop: typing one off a
                supplier's carton, scanning one off a label, or having the shop make one. All
                three end in the same field, because they are the same fact. */}
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("addProduct.barcode")}</p>
              <div className="flex gap-2">
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder={t("addProduct.barcodePlaceholder")}
                  data-testid="product-barcode"
                  dir="ltr"
                  aria-label={t("addProduct.barcode")}
                  className="flex-1 min-w-0 h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none font-mono"
                  style={fieldStyle}
                />
                <ScanButton
                  size="lg"
                  label={t("addProduct.barcodeScan")}
                  onScan={(code) => setBarcode(code)}
                />
              </div>

              {/* A text action, not a third control competing with the field: making a code is
                  the fallback for when there is nothing to type or scan. */}
              <button
                type="button"
                onClick={handleGenerateBarcode}
                disabled={barcodeBusy}
                data-testid="product-barcode-generate"
                className="mt-1.5 text-12 font-semibold underline underline-offset-2 disabled:opacity-50"
                style={{ color: "var(--brand-dark)" }}
              >
                <RefreshCw size={12} className="inline me-1 -mt-0.5" />
                {t("addProduct.barcodeGenerate")}
              </button>

              {/* Everything above is enforced by the database, not by this screen: it refuses
                  a code another product owns and refuses one that was ever retired. Saying so
                  is the only way an owner can tell a refusal apart from a fault. */}
              <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("addProduct.barcodeRules")}
              </p>
            </div>

            {/* The shelves are the shop's own (0259), created on Categories. A shop with a few
                of them needs a picker, not a row of chips that overflows; the parent is named
                in the row so "Insect powder" cannot be mistaken for a top-level shelf. */}
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("inline.category")}</p>
              {/* A panel under the field, not a sheet: a shelf is one word, and raising a
                  full overlay to answer one word cost the reader their place in the form
                  (owner's correction, 2026-10-31). */}
              <InlineSelect
                value={categoryId}
                options={categoryOptions}
                label={t("inline.category")}
                testId="product-category"
                onChange={(id) => {
                  classificationTouched.current = true;
                  setCategoryId(id);
                  setPhysicalForm("");
                  // Keep the stored kind in step with the shelf, for the draft and for a client
                  // that predates `categoryId`: the kind comes from the shelf's root.
                  const shelf = categories.find((c) => c.id === id);
                  const root = shelf?.parentId
                    ? categories.find((c) => c.id === shelf.parentId) ?? shelf
                    : shelf;
                  if (root?.legacyCategory) setCategory(root.legacyCategory);
                }}
              />
            </div>

            {formOptions.length > 0 && (
              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
                  {t("classification.physicalForm")}
                </p>
                <InlineSelect
                  value={selectedForm?.code ?? ""}
                  options={formOptions}
                  label={t("classification.physicalForm")}
                  placeholder={t("classification.chooseForm")}
                  testId="product-form"
                  onChange={choosePhysicalForm}
                />
                {selectedForm && !automaticUnit && (
                  <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("classification.noUnits")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── The packs, in one box ─────────────────────────────────────────────
              One surface for the whole shelf, not one per pack. A pack is a part of the
              product, and a card around each one broke a two-pack product into what looked
              like two separate forms; leaving them loose on the page lost the grouping
              altogether. Inside this box the packs are still told apart by a rule, and
              "add another" stays in the same block (owner's correction, 2026-10-31). */}
          <div
            className="rounded-[var(--radius-card)] p-3.5 flex flex-col gap-3"
            style={{ background: "var(--tone-card)" }}
          >
          {packs.map((p, i) => (
            <div
              key={p.id ?? `new-${i}`}
              className={`flex flex-col gap-2.5${i > 0 ? " pt-3" : ""}`}
              style={i > 0 ? { borderTop: "1px solid var(--hairline)" } : undefined}
            >
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

              {/* The size and the unit beside it are one answer, so they are one control: the
                  unit offered is decided by the product's unit above, never free — and the row
                  has to survive a 320px phone, so the number yields the space (`min-w-0`, which
                  overrides an input's intrinsic minimum width) and the unit chip takes a fixed
                  share of the row, ellipsizing its word rather than pushing the field off the
                  card. */}
              <div className="min-w-0">
                <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.packSize")}</p>
                <div className="flex gap-2 min-w-0">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.sizeValue}
                    min={0}
                    onChange={(e) => setPack(i, { sizeValue: unsigned(e.target.value) })}
                    data-testid={`product-pack-size-${i}`}
                    className="flex-1 min-w-0 h-12 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                  {/* A dropdown in the row, not a sheet: the answer is one word from a list of
                      three, and raising an overlay for it hid the pack being measured (owner's
                      correction, 2026-10-31). */}
                  <div className="w-[45%] shrink-0 min-w-0">
                    <InlineSelect
                      value={p.sizeUnit}
                      options={units.map((u) => ({ value: u, label: unitLabelFor(u) }))}
                      onChange={(u) => setPack(i, { sizeUnit: u as typeof p.sizeUnit })}
                      label={t("addProduct.packUnitTitle")}
                      testId={`product-pack-unit-${i}`}
                      disabled={units.length < 2}
                    />
                  </div>
                </div>
                {/* The pack that is wrong is the one that says so, where its size is, rather
                    than one line at the foot of a form the owner would have to search. */}
                {clashes[i] && (
                  <p
                    className="text-11 mt-1"
                    style={{ color: "var(--error)" }}
                    data-testid={`product-pack-size-error-${i}`}
                  >
                    {t("addProduct.packSizeDuplicate")}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.costsYou")}</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.costPrice}
                    min={0}
                    onChange={(e) => setPack(i, withMarkup({ ...p, costPrice: unsigned(e.target.value) }))}
                    data-testid={`product-pack-cost-${i}`}
                    className="w-full h-12 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                  {/* Left empty, this one field is what turns every profit figure in the app
                      into the sale price. Said here, once, at the moment it is entered —
                      not months later on a report nobody can explain.

                      Only once a price has been quoted: on a blank pack there is nothing wrong
                      yet, and three warnings on an untouched form are the noise that teaches
                      people to ignore the fourth (owner's review, 2026-10-31). */}
                  {Number(p.sellingPrice) > 0 && !(Number(p.costPrice) > 0) && (
                    <p
                      className="text-11 mt-1"
                      style={{ color: "var(--warning)" }}
                      data-testid={`product-pack-cost-hint-${i}`}
                    >
                      {t("addProduct.costMissingHint")}
                    </p>
                  )}
                </div>
                <div>
                  <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.sellFor")}</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={p.sellingPrice}
                    min={0}
                    onChange={(e) => setPack(i, withMarkup({ ...p, sellingPrice: unsigned(e.target.value) }))}
                    data-testid={`product-pack-sell-${i}`}
                    className="w-full h-12 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                    style={fieldStyle}
                  />
                </div>
              </div>

              {/* The same money, said the other way round.

                  A shopkeeper thinks in "25% on cost" as often as in "sell at 500", so both
                  doors to the number are open. Whichever one is typed re-states the other
                  two, which is why the cost field, the selling field and this one are never
                  set independently: markup is derived from the prices (so it can never
                  disagree with what is saved), and typing a markup writes the selling price
                  instead. */}
              <div>
                <p className={cellLabel} style={{ color: "var(--text-secondary)" }}>{t("addProduct.markup")}</p>
                <input
                  type="number"
                  inputMode="decimal"
                  value={p.markup}
                  min={0}
                  onChange={(e) => setPack(i, withSellingFromMarkup(p, unsigned(e.target.value)))}
                  data-testid={`product-pack-markup-${i}`}
                  placeholder="%"
                  className="w-full h-12 rounded-[var(--radius-card)] px-3 text-sm outline-none"
                  style={fieldStyle}
                />
                {/* A percentage of nothing is nothing: with no cost price entered the
                    selling price is left exactly as typed, and this says why it did not
                    move instead of silently ignoring the field. */}
                {!(Number(p.costPrice) > 0) && (
                  <p
                    className="text-11 mt-1"
                    style={{ color: "var(--text-secondary)" }}
                    data-testid={`product-pack-markup-hint-${i}`}
                  >
                    {t("addProduct.markupNeedsCost")}
                  </p>
                )}
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
                      onClick={() => navigate(`${base}/inventory/${productId}/adjust`)}
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
                    min={0}
                    onChange={(e) => setPack(i, { stockQty: unsigned(e.target.value) })}
                    data-testid={`product-pack-stock-${i}`}
                    className="w-full h-12 rounded-[var(--radius-card)] px-3 text-sm outline-none"
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
                      min={0}
                      onChange={(e) => setPack(i, { lowStockThreshold: unsigned(e.target.value) })}
                      data-testid={`product-pack-warn-${i}`}
                      /* Same type size as every other input on the screen: a number typed
                         here is the same kind of thing as a number typed above. */
                      className="w-16 h-12 rounded-[var(--radius-tile)] px-2 text-sm text-center outline-none"
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
                <DateField
                  value={p.expiryDate}
                  onChange={(v) => setPack(i, { expiryDate: v })}
                  testId={`product-pack-expiry-${i}`}
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
          </div>

          {/* ── Listing on the farmer marketplace ────────────────────────────────
              A checkbox row, not a switch: it is the same control the permission and branch
              lists already use, and it reads as a decision the owner ticks rather than a
              setting he slides. The subtitle states the two things that decide whether it
              actually appears — the branch has to be listing too, and the product has to be
              in stock — because a tick that produces nothing visible is the failure this
              whole screen has been fixed for before.

              No separate save: the switch travels with the product on the same button, so
              there is no second write to forget and no half-listed state. */}
          <div
            className="pt-4 flex items-start gap-3"
            style={{ borderTop: "1px solid var(--hairline)" }}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={marketplaceListed}
              aria-label={t("marketplace.listOn")}
              onClick={() => { marketplaceTouched.current = true; setMarketplaceListed((v) => !v); }}
              data-testid="product-marketplace-toggle"
              className="mt-0.5 flex items-center justify-center shrink-0"
            >
              <Checkbox checked={marketplaceListed} />
            </button>
            <div className="min-w-0">
              <p className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("marketplace.listOn")}
              </p>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("marketplace.listOnHint")}
              </p>
            </div>
          </div>

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

      {/* ── Leaving with unsaved work ──────────────────────────────────────────── */}
      {/* An alert, not a sheet. A sheet is a container you browse — a supplier list, a pack
          unit — and this is a decision about the screen you are on, which is what a centered
          alert is for.

          TWO ANSWERS: keep the work as a draft, or throw it away. There used to be a third
          button for staying on the screen, which is what closing the alert already does, so it
          asked the reader to choose between three things when only two were decisions
          (owner's correction, 2026-10-31). Backdrop and Escape still mean keep editing, never
          discard: the one answer that cannot be undone must not be reachable by a stray tap. */}
      <ConfirmDialog
        open={askAboutDraft}
        title={t("draft.promptTitle")}
        message={t("draft.promptBody")}
        confirmLabel={t("draft.saveDraft")}
        secondaryDestructive={{ label: t("draft.discard"), onClick: handleDiscardDraft }}
        onConfirm={handleSaveDraft}
        onCancel={handleKeepEditing}
      />

    </div>
  );
}
