/**
 * Tenant Context Helper
 *
 * Resolves the current user's tenant ID from their membership.
 * Used by all stores that create/modify tenant-owned business data.
 *
 * Architecture: User → Membership → Tenant → Business Data
 * The tenant ID is NEVER trusted from the frontend — it's resolved
 * from the authenticated user's membership in the database.
 */

import { useAuthStore } from "@/stores/authStore";

/**
 * Get the current user's tenant ID.
 * This is the authoritative source for tenant context in all frontend operations.
 *
 * Priority:
 * 1. Membership-based tenant ID (new architecture)
 * 2. Legacy users.shop_id (backward compatibility)
 *
 * NEVER hardcode a tenant ID. NEVER accept it as a parameter from the UI.
 */
export function getCurrentTenantId(): string | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;

  // Primary: membership-based tenant ID
  if (user.tenantId) return user.tenantId;

  // Fallback: legacy shop_id (for pre-membership users)
  // This should not be needed after migration but provides safety
  return null;
}

/**
 * Get the current user's membership role.
 * Use this for frontend permission checks (hide/show UI elements).
 * Backend authorization is enforced by RPCs and RLS.
 */
export function getCurrentMembershipRole(): string | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;
  return user.membershipRole ?? null;
}

/**
 * Check if the current user is an admin or owner.
 * Used for UI-level permission checks (show/hide admin features).
 */
export function isCurrentUserAdmin(): boolean {
  const role = getCurrentMembershipRole();
  return role === "owner" || role === "admin";
}

/**
 * Check if the current user is the tenant owner.
 */
export function isCurrentUserOwner(): boolean {
  return getCurrentMembershipRole() === "owner";
}
