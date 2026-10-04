import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PickedPlace } from "@/lib/geo";

/**
 * Take the location the picker page handed back.
 *
 * The picker is a page of its own, so the choice cannot travel back through the component that
 * opened it — that component was unmounted while the picker was on screen. It travels through
 * the router instead: the picker returns to the same path with `pickedPlace` in the location
 * state, and whichever field opened it applies the value here and clears the state in place, so
 * going back or refreshing does not re-apply an old choice.
 */
export function usePickedLocation(apply: (place: PickedPlace) => void): void {
  const location = useLocation();
  const navigate = useNavigate();
  const picked = (location.state as { pickedPlace?: PickedPlace } | null)?.pickedPlace;
  // The query is part of where we are, not decoration: a sheet that reopens itself from a
  // `?setupFlow=` marker reads it, and clearing the state with a bare path would take the marker
  // with it and drop the owner back to the list instead of the form they left.
  const here = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!picked) return;
    apply(picked);
    navigate(here, { replace: true, state: null });
  }, [picked, apply, here, navigate]);
}
