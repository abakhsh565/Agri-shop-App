import { supabase } from "@/lib/supabase";
import { isInvoiceDesign, type InvoiceDesign } from "@/lib/invoices";

/**
 * How this shop prints its paperwork.
 *
 * One record per shop, kept in `business_settings` under `invoice_settings` — the same key/value
 * table the harvest periods use, so there is no second settings store and no migration to hold a
 * preference. What is stored here is what a reprint uses: the design, the paper, whether the
 * header prints, the two notes, and which fields of the bill are allowed on paper.
 *
 * WHY FIELD SWITCHES. A shop that hands a bill to a walk-in does not want its customer ledger
 * number on it, and a shop printing a thermal receipt does not need the address block. The sheet
 * reads these answers; it does not decide them.
 *
 * A MISSING OR UNREADABLE RECORD IS THE DEFAULTS, never an error. A shop that has never opened
 * the screen prints the bill it printed before this existed.
 */

export type InvoicePaper = "a4" | "a5" | "thermal";

export const INVOICE_PAPERS: InvoicePaper[] = ["a4", "a5", "thermal"];

/** Every part of the paper that may be turned off. */
export interface InvoiceVisibleFields {
  /** Invoice number on the paper. */
  receiptNo: boolean;
  date: boolean;
  dueDate: boolean;
  /** The customer (or party) the bill is for. */
  contact: boolean;
  contactNumber: boolean;
  location: boolean;
  subtotal: boolean;
  discount: boolean;
  tax: boolean;
  amountPaid: boolean;
  paymentAccount: boolean;
  signature: boolean;
  notes: boolean;
  logo: boolean;
}

export interface InvoiceSettings {
  design: InvoiceDesign;
  paper: InvoicePaper;
  /** The shop's name, logo, phone and address at the top of the paper. */
  headerOn: boolean;
  headerNote: string;
  footerNote: string;
  visible: InvoiceVisibleFields;
}

export const INVOICE_SETTINGS_KEY = "invoice_settings";

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  design: "royal",
  paper: "a4",
  headerOn: true,
  headerNote: "",
  footerNote: "",
  visible: {
    receiptNo: true,
    date: true,
    dueDate: true,
    contact: true,
    contactNumber: true,
    location: true,
    subtotal: true,
    discount: true,
    tax: true,
    amountPaid: true,
    paymentAccount: true,
    signature: true,
    notes: true,
    logo: true,
  },
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Whatever is stored, shaped into a complete settings record.
 *
 * The record outlives the screen that wrote it, so an older row may be missing a switch added
 * later. Each missing answer falls back to the default rather than hiding a field nobody turned
 * off.
 */
export function normalizeInvoiceSettings(raw: unknown): InvoiceSettings {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== "object") return { ...DEFAULT_INVOICE_SETTINGS, visible: { ...DEFAULT_INVOICE_SETTINGS.visible } };

  const record = value as Record<string, unknown>;
  const visible = (record.visible && typeof record.visible === "object" ? record.visible : {}) as Record<string, unknown>;
  const design = isInvoiceDesign(record.design) ? record.design : DEFAULT_INVOICE_SETTINGS.design;
  const paper = INVOICE_PAPERS.includes(record.paper as InvoicePaper)
    ? (record.paper as InvoicePaper)
    : DEFAULT_INVOICE_SETTINGS.paper;

  return {
    design,
    paper,
    headerOn: bool(record.headerOn, DEFAULT_INVOICE_SETTINGS.headerOn),
    headerNote: text(record.headerNote, ""),
    footerNote: text(record.footerNote, ""),
    visible: {
      receiptNo: bool(visible.receiptNo, true),
      date: bool(visible.date, true),
      dueDate: bool(visible.dueDate, true),
      contact: bool(visible.contact, true),
      contactNumber: bool(visible.contactNumber, true),
      location: bool(visible.location, true),
      subtotal: bool(visible.subtotal, true),
      discount: bool(visible.discount, true),
      tax: bool(visible.tax, true),
      amountPaid: bool(visible.amountPaid, true),
      paymentAccount: bool(visible.paymentAccount, true),
      signature: bool(visible.signature, true),
      notes: bool(visible.notes, true),
      logo: bool(visible.logo, true),
    },
  };
}

/**
 * Read the shop's settings. A missing row or a read the caller may not make is the defaults —
 * printing must never be blocked by a preference lookup.
 */
export async function loadInvoiceSettings(shopId: string | null): Promise<InvoiceSettings> {
  if (!shopId) return { ...DEFAULT_INVOICE_SETTINGS, visible: { ...DEFAULT_INVOICE_SETTINGS.visible } };
  const { data, error } = await supabase
    .from("business_settings")
    .select("setting_value")
    .eq("shop_id", shopId)
    .eq("setting_key", INVOICE_SETTINGS_KEY)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_INVOICE_SETTINGS, visible: { ...DEFAULT_INVOICE_SETTINGS.visible } };
  return normalizeInvoiceSettings((data as { setting_value?: unknown }).setting_value);
}

/** Write the settings for this shop. One row, updated in place when it already exists. */
export async function saveInvoiceSettings(shopId: string, settings: InvoiceSettings): Promise<void> {
  const value = JSON.stringify(settings);
  const existing = await supabase
    .from("business_settings")
    .select("id")
    .eq("shop_id", shopId)
    .eq("setting_key", INVOICE_SETTINGS_KEY)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  const id = (existing.data as { id?: string } | null)?.id;

  if (id) {
    const { error } = await supabase
      .from("business_settings")
      .update({ setting_value: value })
      .eq("id", id)
      .eq("shop_id", shopId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("business_settings").insert({
    shop_id: shopId,
    setting_key: INVOICE_SETTINGS_KEY,
    setting_value: value,
    description: "How this shop prints its bills",
  });
  if (error) throw new Error(error.message);
}
