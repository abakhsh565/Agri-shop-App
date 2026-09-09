/**
 * localStorage-based registry for Group Reminders and Credit Limit Requests.
 *
 * WHY: The Supabase migrations (20260903_reminder_groups.sql, 20260903_credit_limit_requests.sql)
 * have not been deployed. The reminder_configs table lacks group_id/group_name columns,
 * and the credit_limit_requests table doesn't exist.
 *
 * This module provides a working localStorage-based fallback so the features are functional NOW.
 * When the migrations are deployed, this code should be replaced with proper Supabase queries.
 *
 * IMPORTANT: Individual reminder_configs are still saved to Supabase per-customer.
 * Only the GROUP METADATA (which customers belong to which group) is stored here.
 */

import { supabase } from "@/lib/supabase";
import type { ReminderConfig } from "@/types";

// ── Types ──

export interface LocalGroupEntry {
  id: string;
  name: string;
  config: {
    enabled: boolean;
    startDays: number;
    anchor: string;
    repeatType: string;
    intervalN: number;
    intervalUnit: string;
    escalation: any[];
    ends: string;
    endsDate: string | null;
    endsCount: number;
  };
  customerIds: string[];
  createdAt: string;
}

export interface LocalCreditRequest {
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
  reason: string;
  createdAt: string;
}

// ── Group Registry ──

const GROUP_KEY = "agri_group_registry";

