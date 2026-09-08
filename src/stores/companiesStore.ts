import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { Company } from "@/types";

interface CompanyRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  outstanding_payable: number;
  total_purchases: number;
  due_date: string | null;
  created_at: string;
}

function companyFromRow(r: CompanyRow): Company {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    logoUrl: r.logo_url ?? undefined,
    outstandingPayable: Number(r.outstanding_payable),
    totalPurchases: Number(r.total_purchases),
    dueDate: r.due_date ?? null,
    createdAt: r.created_at,
  };
}

interface CompaniesState {
  companies: Company[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  subscribe: () => () => void;
  createCompany: (input: {
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    logoUrl?: string;
  }) => Promise<Company>;
  updateCompany: (id: string, input: {
    name?: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    logoUrl?: string;
  }) => Promise<void>;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useCompaniesStore = create<CompaniesState>((set, get) => ({
  companies: [],
  loading: false,
  ready: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("name");
    if (error) {
      set({ loading: false, ready: true, error: error.message });
      return;
    }
    set({
      companies: (data as CompanyRow[]).map(companyFromRow),
      loading: false,
      ready: true,
    });
  },

  subscribe: () => {
    if (channel) return () => {};
    channel = supabase
      .channel("companies-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "companies" },
        async () => { await get().load(); }
      )
      .subscribe();
    return () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
  },

  createCompany: async (input) => {
    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: input.name,
        contact_person: input.contactPerson ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        logo_url: input.logoUrl ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const company = companyFromRow(data as CompanyRow);
    set({ companies: [company, ...get().companies] });
    return company;
  },

  updateCompany: async (id, input) => {
    const { error } = await supabase
      .from("companies")
      .update({
        name: input.name,
        contact_person: input.contactPerson,
        phone: input.phone,
        address: input.address,
        logo_url: input.logoUrl,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    // Update local state
    set({
      companies: get().companies.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(input.name !== undefined && { name: input.name }),
              ...(input.contactPerson !== undefined && { contactPerson: input.contactPerson }),
              ...(input.phone !== undefined && { phone: input.phone }),
              ...(input.address !== undefined && { address: input.address }),
              ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
            }
          : c
      ),
    });
  },
}));
