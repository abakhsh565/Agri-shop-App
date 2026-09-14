import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import type {
  Purchase,
  PurchaseItem,
  CustomerPayment,
  StockAdjustment,
  Return,
  PaymentMethod,
  PaymentType,
  AdjustmentType,
  ProductCategory,
} from "@/types";

// Centralised data access for the flows that either (a) mutate several tables
// atomically or (b) are read-only history lists. The atomic writes go through
// SECURITY DEFINER RPCs (see migration 0004) so stock can't go negative, price
// is read from the DB, and money/stock updates are transactional.

// ─── Atomic write RPCs ───────────────────────────────────────────────────────

export interface SaleLineInput {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  qty: number;
  unitPrice: number;
  unitSize: number;
  baseUnit: string;
}

export async function rpcCreateSale(payload: {
  customerId?: string | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  employeeId?: string;
  employeeName?: string;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  note?: string;
  items: SaleLineInput[];
}): Promise<{ id: string; saleNumber: string; totalAmount: number; amountPaid: number; outstandingBalance: number }> {
  const { data, error } = await supabase.rpc("create_sale", { payload });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcCreatePurchase(payload: {
  companyId?: string | null;
  companyName: string;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  note?: string;
  items: { productId?: string; productName: string; variantId?: string; variantName: string; qty: number; costPrice: number }[];
}): Promise<{ id: string; purchaseNumber: string; totalAmount: number; outstandingPayable: number }> {
  const { data, error } = await supabase.rpc("create_purchase", { payload });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcRecordCustomerPayment(payload: {
  customerId: string;
  amount?: number;
  method?: PaymentMethod;
  notes?: string;
  splits?: { amount: number; method: PaymentMethod }[];
  idempotencyKey?: string;
}): Promise<{ id: string; balanceAfter: number; splitCount?: number; totalAmount?: number }> {
  const actorId = useAuthStore.getState().user?.id;
  const idempotency_key = payload.idempotencyKey ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc("record_customer_payment", { payload: { ...payload, actorId, idempotency_key } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcRecordSupplierPayment(payload: {
  companyId: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
}): Promise<{ id: string; payableAfter: number }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("record_supplier_payment", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcAdjustStock(payload: {
  variantId: string;
  productId?: string;
  productName: string;
  adjustmentType: AdjustmentType;
  qty: number;
  reason?: string;
}): Promise<{ id: string; qtyBefore: number; qtyChange: number; qtyAfter: number }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("adjust_stock", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcCreateProduct(payload: {
  name: string;
  company: string;
  category: ProductCategory;
  baseUnit: string;
  stockQty: number;
  imageUrl?: string;
  barcode?: string;
  variants: { name: string; sellingPrice: number; costPrice: number; unitSize: number; qtyStep: number; lowStockThreshold: number }[];
}): Promise<{ id: string }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("create_product", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcUpdateProduct(payload: {
  id: string;
  name: string;
  company: string;
  category: ProductCategory;
  baseUnit?: string;
  stockQty?: number;
  imageUrl?: string;
  barcode?: string;
  variants: { id?: string; name: string; sellingPrice: number; costPrice: number; unitSize?: number; qtyStep?: number; lowStockThreshold: number }[];
}): Promise<{ id: string }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("update_product", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcDeleteProduct(payload: {
  id: string;
}): Promise<{ id: string; deactivated: boolean }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("delete_product", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcProcessReturn(payload: {
  saleId?: string;
  customerId?: string | null;
  customerName: string;
  resolution: string;
  reason?: string;
  note?: string;
  idempotencyKey?: string;
  processedBy?: string;
  processedByName?: string;
  items: { saleItemId?: string; productId?: string; productName: string; variantId?: string; variantName: string; qty: number; unitPrice: number; restock: boolean }[];
}): Promise<{ id: string; returnNumber: string; totalRefund: number }> {
  // Build payload — only include optional fields that have values
  const rpcPayload: Record<string, unknown> = {
    saleId: payload.saleId,
    customerId: payload.customerId,
    customerName: payload.customerName,
    resolution: payload.resolution,
    items: payload.items,
  };
  if (payload.reason) rpcPayload.reason = payload.reason;
  if (payload.idempotencyKey) rpcPayload.idempotency_key = payload.idempotencyKey;
  if (payload.note) rpcPayload.note = payload.note;
  if (payload.processedBy) rpcPayload.processedBy = payload.processedBy;
  if (payload.processedByName) rpcPayload.processedByName = payload.processedByName;

  const { data, error } = await supabase.rpc("process_return", { payload: rpcPayload });
  if (error) throw new Error(friendly(error.message));
  // Map snake_case RPC response to camelCase for UI consumption
  return {
    id: data.id,
    returnNumber: data.return_number,
    totalRefund: Number(data.total_refund ?? 0),
  };
}

// Turn raw Postgres exception text into a human message for the UI.
function friendly(msg: string): string {
  if (msg.includes("INSUFFICIENT_STOCK")) return "Not enough stock for one or more items.";
  if (msg.includes("NEGATIVE_STOCK")) return "That adjustment would make stock negative.";
  if (msg.includes("VARIANT_NOT_FOUND")) return "One of the selected items no longer exists.";
  if (msg.includes("NOT_AUTHORIZED")) return "You don't have permission to do that.";
  if (msg.includes("PRODUCT_NOT_FOUND")) return "That product no longer exists.";
  if (msg.includes("REASON_REQUIRED")) return "A return reason is required.";
  if (msg.includes("RETURN_WINDOW_EXPIRED")) return "Return window has expired (30 days).";
  if (msg.includes("EXCESS_RETURN")) return "Cannot return more than the remaining quantity.";
  if (msg.includes("ITEM_NOT_OWNED")) return "This item does not belong to the selected sale.";
  if (msg.includes("SALE_ITEM_NOT_FOUND")) return "One of the return items no longer exists.";
  if (msg.includes("SALE_NOT_FOUND")) return "The original sale was not found.";
  if (msg.includes("INVALID_QTY")) return "Return quantity must be at least 1.";
  if (msg.includes("null value")) return "A required field is missing. Please run the SQL migration (0014_return_enhancements.sql) in Supabase.";
  if (msg.includes("CUSTOMER_NOT_FOUND")) return "Customer not found.";
  if (msg.includes("INVALID_SPLIT")) return "Each split amount must be positive.";
  return msg;
}

// ─── Read-only history fetchers ────────────────────────────────────────────

interface PurchaseRow {
  id: string;
  purchase_number: string;
  company_id: string | null;
  company_name: string;
  total_amount: number;
  amount_paid: number;
  outstanding_payable: number;
  payment_method: PaymentMethod;
  note: string | null;
  created_by: string | null;
  created_at: string;
  purchase_items?: {
    id: string; purchase_id: string; product_id: string | null; product_name: string;
    variant_id: string | null; variant_name: string; qty: number; cost_price: number; line_total: number;
  }[];
}

export async function fetchPurchases(): Promise<Purchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("*, purchase_items(*)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as PurchaseRow[]).map((r) => ({
    id: r.id,
    purchaseNumber: r.purchase_number,
    companyId: r.company_id ?? "",
    companyName: r.company_name,
    items: (r.purchase_items ?? []).map<PurchaseItem>((it) => ({
      id: it.id,
      purchaseId: it.purchase_id,
      productId: it.product_id ?? "",
      productName: it.product_name,
      variantId: it.variant_id ?? "",
      variantName: it.variant_name,
      qty: it.qty,
      costPrice: Number(it.cost_price),
      lineTotal: Number(it.line_total),
    })),
    totalAmount: Number(r.total_amount),
    amountPaid: Number(r.amount_paid),
    outstandingPayable: Number(r.outstanding_payable),
    paymentMethod: r.payment_method,
    note: r.note ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by ?? "",
  }));
}

interface CustomerPaymentRow {
  id: string; customer_id: string; amount: number; method: PaymentMethod;
  notes: string | null; recorded_by: string | null; recorded_by_name: string | null;
  balance_after: number; created_at: string;
  payment_group_id: string | null; split_index: number | null;
}

export async function fetchCustomerPayments(customerId?: string): Promise<CustomerPayment[]> {
  let q = supabase.from("customer_payments").select("*").order("created_at", { ascending: false });
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);

  const rows = data as CustomerPaymentRow[];

  // Group split payments by payment_group_id
  const groups = new Map<string, CustomerPaymentRow[]>();
  const singles: CustomerPayment[] = [];

  for (const r of rows) {
    const groupId = r.payment_group_id || r.id;
    const isSplit = groupId !== r.id || (rows.filter((x) => x.payment_group_id === groupId).length > 1);

    if (isSplit) {
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId)!.push(r);
    } else {
      singles.push({
        id: r.id,
        customerId: r.customer_id,
        amount: Number(r.amount),
        method: r.method,
        notes: r.notes ?? undefined,
        recordedBy: r.recorded_by ?? "",
        recordedByName: r.recorded_by_name ?? "",
        balanceAfter: Number(r.balance_after),
        createdAt: r.created_at,
      });
    }
  }

  // Convert split groups to grouped payment entries
  for (const [groupId, groupRows] of groups) {
    const sorted = groupRows.sort((a, b) => (a.split_index ?? 0) - (b.split_index ?? 0));
    const total = sorted.reduce((sum, r) => sum + Number(r.amount), 0);
    singles.push({
      id: groupId,
      customerId: sorted[0].customer_id,
      amount: total,
      method: sorted.length === 1 ? sorted[0].method : ("split" as PaymentMethod),
      notes: sorted[0].notes ?? undefined,
      recordedBy: sorted[0].recorded_by ?? "",
      recordedByName: sorted[0].recorded_by_name ?? "",
      balanceAfter: Number(sorted[0].balance_after),
      createdAt: sorted[0].created_at,
    });
  }

  // Sort by date descending
  return singles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

interface StockAdjustmentRow {
  id: string; product_id: string | null; product_name: string; variant_id: string | null;
  variant_name: string; adjustment_type: AdjustmentType; qty_before: number; qty_change: number;
  qty_after: number; reason: string | null; adjusted_by: string | null; adjusted_by_name: string | null;
  created_at: string;
}

export async function fetchStockAdjustments(): Promise<StockAdjustment[]> {
  const { data, error } = await supabase
    .from("stock_adjustments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as StockAdjustmentRow[]).map((r) => ({
    id: r.id,
    productId: r.product_id ?? "",
    productName: r.product_name,
    variantId: r.variant_id ?? "",
    variantName: r.variant_name,
    adjustmentType: r.adjustment_type,
    qtyBefore: r.qty_before,
    qtyChange: r.qty_change,
    qtyAfter: r.qty_after,
    reason: r.reason ?? undefined,
    adjustedBy: r.adjusted_by_name ?? r.adjusted_by ?? "",
    createdAt: r.created_at,
  }));
}

interface ReturnRow {
  id: string; return_number: string; sale_id: string | null; customer_id: string | null;
  customer_name: string; total_refund: number; resolution: string; reason: string | null;
  note: string | null; processed_by: string | null; processed_by_name: string | null; created_at: string;
}

export async function fetchReturns(): Promise<Return[]> {
  const { data, error } = await supabase
    .from("returns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as ReturnRow[]).map((r) => ({
    id: r.id,
    saleId: r.sale_id ?? "",
    saleNumber: "",
    customerId: r.customer_id ?? "",
    customerName: r.customer_name,
    items: [],
    totalRefund: Number(r.total_refund),
    resolution: (r.resolution as Return["resolution"]) ?? "refund_cash",
    reason: r.reason ?? undefined,
    processedBy: r.processed_by_name ?? r.processed_by ?? "",
    note: r.note ?? undefined,
    createdAt: r.created_at,
  }));
}

// ─── Customer Archive / Restore ──────────────────────────────────────────────

export async function rpcArchiveCustomer(customerId: string): Promise<void> {
  const actorId = useAuthStore.getState().user?.id;
  const { error } = await supabase.rpc("archive_customer", {
    p_customer_id: customerId,
    p_archived_by: actorId,
  });
  if (error) throw new Error(friendly(error.message));
}

export async function rpcRestoreCustomer(customerId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_customer", {
    p_customer_id: customerId,
  });
  if (error) throw new Error(friendly(error.message));
}

// ─── Void Sale ──────────────────────────────────────────────────────────────

export async function rpcVoidSale(saleId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason,
    p_voided_by: useAuthStore.getState().user?.id ?? null,
  });
  if (error) throw new Error(friendly(error.message));
}
