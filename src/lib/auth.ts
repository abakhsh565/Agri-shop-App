import { supabase } from "@/lib/supabase";
import type { User, UserRole, MembershipRole, MembershipStatus } from "@/types";
import {
  DEMO_OTP_CODE,
  assertDemoOtpAllowed,
  demoCodeAccepted,
  isDemoOtpMode,
} from "@/lib/authMode";
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
  // A membership row is what makes this account part of a shop. When the lookup returned none
  // there is nothing active to claim: defaulting to "active" here made an account with no shop
  // look like a fully privileged owner of an empty one, so every screen it reached rendered as
  // if the shop were merely new instead of saying the account has no shop at all.
  const membershipStatus = r.membership_id
    ? ((r.membership_status || "active") as MembershipStatus)
    : undefined;
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
  if (isDemoOtpMode) {
    // Never report "code sent" for a code that was not sent, in an environment that must not
    // accept one. See authMode.ts.
    assertDemoOtpAllowed();
    return { success: true };
  }

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
 * Check a code that CONFIRMS something the signed-in person is about to do, rather than
 * one that signs them in.
 *
 * Kept here beside `sendOTP` because it must accept exactly the same codes that send
 * delivers: in demo mode the shared constant, live mode the real one. A second
 * implementation in a screen is how the two drift apart and a confirmation starts
 * refusing a code sign-in happily accepts.
 *
 * It deliberately does not create a session. The person is already signed in, and
 * re-establishing a session to confirm an action would be a way to change who is acting.
 * On success it returns only that the code was right; what happens next is the caller's
 * decision, and the database checks their authority again when they make it.
 */
export async function verifyConfirmOTP(phone: string, token: string): Promise<boolean> {
  const code = token.replace(/\D/g, "");
  if (code.length !== 6) return false;

  if (isDemoOtpMode) {
    // Second lock: `isDemoOtpMode` is already false in a production build, and this makes it
    // impossible for a future caller to honour the shared code there by mistake.
    assertDemoOtpAllowed();
    return demoCodeAccepted(code);
  }

  const { error } = await supabase.auth.verifyOtp({
    phone: normalizePhone(phone),
    token: code,
    type: "sms",
  });
  return !error;
}

/**
 * Which stage does this phone belong at? Asked BEFORE a code is sent, so an
 * unregistered number is told to create an account instead of being sent a code
 * that ends at a session that cannot exist for it.
 *
 * Both lookups are anon-callable SECURITY DEFINER RPCs (lookup_user_by_phone,
 * get_my_shop_request) — the same pair the rest of the auth flow already trusts.
 * shop_requests itself is unreachable from the client (RLS on, no policy), which is
 * exactly why an applicant must be read through the RPC rather than the table.
 */
export type PhoneCheck =
  /** The role matters: an employee must never be invited to sign themselves up. */
  | { status: "registered"; role: UserRole }
  | { status: "inactive" }
  | { status: "pending" }
  | { status: "rejected" }
  | { status: "unregistered" }
  | { status: "error"; message: string };

