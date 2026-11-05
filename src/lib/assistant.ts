import { supabase } from "@/lib/supabase";

/**
 * The assistant, as the app uses it.
 *
 * There is no separate sign-in: this calls the `assistant` function with the session that is
 * already open, so the function reads the shop as the person holding the phone and can only
 * ever see what they can see. Nothing here decides what is allowed — the server does, from the
 * same permission rows the app's own screens use — so a bug in this file can lose an answer,
 * never widen access.
 *
 * Nothing is stored either, on this side or the other: the transcript lives in the screen's own
 * memory, and the last few turns are sent back as context. Close the screen and it is gone,
 * which is a stricter answer to "keep no history for more than 24 hours" than a purge job.
 */

/**
 * Every tool, named in the reader's language.
 *
 * The server calls a tool "Low stock" because it does not know which language this screen is in;
 * the screen does. So the card's heading and the list in "what this account can see" come from the
 * dictionary, and the server's own title is only a fallback for a tool this file has not met —
 * which is also how a new tool shows up in English rather than blank.
 */
const TOOL_TITLE_KEYS: Record<string, string> = {
  sales_summary: "assistant.tool.sales",
  profit_summary: "assistant.tool.profit",
  customer_account: "assistant.tool.customer",
  product_stock: "assistant.tool.stock",
  low_stock: "assistant.tool.low",
  sale_lookup: "assistant.tool.sale",
  supplier_dues: "assistant.tool.dues",
  employee_activity: "assistant.tool.activity",
  my_abilities: "assistant.tool.abilities",
  help_topic: "assistant.tool.help",
};

/** The dictionary key for a tool's name, or `null` for one this build has not met yet. */
export function toolTitleKey(tool: string): string | null {
  return TOOL_TITLE_KEYS[tool] ?? null;
}

export interface AssistantSource {
  label: string;
  route: string;
}

export interface AssistantWidget {
  /** Which tool produced this — the key the chat draws the matching card from. */
  tool: string;
  title: string;
  facts: Record<string, unknown>;
  notes: string[];
  sources: AssistantSource[];
}

export interface AssistantCall {
  name: string;
  ok: boolean;
  permission?: string | null;
}

export interface AssistantReply {
  answer: string;
  speak: string;
  model: string;
  refused: boolean;
  notes: string[];
  widgets: AssistantWidget[];
  sources: AssistantSource[];
  calls: AssistantCall[];
}

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantAbilities {
  user: { name: string | null; role: string };
  shell: "admin" | "employee";
  tools: { name: string; title: string; permission: string | null }[];
  withheld: { name: string; title: string; permission: string | null }[];
  model: string;
}

/**
 * A failure the screen can say in the reader's own language: the code is what gets translated, so
 * the copy lives in the dictionary with every other sentence the app shows.
 */
export type AssistantErrorCode = "not_switched_on" | "signed_out" | "unreachable" | "server";

export class AssistantError extends Error {
  code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/**
 * In development the function can be run locally, so the screen can be tried without deploying.
 * Put this in `.env.local` (which Vite loads for every mode) and `npm run dev` picks it up:
 *
 *   VITE_ASSISTANT_DEV_URL=http://localhost:64701   # node ai-assistant/server/dev.mjs
 *
 * The same code answers either way — this only chooses where the request goes.
 *
 * HONOURED ONLY IN A DEV BUILD, deliberately. Without the `DEV` test, a variable left in an env
 * file is baked into whatever is built next, and a shipped bundle whose assistant posts every
 * question to `http://localhost:64701` is a chat that silently answers nothing for every real
 * user — and, worse, quietly diverges from the deployed function that is the real boundary. This
 * is the same rule the rest of the app already runs on (see src/lib/envGuard.ts): the build must
 * not be able to point somewhere it was never told to point.
 */
const devUrl = import.meta.env.DEV
  ? (import.meta.env.VITE_ASSISTANT_DEV_URL as string | undefined)
  : undefined;

function codeFor(error: unknown): AssistantErrorCode {
  const raw = String((error as { message?: string })?.message ?? "");
  if (/failed to send a request|not found|404/i.test(raw)) return "not_switched_on";
  if (/401|jwt|expired/i.test(raw)) return "signed_out";
  return "unreachable";
}

async function post(body: Record<string, unknown>): Promise<any> {
  if (devUrl) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    const res = await fetch(devUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new AssistantError(res.status === 401 ? "signed_out" : "server", json?.error);
    return json;
  }

  const { data, error } = await supabase.functions.invoke("assistant", { body });
  if (error) throw new AssistantError(codeFor(error));
  if (data?.error) throw new AssistantError("server", data.error);
  return data;
}

/** One question. `history` is the transcript this screen is holding, newest last. */
export async function askAssistant(input: {
  text: string;
  photo?: { data: string; mimeType: string } | null;
  history?: AssistantTurn[];
}): Promise<AssistantReply> {
  const data = await post({
    text: input.text,
    photo: input.photo ?? undefined,
    history: (input.history ?? []).slice(-8),
  });
  return {
    answer: String(data.answer ?? ""),
    speak: String(data.speak ?? data.answer ?? ""),
    model: String(data.model ?? ""),
    refused: !!data.refused,
    notes: Array.isArray(data.notes) ? data.notes : [],
    widgets: Array.isArray(data.widgets) ? data.widgets : [],
    sources: Array.isArray(data.sources) ? data.sources : [],
    calls: Array.isArray(data.calls) ? data.calls : [],
  };
}

/** What this account may ask about — shown so the boundary is visible, not discovered. */
export async function assistantAbilities(): Promise<AssistantAbilities> {
  const data = await post({ action: "tools" });
  return {
    user: data.user ?? { name: null, role: "" },
    shell: data.shell === "employee" ? "employee" : "admin",
    tools: Array.isArray(data.tools) ? data.tools : [],
    withheld: Array.isArray(data.withheld) ? data.withheld : [],
    model: String(data.model ?? ""),
  };
}

/** Speak a reply through the device, when the browser supports it. */
export function speak(text: string): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

/**
 * Listening, when the browser supports it. `onText` fires with what was heard.
 *
 * `lang` is a parameter because the finance quick-add form reads the owner's sentence in the
 * language the app is already in; the assistant keeps its own default.
 */
export function listen(
  onText: (text: string) => void,
  onEnd?: () => void,
  lang = "en-PK",
): (() => void) | null {
  const Recognition =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event: any) => {
    let heard = "";
    for (const result of event.results) heard += result[0].transcript;
    onText(heard.trim());
  };
  recognition.onend = () => onEnd?.();
  recognition.start();
  return () => recognition.stop();
}
