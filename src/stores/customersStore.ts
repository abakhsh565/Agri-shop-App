import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { getCachedData, setCachedData, isCacheStale } from "@/lib/localCache";
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
    createdAt: r.created_at,
    createdBy: r.created_by ?? "",
    isArchived: r.is_archived ?? false,
    archivedAt: r.archived_at,
    archivedBy: r.archived_by,
  };
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
  restoreCustomer: (id: string) => Promise<void>;
  /** Get customer snapshot for historical sale display */
  getSnapshot: (customerId: string) => { name: string; phone: string; address?: string } | null;
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

    if (cached && !stale) {
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

    // Try online first
    try {
      const { data, error } = await supabase
        .from("customers")
        .insert(rowPayload)
        .select()
        .single();
      if (error) throw error;
      const customer = customerFromRow(data as CustomerRow);
      set({ customers: [customer, ...get().customers] });
      setCachedData(CACHE_KEY, [customer, ...get().customers]);
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
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy ?? "",
        };
        set({ customers: [tempCustomer, ...get().customers] });
        setCachedData(CACHE_KEY, [tempCustomer, ...get().customers]);
        enqueueOperation({ type: "create_customer", payload: rowPayload });
        return tempCustomer;
      }
      throw err;
    }
  },

  updateCustomerImage: async (id, imageUrl) => {
    const { error } = await supabase
      .from("customers")
      .update({ image_url: imageUrl })
      .eq("id", id);
    if (error) throw new Error(error.message);
    set({
      customers: get().customers.map((c) =>
        c.id === id ? { ...c, imageUrl: imageUrl ?? undefined } : c
      ),
    });
  },

  archiveCustomer: async (id) => {
    // Try RPC first (works if migration 0027 is deployed)
    const { error: rpcErr } = await supabase.rpc("archive_customer", {
      p_customer_id: id,
    });
    if (rpcErr) {
      // Fallback: direct update (bypasses RLS via SECURITY DEFINER not available)
      const { error } = await supabase
        .from("customers")
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq("id", id)
        .select();
      if (error) throw new Error(error.message);
    }
    set({
      customers: get().customers.map((c) =>
        c.id === id ? { ...c, isArchived: true, archivedAt: new Date().toISOString() } : c
      ),
    });
  },

  restoreCustomer: async (id) => {
    // Try RPC first (works if migration 0027 is deployed)
    const { error: rpcErr } = await supabase.rpc("restore_customer", {
      p_customer_id: id,
    });
    if (rpcErr) {
      // Fallback: direct update
      const { error } = await supabase
        .from("customers")
        .update({ is_archived: false, archived_at: null, archived_by: null })
        .eq("id", id)
        .select();
      if (error) throw new Error(error.message);
    }
    set({
      customers: get().customers.map((c) =>
        c.id === id ? { ...c, isArchived: false, archivedAt: null, archivedBy: null } : c
      ),
    });
  },

  getSnapshot: (customerId) => {
    const c = get().customers.find((cu) => cu.id === customerId);
    if (!c) return null;
    return { name: c.name, phone: c.phone, address: c.address };
  },
}));