export async function checkPhoneRegistration(phone: string): Promise<PhoneCheck> {
  const e164 = normalizePhone(phone);

  const { data, error } = await supabase.rpc("lookup_user_by_phone", { p_phone: e164 });
  if (error) return { status: "error", message: error.message };
  if (data) {
    const row = data as UserRow;
    return row.is_active ? { status: "registered", role: row.role } : { status: "inactive" };
  }

  // No app profile. An owner whose shop application is still open has a record of
  // what happens next, so they must not be pushed back into signup as if nothing
  // had been submitted.
  const { data: request } = await supabase.rpc("get_my_shop_request", { p_phone: e164 });
  const parsed = typeof request === "string" ? JSON.parse(request) : request;
  const status = parsed?.found ? parsed?.request?.status : null;
  if (status === "pending" || status === "hold") return { status: "pending" };
  if (status === "rejected") return { status: "rejected" };
  if (status === "approved") return { status: "pending" };
  return { status: "unregistered" };
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

/**
 * This number has no login identity on the server, and the browser must not invent one.
 *
 * The bridge below used to answer exactly this case with `auth.signUp`, which creates an
 * identity with a FRESH RANDOM id. `app_current_user_id()` reads the JWT `sub`, so that
 * session resolves to no app user: every authorization path denies it, and
 * `complete_member_onboarding()` answers ACCOUNT_INACTIVE — the invitee sees "inactive" and a
 * message that explains nothing. Worse, the stray identity then HOLDS the derived address, so
 * the authorized provisioner (migration 0135/0163) can no longer create the correct row —
 * which is exactly the `users_email_partial_key` failure that broke 4 of the last 8 QA invites.
 *
 * The fix is the owner's, not the invitee's: the server creates the identity at invitation
 * time (provision_member_login). The app reports the state honestly instead of seeding another
 * stray.
 */
export const LOGIN_NOT_READY = 'LOGIN_NOT_READY';

/**
 * The phone could not reach the server at all — which is NOT a verdict about this account.
 *
 * Kept apart from LOGIN_NOT_READY because the two need opposite answers: "your login is
 * missing, ask the owner to re-send the invitation" is wrong (and alarming) advice for a
 * shop phone with no signal, and it is the kind of wrong answer that sends someone to reset
 * an account that was never broken. A device that cannot ask keeps its cached rows and its
 * PIN; only a server that answers no closes the door.
 */
export const SESSION_UNREACHABLE = 'SESSION_UNREACHABLE';

/** Is a Supabase Auth session present? (The live SMS path establishes it itself.) */
async function hasAuthSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

/**
 * Did this failure come from the transport, rather than from the server refusing us?
 *
 * supabase-js reports "could not reach the network" without an HTTP status, while a refusal
 * always carries one (400 for unknown credentials, 422 for a bad body). That absence — not
 * the wording of the message, which is a library detail — is the signal.
 */
function isUnreachable(error: { status?: number } | null | undefined): boolean {
  const status = error?.status;
  return status === undefined || status === 0;
}

async function ensureAuthSession(phone: string): Promise<{ ok: boolean; error?: string }> {
  // This bridge turns a phone number into a password-derivable Supabase identity. It belongs to
  // demo sign-in only, so it refuses to run where demo sign-in is not allowed — belt and braces
  // with the `isDemoOtpMode` check at every call site.
  assertDemoOtpAllowed();

  const { email, password } = phoneToAuthCredentials(phone);

  // A session that belongs to a DIFFERENT account is not this person's identity.
  // Accepting it rendered the app as the person signing in while every RLS read
  // and RPC ran with the previous user's JWT — observed in QA: an invited
  // employee "signed in" on a device where the owner's session was still live,
  // so the owner's identity performed the employee's onboarding call. Whoever the
  // device last served must be signed out first.
  let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch {
    return { ok: false, error: SESSION_UNREACHABLE };
  }
  if (session) {
    if (session.user?.email === email) return { ok: true };
    await supabase.auth.signOut();
  }

  // Sign in with the identity the server provisioned for this phone. Nothing else is tried.
  //
  // There is deliberately NO signUp fallback here any more. It looked like a harmless bridge
  // and it was the defect: a brand-new random id cannot be the employee's id, so the session
  // it produced was denied everywhere and, by occupying the derived address, it stopped the
  // real identity from ever being created (see LOGIN_NOT_READY above). An identity the server
  // has not created is a state to report, not one for the browser to paper over.
  let signIn: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    signIn = await supabase.auth.signInWithPassword({ email, password });
  } catch {
    return { ok: false, error: SESSION_UNREACHABLE };
  }
  if (signIn.error) {
    // "No signal" and "no login here" produce the same failed call and need different words.
    if (isUnreachable(signIn.error)) {
      console.warn('Could not reach the server to open a session:', signIn.error.message);
      return { ok: false, error: SESSION_UNREACHABLE };
    }
    console.warn('No provisioned login identity for this phone:', signIn.error.message);
    return { ok: false, error: LOGIN_NOT_READY };
  }

  return confirmIdentity(signIn.data.user?.email, email);
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
  /** This number is not the one this shop invited — the invited number must be used. */
  | { status: "wrong_invite"; shopName: string }
  /** The invitation exists but its login identity is missing; the owner must re-send it. */
  | { status: "login_not_ready" }
  | { status: "error"; message: string };

/** What the database says about a (shop, phone) invitation pair. */
export interface InviteContext {
  found: boolean;
  shopName?: string;
  /** Is this phone a member (pending or active) of that shop? */
  invited?: boolean;
  status?: string;
}

/**
 * Is this phone actually invited to this shop?
 *
 * The question the phone alone cannot answer. `lookup_user_by_phone` finds a person by their
 * number and is right to — but an invitation is a claim about a PAIR ("this owner added this
 * number"), and with many shops the number on its own does not say which owner made it. The
 * link carries the shop, and this asks the database whether the pair is real, so an invitation
 * cannot be completed by a different number.
 *
 * Anon-callable on purpose: it runs before any session exists.
 */
export async function resolveInvite(shopId: string, phone: string): Promise<InviteContext> {
  const { data, error } = await supabase.rpc("resolve_invite", {
    p_shop_id: shopId,
    p_phone: normalizePhone(phone),
  });
  if (error || !data) return { found: false };
  const d = data as { found?: boolean; shopName?: string; invited?: boolean; status?: string };
  return { found: !!d.found, shopName: d.shopName, invited: d.invited, status: d.status };
}

/** What a shop code names, as the sign-in screen needs it. */
export interface ShopCodeLookup {
  found: boolean;
  shopId?: string;
  shopName?: string;
}

/**
 * Turn a shop code into the shop it names.
 *
 * The question an employee asks is "which owner added my number?" — and the answer used to be a
 * uuid, which cannot be read down a phone line. A code can. This resolves one to the shop's id
 * and name so the sign-in screen can check the (shop, number) pair exactly as an invitation
 * link does. Anonymous on purpose: it runs before any session exists.
 *
 * Returns `found: false` for anything unknown or malformed rather than throwing — an unknown
 * code is a typo, and the screen says so.
 */
export async function resolveShopCode(code: string): Promise<ShopCodeLookup> {
  const clean = code.trim();
  if (!clean) return { found: false };
  const { data, error } = await supabase.rpc("resolve_shop_code", { p_code: clean });
  if (error || !data) return { found: false };
  const d = (typeof data === "string" ? JSON.parse(data) : data) as {
    found?: boolean;
    shopId?: string;
    shopName?: string;
  };
  return { found: !!d.found, shopId: d.shopId, shopName: d.shopName };
}

/**
 * The code for the shop the caller is working in — the value an owner reads out to a new
 * employee. Any active member may read it; the code identifies a shop and grants nothing.
 */
export async function myShopJoinCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_shop_join_code");
  if (error) return null;
  return typeof data === "string" && data.trim() ? data.trim() : null;
}

