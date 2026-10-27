import { supabase } from "@/lib/supabase";
import { useScopedRows } from "@/lib/scopedRead";

/**
 * The two ledgers behind "Returns" and "Voided sales", and the one reading of "net sales".
 *
 * WHY THIS FILE EXISTS. Returns and voided sales are the two places a sale stops being money
 * the shop kept — goods came back, or the whole record was written off — and both figures are
 * read by more than one screen now (the Sales hub's today tile, the All Sales total, and the
 * two popups). A refund counted twice, or a void counted as a sale, is a figure the owner
 * cannot act on, so the pair is derived here once and every screen spends it.
 *
 * `returns` is read straight from the ledger, at the same scope as the sales list: the rows a
 * reader may see are the rows the database returns (shop and branch scope are policies, not
 * filters applied here). Nothing in this file computes a stock or profit figure.
 */

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  /** The sale the goods came back from; a return without one is not counted as money. */
  saleId: string;
  customerName: string;
  totalRefund: number;
  /** The app's own vocabulary: "refund_cash" or "credit_note". */
  resolution: string;
  createdAt: string;
}

export interface VoidedSaleRecord {
  id: string;
  saleNumber: string;
  customerName: string;
  totalAmount: number;
  voidedAt: string | null;
  createdAt: string;
}

/** Every return this account may see, newest first. */
export function useReturns(): { returns: ReturnRecord[]; ready: boolean } {
  const { rows, ready } = useScopedRows<ReturnRecord>(async () => {
    const { data, error } = await supabase
      .from("returns")
      .select("id, return_number, sale_id, customer_name, total_refund, resolution, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      returnNumber: String(r.return_number ?? ""),
      saleId: String(r.sale_id ?? ""),
      customerName: String(r.customer_name ?? ""),
      totalRefund: Number(r.total_refund ?? 0),
      resolution: String(r.resolution ?? ""),
      createdAt: String(r.created_at ?? ""),
    }));
  });
  return { returns: rows, ready };
}

/**
 * Every sale that was voided, newest first.
 *
 * Read from the ledger rather than filtered out of the sales feed: that feed is a window of the
 * most recent 200 sales, so a void from three weeks ago would simply be missing from a list
 * whose whole job is to show it.
 */
export function useVoidedSales(): { voided: VoidedSaleRecord[]; ready: boolean } {
  const { rows, ready } = useScopedRows<VoidedSaleRecord>(async () => {
    const { data, error } = await supabase
      .from("sales")
      .select("id, sale_number, customer_name_snapshot, total_amount, voided_at, created_at")
      .eq("is_voided", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      saleNumber: String(r.sale_number ?? ""),
      customerName: String(r.customer_name_snapshot ?? ""),
      totalAmount: Number(r.total_amount ?? 0),
      voidedAt: r.voided_at ? String(r.voided_at) : null,
      createdAt: String(r.created_at ?? ""),
    }));
  });
  return { voided: rows, ready };
}

/** How much of each sale has already been refunded, keyed by the sale's own id. */
export function refundsBySale(returns: ReturnRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of returns) {
    if (!r.saleId) continue;
    map.set(r.saleId, (map.get(r.saleId) ?? 0) + r.totalRefund);
  }
  return map;
}

/**
 * Sales less the refunds of those same sales — the app's one reading of "net sales".
 *
 * Subtracting per sale, not by subtracting a period's return total, is what keeps a period's
 * figure made of the very records a reader can open: the refund of a sale that was made last
 * month reduces last month's net, not this one's.
 */
export function netSalesOf(
  sales: { id: string; totalAmount: number }[],
  refunds: Map<string, number>
): number {
  let net = 0;
  for (const sale of sales) net += sale.totalAmount - (refunds.get(sale.id) ?? 0);
  return net;
}
