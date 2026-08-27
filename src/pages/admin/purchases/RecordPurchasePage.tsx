import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SelectSheet from "@/components/ui/SelectSheet";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { rpcCreatePurchase } from "@/lib/db";
import { formatCurrency } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import type { PaymentMethod } from "@/types";
import { ChevronDown } from "lucide-react";

export default function RecordPurchasePage() {
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const companies = useCompaniesStore((s) => s.companies);
  const products = useProductsStore((s) => s.products);

  const [companyId, setCompanyId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState<null | "company" | "product">(null);

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

  function pickVariant(id: string) {
    setVariantId(id);
    const v = product?.variants.find((x) => x.id === id);
    if (v) {
      setCostPrice(String(v.costPrice));
      setSellingPrice(String(v.sellingPrice));
    }
  }

  async function handleSave() {
    setError("");
    if (!company) { setError("Select a supplier."); return; }
    if (!product || !variant) { setError("Select a product and variant."); return; }
    if (qtyNum <= 0) { setError("Enter a quantity greater than zero."); return; }
    if (costNum <= 0) { setError("Enter the purchase (base) cost."); return; }

    setLoading(true);
    try {
      await rpcCreatePurchase({
        companyId: company.id,
        companyName: company.name,
        paymentMethod: method,
        amountPaid: paidNum,
        note: "",
        items: [{
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          variantName: variant.name,
          qty: qtyNum,
          costPrice: costNum,
        }],
      });

      addToast(`Stocked ${qtyNum} × ${variant.name} · ${formatCurrency(total)}`, "success");
      navigate("/admin/purchases", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record purchase. Please try again.");
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
        <NavHeader title="Record Stock Purchase" />

        <div className="flex flex-col gap-5 p-4">
          {/* Supplier */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Supplier / Company</p>
            <button
              type="button"
              onClick={() => setSheet("company")}
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none flex items-center justify-between"
              style={fieldStyle}
            >
              <span style={{ color: company ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {company ? company.name : "Select supplier…"}
              </span>
              <ChevronDown size={16} style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>

          {/* Product */}
          {company && (
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Product</p>
              {companyProducts.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  No products linked to {company.name} yet. Add the product first.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setSheet("product")}
                  className="w-full h-12 rounded-[24px] px-4 text-sm outline-none flex items-center justify-between"
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
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Unit / Variant</p>
              <div className="flex flex-col gap-2">
                {product.variants.map((v) => {
                  const selected = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      onClick={() => pickVariant(v.id)}
                      className="flex items-center justify-between p-3.5 rounded-[14px] text-left transition-colors"
                      style={{ background: "var(--surface)", border: `1.5px solid ${selected ? "var(--brand)" : "var(--divider)"}` }}
                    >
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{product.stockQty} {product.baseUnit} in stock</p>
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
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Quantity</p>
                  <input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)}
                    placeholder="0" className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
                </div>
                <div className="flex-1">
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Base Cost / unit</p>
                  <input type="number" inputMode="numeric" value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="0" className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
                </div>
              </div>

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Selling Price / unit <span style={{ opacity: 0.6 }}>(current)</span></p>
                <input type="number" inputMode="numeric" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="0" className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
              </div>

              {/* Payment */}
              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Amount Paid Now</p>
                <input type="number" inputMode="numeric" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder={formatCurrency(total)} className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
              </div>

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Payment Method</p>
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
              <div className="rounded-[14px] p-4" style={{ background: "var(--surface-2)" }}>
                <Row label="Purchase total" value={formatCurrency(total)} />
                <Row label="Paid now" value={formatCurrency(paidNum)} />
                <div className="h-px my-2" style={{ background: "var(--divider)" }} />
                <Row label="New supplier payable" value={formatCurrency(payable)} bold highlight={payable > 0} />
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
          {loading ? "Saving…" : "Save & Add to Inventory"}
        </button>
      </div>

      <SelectSheet
        open={sheet === "company"}
        title="Select supplier"
        searchable
        options={companies.map((c) => ({ value: c.id, label: c.name, sub: c.outstandingPayable > 0 ? `Payable: ${formatCurrency(c.outstandingPayable)}` : undefined }))}
        selected={companyId}
        emptyLabel="No companies yet. Add a company first."
        onSelect={(id) => { setCompanyId(id); setProductId(""); setVariantId(""); }}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        open={sheet === "product"}
        title="Select product"
        searchable
        options={companyProducts.map((p) => ({ value: p.id, label: p.name, sub: `${p.variants.length} variant${p.variants.length !== 1 ? "s" : ""} · ${p.stockQty} ${p.baseUnit} in stock`, imageUrl: p.imageUrl }))}
        selected={productId}
        emptyLabel={company ? `No products linked to ${company.name} yet.` : "Select a supplier first."}
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
