import { supabase } from "@/lib/supabase";
import { beginScopedWrite } from "@/lib/localCache";

/**
 * The shop's invoices — the paper it gives a customer for goods being paid for later.
 *
 * A sale and an invoice are different records: a sale is money and stock moving, an invoice is the
 * promise that money will move, with a due date and a number the shop wrote on paper. The database
 * side is 0319; the totals are recomputed here only to *show* them before saving — the RPC is the
 * one that decides what is stored.
 */

export type InvoiceStatus = "unpaid" | "partial" | "paid";
export type InvoiceDiscountType = "amount" | "percent";
/** Who the paper bills. The name is copied onto the invoice either way. */
export type InvoicePartyType = "customer" | "supplier" | "employee" | "other";
/**
 * Why the bill exists. The purpose decides the paper: a counter sale is paid now, a credit (udhaar)
 * bill needs somebody to chase, a service bill has no stock behind it.
 */
export type InvoiceType = "sale" | "credit" | "service" | "other";
/**
 * The paper layouts.
 *
 * The first three are the original A4 sheets; the next six are the alternatives the owner asked
 * for, and the four `receipt-*` presets are the 80 mm thermal receipt. A design is stored per
 * invoice so a reprint looks like the hand-over; the shop's default lives in
 * `lib/invoiceSettings` and is what a new bill starts on.
 */
export type PageDesign =
  | "atelier"
  | "royal"
  | "aurora"
  | "classic"
  | "modern"
  | "elegant"
  | "minimal"
  | "corporate"
  | "bold";

export type ThermalDesign = "receipt-simple" | "receipt-bordered" | "receipt-compact" | "receipt-bold";

export type InvoiceDesign = PageDesign | ThermalDesign;

export const PAGE_DESIGNS: PageDesign[] = [
  "atelier",
  "royal",
  "aurora",
  "classic",
  "modern",
  "elegant",
  "minimal",
  "corporate",
  "bold",
];

export const THERMAL_DESIGNS: ThermalDesign[] = [
  "receipt-simple",
  "receipt-bordered",
  "receipt-compact",
  "receipt-bold",
];

export const INVOICE_DESIGNS: InvoiceDesign[] = [...PAGE_DESIGNS, ...THERMAL_DESIGNS];

/** A stored or submitted value is a known design, or it is not a design at all. */
export function isInvoiceDesign(value: unknown): value is InvoiceDesign {
  return typeof value === "string" && (INVOICE_DESIGNS as string[]).includes(value);
}

export interface InvoiceItem {
  id?: string;
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount: number;
  line_total: number;
  position?: number;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  party_type: InvoicePartyType;
  party_id: string | null;
  invoice_type: InvoiceType;
  design: InvoiceDesign;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  issued_on: string;
  due_date: string | null;
  discount_type: InvoiceDiscountType;
  discount_value: number;
  tax_rate: number;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  payment_method: string | null;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  created_at: string;
  items?: InvoiceItem[];
}

export interface InvoiceLineInput {
  description: string;
  qty: number;
  unitPrice: number;
  discount?: number;
  productId?: string | null;
}

export interface NewInvoiceInput {
  /** Claimed by the database: a double tap returns the invoice the first tap wrote. */
  idempotencyKey: string;
  customerId?: string | null;
  partyType?: InvoicePartyType;
  partyId?: string | null;
  invoiceType?: InvoiceType;
  design?: InvoiceDesign;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  issuedOn: string;
  dueDate?: string;
  discountType: InvoiceDiscountType;
  discountValue: number;
  taxRate: number;
  amountPaid: number;
  paymentMethod?: string;
  notes?: string;
  terms?: string;
  items: InvoiceLineInput[];
}

/** PostgREST returns `numeric` as a string; a missing amount is zero, never NaN. */
function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toInvoice(row: Record<string, unknown>): Invoice {
  const items = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : undefined;
  return {
    ...(row as unknown as Invoice),
    discount_value: num(row.discount_value),
    tax_rate: num(row.tax_rate),
    subtotal: num(row.subtotal),
    discount_amount: num(row.discount_amount),
    tax_amount: num(row.tax_amount),
    total: num(row.total),
    amount_paid: num(row.amount_paid),
    items: items?.map((it) => ({
      ...(it as unknown as InvoiceItem),
      qty: num(it.qty),
      unit_price: num(it.unit_price),
      discount: num(it.discount),
      line_total: num(it.line_total),
    })),
  };
}

/** The oldest unpaid bill is the one a shop chases first, so the list is newest-first and the
 *  reminder block on the detail reads its own due date. */
export async function listInvoices(): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("issued_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toInvoice(row as Record<string, unknown>));
}

export async function getInvoice(id: string): Promise<Invoice> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, items:invoice_items(*)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return toInvoice(data as Record<string, unknown>);
}

export async function createInvoice(input: NewInvoiceInput): Promise<Invoice> {
  const finish = beginScopedWrite();
  try {
    const { data, error } = await supabase.rpc("create_invoice", {
      payload: {
        idempotencyKey: input.idempotencyKey,
        customerId: input.customerId ?? "",
        partyType: input.partyType ?? "customer",
        partyId: input.partyId ?? "",
        invoiceType: input.invoiceType ?? "sale",
        design: input.design ?? "royal",
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? "",
        customerAddress: input.customerAddress ?? "",
        issuedOn: input.issuedOn,
        dueDate: input.dueDate ?? "",
        discountType: input.discountType,
        discountValue: input.discountValue,
        taxRate: input.taxRate,
        amountPaid: input.amountPaid,
        paymentMethod: input.paymentMethod ?? "",
        notes: input.notes ?? "",
        terms: input.terms ?? "",
        items: input.items.map((it) => ({
          description: it.description,
          qty: it.qty,
          unitPrice: it.unitPrice,
          discount: it.discount ?? 0,
          productId: it.productId ?? null,
        })),
      },
    });
    if (error) throw new Error(error.message);
    return toInvoice(data as Record<string, unknown>);
  } finally {
    finish();
  }
}

