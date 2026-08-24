import { useState, useEffect } from "react";

/**
 * Returns the current time and re-renders the component every `intervalMs`
 * (default 60 000 ms = 1 minute). Use this in any component that displays
 * relative time ("5 min ago", "Today at 3:00 PM") or date-dependent values
 * that should stay fresh without requiring a manual refresh.
 */
export function useCurrentTime(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
