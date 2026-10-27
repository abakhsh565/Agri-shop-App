import { useEffect, useRef, useState } from "react";
import {
  captureDataContext,
  isDataContextCurrent,
  whenDataContextConfirmed,
} from "@/lib/localCache";

/**
 * A branch-scoped ledger read that survives being issued too early.
 *
 * WHY THIS IS NOT A PLAIN FETCH. A screen can mount a moment before the shell has confirmed
 * which shop and branch the app is working in — a cold start, a deep link, or the first
 * navigation after sign-in. A read that goes out then is answered "may not publish" and, if it
 * is simply dropped, `ready` never turns true and the screen keeps its skeleton for the whole
 * session even though the confirmation arrived a moment later (`whenDataContextConfirmed`
 * documents the same failure). So the read waits for that confirmation, then publishes only
 * under the context it was issued in — and if the shop or branch changed while it was in
 * flight, it reads again rather than showing one branch's rows under another branch's name.
 *
 * `ready` means the read has settled — succeeded, failed, or been given up on — so a screen can
 * tell "none yet" apart from "not asked yet" and never prints a zero over a ledger it has not
 * seen.
 *
 * Rows a reader may see are the rows the database returns: shop and branch scope are row
 * policies, not filters applied here.
 */
export function useScopedRows<T>(read: () => Promise<T[]>): { rows: T[]; ready: boolean } {
  const [rows, setRows] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(read);
  latest.current = read;

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isDataContextCurrent(captureDataContext()) && !(await whenDataContextConfirmed())) {
        // No confirmed shop or branch to read under. Settle, so the screen says what it knows
        // instead of spinning.
        if (active) setReady(true);
        return;
      }
      const context = captureDataContext();
      try {
        const next = await latest.current();
        if (!active) return;
        if (!isDataContextCurrent(context)) {
          // Read again under the context that is current now — bounded, so an app that keeps
          // changing shop still settles instead of looping.
          if (attempt < 3) setAttempt(attempt + 1);
          else setReady(true);
          return;
        }
        setRows(next);
        setReady(true);
      } catch {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  return { rows, ready };
}
