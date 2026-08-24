import { useLocation } from "react-router-dom";

/**
 * Returns the current shell's base path ("/admin" or "/employee").
 *
 * Several pages (customers, activity, …) are mounted under BOTH the admin and
 * employee shells. They must navigate relative to the shell they're currently
 * in — otherwise an admin tapping a customer would be thrown into the employee
 * side. Build every internal link as `${base}/...` instead of hardcoding a shell.
 */
export function useShellBase(): "/admin" | "/employee" {
  const { pathname } = useLocation();
  return pathname.startsWith("/admin") ? "/admin" : "/employee";
}
