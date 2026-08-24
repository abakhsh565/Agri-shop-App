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
export async function sendOTP(
  phone: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    phone: normalizePhone(phone),
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── OTP verify + resolve/bootstrap the app user ──────────────────────────────
export type ResolveResult =
  | { status: "ok"; user: User }
  | { status: "not_registered" }
  | { status: "deactivated" }
  | { status: "wrong_otp" }
  | { status: "error"; message: string };

export async function verifyOTPAndResolveUser(
  phone: string,
  token: string
): Promise<ResolveResult> {
  const e164 = normalizePhone(phone);

  // 1. Verify the SMS code — this creates the Supabase Auth session.
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    phone: e164,
    token,
    type: "sms",
  });
  if (verifyErr) return { status: "wrong_otp" };

  // 2. Find the matching app profile row.
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

  // 3. No profile yet. Bootstrap: if there are no users at all, this first
  //    person becomes the OWNER. Otherwise the number isn't registered.
  const { count } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) === 0) {
    const { data: created, error: createErr } = await supabase
      .from("users")
      .insert({
        name: "Owner",
        phone: e164,
        role: "admin",
        is_original_owner: true,
        is_active: true,
      })
      .select()
      .single();
    if (createErr) return { status: "error", message: createErr.message };
    const createdRow = created as UserRow;
    void touchLogin(createdRow.id, true);
    return { status: "ok", user: userFromRow(createdRow) };
  }

  return { status: "not_registered" };
}

// ─── Session helpers ──────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Resolve the app user from an existing Supabase session (used on app load so a
// logged-in user survives refreshes without re-entering OTP).
export async function getUserFromSession(): Promise<User | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const phone = sessionData.session?.user?.phone;
  if (!phone) return null;
  const e164 = phone.replace(/^\+/, "");
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("phone", e164)
    .maybeSingle();
  if (!data) return null;
  const row = data as UserRow;
  if (!row.is_active) return null;
  return userFromRow(row);
}
