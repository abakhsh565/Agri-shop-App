import { supabase } from "@/lib/supabase";
import type { User, UserRole, MembershipRole, MembershipStatus } from "@/types";

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
  photo_url: string | null;
  created_at: string;
  shop_id: string | null;
  // Membership fields (from migration 0096 enhanced lookup)
  tenant_id?: string | null;
  membership_id?: string | null;
  membership_role?: string | null;
  membership_status?: string | null;
  branch_scope?: string[] | null;
}

function userFromRow(r: UserRow): User {
  // Resolve tenant context: prefer membership-based, fallback to shop_id
  const tenantId = r.tenant_id || r.shop_id || undefined;
  const membershipRole = (r.membership_role || (r.role === "admin" ? "admin" : "employee")) as MembershipRole;
  const membershipStatus = (r.membership_status || "active") as MembershipStatus;
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    isOriginalOwner: r.is_original_owner,
    pin: "",
    isActive: r.is_active,
    employeeNumber: r.employee_number ?? undefined,
    jobTitle: r.job_title ?? undefined,
    firstLoginAt: r.first_login_at,
    lastLoginAt: r.last_login_at,
    deactivatedAt: r.deactivated_at,
    deactivatedBy: r.deactivated_by,
    createdAt: r.created_at,
    createdBy: r.created_by,
    photoUrl: r.photo_url ?? undefined,
    // Membership / tenant context
    tenantId,
    membershipId: r.membership_id ?? undefined,
    membershipRole,
    membershipStatus,
    branchScope: r.branch_scope ?? undefined,
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
// Also triggers Supabase Auth OTP to establish a server-verifiable session.
export async function sendOTP(
  phone: string
): Promise<{ success: boolean; error?: string }> {
  const e164 = normalizePhone(phone);
  // Trigger Supabase Auth OTP (for test numbers, the OTP is also "123456")
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) {
    // Non-fatal: Supabase Auth OTP may fail for unconfigured numbers
    // The app OTP still works independently
    console.warn('Supabase Auth OTP send failed (non-fatal):', error.message);
  }
  return { success: true };
}

// ─── OTP verify + resolve/bootstrap the app user ──────────────────────────────
export type ResolveResult =
  | { status: "ok"; user: User }
  | { status: "not_registered" }
  | { status: "deactivated" }
  | { status: "pending" }
  | { status: "rejected" }
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

  // Try to establish Supabase Auth session for trusted identity
  // This creates a JWT that RPCs can use to verify the actor
  try {
    const { data: authData, error: authError } = await supabase.auth.verifyOtp({
      phone: e164,
      token: token,
      type: 'sms'
    });
    if (authError) {
      // Non-fatal: continue with app-only auth
      console.warn('Supabase Auth verify failed (non-fatal):', authError.message);
    } else if (authData?.session) {
      console.log('Supabase Auth session established for trusted identity');
    }
  } catch (e) {
    // Non-fatal: continue with app-only auth
    console.warn('Supabase Auth session setup failed (non-fatal):', e);
  }

  // Find the matching app profile row via SECURITY DEFINER RPC.
  // The users table is RLS-protected (anon cannot SELECT), so we use
  // lookup_user_by_phone() which bypasses RLS safely.
  let existing = null;
  let lookupErr = null;
  
  const { data: rpcUser, error: rpcErr } = await supabase
    .rpc("lookup_user_by_phone", { p_phone: e164 });
  
  if (rpcUser) {
    existing = rpcUser;
  } else {
    lookupErr = rpcErr;
  }
  if (lookupErr) return { status: "error", message: lookupErr!.message };

  if (existing) {
    const row = existing as UserRow;
    if (!row.is_active) return { status: "deactivated" };
    void touchLogin(row.id, !row.first_login_at);
    const user = userFromRow(row);
    // Membership context is loaded in getUserFromSession() after session is fully established.
    // Do NOT query memberships here — the JWT may not be ready yet.
    return { status: "ok", user };
  }

  // No user profile found — check if there's a pending shop registration
  const { data: shopReq } = await supabase
    .from("shop_requests")
    .select("status")
    .eq("owner_phone", e164)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shopReq) {
    if (shopReq.status === "pending" || shopReq.status === "hold") return { status: "pending" };
    if (shopReq.status === "rejected") return { status: "rejected" };
    // approved but user not created yet — shouldn't happen, treat as pending
    return { status: "pending" };
  }

  // No profile and no shop request.
  return { status: "not_registered" };
}

// ─── Session helpers ──────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  // Terminate Supabase auth session if one exists
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore — Supabase session may not exist
  }
  window.localStorage.removeItem("agri_auth");
}

// Resolve the app user from an existing Supabase session (used on app load so a
// logged-in user survives refreshes without re-entering OTP).
// Membership/tenant context is resolved server-side by lookup_user_by_phone
// (SECURITY DEFINER) — no additional RLS-dependent query needed.
export async function getUserFromSession(): Promise<User | null> {
  const saved = window.localStorage.getItem("agri_auth");
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    const savedUser: User | null = parsed?.state?.user ?? null;
    if (!savedUser) return null;
    // Verify user still exists + get fresh membership context via SECURITY DEFINER RPC
    const { data } = await supabase
      .rpc("lookup_user_by_phone", { p_phone: savedUser.phone });
    if (data && (data as UserRow).is_active) {
      // userFromRow now includes tenant_id/membership fields from the RPC response
      return userFromRow(data as UserRow);
    }
  } catch { /* invalid session */ }
  window.localStorage.removeItem("agri_auth");
  return null;
}
