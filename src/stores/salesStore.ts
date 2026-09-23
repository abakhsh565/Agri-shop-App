import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { rpcCreateSale } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { enqueueOperation } from "@/lib/offlineQueue";
import { getCachedData as getLocalCache, setCachedData as setLocalCache } from "@/lib/localCache";
import type { Sale, SaleItem } from "@/types";

const CACHE_KEY = "sales";

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
  cogs_amount: number | null;
}

interface SaleRow {
  id: string;
  sale_number: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  customer_phone: string | null;
  customer_address: string | null;
  employee_id: string | null;
  employee_name: string;
  total_amount: number;
  discount: number;
  amount_paid: number;
  amount_due: number;
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
    cogsAmount: r.cogs_amount == null ? undefined : Number(r.cogs_amount),
  };
}

function saleFromRow(r: SaleRow): Sale {
  return {
    id: r.id,
    saleNumber: r.sale_number,
    customerId: r.customer_id ?? "",
    customerName: r.customer_name_snapshot,
    customerPhone: r.customer_phone ?? undefined,
    customerAddress: r.customer_address ?? undefined,
    employeeId: r.employee_id ?? "",
    employeeName: r.employee_name,
    items: (r.sale_items ?? []).map(itemFromRow),
    subtotal: Number(r.total_amount),
    taxAmount: 0,
    totalAmount: Number(r.total_amount),
    amountPaid: Number(r.amount_paid),
    outstandingBalance: Number(r.amount_due),
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
  dueDate?: string;
  /**
   * Identifies one logical "confirm this sale" attempt. The database claims it
   * atomically, so a double tap or a retry after a lost response returns the
   * sale that was already created instead of creating a second one. Optional so
   * scripts/tests can still call the RPC without one.
   */
  idempotencyKey?: string;
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

    // Stale-while-revalidate: render the cache immediately, then ALWAYS revalidate.
    // Skipping the fetch while the cache was still "fresh" meant a sale recorded
    // seconds ago did not appear, and cross-screen totals kept the old figure.
    const cached = getLocalCache<Sale[]>(CACHE_KEY);
    if (cached) {
      set({ sales: cached, loading: false, ready: true });
    }

    try {
      const { data, error } = await supabase
        .from("sales")
        .select("*, sale_items(*)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        if (!cached) {
          set({ loading: false, ready: true, error: error.message });
        }
        return;
      }
      const sales = (data as SaleRow[]).map(saleFromRow);
      setLocalCache(CACHE_KEY, sales);
      set({ sales, loading: false, ready: true });
    } catch {
      if (!cached) {
        set({ loading: false, ready: true, error: "Offline" });
      }
    }
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
    const computedTotal = input.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    const computedPaid = input.amountPaid ?? 0;
    const paymentLabel = input.paymentType === "full" ? "Paid" : "Credit";

    const rpcPayload = {
      idempotencyKey: input.idempotencyKey,
      customerId: asUuidOrNull(input.customerId) ?? undefined,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      paymentType: input.paymentType,
      paymentMethod: input.paymentMethod,
      amountPaid: input.amountPaid,
      note: input.note,
      dueDate: input.dueDate,
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
    };

    // Use "You" in notification body when the employee is the current user
    const currentUserId = (await import("@/stores/authStore")).useAuthStore.getState().user?.id;
    const isSelf = currentUserId === input.employeeId;
    const soldByLabel = isSelf ? "You" : input.employeeName;

    const notifPayload = {
      kind: "sale",
      title: `New sale: Rs. ${computedTotal.toLocaleString("en-PK")} (${paymentLabel})`,
      body: `${input.customerName} — sold by ${soldByLabel}`,
      entityId: null as string | null,
      actor_id: input.employeeId || null,
      actor_name: input.employeeName || null,
    };

    // ── Try online first ──
    try {
      const result = await rpcCreateSale(rpcPayload);
      notifPayload.entityId = result.id;

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
        subtotal: result.totalAmount ?? computedTotal,
        taxAmount: 0,
        totalAmount: result.totalAmount ?? computedTotal,
        amountPaid: result.amountPaid ?? computedPaid,
        outstandingBalance: result.outstandingBalance ?? (computedTotal - computedPaid),
        paymentType: input.paymentType,
        paymentMethod: input.paymentMethod,
        isVoided: false,
        note: input.note,
        createdAt: new Date().toISOString(),
      };

      set({ sales: [sale, ...get().sales] });
      setLocalCache(CACHE_KEY, [sale, ...get().sales]);

      // Fire-and-forget notification
      createNotification({
        kind: "sale",
        title: notifPayload.title,
        body: notifPayload.body ?? undefined,
        entityId: sale.id,
      });

      return sale;
    } catch (err) {
      // ── Offline fallback: queue everything for later sync ──
      if (!navigator.onLine || (err instanceof Error && /fetch|network|Failed to fetch/i.test(err.message))) {
        const tempId = `offline-sale-${Date.now()}`;
        const saleNumber = `OFF-${Date.now().toString(36).toUpperCase()}`;

        const sale: Sale = {
          id: tempId,
          saleNumber,
          customerId: input.customerId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          employeeId: input.employeeId,
          employeeName: input.employeeName,
          items: input.items.map((it, i) => ({
            ...it,
            id: `local-${i}`,
            saleId: tempId,
          })),
          subtotal: computedTotal,
          taxAmount: 0,
          totalAmount: computedTotal,
          amountPaid: computedPaid,
          outstandingBalance: computedTotal - computedPaid,
          paymentType: input.paymentType,
          paymentMethod: input.paymentMethod,
          isVoided: false,
          note: input.note,
          createdAt: new Date().toISOString(),
        };

        // Add to local sales list
        set({ sales: [sale, ...get().sales] });
        setLocalCache(CACHE_KEY, [sale, ...get().sales]);

        // Queue for sync (notification needs snake_case for DB insert)
        enqueueOperation({ type: "create_sale", payload: rpcPayload });
        enqueueOperation({ type: "create_notification", payload: {
          kind: notifPayload.kind,
          title: notifPayload.title,
          body: notifPayload.body,
          entity_id: notifPayload.entityId,
          actor_id: notifPayload.actor_id,
          actor_name: notifPayload.actor_name,
        }});

        return sale;
      }

      throw err;
    }
  },

  updateNote: async (saleId, note) => {
    // Optimistic local update
    set({
      sales: get().sales.map((s) =>
        s.id === saleId ? { ...s, note } : s
      ),
    });

    try {
      const { error } = await supabase
        .from("sales")
        .update({ note })
        .eq("id", saleId);
      if (error) throw error;
    } catch {
      // Queue for later sync if offline
      if (!navigator.onLine) {
        enqueueOperation({ type: "update_note", payload: { saleId, note } });
      }
    }
  },
}));
