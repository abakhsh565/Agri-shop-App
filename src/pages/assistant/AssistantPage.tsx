import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import Sheet from "@/components/ui/Sheet";
import AssistantWidget from "@/components/assistant/AssistantWidget";
import AssistantFinanceCard from "@/components/assistant/AssistantFinanceCard";
import {
  askAssistant,
  assistantAbilities,
  listen,
  speakUrdu,
  stopSpeaking,
  toolTitleKey,
  AssistantError,
  type AssistantAbilities,
  type AssistantReply,
  type AssistantTurn,
} from "@/lib/assistant";
import { financeDraftFromText, type AssistantFinanceDraft } from "@/lib/assistantFinance";
import { translations, useT } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { HARD_MAX_IMAGE_BYTES, prepareImage } from "@/lib/imageCompression";

/**
 * The assistant is a separate place, not a tab inside the shop.
 *
 * The reference is a dark, quiet conversation: one mark, a small welcome, suggestions that are
 * actual questions, and a composer that stays at the bottom. The app's own tokens replace the
 * reference's orange, because this is still the same shop. The screen owns its own header and
 * therefore the shell hides its tab bar for this route: a tab bar under a conversation reads as a
 * second destination inside a screen that is already a destination.
 *
 * Images and voice are part of the composer, not an afterthought. A photo can come from the
 * camera or the gallery; a voice note is transcribed into the same draft, so the person can
 * correct a word before sending. Every assistant message carries its own speaker; pressing it
 * reads that message with the Urdu voice, whatever language the app is in, and stops when asked.
 *
 * Money is review-first. A sentence that clearly says income or expense becomes a card showing
 * what was understood and a single door into the existing ledger form. The card says, in words,
 * that nothing is saved yet. The assistant has no write path to the ledger.
 */

type Photo = { data: string; mimeType: string; name: string };

type Entry =
  | { kind: "user"; text: string; photo?: Photo }
  | { kind: "reply"; reply: AssistantReply }
  | { kind: "finance"; draft: AssistantFinanceDraft }
  | { kind: "error"; text: string };

const MAX_ASSISTANT_PHOTO_BYTES = HARD_MAX_IMAGE_BYTES;
const SPEECH_LANG_EN = "en-US";
const SPEECH_LANG_UR = "ur-PK";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** A tool's name, read in the language this screen is in — never the server's English one. */
function toolName(t: (key: string) => string, tool: { name: string; title: string }): string {
  const key = toolTitleKey(tool.name);
  return key ? t(key) : tool.title;
}

/** The reference's talking mark, drawn from the app's own green rather than its orange. */
function AssistantOrb({ compact = false }: { compact?: boolean }) {
  const bars = compact ? 5 : 7;
  return (
    <span
      className={`ds-assistant-orb${compact ? " ds-assistant-orb--compact" : ""}`}
      aria-hidden="true"
    >
      <span className="ds-assistant-orb-bars">
        {Array.from({ length: bars }, (_, index) => (
          <span key={index} style={{ animationDelay: `${index * 0.11}s` }} />
        ))}
      </span>
    </span>
  );
}

