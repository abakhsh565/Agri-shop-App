import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
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
  branch_overview: "assistant.tool.branches",
  employee_directory: "assistant.tool.employees",
  employee_performance: "assistant.tool.performance",
  purchases_overview: "assistant.tool.purchases",
  finance_overview: "assistant.tool.finance",
  inventory_overview: "assistant.tool.inventory",
  customer_directory: "assistant.tool.customers",
  product_catalogue: "assistant.tool.catalogue",
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
export type AssistantErrorCode = "not_switched_on" | "signed_out" | "unreachable" | "timeout" | "server";

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
  const status = Number(
    (error as { context?: { status?: number } })?.context?.status ??
      (error as { status?: number })?.status ??
      0,
  );
  if (status === 401) return "signed_out";
  if (status >= 500) return "unreachable";
  if (/failed to send a request|not found|404/i.test(raw)) return "not_switched_on";
  if (/401|jwt|expired/i.test(raw)) return "signed_out";
  if (/503|502|504|service temporarily unavailable|failed to fetch|network ?error/i.test(raw)) {
    return "unreachable";
  }
  return "server";
}

/** A question that never settles leaves the composer disabled forever; a bounded wait is kinder. */
const REQUEST_TIMEOUT_MS = 60_000;

async function invoke(body: Record<string, unknown>): Promise<any> {
  if (devUrl) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    const res = await fetch(devUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) throw new AssistantError("signed_out", json?.error);
      throw new AssistantError(res.status >= 500 ? "unreachable" : "server", json?.error);
    }
    return json;
  }

  const { data, error } = await supabase.functions.invoke("assistant", { body });
  if (error) throw new AssistantError(codeFor(error));
  if (data?.error) throw new AssistantError("server", data.error);
  return data;
}

async function post(body: Record<string, unknown>): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AssistantError("timeout")), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([invoke(body), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  onError?: (code: "unsupported" | "permission" | "failed") => void,
): (() => void) | null {
  // An installed Android app does not reliably expose the Web Speech API inside System WebView.
  // Use the phone's own recognizer there; the browser path below remains for the web/PWA build.
  if (Capacitor.getPlatform() === "android") {
    return listenOnAndroid(onText, onEnd, lang, onError);
  }

  const Recognition =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
  if (!Recognition) {
    onError?.("unsupported");
    return null;
  }
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
  recognition.onerror = (event: { error?: string }) => {
    const reason = event?.error ?? "";
    onError?.(
      reason === "not-allowed" || reason === "service-not-allowed"
        ? "permission"
        : "failed",
    );
  };
  try {
    recognition.start();
  } catch {
    onError?.("failed");
    return null;
  }
  return () => recognition.stop();
}

/** The native plugin registered by MainActivity on Android. */
interface NativeSpeechPlugin {
  start(options: { lang: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: string, callback: (data: any) => void): Promise<PluginListenerHandle>;
}

const NativeSpeech = registerPlugin<NativeSpeechPlugin>("SpeechRecognition");

/**
 * `listen()` with the same contract, backed by Android's SpeechRecognizer.
 *
 * The native start call is asynchronous, but callers already expect a synchronous stop handle.
 * Every listener is removed on result, error, or stop so one utterance cannot leave a second
 * recognizer listening in the background.
 */
function listenOnAndroid(
  onText: (text: string) => void,
  onEnd: (() => void) | undefined,
  lang: string,
  onError: ((code: "unsupported" | "permission" | "failed") => void) | undefined,
): () => void {
  let finished = false;
  const listeners: Promise<PluginListenerHandle>[] = [];

  const removeListeners = () => {
    void Promise.all(listeners).then((handles) => {
      for (const handle of handles) void handle.remove();
    });
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    removeListeners();
    onEnd?.();
  };
  const fail = (code: "unsupported" | "permission" | "failed") => {
    if (finished) return;
    onError?.(code);
    finish();
  };

  listeners.push(
    NativeSpeech.addListener("result", (event: { text?: string }) => {
      if (!finished && event?.text) onText(event.text);
    }),
  );
  listeners.push(NativeSpeech.addListener("end", finish));
  listeners.push(
    NativeSpeech.addListener("error", (event: { code?: string }) => {
      fail(event?.code === "permission" ? "permission" : "failed");
    }),
  );

  void NativeSpeech.start({ lang }).catch((error: unknown) => {
    const message = String((error as { message?: string })?.message ?? error ?? "").toLowerCase();
    fail(
      message.includes("permission")
        ? "permission"
        : message.includes("unsupported")
          ? "unsupported"
          : "failed",
    );
  });

  return () => {
    if (finished) return;
    finished = true;
    removeListeners();
    void NativeSpeech.stop().catch(() => {});
  };
}
