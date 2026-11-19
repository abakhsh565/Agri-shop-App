import type { I18nKey } from "@/lib/i18n";
import type { InvoiceDesign } from "@/lib/invoices";

/**
 * The name a design is shown by.
 *
 * One table, so the design card on the invoice form, the settings grid and any later surface
 * cannot name the same sheet two different ways.
 */
export const INVOICE_DESIGN_KEYS: Record<InvoiceDesign, I18nKey> = {
  atelier: "invoiceDesign.atelier",
  royal: "invoiceDesign.royal",
  aurora: "invoiceDesign.aurora",
  classic: "invoiceDesign.classic",
  modern: "invoiceDesign.modern",
  elegant: "invoiceDesign.elegant",
  minimal: "invoiceDesign.minimal",
  corporate: "invoiceDesign.corporate",
  bold: "invoiceDesign.bold",
  "receipt-simple": "invoiceDesign.receiptSimple",
  "receipt-bordered": "invoiceDesign.receiptBordered",
  "receipt-compact": "invoiceDesign.receiptCompact",
  "receipt-bold": "invoiceDesign.receiptBold",
};
