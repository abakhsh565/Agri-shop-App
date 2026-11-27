import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { prepareChatImage, uploadChatMedia, type ChatMediaMeta } from "@/lib/chatMedia";

/**
 * The branch's live channel. The database broadcasts a message, a credit move and a visit move to
 * `shop:<shop_id>` in the same transaction that writes it (0339), and an active member of that
 * shop is the only subscriber the channel's policy admits. One channel per open screen: a second
 * subscriber replaces the first rather than stacking listeners.
 */
let shopChannel: RealtimeChannel | null = null;

/**
 * Farmer conversations: the store behind the Messages tab.
 *
 * WHY A STORE AND NOT `useEffect` IN THE SCREEN. The list, the thread and the four actions all
 * read the same server shapes, and a second screen (the thread) opens from the first. Keeping the
 * shapes here means the RPC contract is written down once, and the screens stay presentation.
 *
 * WHAT IT DOES NOT DO. It does not decide who may act: every call goes to a SECURITY DEFINER RPC
 * that re-reads the caller's membership from the session. It does not invent a delivery either —
 * `send` returns what the server actually recorded, and the screen says that.
 */

export interface FarmerThreadRow {
  farmer_id: string;
  name: string;
  phone: string;
  village: string | null;
  app_ready: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  open_requests: number;
  open_visits: number;
}

export interface FarmerMessage {
  id: string;
  direction: "owner" | "farmer";
  channel: "app" | "whatsapp";
  body: string;
  delivered_to_app_at: string | null;
  created_at: string;
}

export interface CreditRequest {
  id: string;
  status: "submitted" | "offer_sent" | "accepted" | "declined" | "cancelled";
  requested_amount: number | null;
  requested_note: string | null;
  offer_lines: Array<{ name?: string; qty?: number; unit?: string; price?: number }> | null;
  offer_total: number | null;
  offer_due_on: string | null;
  offer_note: string | null;
  revision: number;
  created_at: string;
  decided_at: string | null;
}

export interface VisitRequest {
  id: string;
  status: "requested" | "scheduled" | "in_progress" | "completed" | "cancelled";
  purpose: string;
  preferred_window: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  scheduled_for: string | null;
  owner_note: string | null;
  created_at: string;
  timeline: Array<{ status: string; actor: string; note: string | null; created_at: string }>;
}

export interface FarmerThread {
  /**
   * The branch this conversation belongs to. Two branches of one business have two separate
   * threads with the same farmer, and this is what tells them apart on screen (0338).
   */
  shop?: {
    id: string;
    name: string;
    city: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  farmer: {
    id: string;
    name: string;
    phone: string;
    village: string | null;
    latitude: number | null;
    longitude: number | null;
    app_ready: boolean;
    whatsapp_opted_in: boolean;
    since: string;
  };
  messages: FarmerMessage[];
  requests: CreditRequest[];
  visits: VisitRequest[];
}

export interface AssignableOfficer {
  user_id: string;
  name: string;
  role: string;
}

/**
 * One thing genuinely waiting on the owner: an ask with no offer, a visit with no officer.
 * The Messages screen's queue and the dashboard count read the same RPC, so they cannot disagree.
 */
export interface FarmerAction {
  farmer_id: string;
  farmer_name: string;
  farmer_phone: string;
  farmer_village: string | null;
  kind: "credit" | "visit";
  ref_id: string;
  status: string;
  amount: number | null;
  purpose: string | null;
  scheduled_for: string | null;
  created_at: string;
}

/** A visit assigned to the signed-in employee, with only what a field visit needs. */
export interface MyVisit {
  id: string;
  farmer_id: string;
  farmer_name: string;
  farmer_phone: string;
  farmer_village: string | null;
  status: "scheduled" | "in_progress";
  purpose: string;
  preferred_window: string | null;
  scheduled_for: string | null;
  owner_note: string | null;
  created_at: string;
}

interface FarmerMessagesState {
  threads: FarmerThreadRow[];
  threadsLoading: boolean;
  thread: FarmerThread | null;
  threadLoading: boolean;
  actions: FarmerAction[];
  actionsLoading: boolean;
  myVisits: MyVisit[];
  myVisitsLoading: boolean;
  /** Files in the open conversation, by message id. Empty for a text-only thread. */
  media: Record<string, ChatMediaMeta>;