/** Rewrites an invoice that is already on paper. The number is kept by the database. */
export async function updateInvoice(id: string, input: Omit<NewInvoiceInput, "idempotencyKey">): Promise<Invoice> {
  const finish = beginScopedWrite();
  try {
    const { data, error } = await supabase.rpc("update_invoice", {
      p_invoice_id: id,
      payload: {
        customerId: input.customerId ?? "",
        partyType: input.partyType ?? "customer",
        partyId: input.partyId ?? "",
        invoiceType: input.invoiceType ?? "sale",
        design: input.design ?? "royal",
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? "",
        customerAddress: input.customerAddress ?? "",
        issuedOn: input.issuedOn,
        dueDate: input.dueDate ?? "",
        discountType: input.discountType,
        discountValue: input.discountValue,
        taxRate: input.taxRate,
        amountPaid: input.amountPaid,
        paymentMethod: input.paymentMethod ?? "",
        notes: input.notes ?? "",
        terms: input.terms ?? "",
        items: input.items.map((it) => ({
          description: it.description,
          qty: it.qty,
          unitPrice: it.unitPrice,
          discount: it.discount ?? 0,
          productId: it.productId ?? null,
        })),
      },
    });
    if (error) throw new Error(error.message);
    return toInvoice(data as Record<string, unknown>);
  } finally {
    finish();
  }
}

/**
 * The next number this shop will write, `INV-003`.
 *
 * Read from the series the shop already has, so the field can say what the bill will be called
 * instead of "assigned on save". It is a preview, not an allocation: the number is only claimed
 * inside `create_invoice`, under the shop's lock, and two tills previewing at once still get two
 * different numbers.
 */
export async function nextInvoiceNumber(): Promise<string> {
  const { data, error } = await supabase.from("invoices").select("invoice_number").order("created_at", { ascending: false }).limit(200);
  if (error) return "INV-001";
  const highest = (data ?? []).reduce((max, row) => {
    const match = /([0-9]+)$/.exec(String((row as { invoice_number?: string }).invoice_number ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `INV-${String(highest + 1).padStart(3, "0")}`;
}

export async function setInvoicePayment(
  id: string,
  amountPaid: number,
  paymentMethod?: string,
): Promise<Invoice> {
  const finish = beginScopedWrite();
  try {
    const { data, error } = await supabase.rpc("set_invoice_payment", {
      p_invoice_id: id,
      p_amount_paid: amountPaid,
      p_payment_method: paymentMethod ?? null,
    });
    if (error) throw new Error(error.message);
    return toInvoice(data as Record<string, unknown>);
  } finally {
    finish();
  }
}

/** What a bill adds up to, computed the same way `create_invoice` does. */
export function invoiceTotals(input: {
  lines: { qty: number; unitPrice: number; discount?: number }[];
  discountType: InvoiceDiscountType;
  discountValue: number;
  taxRate: number;
}): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = input.lines.reduce((sum, line) => {
    const gross = Math.round((Number(line.qty) || 0) * (Number(line.unitPrice) || 0) * 100) / 100;
    const cut = Math.min(Number(line.discount) || 0, gross);
    return sum + Math.max(gross - cut, 0);
  }, 0);

  const discount =
    input.discountType === "percent"
      ? Math.round(subtotal * Math.min(Math.max(input.discountValue, 0), 100)) / 100
      : Math.min(Math.max(input.discountValue, 0), subtotal);
  const tax = Math.round((subtotal - discount) * Math.max(input.taxRate, 0)) / 100;
  return {
    subtotal,
    discount,
    tax,
    total: Math.round((subtotal - discount + tax) * 100) / 100,
  };
}

/** Unpaid vs collected, for the summary panel above the list. */
export function invoiceSummary(invoices: Invoice[]): { unpaid: number; collected: number } {
  return invoices.reduce(
    (acc, inv) => {
      const due = Math.max(inv.total - inv.amount_paid, 0);
      return { unpaid: acc.unpaid + due, collected: acc.collected + inv.amount_paid };
    },
    { unpaid: 0, collected: 0 },
  );
}

export function isInvoiceOverdue(invoice: Invoice, today = new Date()): boolean {
  if (invoice.status === "paid" || !invoice.due_date) return false;
  const due = new Date(`${invoice.due_date}T00:00:00`);
  return due.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

/** The purpose, as the label the app reads out. */
export function invoiceTypeKey(type: InvoiceType) {
  if (type === "credit") return "invoice.purposeCredit" as const;
  if (type === "service") return "invoice.purposeService" as const;
  if (type === "other") return "invoice.purposeOther" as const;
  return "invoice.purposeSale" as const;
}

export function invoiceStatusKey(status: InvoiceStatus): "invoice.statusUnpaid" | "invoice.statusPartial" | "invoice.statusPaid" {
  if (status === "paid") return "invoice.statusPaid";
  if (status === "partial") return "invoice.statusPartial";
  return "invoice.statusUnpaid";
}
