import { Mic, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";

interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClass?: string;
  /** Tapping the clear mark empties the field. Omit it and no mark is shown. */
  onClear?: () => void;
}

/** The slice of the Web Speech API this field uses. Kept local: the DOM lib omits it. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type SpeechConstructor = new () => SpeechRecognitionLike;

function speechConstructor(): SpeechConstructor | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null;
}

/**
 * The one search field in the app.
 *
 * Every list screen used to hand-roll its own pill — which is how a page could end
 * up showing two differently-shaped search boxes at once. This is the single
 * implementation, built from the design language's fully-rounded tone field with a
 * thin-stroke mark, so a search looks and measures the same everywhere by
 * construction rather than by convention.
 *
 * The clear mark was previously a text "×" glyph (and, on one screen, an icon).
 * It is one circular trailing icon here, in the same stroke weight as every other
 * icon, and it only appears when there is something to clear.
 *
 * The microphone is here for the same reason: one field means one voice input, so
 * every search in the app — sales, history, customers, settings — understands a
 * spoken keyword in the language the app is reading in. It carries no background of
 * its own (owner, 2026-11-19): it is a glyph at the end of the field, and it only
 * colours while it is actually listening.
 */
export default function SearchBar({ containerClass = "", onClear, ...props }: SearchBarProps) {
  const t = useT();
  const { language } = useThemeStore();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // A field unmounting mid-sentence must not leave a microphone open.
  useEffect(() => {
    setSupported(speechConstructor() !== null);
    return () => {
      const session = recognition.current;
      recognition.current = null;
      if (session) {
        session.onend = null;
        session.onerror = null;
        session.onresult = null;
        try { session.abort(); } catch { /* already closed */ }
      }
    };
  }, []);

  function stop() {
    const session = recognition.current;
    recognition.current = null;
    setListening(false);
    if (session) {
      session.onend = null;
      try { session.stop(); } catch { /* already closed */ }
    }
  }

  function toggleVoice() {
    if (listening) {
      stop();
      return;
    }
    const Constructor = speechConstructor();
    if (!Constructor) return;

    const session = new Constructor();
    session.lang = language === "ur" ? "ur-PK" : "en-PK";
    // One phrase, not an open dictation: a search box is a keyword, and a session that stays
    // open keeps the phone's microphone indicator lit after the person stopped speaking.
    session.continuous = false;
    session.interimResults = true;
    session.maxAlternatives = 1;

    session.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
      }
      const text = transcript.trim();
      if (!text) return;
      // The field is uncontrolled by this component: hand the transcript to the screen through
      // the same onChange it already handles, so a spoken search behaves exactly like a typed one.
      props.onChange?.({ target: { value: text } } as unknown as ChangeEvent<HTMLInputElement>);
      if (Array.from(event.results).some((result) => result.isFinal)) stop();
    };
    session.onerror = () => stop();
    session.onend = () => {
      recognition.current = null;
      setListening(false);
    };

    recognition.current = session;
    setListening(true);
    try {
      session.start();
    } catch {
      stop();
    }
  }

  return (
    <div className={`ds-field ${containerClass}`}>
      <Search size={18} className="ds-glyph-sm shrink-0" style={{ color: "var(--text-secondary)" }} />
      <input
        type="text"
        {...props}
        className="h-full min-w-0 flex-1 bg-transparent outline-none ds-body"
        style={{ color: "var(--text-primary)" }}
      />
      {supported && (
        <button
          type="button"
          onClick={toggleVoice}
          aria-label={listening ? t("search.listening") : t("search.voiceSearch")}
          aria-pressed={listening}
          title={listening ? t("search.listening") : t("search.voiceSearch")}
          data-testid="search-voice"
          className="flex shrink-0 items-center justify-center p-0 border-0 bg-transparent"
          style={{ color: listening ? "var(--brand-dark)" : "var(--text-secondary)" }}
        >
          <Mic size={17} className={listening ? "ds-glyph-sm animate-pulse" : "ds-glyph-sm"} />
        </button>
      )}
      {onClear && props.value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("common.clear")}
          className="flex shrink-0 items-center"
        >
          <X size={16} className="ds-glyph-sm" style={{ color: "var(--text-secondary)" }} />
        </button>
      ) : null}
    </div>
  );
}
