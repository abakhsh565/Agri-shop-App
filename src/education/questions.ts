import { useAuthStore } from "@/stores/authStore";

/**
 * "I don't understand this" — kept on the device it was written on.
 *
 * There is no support backend in this app, so this deliberately does not invent one: the
 * question, who asked it and where they were standing are stored locally, which means a
 * shopkeeper always has somewhere to put the thing they did not understand, and whoever
 * helps them (the owner, the shop's helper, support) can read it off the same phone with
 * the context needed to answer it.
 *
 * Nothing here touches the database. Education never writes business data — that rule is
 * enforced by this file being the only writer, and it writes to `localStorage` only.
 */
export interface EduQuestion {
  id: string;
  /** What they asked, in their own words. */
  text: string;
  /** Where they were in the app when they asked. */
  route: string;
  /** Who asked, so an answer can be given to the right person. */
  name: string;
  role: string;
  askedAt: string;
}

const KEY = "agrishop-edu-questions";

export function loadQuestions(): EduQuestion[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as EduQuestion[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: EduQuestion[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* a full disk must not break the screen the person is standing on */
  }
}

/** Save a question, stamped with who asked it and where. Returns the stored record. */
export function saveQuestion(text: string, route: string): EduQuestion {
  const user = useAuthStore.getState().user;
  const record: EduQuestion = {
    id: `${Date.now()}`,
    text: text.trim(),
    route,
    name: user?.name ?? "",
    role: user?.membershipRole ?? user?.role ?? "",
    askedAt: new Date().toISOString(),
  };
  persist([record, ...loadQuestions()]);
  return record;
}

export function removeQuestion(id: string): EduQuestion[] {
  const next = loadQuestions().filter((q) => q.id !== id);
  persist(next);
  return next;
}
