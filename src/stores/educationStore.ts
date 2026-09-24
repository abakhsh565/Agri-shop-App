import { create } from "zustand";

/**
 * First-run and tour state — and *only* that.
 *
 * This is not the setup-completion system. Setup answers "what is the shop still
 * missing"; this answers "has this person been introduced to the product". They
 * are read by different screens for different reasons and never write to each
 * other, so a finished tour can never mark the shop configured, and adding a
 * supplier can never hide the tour.
 *
 * Where the state lives, and why:
 *
 *  - **Is this person new?** No flag is invented for it. `users.first_login_at`
 *    is already written by the login path, and `user.firstLoginAt` is null
 *    exactly for the session that is the first one — so the server stays the
 *    authority on newness.
 *  - **Was the welcome dismissed / the tour finished?** Per-account local record
 *    (`agrishop-edu:<userId>`), following the app's existing store pattern. No
 *    table, no migration, no RLS. Honest trade-off: it is device-local, so the
 *    same account on a second phone is offered the welcome once more. That is
 *    harmless — the tour stays reachable from App guide either way.
 *  - **Is the overlay open right now?** In memory only, never persisted. A
 *    reload therefore cannot restore a half-finished overlay over the app, which
 *    is one of the failures this system must not have.
 */

const KEY_PREFIX = "agrishop-edu:";

interface Persisted {
  welcomeSeen: boolean;
  tourDone: boolean;
}

const EMPTY: Persisted = { welcomeSeen: false, tourDone: false };

function read(uid: string | null): Persisted {
  if (!uid) return EMPTY;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + uid);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { welcomeSeen: !!parsed.welcomeSeen, tourDone: !!parsed.tourDone };
  } catch {
    return EMPTY; // storage blocked or corrupt — a fresh introduction is the safe read
  }
}

function write(uid: string | null, value: Persisted): void {
  if (!uid) return;
  try {
    localStorage.setItem(KEY_PREFIX + uid, JSON.stringify(value));
  } catch {
    // storage blocked (private mode): the tour still works for this session
  }
}

interface EducationState {
  uid: string | null;
  welcomeSeen: boolean;
  tourDone: boolean;
  /** In-memory only. Never persisted, so a reload cannot leave an overlay. */
  welcomeOpen: boolean;
  tourOpen: boolean;
  /** Point the store at the signed-in account and load its record. */
  sync: (uid: string | null) => void;
  openWelcome: () => void;
  /** "Later" — and the sheet's own close: seen, but not taught. */
  dismissWelcome: () => void;
  /** From the welcome or the App guide. Closes the sheet, opens the tour. */
  startTour: () => void;
  /** Skip, X, Escape, or finishing the last step. Writes nothing but the flag. */
  closeTour: () => void;
}

export const useEducationStore = create<EducationState>((set, get) => ({
  uid: null,
  welcomeSeen: false,
  tourDone: false,
  welcomeOpen: false,
  tourOpen: false,

  sync: (uid) => {
    if (get().uid === uid) return;
    const persisted = read(uid);
    set({ uid, ...persisted, welcomeOpen: false, tourOpen: false });
  },

  openWelcome: () => set({ welcomeOpen: true }),

  dismissWelcome: () => {
    const next = { welcomeSeen: true, tourDone: get().tourDone };
    write(get().uid, next);
    set({ ...next, welcomeOpen: false });
  },

  startTour: () => {
    const next = { welcomeSeen: true, tourDone: get().tourDone };
    write(get().uid, next);
    set({ ...next, welcomeOpen: false, tourOpen: true });
  },

  closeTour: () => {
    const next = { welcomeSeen: get().welcomeSeen, tourDone: true };
    write(get().uid, next);
    set({ ...next, tourOpen: false });
  },
}));