export default function AssistantPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const user = useAuthStore((s) => s.user);
  const language = useThemeStore((s) => s.language);
  // The composer keeps the English control order in both languages: the thumb already knows
  // where the mic and send buttons are. Only the content uses the reading direction, so Urdu
  // text sits at the right edge of the field while the rest of the screen stays localized.
  const composerPlaceholder =
    language === "ur" ? translations.en["assistant.placeholder"] : t("assistant.placeholder");
  const canRecordMoney = user?.membershipRole === "owner";

  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<AssistantTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [speaking, setSpeaking] = useState<{ index: number; text: string } | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [abilities, setAbilities] = useState<AssistantAbilities | null>(null);
  const [showAbilities, setShowAbilities] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const stopListeningRef = useRef<(() => void) | null>(null);
  const stopAudioRef = useRef<(() => void) | null>(null);
  const listeningRef = useRef(false);
  const sendingRef = useRef(false);
  // A new spoken reply or a manual stop increments this. Late callbacks from a cancelled
  // utterance cannot then update the speaking state or start a second utterance.
  const speakRun = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void assistantAbilities().then(setAbilities).catch(() => {});
  }, []);

  useEffect(() => {
    if (!entries.length && !busy) return;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries, busy]);

  useEffect(() => () => {
    stopListeningRef.current?.();
    stopAudioRef.current?.();
    stopSpeaking();
  }, []);

  /**
   * A conversation is a viewport, not a document.
   *
   * On Android `100dvh` does not follow the keyboard, and focusing the textarea can make the
   * WebView scroll the document, dragging the header away and leaving the composer underneath
   * the keyboard. The native keyboard height is measured against the app window, so the shell
   * uses `innerHeight - keyboardHeight`.
   *
   * `visualViewport.height` is not the same number on this phone: it includes Gboard's toolbar,
   * which leaves the composer tucked just under the keyboard. Keep it as the browser fallback,
   * but use Capacitor's native inset in the installed app.
   */
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const setViewportHeight = (height: number) => {
      const value = Math.round(height);
      if (value > 0) {
        root.style.setProperty("--assistant-viewport-height", `${value}px`);
      }
    };
    const resetScroll = () => {
      if (window.scrollY || root.scrollTop || body.scrollTop) window.scrollTo(0, 0);
    };

    let cleanup = () => {};

    if (Capacitor.isNativePlatform()) {
      // Capacitor reports keyboardHeight in CSS pixels, measured from the app window.
      const show = (info: { keyboardHeight: number }) => {
        // Android includes the navigation-bar strip in the IME inset. The WebView is already
        // above that strip, so subtracting the whole inset leaves a dead band above the keyboard.
        // Put back only the part that is outside the app viewport.
        const systemBarInset = Math.max(0, window.screen.height - window.innerHeight);
        setViewportHeight(window.innerHeight - info.keyboardHeight + systemBarInset);
        setKeyboardOpen(true);
        resetScroll();
      };
      const hide = () => {
        setViewportHeight(window.innerHeight);
        setKeyboardOpen(false);
        resetScroll();
      };
      const willShow = Keyboard.addListener("keyboardWillShow", show);
      const didShow = Keyboard.addListener("keyboardDidShow", show);
      const willHide = Keyboard.addListener("keyboardWillHide", hide);
      const didHide = Keyboard.addListener("keyboardDidHide", hide);
      cleanup = () => {
        void willShow.then((handle) => handle.remove());
        void didShow.then((handle) => handle.remove());
        void willHide.then((handle) => handle.remove());
        void didHide.then((handle) => handle.remove());
      };
    } else {
      const viewport = window.visualViewport;
      const syncViewport = () => {
        const height = viewport?.height ?? window.innerHeight;
        setViewportHeight(height);
        setKeyboardOpen(window.innerHeight - height > 120);
        resetScroll();
      };
      syncViewport();
      viewport?.addEventListener("resize", syncViewport);
      viewport?.addEventListener("scroll", syncViewport);
      cleanup = () => {
        viewport?.removeEventListener("resize", syncViewport);
        viewport?.removeEventListener("scroll", syncViewport);
      };
    }

    setViewportHeight(window.innerHeight);
    resetScroll();

    return () => {
      cleanup();
      root.style.removeProperty("--assistant-viewport-height");
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  /** The failure, translated from a stable code rather than raw server English. */
  function errorText(error: unknown): string {
    if (error instanceof AssistantError) {
      if (error.code === "not_switched_on") return t("assistant.off");
      if (error.code === "signed_out") return t("assistant.signedOut");
      if (error.code === "unreachable") return t("assistant.unreachable");
      if (error.code === "timeout") return t("assistant.timeout");
    }
    return t("assistant.failed");
  }  function stopVoice() {
    speakRun.current += 1;
    stopAudioRef.current?.();
    stopAudioRef.current = null;
    setSpeaking(null);
    stopSpeaking();
  }

  /**
   * Read one assistant message in Urdu, whatever language the screen is in.
   *
   * The token is the whole lifecycle: if the person taps stop, sends another question, or
   * chooses a different message, an older utterance cannot keep speaking or overwrite the
   * loading state of the new one.
   */
  function readAloud(text: string, index: number) {
    const value = text.trim();
    if (!value) return;
    speakRun.current += 1;
    const run = speakRun.current;
    stopAudioRef.current?.();
    stopAudioRef.current = null;
    stopSpeaking();
    setSpeechError("");

    setSpeaking({ index, text: value });
    const handle = speakUrdu(value, {
      onEnd: () => {
        if (run !== speakRun.current) return;
        stopAudioRef.current = null;
        setSpeaking(null);
      },
      onError: () => {
        if (run !== speakRun.current) return;
        stopAudioRef.current = null;
        setSpeaking(null);
        setSpeechError(t("assistant.speakFailed"));
      },
    });
    if (!handle) {
      setSpeaking(null);
      setSpeechError(t("assistant.speakUnsupported"));
      return;
    }
    stopAudioRef.current = handle.stop;
  }

  function stopMic() {
    stopListeningRef.current?.();
    stopListeningRef.current = null;
    listeningRef.current = false;
    setListening(false);
  }

  /** The microphone fills the composer draft; it never sends automatically. */
  function startListening() {
    if (listeningRef.current) return;
    setMicError("");
    const stop = listen(
      (heard) => setDraft(heard),
      () => {
        listeningRef.current = false;
        stopListeningRef.current = null;
        setListening(false);
      },
      language === "ur" ? SPEECH_LANG_UR : SPEECH_LANG_EN,
      (code) => {
        listeningRef.current = false;
        stopListeningRef.current = null;
        setListening(false);
        setMicError(
          code === "permission"
            ? t("assistant.micPermission")
            : code === "unsupported"
              ? t("assistant.micUnsupported")
              : t("assistant.micFailed"),
        );
      },
    );
    if (!stop) {
      setMicError(t("assistant.micUnsupported"));
      return;
    }
    stopListeningRef.current = stop;
    listeningRef.current = true;
    setListening(true);
  }

  function newChat() {
    stopMic();
    stopVoice();
    setEntries([]);
    setHistory([]);
    setDraft("");
    setPhoto(null);
    setPhotoError(null);
    setMicError("");
    setSpeechError("");
    setAttachOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function goBack() {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(`${base}/dashboard`, { replace: true });
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setAttachOpen(false);
    setPhotoError(null);
    if (!file.type.startsWith("image/")) {
      setPhotoError(t("assistant.photoNotImage"));
      return;
    }
    setPreparingPhoto(true);
    try {
      const prepared = await prepareImage(file);
      if (prepared.file.size > MAX_ASSISTANT_PHOTO_BYTES) {
        setPhotoError(t("assistant.photoTooLarge"));
        return;
      }
      const data = await readAsDataUrl(prepared.file);
      setPhoto({
        data,
        mimeType: prepared.file.type || "image/jpeg",
        name: prepared.file.name,
      });
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch {
      setPhotoError(t("assistant.photoFailed"));
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function sendQuestion(text: string) {
    const question = text.trim();
    if (sendingRef.current || preparingPhoto) return;
    if (!question && !photo) return;

    sendingRef.current = true;
    stopMic();
    stopVoice();
    setMicError("");
    setSpeechError("");

    const attached = photo;
    const finance = canRecordMoney && !attached ? financeDraftFromText(question) : null;

    setEntries((prev) => [
      ...prev,
      { kind: "user", text: question, photo: attached ?? undefined },
    ]);
    setDraft("");
    setPhoto(null);
    setPhotoError(null);
    setAttachOpen(false);

    if (finance) {
      // The sentence has already been understood. Do not spend a model call to understand it a
      // second time, and do not let the model become a money-writing surface. The existing form
      // owns the confirmation and the database rule.
      setEntries((prev) => [...prev, { kind: "finance", draft: finance }]);
      sendingRef.current = false;
      return;
    }

    setBusy(true);
    try {
      const reply = await askAssistant({
        text: question,
        photo: attached ? { data: attached.data, mimeType: attached.mimeType } : null,
        history,
      });
      setEntries((prev) => [...prev, { kind: "reply", reply }]);
      const turns: AssistantTurn[] = [
        { role: "user", text: question },
        { role: "assistant", text: reply.answer },
      ];
      setHistory((prev) => [...prev, ...turns].slice(-8));
    } catch (error) {
      setEntries((prev) => [...prev, { kind: "error", text: errorText(error) }]);
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendQuestion(draft);
  }

  const suggestions = [
    { text: t("assistant.ask.sales"), Icon: ArrowUpRight },
    { text: t("assistant.ask.reorder"), Icon: Sparkles },
    ...(canRecordMoney
      ? [
          { text: t("assistant.ask.expense"), Icon: ArrowDownLeft },
          { text: t("assistant.ask.income"), Icon: ArrowUpRight },
        ]
      : []),
    { text: t("assistant.ask.help"), Icon: Sparkles },
  ];

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: "var(--tone-page)" }}
      data-testid="assistant-page"
    >
      <StatusBar />

      <header className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-1">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("common.back")}
          className="ds-pressable flex size-9 items-center justify-center rounded-full"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
          >
            <Sparkles size={14} strokeWidth={1.6} />
          </span>
          <p className="truncate text-15 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("assistant.title")}
          </p>
        </div>

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => setShowAbilities(true)}
            aria-label={t("assistant.abilities")}
            className="ds-pressable flex size-9 items-center justify-center rounded-full"
            style={{ color: "var(--text-secondary)" }}
          >
            <ShieldCheck size={18} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={newChat}
            aria-label={t("assistant.newChat")}
            className="ds-pressable flex size-9 items-center justify-center rounded-full"
            style={{ color: "var(--text-secondary)" }}
          >
            <Plus size={19} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="assistant-transcript"
        aria-live="polite"
      >
        {entries.length === 0 ? (
          <div className="flex min-h-full flex-col px-5 pb-3 pt-1">
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
              <AssistantOrb />
              <h1
                className="mt-4 text-22 font-bold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {user?.name
                  ? t("assistant.hiName", { name: String(user.name) })
                  : t("assistant.title")}
              </h1>
              <p
                className="mt-2 max-w-[290px] text-13 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("assistant.tagline")}
              </p>
            </div>

            <div className="mx-auto w-full max-w-[420px]">
              <p
                className="flex items-center gap-2 px-1 pb-2 text-12 font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                <Sparkles size={14} strokeWidth={1.5} />
                {t("assistant.askAnything")}
              </p>
              <div
                className="overflow-hidden rounded-[var(--radius-card)]"
                style={{ background: "var(--tone-card)" }}
              >
                {suggestions.map(({ text, Icon }, index) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => void sendQuestion(text)}
                    className="ds-pressable flex min-h-11 w-full items-center gap-3 px-4 text-start"
                    style={
                      index === 0
                        ? undefined
                        : { borderTop: "1px solid var(--divider)" }
                    }
                  >
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
                    >
                      <Icon size={13} strokeWidth={1.6} />
                    </span>
                    <span className="min-w-0 flex-1 text-12" style={{ color: "var(--text-primary)" }}>
                      {text}
                    </span>
                  </button>
                ))}
              </div>

            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-4 pb-8 pt-3">
            {entries.map((entry, index) => {
              if (entry.kind === "user") {
                return (
                  <div key={index} className="flex flex-col items-end gap-2">
                    {entry.photo && (
                      <img
                        src={entry.photo.data}
                        alt={t("assistant.photoAttached")}
                        className="max-h-56 max-w-[82%] rounded-[18px] object-cover"
                      />
                    )}
                    {entry.text && (
                      <p
                        className="max-w-[85%] whitespace-pre-wrap rounded-[20px] px-4 py-2.5 text-14 leading-relaxed"
                        style={{ background: "var(--ink)", color: "var(--ink-fg)" }}
                      >
                        {entry.text}
                      </p>
                    )}
                  </div>
                );
              }

              if (entry.kind === "finance") {
                return (
                  <div key={index} className="max-w-[92%]">
                    <AssistantFinanceCard draft={entry.draft} />
                  </div>
                );
              }

              if (entry.kind === "error") {
                return (
                  <div
                    key={index}
                    className="flex items-start gap-3 rounded-[var(--radius-card)] p-3 text-12"
                    style={{
                      background: "var(--error-bg)",
                      border: "1px solid var(--error-border)",
                      color: "var(--error)",
                    }}
                  >
                    <X size={16} className="mt-0.5 shrink-0" />
                    <span>{entry.text}</span>
                  </div>
                );
              }

              const { reply } = entry;
              const shownInWidgets = new Set(
                reply.widgets.flatMap((widget) => widget.notes ?? []),
              );
              const answerNotes = reply.notes.filter((note) => !shownInWidgets.has(note));
              const isSpeaking = speaking?.index === index;
              return (
                <div key={index} className="flex flex-col gap-2">
                  <div className="flex items-start gap-3">
                    <AssistantOrb compact />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p
                        className="whitespace-pre-wrap text-14 leading-relaxed"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {reply.answer}
                      </p>
                      <div className="mt-1.5 flex items-center">
                        <button
                          type="button"
                          onClick={() =>
                            isSpeaking ? stopVoice() : readAloud(reply.answer, index)
                          }
                          aria-label={
                            isSpeaking ? t("assistant.stopSpeaking") : t("assistant.readAloud")
                          }
                          title={
                            isSpeaking ? t("assistant.stopSpeaking") : t("assistant.readAloud")
                          }
                          aria-pressed={isSpeaking}
                          className="ds-pressable flex size-8 items-center justify-center rounded-full"
                          style={{
                            background: isSpeaking
                              ? "var(--brand-light)"
                              : "var(--surface-2)",
                            color: isSpeaking
                              ? "var(--brand-dark)"
                              : "var(--text-secondary)",
                          }}
                          data-testid={`assistant-speak-${index}`}
                        >
                          {isSpeaking ? (
                            <VolumeX size={15} strokeWidth={1.6} />
                          ) : (
                            <Volume2 size={15} strokeWidth={1.6} />
                          )}
                        </button>
                      </div>
                      {answerNotes.map((text, noteIndex) => (
                        <p
                          key={noteIndex}
                          className="mt-2 text-11 leading-relaxed"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {text}
                        </p>
                      ))}
                    </div>
                  </div>
                  {reply.widgets.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {reply.widgets.map((widget) => (
                        <AssistantWidget
                          key={widget.tool + widget.title}
                          widget={widget}
                          onAsk={(text) => void sendQuestion(text)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {busy && (
              <div
                className="flex items-center gap-2 text-11"
                style={{ color: "var(--text-secondary)" }}
              >
                <span className="ds-assistant-thinking" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                {t("assistant.thinking")}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div
        className="shrink-0 px-4 pt-2"
        style={{
          background: "linear-gradient(to top, var(--tone-page) 70%, transparent)",
          // The safe-area inset still describes the gesture bar underneath the keyboard, which
          // would leave a large dead band above the keyboard. While it is open, the keyboard is
          // the edge the composer must meet.
          paddingBottom: keyboardOpen ? "10px" : "calc(10px + var(--safe-bottom))",
        }}
      >
        {photo && (
          <div
            className="mb-2 flex items-center gap-3 rounded-[var(--radius-card)] p-2"
            style={{ background: "var(--tone-card)" }}
          >
            <img
              src={photo.data}
              alt={t("assistant.photoAttached")}
              className="size-11 shrink-0 rounded-[10px] object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-11" style={{ color: "var(--text-primary)" }}>
                {photo.name}
              </p>
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("assistant.photoAttached")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPhoto(null)}
              aria-label={t("common.remove")}
              className="ds-pressable flex size-8 shrink-0 items-center justify-center rounded-full"
              style={{ color: "var(--text-secondary)" }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {preparingPhoto && (
          <div
            className="mb-2 flex items-center gap-2 text-11"
            style={{ color: "var(--text-secondary)" }}
          >
            <Loader2 size={14} className="animate-spin" />
            {t("assistant.preparingPhoto")}
          </div>
        )}

        {photoError && (
          <p className="mb-2 text-11" style={{ color: "var(--error)" }} role="alert">
            {photoError}
          </p>
        )}

        {listening && (
          <div
            className="mb-2 flex items-center gap-2 text-11"
            role="status"
            style={{ color: "var(--brand-dark)" }}
          >
            <span className="ds-assistant-listening" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>{t("assistant.listening")}</span>
            <span style={{ color: "var(--text-tertiary)" }}>{t("assistant.listeningHint")}</span>
          </div>
        )}

        {micError && (
          <p className="mb-2 text-11" style={{ color: "var(--error)" }} role="alert">
            {micError}
          </p>
        )}
        {speechError && (
          <p className="mb-2 text-11" style={{ color: "var(--error)" }} role="alert">
            {speechError}
          </p>
        )}

        <div className="flex items-end gap-2" dir="ltr">
          <div
            className="flex min-w-0 flex-1 items-end gap-0.5 rounded-[26px] py-1 pe-1 ps-1"
            style={{ background: "var(--surface-2)" }}
            data-testid="assistant-composer"
          >
            <button
              type="button"
              onClick={() => (listening ? stopMic() : startListening())}
              aria-label={listening ? t("assistant.listening") : t("assistant.speak")}
              aria-pressed={listening}
              className="ds-pressable flex size-10 shrink-0 items-center justify-center rounded-full"
              style={{
                background: listening ? "var(--brand-light)" : "transparent",
                color: listening ? "var(--brand-dark)" : "var(--text-secondary)",
              }}
            >
              {listening ? <Square size={16} fill="currentColor" /> : <Mic size={19} strokeWidth={1.5} />}
            </button>

            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={composerPlaceholder}
              aria-label={composerPlaceholder}
              dir="auto"
              rows={1}
              className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-15 leading-relaxed outline-none"
              style={{
                border: 0,
                boxShadow: "none",
                background: "transparent",
                color: "var(--text-primary)",
                maxHeight: 120,
              }}
              data-testid="assistant-input"
            />

            <button
              type="button"
              onClick={() => setAttachOpen(true)}
              disabled={preparingPhoto || busy}
              aria-label={t("assistant.attachPhoto")}
              className="ds-pressable flex size-10 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
              style={{ color: "var(--text-secondary)" }}
              data-testid="assistant-attach"
            >
              <Paperclip size={18} strokeWidth={1.5} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void sendQuestion(draft)}
            disabled={(!draft.trim() && !photo) || preparingPhoto || busy}
            aria-label={t("assistant.send")}
            className="ds-pressable flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-35"
            style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
            data-testid="assistant-send"
          >
            <Send size={18} strokeWidth={1.8} style={{ transform: "none" }} />
          </button>
        </div>

        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          data-testid="assistant-camera-input"
          onChange={(event) => {
            void onPickPhoto(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={galleryInput}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="assistant-gallery-input"
          onChange={(event) => {
            void onPickPhoto(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <Sheet
        open={attachOpen}
        title={t("assistant.attachPhoto")}
        onClose={() => setAttachOpen(false)}
        closeButton={false}
        maxHeight="50vh"
      >
        <div className="flex flex-col gap-2 px-5 pt-1">
          <button
            type="button"
            onClick={() => {
              setAttachOpen(false);
              cameraInput.current?.click();
            }}
            className="ds-pressable flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-card)] px-4 text-start"
            style={{ background: "var(--surface-2)" }}
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
            >
              <Camera size={18} strokeWidth={1.5} />
            </span>
            <span className="text-13 font-medium" style={{ color: "var(--text-primary)" }}>
              {t("assistant.takePhoto")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAttachOpen(false);
              galleryInput.current?.click();
            }}
            className="ds-pressable flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-card)] px-4 text-start"
            style={{ background: "var(--surface-2)" }}
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
            >
              <ImageIcon size={18} strokeWidth={1.5} />
            </span>
            <span className="text-13 font-medium" style={{ color: "var(--text-primary)" }}>
              {t("assistant.choosePhoto")}
            </span>
          </button>
        </div>
      </Sheet>

      <Sheet
        open={showAbilities}
        title={t("assistant.abilities")}
        onClose={() => setShowAbilities(false)}
        maxHeight="80vh"
      >
        <div className="px-5 pb-2">
          <p className="text-12 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {t("assistant.abilitiesIntro")}
          </p>
          {!abilities ? (
            <p className="mt-4 text-12" style={{ color: "var(--text-secondary)" }}>
              {t("assistant.abilitiesLoading")}
            </p>
          ) : (
            <>
              <p className="ds-section-label mt-4">{t("assistant.canUse")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {abilities.tools.map((tool) => (
                  <span key={tool.name} className="ds-chip">
                    {toolName(t, tool)}
                  </span>
                ))}
              </div>
              {abilities.withheld.length > 0 && (
                <>
                  <p className="ds-section-label mt-4">{t("assistant.cannotUse")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {abilities.withheld.map((tool) => (
                      <span key={tool.name} className="ds-chip" style={{ color: "var(--text-tertiary)" }}>
                        {toolName(t, tool)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <p className="mt-4 text-11 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            {t("assistant.onlyYours")}
          </p>
        </div>
      </Sheet>
    </div>
  );
}
