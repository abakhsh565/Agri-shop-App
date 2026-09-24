import { supabase } from "@/lib/supabase";
import type { User, UserRole, MembershipRole, MembershipStatus } from "@/types";
import { DEMO_OTP_CODE, isDemoOtpMode } from "@/lib/authMode";
import { clearAllCachedData } from "@/lib/localCache";

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

// Load user permissions via get_my_permissions() SECURITY DEFINER RPC.
// Owner gets all permissions implicitly; admin/employee get explicit grants.
async function loadPermissions(): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_my_permissions");
    if (error || !data) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
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
// Which code is accepted, and how it is delivered, is decided in one place
// (lib/authMode.ts) so switching to a live SMS provider touches nothing here.
export async function sendOTP(
  phone: string
): Promise<{ success: boolean; error?: string }> {
  const e164 = normalizePhone(phone);

  // Demo mode: there is no SMS provider, so there is nothing to send and the
  // code is the shared constant. Reporting success is accurate — the person can
  // complete sign-in (the invitation carries the code).
  if (isDemoOtpMode) return { success: true };

  // Live mode: Supabase Auth sends the one-time code over SMS.
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) {
    // A code that was never sent must be reported, not swallowed: the person
    // would otherwise wait for an SMS that is not coming.
    console.warn('Supabase Auth phone OTP failed:', error.message);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Derive a deterministic email+password from a phone number.
 * Used to establish a Supabase Auth session when phone-based OTP fails.
 * The email is stable per phone — same phone always gets the same auth user.
 */
function phoneToAuthCredentials(phone: string) {
  const e164 = normalizePhone(phone);
  // Hash the phone to create a deterministic email (Supabase requires valid email format)
  const email = `user-${e164}@agrishop.auth.local`;
  // Deterministic password from phone (not a security boundary — the app OTP is the auth gate)
  const password = `AgriShop-${e164}-2026!`;
  return { email, password, e164 };
}

/**
 * Ensure a Supabase Auth session exists for this phone number.
 * Uses email+password auth (more reliable than phone OTP for test/development numbers).
 * Called after app-level OTP verification succeeds.
 *
 * A Supabase Auth session is REQUIRED for every RLS-protected read and for every
 * authorized RPC: without a JWT the browser silently degrades to 401 responses
 * and the whole app renders empty. So this must report failure, never swallow it.
 */
export const SESSION_SETUP_FAILED = 'SESSION_SETUP_FAILED';

/** Is a Supabase Auth session present? (The live SMS path establishes it itself.) */
async function hasAuthSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

async function ensureAuthSession(phone: string): Promise<{ ok: boolean; error?: string }> {
  const { email, password } = phoneToAuthCredentials(phone);

  // A session that belongs to a DIFFERENT account is not this person's identity.
  // Accepting it rendered the app as the person signing in while every RLS read
  // and RPC ran with the previous user's JWT — observed in QA: an invited
  // employee "signed in" on a device where the owner's session was still live,
  // so the owner's identity performed the employee's onboarding call. Whoever the
  // device last served must be signed out first.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    if (session.user?.email === email) return { ok: true };
    await supabase.auth.signOut();
  }

  // Try sign-in first (user likely already exists)
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (!signIn.error) return confirmIdentity(signIn.data.user?.email, email);

  // User doesn't exist yet — create via signUp (auto-confirms in dev)
  const signUp = await supabase.auth.signUp({ email, password });
  if (signUp.error) {
    console.warn('Auth session setup failed:', signIn.error.message, '/', signUp.error.message);
    return { ok: false, error: `${signIn.error.message}; ${signUp.error.message}` };
  }

  // SignUp may or may not auto-create session — try sign-in to be sure
  const retry = await supabase.auth.signInWithPassword({ email, password });
  if (retry.error) {
    console.warn('Auth sign-in after signUp failed:', retry.error.message);
    return { ok: false, error: retry.error.message };
  }

  console.log('Supabase Auth session established via email+password');
  return confirmIdentity(retry.data.user?.email, email);
}

/** The session we just established must be the one we asked for. */
function confirmIdentity(actual: string | undefined, expected: string): { ok: boolean; error?: string } {
  if (actual === expected) return { ok: true };
  console.warn('Auth session identity mismatch:', actual, '!=', expected);
  return { ok: false, error: `identity mismatch: ${actual ?? 'none'} != ${expected}` };
}

