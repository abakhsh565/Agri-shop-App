import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { experienceOf, homePathForUser } from "@/lib/experience";
import { hasPin } from "@/lib/pinLock";
import type { Experience } from "@/types";
import type { UserRole } from "@/types";

/**
 * Route guard. Blocks access unless a user is logged in and (optionally) holds
 * one of `allowedRoles`. This enforces the SECURITY.md rule that authorization
 * must not rely on merely hiding UI — an employee cannot reach /admin URLs.
 *
 * NOTE: this is the client-side gate. The authoritative enforcement is the
 * Supabase Row-Level Security policies applied to the data (see ADR-006);
 * this guard is the UX layer on top of that.
 */
export default function ProtectedRoute({
  allowedRoles,
  allowedExperiences,
  requirePin = false,
}: {
  allowedRoles?: UserRole[];
  allowedExperiences?: Experience[];
  /** Workspace shells require this device's PIN marker; identity/setup routes do not. */
  requirePin?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Wrong role for this area — send them to their own home.
    return <Navigate to={homePathForUser(user)} replace />;
  }

  if (allowedExperiences && !allowedExperiences.includes(experienceOf(user))) {
    // A Co-Owner is an employee account with a delegated owner experience. The
    // route guard follows the SERVER-resolved experience, never users.role alone.
    return <Navigate to={homePathForUser(user)} replace />;
  }

  // A verified OTP session is not the same as a device PIN. The PIN screens are
  // public so this redirect cannot loop, and identity/setup routes deliberately do
  // not opt into this flag.
  if (requirePin && !hasPin(user.id)) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to="/login/pin-set" replace state={{ returnTo }} />;
  }

  return <Outlet />;
}
