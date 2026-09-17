import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { getCachedData, setCachedData, isCacheStale, clearCachedData } from "@/lib/localCache";
import { enqueueOperation } from "@/lib/offlineQueue";
import type { Customer } from "@/types";

const CACHE_KEY = "customers";

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  image_url: string | null;
  credit_limit: number;
  outstanding_balance: number;
  total_purchases: number;
  total_paid: number;
  due_date: string | null;
  created_at: string;
  created_by: string | null;
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
}

function customerFromRow(r: CustomerRow): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    address: r.address ?? undefined,
    imageUrl: r.image_url ?? undefined,
    creditLimit: Number(r.credit_limit),
    outstandingBalance: Number(r.outstanding_balance),
    totalPurchases: Number(r.total_purchases),
    totalPaid: Number(r.total_paid),
    dueDate: r.due_date ?? null,
    createdAt: r.created_at,
    createdBy: r.created_by ?? "",
    isArchived: r.is_archived ?? false,
    archivedAt: r.archived_at,
    archivedBy: r.archived_by,
  };
}

export interface CreditLimitRequest {
  id: string;
  customerId: string;
  customerName: string;
  requestedBy: string;
  currentLimit: number;
  requestedLimit: number;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface CustomersState {
  customers: Customer[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  subscribe: () => () => void;
  createCustomer: (input: {
    name: string;
    phone: string;
    address?: string;
    creditLimit?: number;
    createdBy?: string | null;
  }) => Promise<Customer>;
  updateCustomerImage: (id: string, imageUrl: string | null) => Promise<void>;
  archiveCustomer: (id: string) => Promise<void>;
  updateDueDate: (id: string, dueDate: string | null) => Promise<void>;
  restoreCustomer: (id: string) => Promise<void>;
  /** Get customer snapshot for historical sale display */
  getSnapshot: (customerId: string) => { name: string; phone: string; address?: string } | null;
  requestCreditLimitIncrease: (input: {
    customerId: string;
    customerName: string;
    currentLimit: number;
    requestedLimit: number;
    requestedBy: string;
  }) => Promise<void>;
  loadCreditLimitRequests: () => Promise<CreditLimitRequest[]>;
  approveCreditLimitRequest: (requestId: string, reviewedBy: string) => Promise<void>;
  rejectCreditLimitRequest: (requestId: string, reviewedBy: string, reason?: string) => Promise<void>;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuidOrNull = (id?: string | null) =>
  id && UUID_RE.test(id) ? id : null;

export const useCustomersStore = create<CustomersState>((set, get) => ({
  customers: [],
  loading: false,
  ready: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });

    // Stale-while-revalidate: show cached data immediately
    const cached = getCachedData<Customer[]>(CACHE_KEY);
    const stale = isCacheStale(CACHE_KEY);
    const storeEmpty = get().customers.length === 0;

    // If cache is fresh AND store already has data, skip fetch
    if (cached && !stale && !storeEmpty) {
      set({ customers: cached, loading: false, ready: true });
      return;
    }

    if (cached && stale) {
      set({ customers: cached, loading: false, ready: true });
    }

    try {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("is_archived", false)
        .order("name");
      if (error) {
        if (!cached) {
          set({ loading: false, ready: true, error: error.message });
        }
        return;
      }
      const customers = (data as CustomerRow[]).map(customerFromRow);
      setCachedData(CACHE_KEY, customers);
      set({ customers, loading: false, ready: true });
    } catch {
      if (!cached) {
        set({ loading: false, ready: true, error: "Offline — showing cached data" });
      }
    }
  },

  subscribe: () => {
    if (channel) return () => {};
    channel = supabase
      .channel("customers-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers" },
        async () => { await get().load(); }
      )
      .subscribe();
    return () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
  },

  createCustomer: async (input) => {
    const rowPayload = {
      name: input.name,
      phone: input.phone,
      address: input.address ?? null,
      credit_limit: input.creditLimit ?? 0,
      created_by: asUuidOrNull(input.createdBy),
    };

    // Try online first - use RPC for secure creation
    try {
      const { data, error } = await supabase.rpc("create_customer", {
        payload: rowPayload,
      });
      if (error) throw error;
      
      // Build customer from RPC response + input data (avoids fragile re-fetch)
      const customer: Customer = {
        id: data.id,
        name: input.name,
        phone: input.phone,
        address: input.address,
        creditLimit: input.creditLimit ?? 0,
        outstandingBalance: 0,
        totalPurchases: 0,
        totalPaid: 0,
        dueDate: null,
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy ?? "",
      };
      const updated = [customer, ...get().customers];
      set({ customers: updated });
      setCachedData(CACHE_KEY, updated);
      return customer;
    } catch (err) {
      // If network error, queue for later
      if (!navigator.onLine || (err instanceof Error && err.message.includes("fetch"))) {
        const tempId = `offline-cust-${Date.now()}`;
        const tempCustomer: Customer = {
          id: tempId,
          name: input.name,
          phone: input.phone,
          address: input.address,
          creditLimit: input.creditLimit ?? 0,
          outstandingBalance: 0,
          totalPurchases: 0,
          totalPaid: 0,
          dueDate: null,
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy ?? "",
        };
        const updatedOffline = [tempCustomer, ...get().customers];
        set({ customers: updatedOffline });
        setCachedData(CACHE_KEY, updatedOffline);
        enqueueOperation({ type: "create_customer", payload: rowPayload });
        return tempCustomer;
      }
      throw err;
    }
  },

  updateCustomerImage: async (id, imageUrl) => {
    const { error } = await supabase.rpc("update_customer_image", {
      p_customer_id: id,
      p_image_url: imageUrl,
    });
    if (error) throw new Error(error.message);
    set({
      customers: get().customers.map((c) =>
        c.id === id ? { ...c, imageUrl: imageUrl ?? undefined } : c
      ),
    });
  },

  archiveCustomer: async (id) => {
    const { error } = await supabase.rpc("archive_customer", {
      p_customer_id: id,
    });
    if (error) throw new Error(error.message);
    // Remove from local list + invalidate cache so stale data doesn't reappear
    const remaining = get().customers.filter((c) => c.id !== id);
    set({ customers: remaining });
    setCachedData(CACHE_KEY, remaining);
  },

  restoreCustomer: async (id) => {
    const { error } = await supabase.rpc("restore_customer", {
      p_customer_id: id,
    });
    if (error) throw new Error(error.message);
    // Invalidate cache so next load() fetches fresh data from DB
    clearCachedData(CACHE_KEY);
    await get().load();
  },

  updateDueDate: async (id, dueDate) => {
    // Reject past dates — due date must be today or future
    if (dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(dueDate) < today) {
        throw new Error("Due date cannot be in the past");
      }
    }
    // Invalidate cache so next load() fetches fresh data
    localStorage.removeItem("agrishop_cache_customers");
    const { error } = await supabase.rpc("update_customer_due_date", {
      p_customer_id: id,
      p_due_date: dueDate || '',
    });
    if (error) throw new Error(error.message);
    set({
      customers: get().customers.map((c) =>
        c.id === id ? { ...c, dueDate } : c
      ),
    });
  },

