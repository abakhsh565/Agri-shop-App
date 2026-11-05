import { useEffect, useRef } from "react";
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
  /**
   * The apply callback, held in a ref rather than listed as a dependency.
   *
   * Callers pass an inline arrow (`(place) => setSetupDraft({ place })`), so its identity is
   * new on every render of the screen that opened the picker. As a dependency it made this
   * effect re-run on every one of those renders — and each run applied the place again and
   * re-rendered the screen that applied it. On the branch setup sheet that loop reached
   * React's nested-update limit and surfaced as "Maximum update depth exceeded", which the
   * router renders as its error page: the half-second error screen an owner saw the moment
   * they tapped a search result. A ref gives the effect the current callback without letting
   * a new closure restart it; `picked` is the only thing that should.
   */
  const applyRef = useRef(apply);
  applyRef.current = apply;
  // The query is part of where we are, not decoration: a sheet that reopens itself from a
  // `?setupFlow=` marker reads it, and clearing the state with a bare path would take the marker
  // with it and drop the owner back to the list instead of the form they left.
  const here = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!picked) return;
    applyRef.current(picked);
    navigate(here, { replace: true, state: null });
  }, [picked, here, navigate]);
}
