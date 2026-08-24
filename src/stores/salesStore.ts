import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { rpcCreateSale } from "@/lib/db";
import type { Sale, SaleItem } from "@/types";

// ─── Row <-> domain mapping ─────────────────────────────────────────────────
// DB columns are snake_case; the app's types are camelCase. Keep the mapping in
// one place so every read/write goes through the same shape.

interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_name: string;
  qty: number;
  unit_price: number;
  unit_size: number | null;
  base_unit: string | null;
  line_total: number;
}

interface SaleRow {
  id: string;
  sale_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  employee_id: string | null;
  employee_name: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  outstanding_balance: number;
  payment_type: Sale["paymentType"];
  payment_method: Sale["paymentMethod"];
  is_voided: boolean;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  note: string | null;
  created_at: string;
  sale_items?: SaleItemRow[];
}

function itemFromRow(r: SaleItemRow): SaleItem {
  return {
    id: r.id,
    saleId: r.sale_id,
    productId: r.product_id ?? "",
    productName: r.product_name,
    variantId: r.variant_id ?? "",
    variantName: r.variant_name,
    qty: r.qty,
    unitPrice: Number(r.unit_price),
    unitSize: Number(r.unit_size ?? 1),
    baseUnit: r.base_unit ?? "piece",
    lineTotal: Number(r.line_total),
  };
}

function saleFromRow(r: SaleRow): Sale {
  return {
    id: r.id,
    saleNumber: r.sale_number,
    customerId: r.customer_id ?? "",
    customerName: r.customer_name,
    customerPhone: r.customer_phone ?? undefined,
    customerAddress: r.customer_address ?? undefined,
    employeeId: r.employee_id ?? "",
    employeeName: r.employee_name,
    items: (r.sale_items ?? []).map(itemFromRow),
    subtotal: Number(r.subtotal),
    taxAmount: Number(r.tax_amount),
    totalAmount: Number(r.total_amount),
    amountPaid: Number(r.amount_paid),
    outstandingBalance: Number(r.outstanding_balance),
    paymentType: r.payment_type,
    paymentMethod: r.payment_method,
    isVoided: r.is_voided,
    voidedAt: r.voided_at ?? undefined,
    voidedBy: r.voided_by ?? undefined,
    voidReason: r.void_reason ?? undefined,
    note: r.note ?? undefined,
    createdAt: r.created_at,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

export interface NewSaleInput {
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  employeeId: string;
  employeeName: string;
  items: Omit<SaleItem, "id" | "saleId">[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  paymentType: Sale["paymentType"];
  paymentMethod: Sale["paymentMethod"];
  note?: string;
}

interface SalesState {
  sales: Sale[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  subscribe: () => () => void;
  createSale: (input: NewSaleInput) => Promise<Sale>;
  updateNote: (saleId: string, note: string) => Promise<void>;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

// The mock/demo data uses ids like "cust-2" / "user-emp-1" that are NOT real
// UUIDs. The DB's foreign-key columns are `uuid`, so only pass through a value
// that is actually a UUID; otherwise store null (the human-readable name column
// is what the UI renders anyway).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuidOrNull(id: string | undefined | null): string | null {
  return id && UUID_RE.test(id) ? id : null;
}

export const useSalesStore = create<SalesState>((set, get) => ({
  sales: [],
  loading: false,
  ready: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("sales")
      .select("*, sale_items(*)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      set({ loading: false, ready: true, error: error.message });
      return;
    }
    set({
      sales: (data as SaleRow[]).map(saleFromRow),
      loading: false,
      ready: true,
    });
  },

  subscribe: () => {
    if (channel) return () => {};
    channel = supabase
      .channel("sales-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales" },
        async () => {
          // Cheapest correct path: refetch the list (includes items via join).
          await get().load();
        }
      )
      .subscribe();
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  },

  createSale: async (input) => {
    // One atomic server call: validates + decrements stock (never negative),
    // writes the sale + items, updates the customer balance, and notifies.
    // Selling price is re-read from the DB inside the function, so the client
    // can't dictate price or oversell.
    const result = await rpcCreateSale({
      customerId: asUuidOrNull(input.customerId) ?? undefined,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      paymentType: input.paymentType,
      paymentMethod: input.paymentMethod,
      amountPaid: input.amountPaid,
      note: input.note,
      items: input.items.map((it) => ({
        productId: it.productId ?? '',
        productName: it.productName,
        variantId: it.variantId ?? '',
        variantName: it.variantName,
        qty: it.qty,
        unitPrice: it.unitPrice,
        unitSize: it.unitSize,
        baseUnit: it.baseUnit,
      })),
    });

    const sale: Sale = {
      id: result.id,
      saleNumber: result.saleNumber,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      items: input.items.map((it, i) => ({
        ...it,
        id: "local-" + i,
        saleId: result.id,
      })),
      subtotal: result.totalAmount,
      taxAmount: 0,
      totalAmount: result.totalAmount,
      amountPaid: result.amountPaid,
      outstandingBalance: result.outstandingBalance,
      paymentType: input.paymentType,
      paymentMethod: input.paymentMethod,
      isVoided: false,
      note: input.note,
      createdAt: new Date().toISOString(),
    };
    // Optimistically prepend so the creator sees it instantly.
    set({ sales: [sale, ...get().sales] });
    return sale;
  },

  updateNote: async (saleId, note) => {
    const { error } = await supabase
      .from("sales")
      .update({ note })
      .eq("id", saleId);
    if (error) throw new Error(error.message);
    set({
      sales: get().sales.map((s) =>
        s.id === saleId ? { ...s, note } : s
      ),
    });
  },
}));
