import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { navigateBack } from "@/lib/navContext";

/** Shared Back action for screens with their own header arrow instead of NavHeader. */
export function useAppBack(backTo?: string) {
  const location = useLocation();
  const navigate = useNavigate();
  return useCallback(() => {
    navigateBack(location, navigate, backTo);
  }, [backTo, location, navigate]);
}