/**
 * A Repair action for an owner: give an already-invited employee the login they are missing.
 *
 * Every invited employee should have been provisioned at invitation time (0135). When that
 * step failed — the address was already held by a stray identity — the employee and their
 * pending membership exist but they cannot sign in, and re-inviting is not possible because
 * the phone is already taken. This re-runs the authorized provisioner, which now also claims
 * the address back (0163). Owner-only: the RPC begins with employees.manage.
 */
export async function provisionMemberLogin(userId: string): Promise<{ ok: boolean; repaired: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("provision_member_login", { p_user_id: userId });
  if (error) return { ok: false, repaired: false, error: error.message };
  const d = data as { provisioned?: boolean; repaired?: boolean } | null;
  return { ok: true, repaired: !!d?.repaired };
}

export async function verifyOTPAndResolveUser(
  phone: string,
  token: string,
  /**
   * The shop from the invitation link, when there was one. Checked BEFORE the code is spent,
   * against the pair — the number alone is not enough to say which owner invited it.
   */
  inviteShopId?: string | null,
): Promise<ResolveResult> {
  const e164 = normalizePhone(phone);

  // The invitation is a (shop, phone) claim. Re-checked here, not only on the sign-in screen:
  // the number can still be edited before this point, and this is the last stop before an
  // identity is trusted.
  if (inviteShopId) {
    const invite = await resolveInvite(inviteShopId, phone);
    if (invite.found && !invite.invited) {
      return { status: "wrong_invite", shopName: invite.shopName ?? "" };
    }
  }

  if (isDemoOtpMode) {
    // Demo mode: the shared constant stands in for the SMS. The decision itself lives in
    // authMode.ts so this path and the confirmation path cannot drift apart.
    assertDemoOtpAllowed();
    if (!demoCodeAccepted(token)) return { status: "wrong_otp" };
  } else {
    // Live mode: Supabase verifies the code it sent, and establishes the
    // session as part of doing so.
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: "sms" });
    if (error) return { status: "wrong_otp" };
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
    // `let`, not `const`: 0201 scopes this RPC's answer to the identity the caller has proved, so
    // the pre-session read below is the door answer only, and the full profile is re-read once the
    // session exists (see the demo bridge further down).
    let row = existing as UserRow;
    // Deactivation is decided from the profile alone — no session is minted for a
    // closed account.
    if (!row.is_active) return { status: "deactivated" };

    // Signing in continues into RLS-protected reads, so THIS is the branch that needs a
    // real Supabase Auth session. In demo mode phone OTP cannot open one for a test
    // number, so it is bridged with email+password (deterministic from the phone) — and a
    // failure must be surfaced, or every read returns 401 and the app looks empty for no
    // visible reason. The signup branches below deliberately do NOT require a session:
    // registration ends at the application form, which is an anon RPC. Requiring one
    // there made every brand-new number fail with a session error instead of reaching
    // owner setup.
    const session = isDemoOtpMode
      ? await ensureAuthSession(phone)
      : { ok: await hasAuthSession() };
    if (!session.ok) {
      console.error('Could not establish Supabase Auth session:', session.error);
      // "The server has no login for this number" is a different situation from "the session
      // could not be opened", and it has a different answer (the owner re-sends the invitation),
      // so it must not be reported as a generic failure.
      return session.error === LOGIN_NOT_READY
        ? { status: "login_not_ready" }
        : { status: "error", message: SESSION_SETUP_FAILED };
    }

    // 0201 answers an unauthenticated caller with `{is_active, role}` and nobody else with more, so
    // a profile read taken BEFORE a session existed is the door answer rather than the account. The
    // door answer carries no `id` (the full row always does — it is the primary key), which makes
    // that the exact test for "read it again now that the session exists". Demo mode is where this
    // happens today: it cannot open a session from phone OTP (that is why the bridge above exists),
    // so its lookup ran before any session did. Live mode reaches here with the session `verifyOtp`
    // just opened, so its read was already the full profile and this is a no-op. Without it the
    // demoed sign-in would build its user from the door answer: no id, no tenant, and every screen
    // behind it empty for no visible reason.
    if (row.id === undefined) {
      const { data: fullProfile } = await supabase
        .rpc("lookup_user_by_phone", { p_phone: e164 });
      if (fullProfile) row = fullProfile as UserRow;
    }

    void touchLogin(row.id, !row.first_login_at);
    const user = userFromRow(row);
    // First verified sign-in of an invited employee IS the onboarding step.
    // A failure here must be surfaced: continuing would land the user in an app
    // where every read and write is denied, looking inexplicably empty.
    const onboardError = await completeOnboardingIfInvited(user);
    // ACCOUNT_INACTIVE from onboarding means the session's `sub` has no active app user — i.e.
    // this is a stray identity, not a closed account (a closed account was already reported as
    // `deactivated` above, from the profile itself). Showing the database's own code here is
    // what put "ACCOUNT_INACTIVE" in front of a shop owner.
    if (onboardError) {
      return /ACCOUNT_INACTIVE/.test(onboardError)
        ? { status: "login_not_ready" }
        : { status: "error", message: onboardError };
    }
    // Load permissions after the membership is active and the session is established
    user.permissions = await loadPermissions();
    return { status: "ok", user };
  }

  // No user profile found — check for an open shop registration. shop_requests is
  // RLS-protected with no client policy, so this MUST go through the RPC (the direct
  // table read returned nothing, which is how pending applicants were told they were
  // not registered at all).
  const { data: request } = await supabase.rpc("get_my_shop_request", { p_phone: e164 });
  const parsed = typeof request === "string" ? JSON.parse(request) : request;
  const requestStatus = parsed?.found ? parsed?.request?.status : null;

  if (requestStatus) {
    if (requestStatus === "pending" || requestStatus === "hold") return { status: "pending" };
    if (requestStatus === "rejected") return { status: "rejected" };
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

/**
 * What happened when a device that already knows an account asked for a session again.
 *
 * Every outcome is separate because each one has a different, actionable answer:
 *
 *   • `ok`           — a live session, with the profile re-read from the server.
 *   • `login_not_ready` — the server provisioned no login for this number (an invitation whose
 *                      provisioning failed): the owner re-sends it. Never the browser's job.
 *   • `offline`      — the server could not be asked. NOT a verdict: the device keeps its
 *                      cached rows and its PIN, and says nothing alarming.
 *   • `signed_out`   — the server answered and there is no usable profile (account erased, or
 *                      the number went inactive). The stored identity is dropped.
 *   • `error`        — the server answered with a failure of its own.
 */
export type ResumeResult =
  | { status: "ok"; user: User }
  | { status: "login_not_ready" }
  | { status: "offline" }
  | { status: "signed_out" }
  | { status: "error"; message: string };

/**
 * Open a session for an account this device already knows, without a phone code.
 *
 * This is the second half of the PIN rule: the PIN is checked first (by the server against its
 * bcrypt hash, or by the device's own record when there is nothing to ask), and this mints the
 * session that every RLS-protected read then runs under. It is the SAME credential path the
 * code uses — the login identity the server provisioned for the number — so a signed-out
 * phone still cannot come back as anyone but itself, and nothing is ever invented here.
 *
 * The caller passes the account it believes it is resuming; the server is what confirms it:
 * a number whose profile was removed or deactivated comes back `signed_out`.
 */
export async function resumeSession(known: User): Promise<ResumeResult> {
  let session: { ok: boolean; error?: string };
  try {
    session = await ensureAuthSession(known.phone);
  } catch {
    return { status: "offline" };
  }
  if (!session.ok) {
    if (session.error === LOGIN_NOT_READY) return { status: "login_not_ready" };
    if (session.error === SESSION_UNREACHABLE) return { status: "offline" };
    return { status: "error", message: SESSION_SETUP_FAILED };
  }

  // Verify the profile still exists and re-read membership context (SECURITY DEFINER RPC).
  const { data, error } = await supabase
    .rpc("lookup_user_by_phone", { p_phone: normalizePhone(known.phone) });
  // A lookup that could not be answered is not a verdict about the account: the session is
  // live, so the cached rows are the honest thing to keep showing.
  if (error) return { status: "offline" };
  const row = data as UserRow | null;
  if (!row || !row.is_active) return { status: "signed_out" };

  const user = userFromRow(row);
  // Best-effort: if the invite was accepted on another device the membership is already
  // active and this is a no-op, so returning must never be blocked by it.
  const onboardError = await completeOnboardingIfInvited(user);
  if (onboardError) {
    return /ACCOUNT_INACTIVE/.test(onboardError)
      ? { status: "login_not_ready" }
      : { status: "error", message: onboardError };
  }
  user.permissions = await loadPermissions();
  return { status: "ok", user };
}

/** The identity this device last persisted, or null if there is none (or it is unreadable). */
function readSavedUser(): User | null {
  const saved = window.localStorage.getItem("agri_auth");
  if (!saved) return null;
  try {
    return (JSON.parse(saved)?.state?.user ?? null) as User | null;
  } catch {
    return null;
  }
}

// Resolve the app user from an existing Supabase session (used on app load so a
// logged-in user survives refreshes without re-entering OTP).
// Membership/tenant context is resolved server-side by lookup_user_by_phone
// (SECURITY DEFINER) — no additional RLS-dependent query needed.
export async function getUserFromSession(): Promise<User | null> {
  const savedUser = readSavedUser();
  if (!savedUser) return null;
  let resumed: ResumeResult;
  try {
    resumed = await resumeSession(savedUser);
  } catch {
    // Unreadable stored user. Nothing to restore, and nothing to erase: the row may simply
    // be mid-write. Signing out is the job of the explicit sign-out, not of a parse failure.
    return null;
  }
  if (resumed.status === "ok") return resumed.user;
  // The profile lookup answered and there is no usable profile: the account was removed, or
  // the phone it belongs to went inactive. That is a definitive server answer, so the stored
  // identity is dropped — this is the one path where erasing it is correct.
  if (resumed.status === "signed_out") {
    window.localStorage.removeItem("agri_auth");
    return null;
  }
  // Everything else is "the server could not be asked" or "this number has no login yet".
  // Both keep the stored identity: the PIN and the cached rows can still serve, and neither
  // is a reason to throw away the only route back into the app.
  console.warn('No Supabase Auth session available:', resumed.status);
  return null;
}
