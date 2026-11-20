import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/formatters";
import type { I18nKey } from "@/lib/i18n";

export type GlobalGroup = "invoice" | "purchase" | "return" | "payment" | "stock";

export interface GlobalHit {
  id: string;
  group: GlobalGroup;
  title: string;
  subtitle: string;
  badge?: string;
  path: string;
}

type Translate = (key: I18nKey, params?: Record<string, string>) => string;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function related(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * The records behind the modules.
 *
 * The global search's five stores already answer for customers, products, sales, employees and
 * suppliers. The books that only exist in the database — a bill, a purchase, a refund, a payment,
 * a stock adjustment — are read here, with the same keyword applied to their numbers, party names
 * and the notes the shopkeeper actually writes. RLS decides which rows each account may see; a
 * refused table returns no rows rather than failing the whole search.
 */
export async function searchDocuments(
  query: string,
  opts: { base: string; isAdmin: boolean; t: Translate },
): Promise<GlobalHit[]> {
  const term = query.trim().replace(/[,()%]/g, " ").replace(/\s+/g, " ").slice(0, 60);
  if (!term) return [];
  const like = `%${term}%`;
  const { base, isAdmin, t } = opts;
  const hits: GlobalHit[] = [];

  const [invoices, purchases, returns, customerPayments, supplierPayments, stockMoves] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("id,invoice_number,customer_name,total,notes,terms,status,created_at")
        .or(`invoice_number.ilike.${like},customer_name.ilike.${like},notes.ilike.${like},terms.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(6)
        .then((result) => result.data ?? [], () => []),
      supabase
        .from("purchases")
        .select("id,purchase_number,company_name,total_amount,notes,status,created_at")
        .or(`purchase_number.ilike.${like},company_name.ilike.${like},notes.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(6)
        .then((result) => result.data ?? [], () => []),
      supabase
        .from("returns")
        .select("id,sale_id,return_number,customer_name,total_refund,refund_amount,note,reason,created_at")
        .or(`return_number.ilike.${like},customer_name.ilike.${like},note.ilike.${like},reason.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(6)
        .then((result) => result.data ?? [], () => []),
      supabase
        .from("customer_payments")
        .select("id,customer_id,amount,notes,recorded_by_name,created_at,customers(name)")
        .or(`notes.ilike.${like},recorded_by_name.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(6)
        .then((result) => result.data ?? [], () => []),
      supabase
        .from("supplier_payments")
        .select("id,company_id,amount,notes,recorded_by_name,created_at,companies(name)")
        .or(`notes.ilike.${like},recorded_by_name.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(6)
        .then((result) => result.data ?? [], () => []),
      supabase
        .from("stock_adjustments")
        .select("id,product_name,variant_name,adjustment_type,qty_change,reason,created_at")
        .or(`product_name.ilike.${like},variant_name.ilike.${like},reason.ilike.${like},adjustment_type.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(6)
        .then((result) => result.data ?? [], () => []),
    ]);

  for (const raw of invoices as Record<string, unknown>[]) {
    const id = text(raw.id);
    const number = text(raw.invoice_number);
    const note = text(raw.notes) || text(raw.terms);
    hits.push({
      id: `invoice-${id}`,
      group: "invoice",
      title: `${text(raw.customer_name) || t("search.invoice")}${number ? ` · ${number}` : ""}`,
      subtitle: note || t("search.invoice"),
      badge: formatCurrency(numberValue(raw.total)),
      path: `${base}/invoices/${id}`,
    });
  }

  for (const raw of purchases as Record<string, unknown>[]) {
    const id = text(raw.id);
    const number = text(raw.purchase_number);
    hits.push({
      id: `purchase-${id}`,
      group: "purchase",
      title: `${text(raw.company_name) || t("search.purchase")}${number ? ` · ${number}` : ""}`,
      subtitle: text(raw.notes) || t("search.purchase"),
      badge: formatCurrency(numberValue(raw.total_amount)),
      path: `${base}/purchases/${id}`,
    });
  }

  for (const raw of returns as Record<string, unknown>[]) {
    const id = text(raw.id);
    const saleId = text(raw.sale_id);
    const number = text(raw.return_number);
    hits.push({
      id: `return-${id}`,
      group: "return",
      title: `${text(raw.customer_name) || t("search.return")}${number ? ` · ${number}` : ""}`,
      subtitle: text(raw.note) || text(raw.reason) || t("search.return"),
      badge: formatCurrency(numberValue(raw.total_refund) || numberValue(raw.refund_amount)),
      path: saleId ? `${base}/sales/${saleId}` : `${base}/history/returns`,
    });
  }

  for (const raw of customerPayments as Record<string, unknown>[]) {
    const id = text(raw.id);
    const customer = related(raw, "customers");
    const customerId = text(raw.customer_id);
    hits.push({
      id: `customer-payment-${id}`,
      group: "payment",
      title: text(customer?.name) || t("search.customerPayment"),
      subtitle: text(raw.notes) || text(raw.recorded_by_name) || t("search.customerPayment"),
      badge: formatCurrency(numberValue(raw.amount)),
      path: customerId ? `${base}/customers/${customerId}` : `${base}/history/customer-payments`,
    });
  }

  for (const raw of supplierPayments as Record<string, unknown>[]) {
    const id = text(raw.id);
    const company = related(raw, "companies");
    hits.push({
      id: `supplier-payment-${id}`,
      group: "payment",
      title: text(company?.name) || t("search.supplierPayment"),
      subtitle: text(raw.notes) || text(raw.recorded_by_name) || t("search.supplierPayment"),
      badge: formatCurrency(numberValue(raw.amount)),
      path: `${base}/purchases/payments/${id}`,
    });
  }

  for (const raw of stockMoves as Record<string, unknown>[]) {
    const id = text(raw.id);
    const change = numberValue(raw.qty_change);
    hits.push({
      id: `stock-${id}`,
      group: "stock",
      title: text(raw.product_name) || text(raw.variant_name) || t("search.stockMove"),
      subtitle: [text(raw.adjustment_type), text(raw.reason)].filter(Boolean).join(" · ") || t("search.stockMove"),
      badge: `${change > 0 ? "+" : ""}${change}`,
      path: isAdmin ? `${base}/inventory/movements` : `${base}/stock`,
    });
  }

  return hits;
}
