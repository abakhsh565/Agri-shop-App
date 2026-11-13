import type { Experience, User } from "@/types";

/**
 * The three business experiences are resolved on the server. The client only
 * chooses a route from that answer; it never infers Co-Owner authority from a
 * role name or a cached permission list.
 */
export function experienceOf(user: User | null | undefined): Experience {
  if (!user) return "employee";
  if (user.experience) return user.experience;
  // Older stored sessions do not carry the field yet. The membership role is
  // still a safe fallback for owner vs employee, never for co-owner.
  return user.membershipRole === "owner" ? "owner" : "employee";
}

export function isCoOwner(user: User | null | undefined): boolean {
  return experienceOf(user) === "co_owner";
}

/** Where a signed-in account belongs. */
export function homePathForUser(user: User | null | undefined): string {
  if (user?.pendingCoOwnerInvitation) return "/co-owner/accept";
  switch (experienceOf(user)) {
    case "owner":
      return "/admin/dashboard";
    case "co_owner":
      // A Co-Owner is a separate phone profile, not a separate product. It opens the same
      // Owner shell and screens; permissions, branch scope and major-action rules remain the
      // server's checks inside that shell.
      return "/admin/dashboard";
    default:
      return "/employee/dashboard";
  }
}

/**
 * Co-Owner is development-first until the owner explicitly turns it on in
 * production. A build with no variable behaves as: on in development, off in
 * production.
 */
export function coOwnerEnabled(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | boolean> }).env ?? {};
  const value = env.VITE_CO_OWNER_ENABLED;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(env.DEV);
}

/** The database speaks in codes; a screen must speak in a sentence. */
export function coOwnerErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const known = [
    "NOT_AUTHENTICATED",
    "NOT_AUTHORIZED",
    "APPROVAL_REQUIRED",
    "GRANT_NOT_FOUND",
    "GRANT_REVOKED",
    "GRANT_NOT_ACTIVE",
    "INVITATION_EXPIRED",
    "INVITATION_REVOKED",
    "INVITATION_NOT_FOUND",
    "PERSON_ALREADY_INVITED",
    "PERSON_ALREADY_HAS_OWNER_ACCESS",
    "PERSON_BELONGS_TO_ANOTHER_BUSINESS",
    "PERSON_NOT_IN_THIS_BUSINESS",
    "INVALID_BRANCH_SCOPE",
    "ROLE_NOT_FOUND_OR_NOT_AUTHORIZED",
    "REQUEST_NOT_FOUND",
    "REQUEST_ALREADY_DECIDED",
    "AUTHORITY_NOT_IN_APPROVAL_MODE",
    "APPROVAL_NOT_REQUIRED",
    "UNSUPPORTED_APPROVAL_ACTION",
    "VALIDATION",
    "REAUTH_REQUIRED",
    "TRANSFER_ALREADY_PENDING",
    "TRANSFER_NOT_FOUND",
    "TRANSFER_NOT_PENDING",
    "TRANSFER_NOT_ACCEPTED",
    "TRANSFER_EXPIRED",
    "RECIPIENT_NOT_FOUND",
    "RECIPIENT_IS_OWNER",
    "RECIPIENT_NOT_IN_THIS_BUSINESS",
    "RECIPIENT_PHONE_MISMATCH",
    "RECIPIENT_NOT_ACTIVE_CO_OWNER",
    "RECIPIENT_GRANT_ENDED",
    "GRANT_NOT_ARCHIVED",
    "GRANT_BELONGS_TO_OWNER",
    "BRANCH_NOT_FOUND",
    "MAIN_BRANCH_OWNER_ONLY",
    "BRANCH_ALREADY_HAS_CO_OWNER",
    "CO_OWNER_CANNOT_DELETE_BRANCH",
  ];
  return known.find((code) => raw.includes(code)) ?? "UNKNOWN";
}
