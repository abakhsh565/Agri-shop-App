import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SelectSheet from "@/components/ui/SelectSheet";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { rpcCreatePurchase } from "@/lib/db";
import { dependencyHint } from "@/lib/dependencyGraph";
import { formatCurrency } from "@/lib/formatters";
import { markupPercent, sellingFromMarkup } from "@/lib/profit";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import type { PaymentMethod } from "@/types";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function RecordPurchasePage() {
  const t = useT();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const companies = useCompaniesStore((s) => s.companies);
  const products = useProductsStore((s) => s.products);

  const [searchParams] = useSearchParams();
  const presetCompanyId = searchParams.get("companyId") || "";
  // Creating the missing supplier from this form must come back to this form.
  const supplierHint = dependencyHint("supplier", t, {
    base: "/admin",
    returnTo: "/admin/purchases/new",
  });
  const [companyId, setCompanyId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  /**
   * The third way to say the same price, and the one a shopkeeper actually negotiates in:
   * "I want 25% on this delivery". Derived from the two prices like everywhere else in the
   * app (see `src/lib/profit.ts`), so it can never end up disagreeing with what is saved.
   */
  const [markup, setMarkup] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);
  const submissionKeyRef = useRef<string | null>(null);
  const [sheet, setSheet] = useState<null | "company" | "product">(null);

  // Pre-select company when coming from Company Detail (Order Stock)
  useEffect(() => {
    if (presetCompanyId && companies.length > 0) {
      setCompanyId(presetCompanyId);
    }
  }, [presetCompanyId, companies]);

  const company = companies.find((c) => c.id === companyId);
  // Products supplied by the chosen company (Product.company is the company name).
  const companyProducts = useMemo(
    () => (company ? products.filter((p) => p.company === company.name) : []),
    [company, products],
  );
  const product = products.find((p) => p.id === productId);
  const variant = product?.variants.find((v) => v.id === variantId);

  const qtyNum = Number(qty) || 0;
  const costNum = Number(costPrice) || 0;
  const total = qtyNum * costNum;
  const paidNum = amountPaid === "" ? total : Math.min(Number(amountPaid) || 0, total);
  const payable = Math.max(0, total - paidNum);

  const productSheetOptions = useMemo(() => companyProducts.map((p) => {
    const th = p.variants[0]?.lowStockThreshold ?? 5;
    const isLow = p.stockQty <= th;
    const vCount = p.variants.length;
    const vLabel = vCount !== 1 ? t("common.variantsCount", { count: String(vCount) }) : t("common.variantOne", { count: String(vCount) });
    // A pack is counted in items, not in kilos: twelve five-kilo bags are twelve items on the
    // shelf, and calling that "12 kg" was the same mislabel this sweep removes.
    const stockLabel = vLabel + " \u00b7 " + t("common.itemsInStock", { count: String(p.stockQty) }) + (isLow ? " \u00b7 " + t("common.lowStock") : "");
    return { value: p.id, label: p.name + (isLow ? " \u26a0\ufe0f" : ""), sub: stockLabel, imageUrl: p.imageUrl };
  }), [companyProducts, t]);

  function pickVariant(id: string) {
    setVariantId(id);
    const v = product?.variants.find((x) => x.id === id);
    if (v) {
      setCostPrice(String(v.costPrice));
      setSellingPrice(String(v.sellingPrice));
      setMarkup(markupPercent(v.costPrice, v.sellingPrice));
    }
  }

  /** A price was typed: the markup follows the prices, which are the source of truth. */
  function changePrice(next: { costPrice?: string; sellingPrice?: string }) {
    const cost = next.costPrice ?? costPrice;
    const sell = next.sellingPrice ?? sellingPrice;
    if (next.costPrice !== undefined) setCostPrice(cost);
    if (next.sellingPrice !== undefined) setSellingPrice(sell);
    setMarkup(markupPercent(Number(cost), Number(sell)));
  }

  /**
   * The percentage was typed: it writes the selling price against the cost of this delivery.
   * With no cost entered there is nothing to measure it against, so the price is left exactly
   * as typed and the hint under the field says why nothing moved.
   */
  function changeMarkup(value: string) {
    setMarkup(value);
    const next = sellingFromMarkup(Number(costPrice), value);
    if (next.sellingPrice !== null) setSellingPrice(next.sellingPrice);
  }

  async function handleSave() {
    setError("");
    if (!company) { setError(t("copy.selectSupplier")); return; }
    if (!product || !variant) { setError(t("copy.selectProductAndUnit")); return; }
    if (qtyNum <= 0) { setError(t("copy.enterQty")); return; }
    if (costNum <= 0) { setError(t("copy.enterPurchaseCost")); return; }

    // A ref, not `loading`: React batches, so two taps in one task both read the
    // pre-render `false` and one delivery is received twice — stock up twice, the
    // supplier's payable up twice, two purchase records.
    if (savingRef.current) return;
    savingRef.current = true;
    // One key per attempt, held across a retry: the attempt may have reached the
    // database and only the answer been lost, so a retry must be recognised as the
    // same delivery rather than a second one (0140 claims it in the database).
    if (!submissionKeyRef.current) submissionKeyRef.current = crypto.randomUUID();
    setLoading(true);
    try {
      await rpcCreatePurchase({
        companyId: company.id,
        companyName: company.name,
        paymentMethod: method,
        amountPaid: paidNum,
        note: "",
        idempotencyKey: submissionKeyRef.current,
        items: [{
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          variantName: variant.name,
          qty: qtyNum,
          costPrice: costNum,
          // Sends the current selling price on, so a delivery can also re-price the
          // product. Omitted when left blank or zero: the database then keeps the
          // existing price instead of overwriting it with 0.
          ...(Number(sellingPrice) > 0 ? { sellingPrice: Number(sellingPrice) } : {}),
        }],
      });

      // Done: this attempt's key retires, so a later delivery is a new purchase.
      submissionKeyRef.current = null;

      // The delivery moved the supplier's payable (and the stock it bought), and both live in a
      // store the shell loaded once. Refresh the suppliers here — the screen this navigates to is
      // the purchases list, which refetches on mount, but Payments and Alerts read the store and
      // would otherwise show the payable from before the delivery.
      await useCompaniesStore.getState().load();

      addToast(t("copy.stockedPurchase", { qty: String(qtyNum), variant: variant.name, amount: formatCurrency(total) }), "success");
      navigate("/admin/purchases", { replace: true });
    } catch (e) {
      // The key is KEPT on failure: the retry must not be treated as a new delivery.
      setError(e instanceof Error ? e.message : t("errors.recordPurchaseFailed"));
    } finally {
      savingRef.current = false;
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--field-bg)",
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
        <NavHeader title={presetCompanyId ? t("company.orderStock") : t("purchases.recordStockPurchase")} />

        <div className="flex flex-col gap-5 p-4">
          {/* Supplier */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("supplier.selectLabel")}</p>
            {presetCompanyId ? (
              <div className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm flex items-center" style={{ ...fieldStyle, opacity: 0.8 }}>
                <span style={{ color: "var(--text-primary)" }}>{company?.name || t("common.loading")}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSheet("company")}
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none flex items-center justify-between"
                style={fieldStyle}
              >
                <span style={{ color: company ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {company ? company.name : t("supplier.selectSupplier")}
                </span>
                <ChevronDown size={16} style={{ color: "var(--text-secondary)" }} />
              </button>
            )}
          </div>

          {/* Low-stock alert for this supplier */}
          {company && companyProducts.some(p => p.stockQty <= (p.variants[0]?.lowStockThreshold ?? 5)) && (
            <div className="flex items-center gap-2 rounded-[var(--radius-card)] p-3" style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)" }}>
              <AlertTriangle size={16} style={{ color: "#d97706" }} />
              <p className="text-xs" style={{ color: "#92400e" }}>
                {companyProducts.filter(p => p.stockQty <= (p.variants[0]?.lowStockThreshold ?? 5)).length} product(s) from this supplier need restocking
              </p>
            </div>
          )}

          {/* Product */}
          {company && (
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.product")}</p>
              {companyProducts.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  No products linked to {company.name} yet. Add the product first.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setSheet("product")}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none flex items-center justify-between"
                  style={fieldStyle}
                >
                  <span style={{ color: product ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {product ? product.name : "Select product…"}
                  </span>
                  <ChevronDown size={16} style={{ color: "var(--text-secondary)" }} />
                </button>
              )}
            </div>
          )}

          {/* Variant */}
          {product && (
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("admin.unitVariant")}</p>
              <div className="flex flex-col gap-2">
                {product.variants.map((v) => {
                  const selected = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      onClick={() => pickVariant(v.id)}
                      className="flex items-center justify-between p-3.5 rounded-[var(--radius-card)] text-start transition-colors"
                      style={{ background: "var(--surface)", border: `1.5px solid ${selected ? "var(--brand)" : "var(--divider)"}` }}
                    >
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("common.itemsInStock", { count: String(v.stockQty) })}</p>
                      </div>
                      <div
                        className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                        style={{ borderColor: selected ? "var(--brand)" : "var(--text-secondary)" }}
                      >
                        {selected && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity + pricing */}
          {variant && (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("admin.quantity")}</p>
                  <input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)}
                    placeholder="0" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
                </div>
                <div className="flex-1">
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("admin.baseCostUnit")}</p>
                  <input type="number" inputMode="numeric" value={costPrice} onChange={(e) => changePrice({ costPrice: e.target.value })}
                    data-testid="purchase-cost"
                    placeholder="0" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
                </div>
              </div>

              {/* Selling price and the markup that produced it, side by side: they are the same
                  number said two ways, and whichever one is typed re-states the other. The
                  markup is derived, never saved — the two prices are what the database keeps. */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("admin.sellingPriceUnit")} <span style={{ opacity: 0.6 }}>{t("common.current")}</span></p>
                  <input type="number" inputMode="numeric" value={sellingPrice} onChange={(e) => changePrice({ sellingPrice: e.target.value })}
                    data-testid="purchase-selling-price"
                    placeholder="0" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
                </div>
                <div className="flex-1">
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("addProduct.markup")}</p>
                  <input type="number" inputMode="decimal" value={markup} onChange={(e) => changeMarkup(e.target.value)}
                    data-testid="purchase-markup"
                    placeholder="%" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
                  {!(costNum > 0) && (
                    <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }} data-testid="purchase-markup-hint">
                      {t("addProduct.markupNeedsCost")}
                    </p>
                  )}
                </div>
              </div>

              {/* Payment */}
              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("purchase.amountPaidNow")}</p>
                <input type="number" inputMode="numeric" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder={formatCurrency(total)} className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
              </div>

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("sale.paymentMethod")}</p>
                <div className="flex gap-2">
                  {([{ key: "cash", label: "Cash" }, { key: "bank_transfer", label: "Bank Transfer" }] as const).map((m) => (
                    <button key={m.key} onClick={() => setMethod(m.key)}
                      className="flex-1 h-11 rounded-full text-sm font-semibold transition-colors"
                      style={{
                        background: method === m.key ? "var(--brand)" : "var(--surface-2)",
                        color: method === m.key ? "#0a0a0a" : "var(--text-secondary)",
                        border: method === m.key ? "none" : "1px solid var(--divider)",
                      }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
                <Row label={t("purchases.purchaseTotal")} value={formatCurrency(total)} />
                <Row label={t("purchases.paidNow")} value={formatCurrency(paidNum)} />
                <div className="h-px my-2" style={{ background: "var(--divider)" }} />
                <Row label={t("supplier.newPayable")} value={formatCurrency(payable)} bold highlight={payable > 0} />
              </div>
            </>
          )}

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading || !variant || qtyNum <= 0}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? t("common.saving") : t("purchases.saveAndAdd")}
        </button>
      </div>

      <SelectSheet
        open={sheet === "company"}
        title={t("supplier.selectSupplier")}
        searchable
        options={companies.map((c) => ({
          value: c.id,
          label: c.name,
          sub: c.outstandingPayable > 0
            ? t("common.payableAmount", { amount: formatCurrency(c.outstandingPayable) })
            : undefined,
        }))}
        selected={companyId}
        emptyLabel={supplierHint.title}
        /* A purchase cannot be recorded without a supplier, so the empty picker gave
           the user nowhere to go. Tertiary, because the purchase form is the main
           task here; on return the new supplier is preselected from the URL. */
        emptyAction={
          supplierHint.action
            ? { label: supplierHint.action.label, onClick: () => navigate(supplierHint.action!.to) }
            : undefined
        }
        onSelect={(id) => { setCompanyId(id); setProductId(""); setVariantId(""); }}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        open={sheet === "product"}
        title={t("purchases.selectProduct")}
        searchable
        options={productSheetOptions}
        selected={productId}
        emptyLabel={company
          ? t("purchases.noProductsForSupplier", { name: company.name })
          : t("purchases.selectSupplierFirst")}
        onSelect={(id) => { setProductId(id); setVariantId(""); }}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

function Row({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className={bold ? "text-sm font-bold" : "text-sm"} style={{ color: highlight ? "var(--error)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