  loadThreads: (search?: string) => Promise<void>;
  /** `markRead: false` opens the record without consuming the conversation's unread count. */
  loadThread: (farmerId: string, options?: { markRead?: boolean }) => Promise<void>;
  loadActions: () => Promise<void>;
  loadMyVisits: () => Promise<void>;
  registerFarmer: (input: { phone: string; name: string; village?: string }) => Promise<string>;
  /** Issue (or rotate) this farmer's app credential. The plaintext is returned once. */
  issueFarmerToken: (farmerId: string) => Promise<string>;
  /** The shop's printed farmer code, made on first look and stable afterwards. */
  shopJoinCode: () => Promise<{ code: string; shop_name: string }>;
  send: (farmerId: string, body: string, via: "app" | "whatsapp") => Promise<{ delivered_to_app: boolean }>;
  /** Record a voice note: upload the bytes, then let the server write the message. */
  sendVoice: (farmerId: string, blob: Blob, mimeType: string, durationMs: number) => Promise<void>;
  /** Send a photo, with an optional caption. */
  sendImage: (farmerId: string, file: File | Blob, caption?: string) => Promise<void>;
  /** The conversation's files, keyed by message id. Called with the thread. */
  loadMedia: (farmerId: string) => Promise<void>;
  markRead: (farmerId: string) => Promise<void>;
  reviseOffer: (input: {
    requestId: string;
    lines: Array<{ name: string; qty: number; unit: string; price: number }>;
    total: number;
    dueOn?: string | null;
    note?: string | null;
  }) => Promise<void>;
  closeRequest: (requestId: string) => Promise<void>;
  scheduleVisit: (input: {
    visitId: string;
    employeeId: string;
    scheduledFor: string;
    note?: string | null;
  }) => Promise<void>;
  advanceVisit: (visitId: string, status: string, note?: string | null) => Promise<void>;
  listOfficers: () => Promise<AssignableOfficer[]>;
  /**
   * Listen to the branch's own conversation. Returns once the channel has settled (subscribed or
   * refused), so the screen can fall back to its poll rather than wait forever.
   */
  subscribeShop: (
    shopId: string,
    onChange: (event: "message" | "request" | "visit") => void,
  ) => Promise<void>;
  unsubscribeShop: () => Promise<void>;
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "UNKNOWN");
}

