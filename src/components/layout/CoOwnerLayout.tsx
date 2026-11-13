import { Navigate, useLocation } from "react-router-dom";

/** The shape the legacy, now-unmounted Co-Owner pages still type their outlet context with. */
export interface CoOwnerAccess {
  grantId: string;
  status: string;
  businessName: string;
  tenantId: string;
  permissions: string[];
  dashboards: string[];
  authorities: Record<string, string>;
  branches: Array<{ id: string; name: string; isMain: boolean }>;
  scope: { branches_mode?: string; suppliers_mode?: string; departments_mode?: string; records_mode?: string } | null;
  canInviteEmployees: boolean;
  canDeactivateEmployees: boolean;
  canManageBranches: boolean;
}

/**
 * Legacy Co-Owner addresses.
 *
 * A Co-Owner is a separate phone profile, not a separate product. The Owner asked for the
 * same design, screens and controls, with the existing permission, branch-scope and
 * major-action checks deciding what that profile can actually use. The old `/co-owner/*`
 * workspace is therefore no longer a destination: every address forwards to the matching
 * `/admin/*` screen. `/co-owner/accept` remains outside this layout because accepting the
 * delegation is its own step.
 */
export default function CoOwnerLayout() {
  const { pathname, search, hash } = useLocation();
  const target = pathname.replace(/^\/co-owner/, "/admin");
  return <Navigate to={`${target}${search}${hash}`} replace />;
}
