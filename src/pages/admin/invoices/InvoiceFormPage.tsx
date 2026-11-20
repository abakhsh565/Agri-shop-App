import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Eye, Package, Plus, Trash2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import DateField from "@/components/ui/DateField";
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
import { loadBusinessProfile } from "@/lib/businessProfile";
import { resolveImageUrl } from "@/lib/storage";
import { useShopStore } from "@/stores/shopStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import {
  createInvoice,
  getInvoice,
  invoiceTotals,
  nextInvoiceNumber,
  PAGE_DESIGNS,
  updateInvoice,
  type Invoice,
  type InvoiceDesign,
  type InvoiceDiscountType,
  type InvoicePartyType,
  type InvoiceType,
} from "@/lib/invoices";
import { INVOICE_DESIGN_KEYS } from "@/lib/invoiceDesignLabels";
import { loadInvoiceSettings } from "@/lib/invoiceSettings";
import InvoiceSheet, { InvoiceDesignThumb, type ShopIdentity } from "@/components/invoices/InvoiceSheet";

interface Line {
  key: string;
  description: string;
  qty: string;
  unitPrice: string;
  productId: string | null;
}

const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  description: "",
  qty: "1",
  unitPrice: "",
  productId: null,
});

const toNum = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Writing a bill.
 *
 * The screen asks **why** before it asks who: a counter sale, a credit (udhaar) bill, a service bill
 * or a one-off charge. The answer is what changes the rest of the form — a credit bill needs a
 * customer to chase and a due date, a service bill has no stock and usually no tax, a counter sale is
 * paid as it is written. Party comes second because it follows from the purpose.
 *
 * One discount, not two. The line-level discount that used to sit on every row and the bill-level one
 * below them asked the same question twice; the bill-level control keeps its Rs / % choice and does
 * both jobs, and the line's own `discount` column stays for rows written before this screen changed.
 */