  getSnapshot: (customerId) => {
    const c = get().customers.find((cu) => cu.id === customerId);
    if (!c) return null;
    return { name: c.name, phone: c.phone, address: c.address };
  },

  requestCreditLimitIncrease: async (input) => {
    const { createCreditRequest } = await import("@/lib/localGroupRegistry");
    await createCreditRequest({
      customerId: input.customerId,
      customerName: input.customerName,
      currentLimit: input.currentLimit,
      requestedLimit: input.requestedLimit,
      requestedBy: input.requestedBy,
      reason: (input as any).reason || "",
    });
  },

  loadCreditLimitRequests: async () => {
    try {
      const { getCreditRequests } = await import("@/lib/localGroupRegistry");
      return getCreditRequests();
    } catch {
      return [];
    }
  },

  approveCreditLimitRequest: async (requestId, reviewedBy) => {
    const { approveCreditRequest } = await import("@/lib/localGroupRegistry");
    await approveCreditRequest(requestId, reviewedBy);
    // Reload customers to reflect updated credit limit
    await get().load();
  },

  rejectCreditLimitRequest: async (requestId, reviewedBy, reason) => {
    const { rejectCreditRequest } = await import("@/lib/localGroupRegistry");
    await rejectCreditRequest(requestId, reviewedBy, reason);
  },
}));
