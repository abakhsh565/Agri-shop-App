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

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  onEnd?: () => void;
  onError?: () => void;
}

/**
 * Speak a reply through the device, when the browser supports it.
 *
 * The caller needs the end of the utterance, not just the start: turning a spoken reply into a
 * voice conversation means opening the microphone only after the device has finished speaking,
 * or it hears the assistant's own voice. The callbacks are deliberately optional so the older
 * read-aloud buttons keep working unchanged.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  if (typeof SpeechSynthesisUtterance === "undefined") return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang ?? "en-US";
  utterance.rate = options.rate ?? 1;
  // Prefer an installed voice for the reading language. Falling back to the browser default is
  // still useful on a device with no matching voice, and the error path is handled by the page.
  const base = utterance.lang.split("-")[0].toLowerCase();
  const voice = synth
    .getVoices()
    .find((candidate) => candidate.lang.toLowerCase().split(/[-_]/)[0] === base);
  if (voice) utterance.voice = voice;
  if (options.onEnd) utterance.onend = options.onEnd;
  if (options.onError) utterance.onerror = options.onError;
  synth.speak(utterance);
  return true;
}

/** Stop whatever the device is reading, if anything. */
export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
}

export interface UrduSpeechOptions {
  onEnd?: () => void;
  onError?: () => void;
}

export interface UrduSpeechHandle {
  stop: () => void;
}

/** Built once per reply, so pressing the same speaker twice does not pay for speech twice. */
const speechCache = new Map<string, { audio: string; mimeType: string }>();
const MAX_CACHED_REPLIES = 12;

function speechUrl(audio: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(audio), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/wav" }));
}

/**
 * Read a reply in Urdu through the assistant's own speech service.
 *
 * The server translates the displayed reply and returns a WAV, so this does not depend on an Urdu
 * voice being installed on the phone. The request is kicked off synchronously from the click (the
 * caller gets a stop handle immediately); the audio starts as soon as the server has prepared it.
 * A stop during preparation prevents playback, and a stop during playback stops the element.
 */
export function speakUrdu(
  text: string,
  options: UrduSpeechOptions = {},
): UrduSpeechHandle | null {
  const value = text.trim();
  if (!value) return null;
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;

  const cleanup = () => {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
    }
    audio = null;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };
  const settle = (failed: boolean) => {
    if (stopped) return;
    stopped = true;
    cleanup();
    if (failed) options.onError?.();
    else options.onEnd?.();
  };

  void (async () => {
    try {
      let speech = speechCache.get(value);
      if (!speech) {
        const data = await post({ action: "speak", text: value });
        const audioData = String(data?.audio ?? "");
        if (!audioData) throw new Error("No speech returned.");
        speech = { audio: audioData, mimeType: String(data?.mimeType ?? "audio/wav") };
        speechCache.set(value, speech);
        if (speechCache.size > MAX_CACHED_REPLIES) {
          const oldest = speechCache.keys().next().value;
          if (oldest) speechCache.delete(oldest);
        }
      }
      if (stopped) return;
      objectUrl = speechUrl(speech.audio, speech.mimeType);
      audio = new Audio(objectUrl);
      audio.onended = () => settle(false);
      audio.onerror = () => settle(true);
      await audio.play();
    } catch {
      settle(true);
    }
  })();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (audio) audio.pause();
      cleanup();
    },
  };
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
  lang = "en-US",
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
  let started = false;
  let listeners: PluginListenerHandle[] = [];

  const removeListeners = () => {
    for (const handle of listeners) void handle.remove();
    listeners = [];
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

  const start = async () => {
    try {
      // Attach before starting. The native recognizer can emit `error` immediately when it cannot
      // support the requested language; starting first let that event arrive with no listener and
      // left the screen waiting for an utterance that had already failed.
      const handles = await Promise.all([
        NativeSpeech.addListener("result", (event: { text?: string }) => {
          if (!finished && event?.text) onText(event.text);
        }),
        NativeSpeech.addListener("end", finish),
        NativeSpeech.addListener("error", (event: { code?: string }) => {
          fail(
            event?.code === "permission"
              ? "permission"
              : event?.code === "unsupported"
                ? "unsupported"
                : "failed",
          );
        }),
      ]);
      if (finished) {
        for (const handle of handles) void handle.remove();
        return;
      }
      listeners = handles;
      started = true;
      await NativeSpeech.start({ lang });
    } catch (error) {
      const message = String((error as { message?: string })?.message ?? error ?? "").toLowerCase();
      fail(
        message.includes("permission")
          ? "permission"
          : message.includes("unsupported")
            ? "unsupported"
            : "failed",
      );
    }
  };
  void start();

  return () => {
    if (finished) return;
    finished = true;
    removeListeners();
    if (started) void NativeSpeech.stop().catch(() => {});
  };
}
