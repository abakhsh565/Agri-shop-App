import { supabase } from "@/lib/supabase";
import { normalizePhone } from "@/lib/auth";

/**
 * An employee asking an owner/admin to add them.
 *
 * The request is not a membership. It is a note that lives in a server-owned
 * table (0243); the only way it becomes access is the owner adding the person
 * through the existing invitation path. The client never reads the table
 * directly.
 */
export type EmployeeAccessRequestStatus = "pending" | "approved" | "dismissed";

export interface EmployeeAccessRequest {
  id: string;
  name: string;
  phone: string;
  status: EmployeeAccessRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  employeeId: string | null;
  membershipStatus: string | null;
}

export type RequestEmployeeAccessResult =
  | { ok: true; requestId: string; duplicate: boolean }
  | { ok: false; reason: "owner_not_found" | "rate_limited" | "same_phone" | "failed" };

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function toRequest(value: unknown): EmployeeAccessRequest | null {
  const row = asRecord(value);
  if (!row.id || !row.phone) return null;
  const status = row.status === "approved" || row.status === "dismissed" ? row.status : "pending";
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    phone: String(row.phone),
    status,
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    resolvedAt: row.resolvedAt || row.resolved_at ? String(row.resolvedAt ?? row.resolved_at) : null,
    employeeId: row.employeeId || row.employee_id ? String(row.employeeId ?? row.employee_id) : null,
    membershipStatus: row.membershipStatus || row.membership_status
      ? String(row.membershipStatus ?? row.membership_status)
      : null,
  };
}

/**
 * Send a request to the owner whose number was entered.
 *
 * The browser cannot choose the shop or the recipient: the database resolves
 * both from the owner's number and writes the request inside its own boundary.
 * `owner_not_found` is deliberately a value, not an exception, so the screen
 * can say "check the number" instead of printing a database error.
 */
export async function requestEmployeeAccess(input: {
  ownerPhone: string;
  requesterName: string;
  requesterPhone: string;
}): Promise<RequestEmployeeAccessResult> {
  const { data, error } = await supabase.rpc("request_employee_access", {
    p_owner_phone: normalizePhone(input.ownerPhone),
    p_requester_name: input.requesterName.trim(),
    p_requester_phone: normalizePhone(input.requesterPhone),
  });

  if (error) {
    if (import.meta.env.DEV) console.error("[AccessRequest] request failed:", error.message);
    return { ok: false, reason: "failed" };
  }

  const result = asRecord(data);
  if (result.sent === true) {
    return {
      ok: true,
      requestId: String(result.requestId ?? result.request_id ?? ""),
      duplicate: result.duplicate === true,
    };
  }

  const reason = String(result.reason ?? "");
  if (reason === "owner_not_found" || reason === "rate_limited" || reason === "same_phone") {
    return { ok: false, reason };
  }
  return { ok: false, reason: "failed" };
}

/** The owner/manager inbox. Requires employees.manage; the database enforces it. */
export async function listEmployeeAccessRequests(
  status?: EmployeeAccessRequestStatus,
): Promise<EmployeeAccessRequest[]> {
  const { data, error } = await supabase.rpc("list_employee_access_requests", {
    p_status: status ?? null,
  });
  if (error) throw new Error(error.message);
  return asArray(data)
    .map(toRequest)
    .filter((row): row is EmployeeAccessRequest => row !== null);
}

export async function getEmployeeAccessRequest(id: string): Promise<EmployeeAccessRequest | null> {
  const { data, error } = await supabase.rpc("get_employee_access_request", {
    p_request_id: id,
  });
  if (error) {
    if (/REQUEST_NOT_FOUND/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return toRequest(data);
}

/**
 * Close a request after the owner added the matching number.
 *
 * This is called after `create_employee` has succeeded, so a failure here must
 * not make the invitation look failed. The caller can treat `false` as "the
 * request is still open" and the request screen will show the employee as
 * already invited anyway.
 */
export async function markEmployeeAccessRequestAdded(
  requestId: string,
  employeeId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_employee_access_request_added", {
    p_request_id: requestId,
    p_employee_id: employeeId,
  });
  if (error) {
    if (import.meta.env.DEV) console.error("[AccessRequest] mark added failed:", error.message);
    return false;
  }
  return asRecord(data).updated === true;
}

export async function dismissEmployeeAccessRequest(requestId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("dismiss_employee_access_request", {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  return asRecord(data).updated === true;
}
