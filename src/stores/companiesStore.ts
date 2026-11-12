import { create } from "zustand";
import { captureDataContext, isDataContextCurrent } from "@/lib/localCache";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { tNow } from "@/lib/i18n";
import { resolveImageUrl } from "@/lib/storage";
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

/** What this supplier is owed for the branch being worked in (0242). */
interface BranchCompanyBalanceRow {
  company_id: string;
  total_purchases: number | string;
  total_paid: number | string;
  outstanding_payable: number | string;
}

function companyFromRow(r: CompanyRow): Company {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    logoUrl: resolveImageUrl(r.logo_url),
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
  archiveCompany: (id: string) => Promise<void>;
  /** Drop every row: the app is about to read a different shop. */
  reset: () => void;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useCompaniesStore = create<CompaniesState>((set, get) => ({
  companies: [],
  loading: false,
  ready: false,
  error: null,

  // The active shop changed: suppliers belong to the shop that was being read.
  reset: () => set({ companies: [], loading: false, ready: false, error: null }),

  load: async () => {
    const context = captureDataContext();
    if (!isDataContextCurrent(context)) return;
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      // Archived suppliers leave the operational lists (pickers, payable totals). Their
      // purchase history is untouched — purchases keep their own company snapshot.
      .eq("is_active", true)
      .order("name");
    if (!isDataContextCurrent(context)) return;
    if (error) {
      set({ loading: false, ready: true, error: error.message });
      return;
    }
    const mapped = (data as CompanyRow[]).map(companyFromRow);

    // Payables are branch money too. The supplier row's shop-wide column answers a
    // different question, and using it here put another branch's debt on this one.
    // A failed read falls back to zero, never to the shop total.
    const { data: branchBalances, error: balanceError } = await supabase.rpc(
      "get_branch_company_balances"
    );
    if (!isDataContextCurrent(context)) return;
    const balanceById = new Map<string, BranchCompanyBalanceRow>(
      balanceError
        ? []
        : ((branchBalances as BranchCompanyBalanceRow[] | null) ?? []).map((row) => [
            row.company_id,
            row,
          ])
    );
    set({
      companies: mapped.map((company) => {
        const balance = balanceById.get(company.id);
        if (!balance) {
          return { ...company, totalPurchases: 0, outstandingPayable: 0 };
        }
        return {
          ...company,
          totalPurchases: Number(balance.total_purchases),
          outstandingPayable: Number(balance.outstanding_payable),
        };
      }),
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
    // Use SECURITY DEFINER RPC — bypasses RLS which requires valid JWT session.
    // The RPC resolves tenant context from JWT claims server-side.
    const { data, error } = await supabase.rpc("create_company", {
      payload: {
        name: input.name,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        logoUrl: input.logoUrl ?? null,
        userId: useAuthStore.getState().user?.id ?? null,
      },
    });
    if (error) throw new Error(error.message);
    // RPC returns { id, name } — build the company object from the input
    const company: Company = {
      id: data.id,
      name: data.name,
      contactPerson: input.contactPerson,
      phone: input.phone,
      address: input.address,
      logoUrl: resolveImageUrl(input.logoUrl),
      outstandingPayable: 0,
      totalPurchases: 0,
      dueDate: null,
      createdAt: new Date().toISOString(),
    };
    set({ companies: [company, ...get().companies] });
    return company;
  },

  archiveCompany: async (id) => {
    const { error } = await supabase.rpc("archive_company", { p_company_id: id });
    if (error) {
      // The database refuses to hide a supplier that is still owed money, so the
      // payable cannot vanish from Payments while the debt remains. Say why in the
      // owner's own language instead of showing the raw error code.
      const name = get().companies.find((c) => c.id === id)?.name ?? "";
      if (error.message.includes("COMPANY_HAS_PAYABLE")) {
        throw new Error(tNow("company.cannotArchivePayable", { name }));
      }
      throw new Error(error.message);
    }
    set({ companies: get().companies.filter((c) => c.id !== id) });
  },

  updateCompany: async (id, input) => {
    // Safe to rename: `products` references its supplier by `company_id`, not by
    // name, so a rename cannot orphan a product. Recorded purchases keep their own
    // company_name snapshot and are never rewritten. Only these display/contact
    // fields are editable — nothing here feeds a financial total.
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
              // Same normalisation as a row read back from the database, so the logo that
              // appears here the instant it is saved is the one every other screen will load.
              ...(input.logoUrl !== undefined && { logoUrl: resolveImageUrl(input.logoUrl) }),
            }
          : c
      ),
    });
  },
}));