export default function InvoiceFormPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();

  const { invoiceId } = useParams<{ invoiceId: string }>();
  const isEdit = Boolean(invoiceId);

  const activeShopName = useShopStore((s) => s.activeShopName);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const companies = useCompaniesStore((s) => s.companies);
  const employees = useEmployeesStore((s) => s.employees);

  const [invoiceType, setInvoiceType] = useState<InvoiceType>("sale");
  const [partyType, setPartyType] = useState<InvoicePartyType>("customer");
  const [partyId, setPartyId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [design, setDesign] = useState<InvoiceDesign>("royal");
  const [loading, setLoading] = useState(isEdit);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [issuedOn, setIssuedOn] = useState(pkToday());
  const [dueDate, setDueDate] = useState("");
  const [nextNumber, setNextNumber] = useState("INV-001");
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [shop, setShop] = useState<ShopIdentity>({ name: activeShopName ?? "", phone: null, address: null, logoUrl: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  // A new bill starts on the shop's own paper. The settings screen is where that choice lives;
  // this screen only asks once, and only when there is no stored design to edit.
  useEffect(() => {
    if (isEdit) return;
    let alive = true;
    loadInvoiceSettings(activeShopId)
      .then((loaded) => {
        if (alive && !loaded.design.startsWith("receipt-")) setDesign(loaded.design);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isEdit, activeShopId]);

  // The number the next save will write, so the field says the bill's name instead of "assigned".
  useEffect(() => {
    if (isEdit) return;
    let alive = true;
    nextInvoiceNumber()
      .then((value) => {
        if (alive) setNextNumber(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isEdit]);

  useEffect(() => {
    let alive = true;
    loadBusinessProfile()
      .then((profile) => {
        if (!alive || !profile) return;
        setShop({
          name: profile.shop.name ?? activeShopName ?? "",
          phone: profile.shop.phone ?? profile.shop.whatsapp_phone ?? null,
          address: profile.shop.address ?? null,
          logoUrl: resolveImageUrl(profile.shop.logo_url) ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeShopName]);

  useEffect(() => {
    if (!invoiceId) return;
    let alive = true;
    getInvoice(invoiceId)
      .then((inv) => {
        if (!alive) return;
        setInvoiceType(inv.invoice_type ?? "sale");
        setPartyType(inv.party_type ?? "customer");
        setPartyId(inv.party_id ?? "");
        setCustomerId(inv.customer_id ?? "");
        setDesign(inv.design ?? "royal");
        setName(inv.customer_name);
        setPhone(inv.customer_phone ?? "");
        setAddress(inv.customer_address ?? "");
        setIssuedOn(inv.issued_on);
        setDueDate(inv.due_date ?? "");
        setNextNumber(inv.invoice_number);
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

  const totals = useMemo(
    () =>
      invoiceTotals({
        lines: lines.map((l) => ({ qty: toNum(l.qty), unitPrice: toNum(l.unitPrice) })),
        discountType,
        discountValue: toNum(discountValue),
        taxRate: toNum(taxRate),
      }),
    [lines, discountType, discountValue, taxRate],
  );

  const paid = Math.min(toNum(amountPaid), totals.total);
  const balance = Math.max(totals.total - paid, 0);
  const needsCustomer = invoiceType === "credit";

  /** The bill as it stands, for the preview — the same shape the print screen prints. */
  const draft: Invoice = useMemo(
    () => ({
      id: invoiceId ?? "draft",
      invoice_number: nextNumber,
      customer_id: partyType === "customer" ? customerId || null : null,
      party_type: partyType,
      party_id: partyId || null,
      invoice_type: invoiceType,
      design,
      customer_name: name.trim() || t("invoice.namePlaceholder"),
      customer_phone: phone.trim() || null,
      customer_address: address.trim() || null,
      issued_on: issuedOn,
      due_date: dueDate || null,
      discount_type: discountType,
      discount_value: toNum(discountValue),
      tax_rate: toNum(taxRate),
      subtotal: totals.subtotal,
      discount_amount: totals.discount,
      tax_amount: totals.tax,
      total: totals.total,
      amount_paid: paid,
      payment_method: paymentMethod,
      status: paid >= totals.total && totals.total > 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
      notes: notes.trim() || null,
      terms: terms.trim() || null,
      created_at: new Date().toISOString(),
      items: lines
        .filter((l) => l.description.trim() || toNum(l.unitPrice) > 0)
        .map((l) => ({
          product_id: l.productId,
          description: l.description.trim() || t("invoice.item"),
          qty: toNum(l.qty) || 1,
          unit_price: toNum(l.unitPrice),
          discount: 0,
          line_total: Math.round((toNum(l.qty) || 1) * toNum(l.unitPrice) * 100) / 100,
        })),
    }),
    [invoiceId, nextNumber, partyType, customerId, partyId, invoiceType, design, name, phone, address, issuedOn, dueDate, discountType, discountValue, taxRate, totals, paid, paymentMethod, notes, terms, lines, t],
  );

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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

  /** Choosing a purpose sets what that purpose implies; nothing it fills is locked. */
  function choosePurpose(next: InvoiceType) {
    setInvoiceType(next);
    if (next === "credit") {
      choosePartyType("customer");
    } else if (next === "other") {
      choosePartyType("supplier");
    } else {
      choosePartyType("customer");
    }
    if (next === "service") {
      setTaxRate("");
      setDiscountValue("");
    }
    if (next === "credit") {
      setAmountPaid("");
      setDueDate((current) => current || addDays(issuedOn, 30));
    }
    if (next === "sale") {
      setAmountPaid(String(totals.total || ""));
      setDueDate("");
    }
  }

  const partyOptions = useMemo(() => {
    // Every row carries the record's own picture, whatever kind it is: a customer's photo, a
    // supplier's logo, a member of staff's photo. The picker reads them from the same stores the
    // rest of the app does, so a picture changed anywhere is the picture shown here (owner,
    // 2026-11-17). Rows with none fall back to initials, as everywhere else.
    if (partyType === "customer") {
      return customers
        .filter((c) => !c.isArchived)
        .map((c) => ({ value: c.id, label: c.name, meta: c.phone, imageUrl: c.imageUrl }));
    }
    if (partyType === "supplier") {
      return companies.map((c) => ({ value: c.id, label: c.name, meta: c.phone, imageUrl: c.logoUrl }));
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
      productId: product.id,
    };
    setLines((prev) => {
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
    if (needsCustomer && !customerId) {
      setError(t("invoice.customerRequiredForCredit"));
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
      invoiceType,
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

      {/* 1. Why this paper exists. It decides the rest of the form. */}
      <section className="px-4 pt-1">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.purpose")}</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "sale" as InvoiceType, title: "invoice.purposeSale", hint: "invoice.purposeSaleHint" },
              { id: "credit" as InvoiceType, title: "invoice.purposeCredit", hint: "invoice.purposeCreditHint" },
              { id: "service" as InvoiceType, title: "invoice.purposeService", hint: "invoice.purposeServiceHint" },
              { id: "other" as InvoiceType, title: "invoice.purposeOther", hint: "invoice.purposeOtherHint" },
            ] as const
          ).map((option) => {
            const on = invoiceType === option.id;
            return (
              <button
                key={option.id}
                onClick={() => choosePurpose(option.id)}
                aria-pressed={on}
                className="text-start p-3 rounded-[var(--radius-tile)] ds-pressable"
                style={{
                  background: "var(--surface-2)",
                  border: `1.5px solid ${on ? "var(--brand-dark)" : "transparent"}`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>{t(option.title)}</span>
                  {on && <Check size={14} style={{ color: "var(--brand-dark)" }} />}
                </div>
                <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{t(option.hint)}</p>
              </button>
            );
          })}
        </div>
        {invoiceType === "other" && (
          <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>{t("invoice.otherHint")}</p>
        )}
      </section>

      {/* 2. Who it is for. */}
      <section className="px-4 pt-5">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.billTo")}</p>
        {invoiceType === "other" && (
          <div className="flex items-center gap-1 p-1 rounded-[var(--radius-tile)] mb-3" style={{ background: "var(--surface-2)" }}>
            {(["supplier", "employee", "other"] as InvoicePartyType[]).map((kind) => (
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
                {kind === "supplier" ? t("invoice.partySupplier") : kind === "employee" ? t("invoice.partyEmployee") : t("invoice.partyOther")}
              </button>
            ))}
          </div>
        )}
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
        {invoiceType === "sale" && (
          <button
            onClick={() => {
              setName("Walk-in customer");
              setPhone("");
              setAddress("");
              setPartyId("");
              setCustomerId("");
            }}
            className="mt-2 text-12 font-semibold ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            {t("invoice.walkInParty")}
          </button>
        )}
        <div className="mt-3 flex flex-col gap-3">
          <Input label={t("invoice.name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("invoice.namePlaceholder")} />
          <div className="flex flex-col gap-3">
            <Input label={t("invoice.phone")} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0301 2345678" />
            <Input label={t("invoice.address")} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("invoice.optional")} />
          </div>
        </div>
      </section>

      {/* 3. The number and the dates. */}
      <section className="px-4 pt-5">
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>{t("invoice.number")}</span>
            <div
              className="h-11 px-4 flex items-center rounded-[var(--radius-field,var(--radius-tile))] text-14 font-semibold tabular-nums"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
              data-testid="invoice-next-number"
            >
              {nextNumber}
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
          {invoiceType === "credit" && !dueDate && (
            <p className="text-11" style={{ color: "var(--warning)" }}>{t("invoice.creditNeedsDue")}</p>
          )}
        </div>
      </section>

      {/* 4. The goods or the work. */}
      <section className="px-4 pt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {invoiceType === "service" ? t("invoice.work") : t("invoice.items")}
          </p>
          <button
            onClick={() => setStockOpen(true)}
            className="text-12 font-semibold flex items-center gap-1 ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            <Package size={14} /> {t("invoice.addFromStock")}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line) => {
            const amount = Math.max(toNum(line.qty) * toNum(line.unitPrice), 0);
            return (
              <div key={line.key} className="rounded-[var(--radius-tile)] p-3" style={{ background: "var(--surface-2)" }}>
                <div className="flex items-center gap-2">
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder={invoiceType === "service" ? t("invoice.workPlaceholder") : t("invoice.itemPlaceholder")}
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
                <div className="grid grid-cols-2 gap-2 mt-2">
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
                </div>
                <p className="text-11 tabular-nums mt-1.5 text-end" style={{ color: "var(--text-secondary)" }}>
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
          <Plus size={15} /> {invoiceType === "service" ? t("invoice.addWork") : t("invoice.addItem")}
        </button>
      </section>

      {/* 5. One discount, on the bill, with the Rs / % choice it always had. */}
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

      {/* 6. What it adds up to. */}
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

      {/* 7. Money received now. */}
      <section className="px-4 pt-5">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.amountPaid")}</p>
        {/* The field and its two shortcuts on one line, the way the paper reads: type what was
            handed over, or say "all of it" / "none of it". The shortcuts never wrap — a wrapped
            "Mark fully paid" over three lines was taller than the field it belongs to. */}
        <div className="flex gap-2 items-end">
          <Input
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label={t("invoice.amountPaid")}
          />
          <div className="flex gap-1.5 shrink-0 pb-0.5">
            <button
              onClick={() => setAmountPaid(String(totals.total))}
              className="h-9 px-3 rounded-full text-11 font-semibold whitespace-nowrap ds-pressable"
              style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "transparent" }}
            >
              {t("invoice.markPaid")}
            </button>
            <button
              onClick={() => setAmountPaid("")}
              className="h-9 px-2 text-11 font-semibold whitespace-nowrap ds-pressable"
              style={{ color: "var(--text-secondary)", background: "transparent" }}
            >
              {t("invoice.markUnpaid")}
            </button>
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

      {/* 8. The foot of the paper. */}
      <section className="px-4 pt-5 flex flex-col gap-3">
        <Input label={t("invoice.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("invoice.notesPlaceholder")} />
        <Input label={t("invoice.terms")} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={t("invoice.optional")} />
      </section>

      {/* 9. The paper it prints on — the card shows the design itself, not an icon of it. */}
      <section className="px-4 pt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("invoice.design")}</p>
          <button
            onClick={() => setPreviewOpen(true)}
            className="text-12 font-semibold flex items-center gap-1 ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            <Eye size={14} /> {t("invoice.preview")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PAGE_DESIGNS.map((option) => (
            <button
              key={option}
              onClick={() => {
                setDesign(option);
                setPreviewOpen(true);
              }}
              aria-pressed={design === option}
              className="flex flex-col items-center gap-1.5 p-2 rounded-[var(--radius-tile)] text-center ds-pressable"
              style={{
                background: "var(--surface-2)",
                border: `1.5px solid ${design === option ? "var(--brand-dark)" : "transparent"}`,
              }}
              data-testid={`invoice-form-design-${option}`}
            >
              <InvoiceDesignThumb design={option} sample={{ ...draft, design: option }} shop={shop} width={54} height={70} />
              <span className="text-11 font-semibold" style={{ color: "var(--text-primary)" }}>
                {t(INVOICE_DESIGN_KEYS[option])}
              </span>
              {design === option && <Check size={14} style={{ color: "var(--brand-dark)" }} />}
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
      </div>

      {/* Stock picker */}
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

      {/* Live preview of this bill on the chosen paper. */}
      <Sheet open={previewOpen} title={t("invoice.preview")} onClose={() => setPreviewOpen(false)}>
        <div className="px-3 pb-6">
          <InvoiceSheet invoice={{ ...draft, design }} shop={shop} design={design} />
        </div>
      </Sheet>
    </div>
  );
}

function addDays(iso: string, days: number): string {
  const base = new Date(`${iso}T00:00:00`);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}
