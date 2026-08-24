import { supabase } from "@/lib/supabase";
import type { User, UserRole } from "@/types";

// ─── Phone normalization ─────────────────────────────────────────────────────
// The UI collects local Pakistani numbers ("03001234567"); Supabase Auth needs
// E.164 ("+923001234567"). Keep the conversion in one place so send + verify +
// lookup all agree on the exact stored value.
export function normalizePhone(input: string): string {
  // Supabase stores/matches phone numbers in E.164 digits WITHOUT the leading
  // "+" (e.g. "923001234567"), and its Test-Phone-Numbers field rejects "+".
  // Produce that exact form so send/verify/lookup all agree.
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) return "92" + digits.slice(1);
  if (digits.startsWith("92")) return digits;
  return "92" + digits;
}

// ─── Row <-> domain mapping ─────────────────────────────────────────────────
interface UserRow {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  is_original_owner: boolean;
  is_active: boolean;
  employee_number: string | null;
  job_title: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  deactivated_at: string | null;
  deactivated_by: string | null;
  created_by: string | null;
  created_at: string;
}

function userFromRow(r: UserRow): User {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    isOriginalOwner: r.is_original_owner,
    pin: "", // PIN moves to a hashed column in Step 2; not used client-side
    isActive: r.is_active,
    employeeNumber: r.employee_number ?? undefined,
    jobTitle: r.job_title ?? undefined,
    firstLoginAt: r.first_login_at,
    lastLoginAt: r.last_login_at,
    deactivatedAt: r.deactivated_at,
    deactivatedBy: r.deactivated_by,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

// Best-effort login-timestamp write. Never throws: if the column is somehow
// missing on an out-of-date deployment, login must still succeed.
async function touchLogin(userId: string, isFirst: boolean): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, string> = { last_login_at: now };
  if (isFirst) patch.first_login_at = now;
  try {
    await supabase.from("users").update(patch).eq("id", userId);
  } catch {
    // ignore — timestamp tracking is non-critical
  }
}

// ─── OTP send ────────────────────────────────────────────────────────────────
// For MVP: hardcoded OTP "123456" — no Twilio/SMS required.
export async function sendOTP(
  phone: string
): Promise<{ success: boolean; error?: string }> {
  return { success: true };
}

// ─── OTP verify + resolve/bootstrap the app user ──────────────────────────────
export type ResolveResult =
  | { status: "ok"; user: User }
  | { status: "not_registered" }
  | { status: "deactivated" }
  | { status: "wrong_otp" }
  | { status: "error"; message: string };

const DEV_OTP = "123456";

export async function verifyOTPAndResolveUser(
  phone: string,
  token: string
): Promise<ResolveResult> {
  const e164 = normalizePhone(phone);

  // MVP: accept hardcoded OTP "123456"
  if (token !== DEV_OTP) return { status: "wrong_otp" };

  // Find the matching app profile row.
  const { data: existing, error: lookupErr } = await supabase
    .from("users")
    .select("*")
    .eq("phone", e164)
    .maybeSingle();
  if (lookupErr) return { status: "error", message: lookupErr.message };

  if (existing) {
    const row = existing as UserRow;
    if (!row.is_active) return { status: "deactivated" };
    void touchLogin(row.id, !row.first_login_at);
    return { status: "ok", user: userFromRow(row) };
  }

  // No profile found.
  return { status: "not_registered" };
}

// ─── Session helpers ──────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  window.localStorage.removeItem("agri_auth");
}

// Resolve the app user from an existing Supabase session (used on app load so a
// logged-in user survives refreshes without re-entering OTP).
export async function getUserFromSession(): Promise<User | null> {
  // Read from zustand persist store (agri_auth)
  const saved = window.localStorage.getItem("agri_auth");
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    const user: User | null = parsed?.state?.user ?? null;
    if (!user) return null;
    // Verify user still exists and is active in DB
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (data && (data as UserRow).is_active) return userFromRow(data as UserRow);
  } catch { /* invalid session */ }
  window.localStorage.removeItem("agri_auth");
  return null;
}
