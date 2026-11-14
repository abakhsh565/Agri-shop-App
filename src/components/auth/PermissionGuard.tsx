import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { hasPermission, isCurrentUserAdmin } from "@/lib/tenantContext";
import type { PermissionCode } from "@/types";

/**
 * Permission-based route guard for admin sub-routes.
 * Checks that the current user has the required permission(s).
 *
 * Owners always pass (they have all permissions implicitly).
 * Admins/employees are checked against their granted permissions.
 *
 * NOTE: This is the client-side gate. The authoritative enforcement is
 * the Supabase RLS + SECURITY DEFINER RPCs. This guard is the UX layer.
 */
export default function PermissionGuard({
  requires,
  fallback,
}: {
  requires?: PermissionCode | PermissionCode[];
  fallback?: string;
}) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Owner always passes
  if (user.membershipRole === "owner") return <Outlet />;

  // No specific permission required — just needs to be in admin area
  if (!requires) return <Outlet />;

  const requiredPerms = Array.isArray(requires) ? requires : [requires];
  const allowed = requiredPerms.some((p) => hasPermission(p));

  if (!allowed) {
    const home = location.pathname.startsWith("/co-owner") ? "/co-owner/dashboard" : "/admin/dashboard";
    return (
      <Navigate
        to={fallback ?? home}
        replace
      />
    );
  }

  return <Outlet />;
}