function readGroupRegistry(): LocalGroupEntry[] {
  try {
    const raw = localStorage.getItem(GROUP_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeGroupRegistry(groups: LocalGroupEntry[]): void {
  localStorage.setItem(GROUP_KEY, JSON.stringify(groups));
}

/** Save a group: create individual reminder_configs in Supabase + store group metadata in localStorage */
export async function saveLocalGroup(
  config: ReminderConfig,
  customerIds: string[],
  groupName: string
): Promise<void> {
  const groupId = "grp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  // 1. Save individual reminder_configs to Supabase (without group columns)
  const configPayload = {
    enabled: config.enabled,
    start_days: config.startDays,
    anchor: config.anchor,
    repeat_type: config.repeat,
    interval_n: config.intervalN,
    interval_unit: config.intervalUnit,
    escalation: config.escalation,
    ends: config.ends,
    ends_date: config.endsDate || null,
    ends_count: config.endsCount,
  };

  const rows = customerIds.map((customerId) => ({
    ...configPayload,
    customer_id: customerId,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("reminder_configs").insert(rows);
  if (error) {
    console.error("Failed to save reminder configs:", error);
    throw error;
  }

  // 2. Store group metadata in localStorage
  const groups = readGroupRegistry();
  groups.push({
    id: groupId,
    name: groupName,
    config: {
      enabled: config.enabled,
      startDays: config.startDays,
      anchor: config.anchor,
      repeatType: config.repeat,
      intervalN: config.intervalN,
      intervalUnit: config.intervalUnit,
      escalation: config.escalation,
      ends: config.ends,
      endsDate: config.endsDate,
      endsCount: config.endsCount,
    },
    customerIds,
    createdAt: new Date().toISOString(),
  });
  writeGroupRegistry(groups);
}

/** Load all groups from localStorage, enriched with customer data from Supabase */
export async function loadLocalGroups(): Promise<
  Array<{
    id: string;
    name: string;
    createdAt: string;
    customerCount: number;
    customers: Array<{ id: string; name: string; outstandingBalance: number; dueDate: string | null; imageUrl?: string }>;
    config: any;
  }>
> {
  const groups = readGroupRegistry();
  if (groups.length === 0) return [];

  // Collect all customer IDs across all groups
  const allCustomerIds = [...new Set(groups.flatMap((g) => g.customerIds))];
  if (allCustomerIds.length === 0) return [];

  // Fetch customer details from Supabase
  const { data: custRows } = await supabase
    .from("customers")
    .select("id, name, outstanding_balance, due_date, image_url")
    .in("id", allCustomerIds);

  const custMap = new Map<string, any>();
  (custRows || []).forEach((c: any) => custMap.set(c.id, c));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    createdAt: g.createdAt,
    customerCount: g.customerIds.length,
    customers: g.customerIds.map((cId) => {
      const c = custMap.get(cId);
      return {
        id: cId,
        name: c?.name || "Unknown",
        outstandingBalance: c?.outstanding_balance || 0,
        dueDate: c?.due_date || null,
        imageUrl: c?.image_url || undefined,
      };
    }),
    config: g.config,
  }));
}

/** Delete a group: remove individual reminder_configs from Supabase + remove metadata from localStorage */
export async function deleteLocalGroup(groupId: string): Promise<void> {
  const groups = readGroupRegistry();
  const group = groups.find((g) => g.id === groupId);

  if (group) {
    // Delete individual reminder_configs from Supabase
    for (const customerId of group.customerIds) {
      await supabase
        .from("reminder_configs")
        .delete()
        .eq("customer_id", customerId)
        .eq("anchor", group.config.anchor)
        .eq("start_days", group.config.startDays);
    }
  }

  // Remove from localStorage
  const filtered = groups.filter((g) => g.id !== groupId);
  writeGroupRegistry(filtered);
}

/** Update a group: update individual reminder_configs in Supabase + update metadata in localStorage */
export async function updateLocalGroup(
  groupId: string,
  config: ReminderConfig,
  customerIds: string[],
  name: string
): Promise<void> {
  const groups = readGroupRegistry();
  const idx = groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return;

  const oldGroup = groups[idx];

  // Remove old reminder_configs from Supabase
  for (const customerId of oldGroup.customerIds) {
    await supabase
      .from("reminder_configs")
      .delete()
      .eq("customer_id", customerId)
      .eq("anchor", oldGroup.config.anchor)
      .eq("start_days", oldGroup.config.startDays);
  }

  // Create new reminder_configs in Supabase
  const configPayload = {
    anchor: config.anchor,
    start_days: config.startDays,
    repeat_type: config.repeat,
    interval_n: config.intervalN,
    interval_unit: config.intervalUnit,
    escalation: config.escalation,
    ends: config.ends,
    ends_date: config.endsDate,
    ends_count: config.endsCount,
    enabled: config.enabled,
  };

  for (const customerId of customerIds) {
    await supabase.from("reminder_configs").insert({
      customer_id: customerId,
      ...configPayload,
    });
  }

  // Update localStorage
  groups[idx] = {
    ...oldGroup,
    name,
    config: {
      enabled: config.enabled,
      startDays: config.startDays,
      anchor: config.anchor,
      repeatType: config.repeat,
      intervalN: config.intervalN,
      intervalUnit: config.intervalUnit,
      escalation: config.escalation,
      ends: config.ends,
      endsDate: config.endsDate,
      endsCount: config.endsCount,
    },
    customerIds,
  };
  writeGroupRegistry(groups);
}

/** Get a single group by ID */
export async function getLocalGroup(groupId: string) {
  const groups = await loadLocalGroups();
  return groups.find((g) => g.id === groupId) || null;
}

// ── Credit Limit Requests ──

const CREDIT_KEY = "agri_credit_requests";

function readCreditRequests(): LocalCreditRequest[] {
  try {
    const raw = localStorage.getItem(CREDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCreditRequests(reqs: LocalCreditRequest[]): void {
  localStorage.setItem(CREDIT_KEY, JSON.stringify(reqs));
}

/** Create a credit limit increase request */
export async function createCreditRequest(params: {
  customerId: string;
  customerName: string;
  requestedBy: string;
  currentLimit: number;
  requestedLimit: number;
  reason: string;
}): Promise<LocalCreditRequest> {
  const requests = readCreditRequests();

  // Check for existing pending request for same customer
  const existing = requests.find(
    (r) => r.customerId === params.customerId && r.status === "pending"
  );
  if (existing) {
    throw new Error("A pending credit limit request already exists for this customer.");
  }

  const newRequest: LocalCreditRequest = {
    id: "cr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    ...params,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
  };

  requests.push(newRequest);
  writeCreditRequests(requests);
  return newRequest;
}

/** Get all credit requests (optionally filtered by status) */
export function getCreditRequests(status?: "pending" | "approved" | "rejected"): LocalCreditRequest[] {
  const requests = readCreditRequests();
  if (status) return requests.filter((r) => r.status === status);
  return requests;
}

/** Approve a credit limit request — updates customer credit_limit in Supabase */
export async function approveCreditRequest(
  requestId: string,
  reviewedBy: string
): Promise<void> {
  const requests = readCreditRequests();
  const req = requests.find((r) => r.id === requestId && r.status === "pending");
  if (!req) throw new Error("Request not found or already processed.");

  // Update customer's credit_limit in Supabase
  const { error } = await supabase
    .from("customers")
    .update({ credit_limit: req.requestedLimit, updated_at: new Date().toISOString() })
    .eq("id", req.customerId);

  if (error) throw error;

  // Mark request as approved
  req.status = "approved";
  req.reviewedBy = reviewedBy;
  req.reviewedAt = new Date().toISOString();
  req.rejectionReason = null;
  writeCreditRequests(requests);
}

/** Reject a credit limit request */
export async function rejectCreditRequest(
  requestId: string,
  reviewedBy: string,
  reason?: string
): Promise<void> {
  const requests = readCreditRequests();
  const req = requests.find((r) => r.id === requestId && r.status === "pending");
  if (!req) throw new Error("Request not found or already processed.");

  req.status = "rejected";
  req.reviewedBy = reviewedBy;
  req.reviewedAt = new Date().toISOString();
  req.rejectionReason = reason || null;
  writeCreditRequests(requests);
}
