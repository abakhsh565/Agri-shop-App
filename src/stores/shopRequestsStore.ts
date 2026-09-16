import { create } from "zustand";
import { supabase } from "@/lib/supabase";

export type ShopRequestStatus = "pending" | "approved" | "hold" | "rejected";

export interface ShopRequest {
  id: string;
  ownerName: string;
  ownerPhone: string;
  shopName: string;
  shopAddress?: string;
  shopCity?: string;
  shopType: string;
  businessRegistrationNumber?: string;
  logoUrl?: string;
  cnicFrontUrl?: string;
  cnicBackUrl?: string;
  businessLicenseUrl?: string;
  status: ShopRequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface ShopRequestRow {
  id: string;
  owner_name: string;
  owner_phone: string;
  shop_name: string;
  shop_address: string | null;
  shop_city: string | null;
  shop_type: string;
  business_registration_number: string | null;
  logo_url: string | null;
  cnic_front_url: string | null;
  cnic_back_url: string | null;
  business_license_url: string | null;
  status: ShopRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

function requestFromRow(r: ShopRequestRow): ShopRequest {
  return {
    id: r.id,
    ownerName: r.owner_name,
    ownerPhone: r.owner_phone,
    shopName: r.shop_name,
    shopAddress: r.shop_address ?? undefined,
    shopCity: r.shop_city ?? undefined,
    shopType: r.shop_type,
    businessRegistrationNumber: r.business_registration_number ?? undefined,
    logoUrl: r.logo_url ?? undefined,
    cnicFrontUrl: r.cnic_front_url ?? undefined,
    cnicBackUrl: r.cnic_back_url ?? undefined,
    businessLicenseUrl: r.business_license_url ?? undefined,
    status: r.status,
    reviewedBy: r.reviewed_by ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
    rejectionReason: r.rejection_reason ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface ShopRequestsState {
  requests: ShopRequest[];
  myRequest: ShopRequest | null;
  loading: boolean;
  error: string | null;

  // Owner actions
  submitRequest: (input: {
    ownerName: string;
    ownerPhone: string;
    shopName: string;
    shopAddress?: string;
    shopCity?: string;
    shopType?: string;
    businessRegistrationNumber?: string;
    logoUrl?: string;
    cnicFrontUrl?: string;
    cnicBackUrl?: string;
    businessLicenseUrl?: string;
  }) => Promise<{ success: boolean; error?: string }>;

  loadMyRequest: (phone: string) => Promise<void>;

  // Admin actions
  loadAllRequests: () => Promise<void>;
  approveRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  rejectRequest: (requestId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
}

export const useShopRequestsStore = create<ShopRequestsState>((set, get) => ({
  requests: [],
  myRequest: null,
  loading: false,
  error: null,

  submitRequest: async (input) => {
    set({ loading: true, error: null });
    try {
      // Use SECURITY DEFINER RPC to bypass RLS issues on shop_requests
      const { data, error } = await supabase.rpc("insert_shop_request", {
        p_owner_name: input.ownerName,
        p_owner_phone: input.ownerPhone,
        p_phone: input.ownerPhone,
        p_shop_name: input.shopName,
        p_shop_type: input.shopType ?? "retail",
        p_shop_city: input.shopCity ?? null,
        p_shop_address: input.shopAddress ?? null,
        p_business_registration_number: input.businessRegistrationNumber ?? null,
      });

      if (error) {
        set({ loading: false, error: error.message });
        return { success: false, error: error.message };
      }

      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (!result?.success) {
        const msg = result?.error || "Failed to submit request";
        set({ loading: false, error: msg });
        return { success: false, error: msg };
      }

      // Build a minimal request object for the store
      const request: ShopRequest = {
        id: result.id,
        ownerName: input.ownerName,
        ownerPhone: input.ownerPhone,
        shopName: input.shopName,
        shopAddress: input.shopAddress,
        shopCity: input.shopCity,
        shopType: input.shopType ?? "retail",
        businessRegistrationNumber: input.businessRegistrationNumber,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      set({ loading: false, myRequest: request });
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit request";
      set({ loading: false, error: msg });
      return { success: false, error: msg };
    }
  },

  loadMyRequest: async (phone) => {
    set({ loading: true });
    try {
      // Use SECURITY DEFINER RPC to bypass RLS issues
      const { data, error } = await supabase.rpc("get_my_shop_request", {
        p_phone: phone,
      });

      if (error || !data) {
        set({ loading: false, myRequest: null });
        return;
      }

      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (!result?.found || !result?.request) {
        set({ loading: false, myRequest: null });
        return;
      }

      set({ loading: false, myRequest: requestFromRow(result.request as ShopRequestRow) });
    } catch {
      set({ loading: false, myRequest: null });
    }
  },

  loadAllRequests: async () => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from("shop_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        set({ loading: false, error: error.message });
        return;
      }

      const requests = (data as ShopRequestRow[]).map(requestFromRow);
      set({ loading: false, requests });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load requests";
      set({ loading: false, error: msg });
    }
  },

  approveRequest: async (requestId) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase
        .from("shop_requests")
        .update({
          status: "approved",
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) {
        set({ loading: false, error: error.message });
        return { success: false, error: error.message };
      }

      await get().loadAllRequests();
      set({ loading: false });
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to approve request";
      set({ loading: false, error: msg });
      return { success: false, error: msg };
    }
  },

  rejectRequest: async (requestId, reason) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase
        .from("shop_requests")
        .update({
          status: "rejected",
          rejection_reason: reason ?? null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) {
        set({ loading: false, error: error.message });
        return { success: false, error: error.message };
      }

      await get().loadAllRequests();
      set({ loading: false });
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to reject request";
      set({ loading: false, error: msg });
      return { success: false, error: msg };
    }
  },
}));