export const useFarmerMessagesStore = create<FarmerMessagesState>((set, get) => ({
  threads: [],
  threadsLoading: false,
  thread: null,
  threadLoading: false,
  actions: [],
  actionsLoading: false,
  myVisits: [],
  media: {},
  myVisitsLoading: false,

  async loadThreads(search) {
    set({ threadsLoading: true });
    try {
      const { data, error } = await supabase.rpc("list_farmer_threads", {
        p_search: search?.trim() ? search.trim() : null,
      });
      if (error) fail(error);
      set({ threads: (data as FarmerThreadRow[]) ?? [] });
    } finally {
      set({ threadsLoading: false });
    }
  },

  async loadThread(farmerId, options) {
    set({ threadLoading: true });
    try {
      const { data, error } = await supabase.rpc("get_farmer_thread", { p_farmer_id: farmerId });
      if (error) fail(error);
      set({ thread: (data as FarmerThread) ?? null, media: {} });
      if (options?.markRead !== false) await get().markRead(farmerId);
      // Files are read once per open thread, not once per message.
      await get().loadMedia(farmerId);
    } finally {
      set({ threadLoading: false });
    }
  },

  async loadActions() {
    set({ actionsLoading: true });
    try {
      const { data, error } = await supabase.rpc("list_farmer_actions");
      if (error) fail(error);
      set({ actions: (data as FarmerAction[]) ?? [] });
    } finally {
      set({ actionsLoading: false });
    }
  },

  async loadMyVisits() {
    set({ myVisitsLoading: true });
    try {
      const { data, error } = await supabase.rpc("list_my_farmer_visits");
      if (error) fail(error);
      set({ myVisits: (data as MyVisit[]) ?? [] });
    } finally {
      set({ myVisitsLoading: false });
    }
  },

  async registerFarmer(input) {
    const { data, error } = await supabase.rpc("register_farmer", {
      p_phone: input.phone,
      p_name: input.name,
      p_village: input.village?.trim() ? input.village.trim() : null,
    });
    if (error) fail(error);
    return String((data as { id: string }).id);
  },

  async issueFarmerToken(farmerId) {
    const { data, error } = await supabase.rpc("issue_farmer_app_token", { p_farmer_id: farmerId });
    if (error) fail(error);
    return String(data);
  },

  async shopJoinCode() {
    const { data, error } = await supabase.rpc("shop_farmer_join_code");
    if (error) fail(error);
    return data as { code: string; shop_name: string };
  },

  async send(farmerId, body, via) {
    const { data, error } = await supabase.rpc("send_farmer_message", {
      p_farmer_id: farmerId,
      p_body: body,
      p_via: via,
    });
    if (error) fail(error);
    return data as { delivered_to_app: boolean };
  },

  async sendVoice(farmerId, blob, mimeType, durationMs) {
    const uploaded = await uploadChatMedia({
      farmerId,
      kind: "voice",
      bytes: blob,
      mimeType,
      durationMs,
    });
    const { error } = await supabase.rpc("send_farmer_attachment", {
      p_farmer_id: farmerId,
      p_kind: "voice",
      p_storage_path: uploaded.storage_path,
      p_mime_type: mimeType,
      p_size_bytes: uploaded.size_bytes,
      p_duration_ms: Math.round(durationMs),
      p_body: null,
    });
    if (error) fail(error);
    await get().loadThread(farmerId, { markRead: false });
  },

  async sendImage(farmerId, file, caption) {
    // The upload is the compressed file, never the camera original: the receiver is the farmer app
    // on a rural connection, and 400 KB is the agreed ceiling.
    const prepared = await prepareChatImage(
      file instanceof File
        ? file
        : new File([file as Blob], "photo.jpg", { type: file.type || "image/jpeg" }),
    );
    const mimeType = prepared.file.type || "image/jpeg";
    const uploaded = await uploadChatMedia({
      farmerId,
      kind: "image",
      bytes: prepared.file,
      mimeType,
    });
    const { error } = await supabase.rpc("send_farmer_attachment", {
      p_farmer_id: farmerId,
      p_kind: "image",
      p_storage_path: uploaded.storage_path,
      p_mime_type: mimeType,
      p_size_bytes: uploaded.size_bytes,
      p_duration_ms: null,
      p_body: caption?.trim() ? caption.trim() : null,
    });
    if (error) fail(error);
    await get().loadThread(farmerId, { markRead: false });
  },

  async loadMedia(farmerId) {
    const { data, error } = await supabase.rpc("get_farmer_media", { p_farmer_id: farmerId });
    // A thread without files is the normal case, not an error to show: 0325-era conversations
    // simply have none until 0336 is applied.
    if (error) {
      set({ media: {} });
      return;
    }
    const list = (data as ChatMediaMeta[] | null) ?? [];
    set({ media: Object.fromEntries(list.map((item) => [item.message_id, item])) });
  },

  async markRead(farmerId) {
    await supabase.rpc("mark_farmer_thread_read", { p_farmer_id: farmerId });
  },

  async reviseOffer(input) {
    const { error } = await supabase.rpc("revise_farmer_credit_request", {
      p_request_id: input.requestId,
      p_lines: input.lines,
      p_total: input.total,
      p_due_on: input.dueOn ?? null,
      p_note: input.note ?? null,
    });
    if (error) fail(error);
  },

  async closeRequest(requestId) {
    const { error } = await supabase.rpc("close_farmer_credit_request", {
      p_request_id: requestId,
      p_reason: null,
    });
    if (error) fail(error);
  },

  async scheduleVisit(input) {
    const { error } = await supabase.rpc("schedule_farmer_visit", {
      p_visit_id: input.visitId,
      p_employee_id: input.employeeId,
      p_scheduled: input.scheduledFor,
      p_note: input.note ?? null,
    });
    if (error) fail(error);
  },

  async advanceVisit(visitId, status, note) {
    const { error } = await supabase.rpc("advance_farmer_visit", {
      p_visit_id: visitId,
      p_status: status,
      p_note: note ?? null,
    });
    if (error) fail(error);
  },

  async listOfficers() {
    const { data, error } = await supabase.rpc("list_assignable_officers");
    if (error) fail(error);
    return (data as AssignableOfficer[]) ?? [];
  },

  async subscribeShop(shopId, onChange) {
    await get().unsubscribeShop();
    if (!shopId) return;

    const channel = supabase.channel(`shop:${shopId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "message" }, () => onChange("message"));
    channel.on("broadcast", { event: "request" }, () => onChange("request"));
    channel.on("broadcast", { event: "visit" }, () => onChange("visit"));
    shopChannel = channel;

    await new Promise<void>((resolve) => {
      let settled = false;
      channel.subscribe((status) => {
        if (settled) return;
        // `CHANNEL_ERROR` is a real answer too: the screen keeps its poll instead of hanging.
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settled = true;
          resolve();
        }
      });
    });
  },

  async unsubscribeShop() {
    if (!shopChannel) return;
    const channel = shopChannel;
    shopChannel = null;
    await supabase.removeChannel(channel);
  },
}));
