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

// ── Permission checks ────────────────────────────────────────────────────────

/**
 * Get the current user's granted permissions.
 * Owner gets all permissions implicitly.
 */
export function getCurrentPermissions(): string[] {
  const user = useAuthStore.getState().user;
  if (!user) return [];
  // Identity/shell does not grant authority. Only the business owner has
  // implicit access; ordinary memberships use their actual effective grants.
  if (user.membershipRole === "owner") return ["*"];
  return user.permissions ?? [];
}

/**
 * Check if the current user has a specific permission.
 * Owner always has all permissions.
 */
export function hasPermission(code: string): boolean {
  const perms = getCurrentPermissions();
  if (perms.includes("*")) return true;
  return perms.includes(code);
}

/**
 * Check if the current user can access a module (any action).
 */
export function canAccessModule(module: string): boolean {
  const perms = getCurrentPermissions();
  if (perms.includes("*")) return true;
  return perms.some(p => p.startsWith(module + "."));
}

// ── Dashboard visibility ─────────────────────────────────────────────────────

/**
 * May the signed-in account be shown this dashboard block?
 *
 * Deliberately a different question from `hasPermission()`: seeing a figure is not the
 * right to change it, and the owner sets the two separately on a role (migration 0250).
 *
 * `undefined` on the user means the answer has not been read yet — an older session, or
 * the moment before `refreshPermissions()` lands. That is treated as "do not hide": a
 * screen that erases itself while a request is in flight is worse than one that briefly
 * shows a block the role has since lost. `[]` is a real answer and hides everything.
 */
export function canSeeDashboard(key: string): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  if (user.membershipRole === "owner") return true;
  if (!user.dashboards) return true;
  return user.dashboards.includes(key);
}