/**
 * An invited employee completes onboarding with their first verified sign-in.
 *
 * The invitation is a `pending` membership, which every authorization path
 * rejects (they all require status = 'active'), so a freshly added employee can
 * authenticate but cannot read or change anything until this runs.
 *
 * Activation is decided server-side inside complete_member_onboarding() from the
 * caller's own JWT — never from anything this client sends — so calling it cannot
 * grant access the database would not already allow: it only moves the CALLER'S
 * OWN membership from 'pending' to 'active', and never revives a suspended one.
 */
async function completeOnboardingIfInvited(user: User): Promise<string | null> {
  if (user.membershipStatus !== "pending") return null;
  const { error } = await supabase.rpc("complete_member_onboarding");
  if (error) return error.message;
  user.membershipStatus = "active";
  return null;
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

export async function verifyOTPAndResolveUser(
  phone: string,
  token: string
): Promise<ResolveResult> {
  const e164 = normalizePhone(phone);

  if (isDemoOtpMode) {
    // Demo mode: the shared constant stands in for the SMS.
    if (token !== DEMO_OTP_CODE) return { status: "wrong_otp" };
  } else {
    // Live mode: Supabase verifies the code it sent, and establishes the
    // session as part of doing so.
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: "sms" });
    if (error) return { status: "wrong_otp" };
  }

  // Establish a Supabase Auth session for PostgREST/RLS.
  // In demo mode phone-based OTP doesn't work for unregistered test numbers, so
  // we bridge with email+password auth (deterministic from phone), and a missing
  // session must be surfaced: otherwise every RLS read returns 401 and the user
  // lands in an app that looks empty for no visible reason.
  const session = isDemoOtpMode
    ? await ensureAuthSession(phone)
    : { ok: await hasAuthSession() };
  if (!session.ok) {
    console.error('Could not establish Supabase Auth session:', session.error);
    return { status: "error", message: SESSION_SETUP_FAILED };
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
    // First verified sign-in of an invited employee IS the onboarding step.
    // A failure here must be surfaced: continuing would land the user in an app
    // where every read and write is denied, looking inexplicably empty.
    const onboardError = await completeOnboardingIfInvited(user);
    if (onboardError) return { status: "error", message: onboardError };
    // Load permissions after the membership is active and the session is established
    user.permissions = await loadPermissions();
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
/**
 * Erase the signed-in account, for good.
 *
 * The database decides what that means, not this file: `delete_my_account()` erases the
 * shop and its data when the account answers for one, and removes just the access and login
 * when it does not. Doing it server-side is the point — the client is not the thing that
 * should hold the power to delete a shop, and the last step there is removing the auth row,
 * so the login cannot outlive the data.
 *
 * On success the session is terminated the same way signing out terminates it, because the
 * account it belonged to no longer exists.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw new Error(error.message);
  await signOut();
}

export async function signOut(): Promise<void> {
  // Terminate Supabase auth session if one exists
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore — Supabase session may not exist
  }
  window.localStorage.removeItem("agri_auth");
  // Business rows are cached per identity — leaving the session must not leave
  // them behind for the next person to sign in on this device.
  clearAllCachedData();
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
    // Ensure Supabase Auth session exists (may have been lost on reload).
    // If it cannot be established, do NOT continue with an unauthenticated
    // client: clear the session so the user signs in again and sees the reason.
    const session = await ensureAuthSession(savedUser.phone);
    if (!session.ok) {
      console.warn('Dropping stored session — Supabase Auth session unavailable:', session.error);
      window.localStorage.removeItem("agri_auth");
      return null;
    }
    // Verify user still exists + get fresh membership context via SECURITY DEFINER RPC
    const { data } = await supabase
      .rpc("lookup_user_by_phone", { p_phone: savedUser.phone });
    if (data && (data as UserRow).is_active) {
      const user = userFromRow(data as UserRow);
      // Best-effort on restore: if the invite was accepted on another device the
      // membership is already active and this is a no-op, so a reload must never
      // be blocked by it.
      const onboardError = await completeOnboardingIfInvited(user);
      if (onboardError) console.warn('Onboarding completion failed on restore:', onboardError);
      user.permissions = await loadPermissions();
      return user;
    }
  } catch { /* invalid session */ }
  window.localStorage.removeItem("agri_auth");
  return null;
}
