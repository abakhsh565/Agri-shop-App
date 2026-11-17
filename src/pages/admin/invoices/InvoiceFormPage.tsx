import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Package, Plus, Trash2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import DateField, { displayDate } from "@/components/ui/DateField";
import SelectorField from "@/components/ui/SelectorField";
import Sheet from "@/components/ui/Sheet";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCustomersStore } from "@/stores/customersStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import {
  createInvoice,
  getInvoice,
  invoiceTotals,
  updateInvoice,
  type InvoiceDesign,
  type InvoiceDiscountType,
  type InvoicePartyType,
} from "@/lib/invoices";

interface Line {
  key: string;
  description: string;
  qty: string;
  unitPrice: string;
  discount: string;
  productId: string | null;
}

const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  description: "",
  qty: "1",
  unitPrice: "",
  discount: "",
  productId: null,
});

const toNum = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Writing a bill.
 *
 * The screen follows the paper it replaces: who it is for, the number and the dates, the goods, the
 * discount and tax, what has been paid now, and the note at the bottom. Two things are deliberately
 * unlike a paper pad: the number is assigned by the shop's own series when it is saved (`INV-0001`),
 * and the customer is optional — a walk-in asking for a proper bill still gets one, and the name on
 * it is simply typed.
 */
export default function InvoiceFormPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();

  const { invoiceId } = useParams<{ invoiceId: string }>();
  const isEdit = Boolean(invoiceId);

  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const companies = useCompaniesStore((s) => s.companies);
  const employees = useEmployeesStore((s) => s.employees);

  /**
   * A bill can be raised for anyone the shop deals with. The type decides which record is offered
   * and which table the id comes from; the name on the paper is copied either way, so a bill for a
   * supplier's driver still prints his name after the record is renamed.
   */
  const [partyType, setPartyType] = useState<InvoicePartyType>("customer");
  const [partyId, setPartyId] = useState("");
  const [design, setDesign] = useState<InvoiceDesign>("royal");
  const [loading, setLoading] = useState(isEdit);
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [issuedOn, setIssuedOn] = useState(pkToday());
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [discountType, setDiscountType] = useState<InvoiceDiscountType>("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  const [stockOpen, setStockOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const totals = useMemo(
    () =>
      invoiceTotals({
        lines: lines.map((l) => ({ qty: toNum(l.qty), unitPrice: toNum(l.unitPrice), discount: toNum(l.discount) })),
        discountType,
        discountValue: toNum(discountValue),
        taxRate: toNum(taxRate),
      }),
    [lines, discountType, discountValue, taxRate],
  );

  const paid = Math.min(toNum(amountPaid), totals.total);
  const balance = Math.max(totals.total - paid, 0);

  // Opening an existing bill: the fields come back exactly as the paper says them.
  useEffect(() => {
    if (!invoiceId) return;
    let alive = true;
    getInvoice(invoiceId)
      .then((inv) => {
        if (!alive) return;
        setPartyType(inv.party_type ?? "customer");
        setPartyId(inv.party_id ?? "");
        setCustomerId(inv.customer_id ?? "");
        setDesign(inv.design ?? "royal");
        setName(inv.customer_name);
        setPhone(inv.customer_phone ?? "");
        setAddress(inv.customer_address ?? "");
        setIssuedOn(inv.issued_on);
        setDueDate(inv.due_date ?? "");
        setDiscountType(inv.discount_type);
        setDiscountValue(inv.discount_value ? String(inv.discount_value) : "");
        setTaxRate(inv.tax_rate ? String(inv.tax_rate) : "");
        setAmountPaid(inv.amount_paid ? String(inv.amount_paid) : "");
        setPaymentMethod(inv.payment_method === "bank_transfer" ? "bank_transfer" : "cash");
        setNotes(inv.notes ?? "");
        setTerms(inv.terms ?? "");
        setLines(
          (inv.items ?? []).map((it) => ({
            key: crypto.randomUUID(),
            description: it.description,
            qty: String(it.qty),
            unitPrice: String(it.unit_price),
            discount: it.discount ? String(it.discount) : "",
            productId: it.product_id,
          })),
        );
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [invoiceId]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function chooseParty(id: string) {
    setPartyId(id);
    if (partyType === "customer") {
      setCustomerId(id);
      const c = customers.find((x) => x.id === id);
      if (c) {
        setName(c.name);
        setPhone(c.phone ?? "");
        setAddress(c.address ?? "");
      }
      return;
    }
    setCustomerId("");
    if (partyType === "supplier") {
      const c = companies.find((x) => x.id === id);
      if (c) {
        setName(c.name);
        setPhone(c.phone ?? "");
        setAddress(c.address ?? "");
      }
    } else if (partyType === "employee") {
      const e = employees.find((x) => x.id === id);
      if (e) {
        setName(e.name);
        setPhone(e.phone ?? "");
        setAddress("");
      }
    }
  }

  function choosePartyType(next: InvoicePartyType) {
    setPartyType(next);
    setPartyId("");
    setCustomerId("");
    if (next === "other") {
      setName("");
      setPhone("");
      setAddress("");
    }
  }

  const partyOptions = useMemo(() => {
    if (partyType === "customer") {
      return customers
        .filter((c) => !c.isArchived)
        .map((c) => ({ value: c.id, label: c.name, meta: c.phone }));
    }
    if (partyType === "supplier") {
      return companies.map((c) => ({ value: c.id, label: c.name, meta: c.phone }));
    }
    if (partyType === "employee") {
      return employees.map((e) => ({ value: e.id, label: e.name, meta: e.phone }));
    }
    return [];
  }, [partyType, customers, companies, employees]);

  function addFromStock(productId: string) {
    const product = products.find((p) => p.id === productId);
    const variant = product?.variants[0];
    if (!product || !variant) return;
    const line: Line = {
      key: crypto.randomUUID(),
      description: variant.name && variant.name !== product.name ? `${product.name} · ${variant.name}` : product.name,
      qty: "1",
      unitPrice: String(variant.sellingPrice ?? ""),
      discount: "",
      productId: product.id,
    };
    setLines((prev) => {
      // An empty first row is a placeholder, not a line — reuse it instead of leaving a blank above.
      const rest = prev.filter((l) => l.description.trim() !== "" || l.unitPrice.trim() !== "");
      return [...rest, line];
    });
    setStockOpen(false);
    setStockQuery("");
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError(t("invoice.nameRequired"));
      return;
    }
    const usable = lines.filter((l) => l.description.trim() !== "" || toNum(l.unitPrice) > 0);
    if (usable.length === 0) {
      setError(t("invoice.itemRequired"));
      return;
    }
    if (!keyRef.current) keyRef.current = crypto.randomUUID();
    setSaving(true);
    const body = {
      customerId: partyType === "customer" ? customerId || null : null,
      partyType,
      partyId: partyId || null,
      design,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      customerAddress: address.trim(),
      issuedOn,
      dueDate,
      discountType,
      discountValue: toNum(discountValue),
      taxRate: toNum(taxRate),
      amountPaid: paid,
      paymentMethod,
      notes,
      terms,
      items: usable.map((l) => ({
        description: l.description.trim() || t("invoice.item"),
        qty: toNum(l.qty) || 1,
        unitPrice: toNum(l.unitPrice),
        discount: toNum(l.discount),
        productId: l.productId,
      })),
    };
    try {
      const invoice = isEdit && invoiceId
        ? await updateInvoice(invoiceId, body)
        : await createInvoice({ ...body, idempotencyKey: keyRef.current });
      keyRef.current = null;
      navigate(`${base}/invoices/${invoice.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const stockResults = products
    .filter((p) => p.name.toLowerCase().includes(stockQuery.trim().toLowerCase()))
    .slice(0, 40);

  if (loading) {
    return (
      <div className="flex flex-col bg-background w-full min-h-full">
        <StatusBar />
        <NavHeader title={t("invoice.edit")} />
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background w-full min-h-full pb-8">
      <StatusBar />
      <NavHeader title={isEdit ? t("invoice.edit") : t("invoice.new")} />

      {/* 1. Who it is for. A saved customer fills the three fields from their record; a walk-in is
             typed once and never has to become a customer. */}
      <section className="px-4 pt-1">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.billTo")}</p>
        {/* Who the bill is for: the same paper serves a customer, a supplier, an employee, or
            somebody with no record at all. Picking the type decides which register is searched. */}
        <div className="flex items-center gap-1 p-1 rounded-[var(--radius-tile)] mb-3" style={{ background: "var(--surface-2)" }}>
          {(["customer", "supplier", "employee", "other"] as InvoicePartyType[]).map((kind) => (
            <button
              key={kind}
              onClick={() => choosePartyType(kind)}
              aria-pressed={partyType === kind}
              className="flex-1 py-2 rounded-[var(--radius-tile)] text-12 font-semibold transition-all"
              style={{
                color: partyType === kind ? "var(--text-primary)" : "var(--text-secondary)",
                background: partyType === kind ? "var(--background)" : "transparent",
                boxShadow: partyType === kind ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {kind === "customer"
                ? t("invoice.partyCustomer")
                : kind === "supplier"
                  ? t("invoice.partySupplier")
                  : kind === "employee"
                    ? t("invoice.partyEmployee")
                    : t("invoice.partyOther")}
            </button>
          ))}
        </div>
        {partyType !== "other" && (
          <SelectorField
            value={partyId}
            options={partyOptions}
            placeholder={t("invoice.pickParty")}
            title={t("invoice.billTo")}
            onChange={chooseParty}
            searchable
          />
        )}
        <div className="mt-3 flex flex-col gap-3">
          <Input label={t("invoice.name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("invoice.namePlaceholder")} />
          <div className="flex gap-3">
            <Input label={t("invoice.phone")} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0301 2345678" />
            <Input label={t("invoice.address")} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("invoice.optional")} />
          </div>
        </div>
      </section>

      {/* 2. The number is the shop's series, written when this is saved — not something to type. */}
      <section className="px-4 pt-5">
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>{t("invoice.number")}</span>
            <div
              className="h-11 px-4 flex items-center rounded-[var(--radius-field,var(--radius-tile))] text-14 tabular-nums"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
            >
              {t("invoice.numberOnSave")}
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>{t("invoice.date")}</span>
            <DateField value={issuedOn} onChange={setIssuedOn} />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
            {t("invoice.dueDate")} <span className="font-normal normal-case">{t("invoice.optional")}</span>
          </span>
          <DateField value={dueDate} onChange={setDueDate} min={issuedOn} title={t("invoice.dueDate")} />
        </div>
      </section>

      {/* 3. The goods. */}
      <section className="px-4 pt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("invoice.items")}</p>
          <button
            onClick={() => setStockOpen(true)}
            className="text-12 font-semibold flex items-center gap-1 ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            <Package size={14} /> {t("invoice.addFromStock")}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((line) => {
            const amount = Math.max(toNum(line.qty) * toNum(line.unitPrice) - toNum(line.discount), 0);
            return (
              <div key={line.key} className="rounded-[var(--radius-tile)] p-3" style={{ background: "var(--surface-2)" }}>
                <div className="flex items-center gap-2">
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder={t("invoice.itemPlaceholder")}
                  />
                  <button
                    onClick={() => setLines((prev) => (prev.length === 1 ? [blankLine()] : prev.filter((l) => l.key !== line.key)))}
                    aria-label={t("invoice.removeItem")}
                    className="size-9 shrink-0 rounded-full flex items-center justify-center ds-pressable"
                    style={{ background: "var(--background)", color: "var(--text-secondary)" }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Input
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    inputMode="decimal"
                    placeholder={t("invoice.qty")}
                    aria-label={t("invoice.qty")}
                  />
                  <Input
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                    inputMode="decimal"
                    placeholder={t("invoice.unitPrice")}
                    aria-label={t("invoice.unitPrice")}
                  />
                  <Input
                    value={line.discount}
                    onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                    inputMode="decimal"
                    placeholder={t("invoice.itemDiscount")}
                    aria-label={t("invoice.itemDiscount")}
                  />
                </div>
                <p className="text-11 tabular-nums mt-1 text-end" style={{ color: "var(--text-secondary)" }}>
                  {formatCurrency(amount)}
                </p>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setLines((prev) => [...prev, blankLine()])}
          className="mt-3 text-13 font-semibold flex items-center gap-1.5 ds-pressable"
          style={{ color: "var(--brand-dark)" }}
        >
          <Plus size={15} /> {t("invoice.addItem")}
        </button>
      </section>

      {/* 4. Discount and tax. */}
      <section className="px-4 pt-5">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("invoice.additional")} <span className="font-normal normal-case">{t("invoice.optional")}</span>
        </p>
        <div className="flex items-end gap-2">
          <div className="flex rounded-full p-0.5 shrink-0" style={{ background: "var(--surface-2)" }}>
            {(["amount", "percent"] as InvoiceDiscountType[]).map((kind) => (
              <button
                key={kind}
                onClick={() => setDiscountType(kind)}
                aria-pressed={discountType === kind}
                className="px-3 h-9 rounded-full text-12 font-semibold"
                style={{
                  background: discountType === kind ? "var(--background)" : "transparent",
                  color: discountType === kind ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {kind === "amount" ? "Rs" : "%"}
              </button>
            ))}
          </div>
          <Input
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            inputMode="decimal"
            placeholder={t("invoice.discount")}
            aria-label={t("invoice.discount")}
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            inputMode="decimal"
            placeholder={t("invoice.taxRate")}
            aria-label={t("invoice.taxRate")}
          />
          <span className="text-14" style={{ color: "var(--text-secondary)" }}>%</span>
        </div>
        <p className="text-11 mt-1.5" style={{ color: "var(--text-tertiary)" }}>{t("invoice.taxHint")}</p>
      </section>

      {/* 5. What it adds up to. */}
      <section className="px-4 pt-5">
        <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-2" style={{ background: "var(--surface-2)" }}>
          <div className="flex justify-between text-13" style={{ color: "var(--text-secondary)" }}>
            <span>{t("invoice.subtotal")}</span>
            <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-13" style={{ color: "var(--text-secondary)" }}>
              <span>{t("invoice.discount")}</span>
              <span className="tabular-nums">-{formatCurrency(totals.discount)}</span>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="flex justify-between text-13" style={{ color: "var(--text-secondary)" }}>
              <span>{t("invoice.tax")}</span>
              <span className="tabular-nums">{formatCurrency(totals.tax)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-2 mt-1" style={{ borderTop: "1px solid var(--divider)" }}>
            <span className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>{t("invoice.total")}</span>
            <span className="text-18 font-bold tabular-nums" style={{ color: "var(--text-primary)" }} data-testid="invoice-form-total">
              {formatCurrency(totals.total)}
            </span>
          </div>
          <div className="flex justify-between text-12" style={{ color: "var(--text-secondary)" }}>
            <span>{t("invoice.balanceDue")}</span>
            <span className="tabular-nums">{formatCurrency(balance)}</span>
          </div>
        </div>
      </section>

      {/* 6. Money received now. */}
      <section className="px-4 pt-5">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.amountPaid")}</p>
        <div className="flex gap-3 items-end">
          <Input
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label={t("invoice.amountPaid")}
          />
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setAmountPaid(String(totals.total))}>
              {t("invoice.markPaid")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAmountPaid("")}>
              {t("invoice.markUnpaid")}
            </Button>
          </div>
        </div>
        {paid > 0 && (
          <div className="flex gap-2 mt-3">
            {(["cash", "bank_transfer"] as const).map((method) => (
              <button
                key={method}
                onClick={() => setPaymentMethod(method)}
                aria-pressed={paymentMethod === method}
                className="flex-1 h-10 rounded-full text-13 font-medium ds-pressable"
                style={{
                  border: `1px solid ${paymentMethod === method ? "var(--brand-dark)" : "var(--border)"}`,
                  color: paymentMethod === method ? "var(--brand-dark)" : "var(--text-primary)",
                  background: "transparent",
                }}
              >
                {method === "cash" ? t("invoice.cash") : t("invoice.bankTransfer")}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 7. What the paper says at the bottom. */}
      <section className="px-4 pt-5 flex flex-col gap-3">
        <Input label={t("invoice.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("invoice.notesPlaceholder")} />
        <Input label={t("invoice.terms")} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={t("invoice.optional")} />
      </section>

      {/* The paper it prints on. Chosen here, stored with the bill, so a reprint from the archive
          looks like the copy that was handed over. */}
      <section className="px-4 pt-5">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.design")}</p>
        <div className="flex flex-col gap-2">
          {([
            { id: "atelier" as InvoiceDesign, name: t("invoice.designAtelier"), hint: t("invoice.designAtelierHint") },
            { id: "royal" as InvoiceDesign, name: t("invoice.designRoyal"), hint: t("invoice.designRoyalHint") },
            { id: "aurora" as InvoiceDesign, name: t("invoice.designAurora"), hint: t("invoice.designAuroraHint") },
          ]).map((option) => (
            <button
              key={option.id}
              onClick={() => setDesign(option.id)}
              aria-pressed={design === option.id}
              className="flex items-center gap-3 p-3 rounded-[var(--radius-tile)] text-start ds-pressable"
              style={{
                background: "var(--surface-2)",
                border: `1.5px solid ${design === option.id ? "var(--brand-dark)" : "transparent"}`,
              }}
            >
              <div
                className="size-11 rounded-[var(--radius-sm,6px)] shrink-0"
                style={{
                  background: "var(--background)",
                  border: "1px solid var(--divider)",
                  boxShadow: "inset 0 -14px 0 rgba(0,0,0,0.04)",
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>{option.name}</p>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{option.hint}</p>
              </div>
              {design === option.id && <Check size={16} style={{ color: "var(--brand-dark)" }} />}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <p className="px-4 pt-4 text-12" style={{ color: "var(--error)" }} role="alert">
          {error}
        </p>
      )}

      <div className="px-4 pt-6">
        <Button variant="cta" size="lg" fullWidth loading={saving} disabled={saving} onClick={save}>
          {isEdit ? t("invoice.saveChanges") : t("invoice.save")}
        </Button>
        <p className="text-11 text-center mt-2" style={{ color: "var(--text-tertiary)" }}>
          {dueDate ? `${t("invoice.paymentTerms")}: ${displayDate(dueDate)}` : t("invoice.noDueDate")}
        </p>
      </div>

      <Sheet open={stockOpen} title={t("invoice.addFromStock")} onClose={() => setStockOpen(false)} closeButton={false}>
        <div className="px-4 pb-3">
          <SearchBar value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder={t("invoice.searchStock")} />
        </div>
        {stockResults.length === 0 ? (
          <p className="px-4 py-6 text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("invoice.noStockMatch")}
          </p>
        ) : (
          <ListCard>
            {stockResults.map((p) => {
              const variants = p.variants;
              const price = Math.min(...variants.map((v) => v.sellingPrice).filter((n) => Number.isFinite(n)));
              const stock = variants.reduce((sum, v) => sum + (v.stockQty ?? 0), 0);
              return (
                <ListRow
                  key={p.id}
                  icon={Package}
                  title={p.name}
                  meta={`${stock} ${p.baseUnit ?? ""}`.trim()}
                  value={Number.isFinite(price) ? formatCurrency(price) : ""}
                  onClick={() => addFromStock(p.id)}
                />
              );
            })}
          </ListCard>
        )}
      </Sheet>
    </div>
  );
}
