import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Send, ShieldCheck, Sparkles, Volume2, X } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import AssistantWidget from "@/components/assistant/AssistantWidget";
import {
  askAssistant, assistantAbilities, listen, speak, toolTitleKey,
  AssistantError, type AssistantAbilities, type AssistantReply, type AssistantTurn,
} from "@/lib/assistant";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";

/**
 * The assistant, inside the app.
 *
 * It opens on the session that is already signed in — there is no second sign-in, and no
 * assistant-only account with its own reach. Whatever this person can open in the app is what
 * they can ask about; everything else is refused by the server, which is the same boundary the
 * app's own screens run inside.
 *
 * Nothing is kept. The transcript lives in this component's own state and nowhere else, so
 * walking away from the screen ends the conversation — a stricter promise than deleting it
 * after a day, and it needs no job to keep it true. Only the last few turns travel with the next
 * question, as context for the answer.
 */

type Entry =
  | { kind: "user"; text: string }
  | { kind: "reply"; reply: AssistantReply }
  | { kind: "error"; text: string };

/** A tool's name, read in the language this screen is in — never the server's English one. */
function toolName(t: (key: string) => string, tool: { name: string; title: string }): string {
  const key = toolTitleKey(tool.name);
  return key ? t(key) : tool.title;
}

export default function AssistantPage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<AssistantTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<{ data: string; mimeType: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [abilities, setAbilities] = useState<AssistantAbilities | null>(null);
  const [showAbilities, setShowAbilities] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  // Refs, not state, guard the two things a double tap can start twice. A state variable is still
  // false for the second click in the same task, so `busy` alone would send the question twice —
  // and a question costs money and a model call, so it is the same class of mistake as a double
  // sale. `busy` still drives the screen; the refs do the refusing.
  const sendingRef = useRef(false);
  const listeningRef = useRef(false);

  useEffect(() => {
    // What this account may ask about — fetched once, so the boundary is something the person can
    // look at rather than something they discover by being told no.
    void assistantAbilities().then(setAbilities).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries, busy]);

  useEffect(() => () => {
    stopListening.current?.();
    window.speechSynthesis?.cancel();
  }, []);

  function startListening() {
    if (listeningRef.current) return;
    const stop = listen(
      (heard) => setDraft(heard),
      () => {
        listeningRef.current = false;
        setListening(false);
      },
    );
    if (!stop) return;
    stopListening.current = stop;
    listeningRef.current = true;
    setListening(true);
  }

  function stopMic() {
    stopListening.current?.();
    listeningRef.current = false;
    setListening(false);
  }

  /**
   * The failure, in the language being read.
   *
   * Nothing from the wire is shown: the code the client attaches is what gets translated, exactly
   * as the rest of the app does it, so a reader is never handed a raw English sentence or a
   * library's own words about a request.
   */
  function errorText(error: unknown): string {
    if (error instanceof AssistantError) {
      if (error.code === "not_switched_on") return t("assistant.off");
      if (error.code === "signed_out") return t("assistant.signedOut");
      if (error.code === "unreachable") return t("assistant.unreachable");
    }
    return t("assistant.failed");
  }

  async function send(text: string) {
    const question = text.trim();
    if (sendingRef.current) return;
    if (!question && !photo) return;
    sendingRef.current = true;
    setEntries((prev) => [...prev, { kind: "user", text: question || t("assistant.photoOnly") }]);
    setDraft("");
    const attached = photo;
    setPhoto(null);
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
      if (voiceMode) speak(reply.speak || reply.answer);
    } catch (error) {
      setEntries((prev) => [...prev, { kind: "error", text: errorText(error) }]);
    } finally {
      sendingRef.current = false;
      setBusy(false);
      if (voiceMode) startListening();
    }
  }

  function onPickPhoto(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      setPhoto({ data: String(reader.result), mimeType: file.type || "image/jpeg", name: file.name });
    reader.readAsDataURL(file);
  }

  const suggestions = [t("assistant.ask.sales"), t("assistant.ask.reorder"), t("assistant.ask.help")];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StatusBar />
      <NavHeader
        title={t("assistant.title")}
        right={
          <button
            type="button"
            onClick={() => setShowAbilities(true)}
            aria-label={t("assistant.abilities")}
            style={{ color: "var(--text-secondary)" }}
          >
            <ShieldCheck size={18} strokeWidth={1.5} />
          </button>
        }
      />

      {/* The transcript. It scrolls; the composer below never does. */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ background: "var(--tone-page)" }}>
        <div className="flex items-start gap-3 pt-2 pb-4">
          <span
            className="flex items-center justify-center rounded-[var(--radius-tile)] shrink-0"
            style={{ width: 36, height: 36, background: "var(--brand-light)", color: "var(--brand-dark)" }}
          >
            <Sparkles size={18} strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <p className="ds-body" style={{ fontWeight: "var(--weight-strong)" }}>
              {user?.name ? t("assistant.hiName", { name: String(user.name) }) : t("assistant.title")}
            </p>
            <p className="ds-meta mt-1">{t("assistant.onlyYours")}</p>
            <p className="ds-meta mt-1">{t("assistant.nothingKept")}</p>
          </div>
        </div>

        {entries.length === 0 && (
          <div className="flex flex-col gap-2 pb-2">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => void send(text)}
                className="ds-chip text-start"
                style={{ justifyContent: "flex-start" }}
              >
                {text}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {entries.map((entry, index) => {
            if (entry.kind === "user") {
              return (
                <div key={index} className="flex justify-end">
                  <p
                    className="max-w-[84%] px-4 py-3 text-15 whitespace-pre-wrap"
                    style={{ background: "var(--ink)", color: "var(--ink-fg)", borderRadius: "var(--radius-card)" }}
                  >
                    {entry.text}
                  </p>
                </div>
              );
            }
            if (entry.kind === "error") {
              return (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 ds-meta"
                  style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)", borderRadius: "var(--radius-card)", color: "var(--error)" }}
                >
                  <X size={16} className="shrink-0 mt-0.5" />
                  <span>{entry.text}</span>
                </div>
              );
            }
            const { reply } = entry;
            // A note belongs to the thing it is about: the one that explains a card is drawn
            // inside that card, so only the notes about the answer as a whole are drawn here.
            const shownInWidgets = new Set(reply.widgets.flatMap((widget) => widget.notes ?? []));
            const answerNotes = reply.notes.filter((note) => !shownInWidgets.has(note));
            return (
              <div key={index}>
                <p className="ds-body whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                  {reply.answer}
                </p>
                {reply.widgets.map((widget) => (
                  <AssistantWidget key={widget.tool + widget.title} widget={widget} onAsk={(text) => void send(text)} />
                ))}
                {answerNotes.map((text, noteIndex) => (
                  <p key={noteIndex} className="ds-meta mt-2">
                    {text}
                  </p>
                ))}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button
                    type="button"
                    className="ds-chip"
                    onClick={() => speak(reply.speak || reply.answer)}
                  >
                    <Volume2 size={14} strokeWidth={1.5} />
                    {t("assistant.readAloud")}
                  </button>
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="flex flex-col gap-2">
              <div className="ds-skeleton" style={{ height: 12, width: "38%", borderRadius: 6 }} />
              <div className="ds-skeleton" style={{ height: 12, width: "82%", borderRadius: 6 }} />
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Composer: a question, a photo of a bill, or a spoken question. One field, in the app's own
          field primitive, so the voice and photo buttons sit inside it instead of squeezing the
          room a question is written in. */}
      <div className="shrink-0 px-4 pt-3" style={{ background: "var(--tone-page)", borderTop: "1px solid var(--divider)" }}>
        {photo && (
          <div className="flex items-center gap-2 pb-2">
            <span
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full ds-meta"
              style={{ background: "var(--surface-2)" }}
            >
              {t("assistant.photoAttached")}
              <button type="button" onClick={() => setPhoto(null)} aria-label={t("common.remove")}>
                <X size={12} />
              </button>
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="ds-field flex-1 min-w-0 gap-1 py-1.5">
            <button
              type="button"
              onClick={() => (listening ? stopMic() : startListening())}
              aria-label={t("assistant.speak")}
              aria-pressed={listening}
              className="ds-pressable flex items-center justify-center shrink-0"
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-field)",
                background: listening ? "var(--brand-light)" : "transparent",
                color: listening ? "var(--brand-dark)" : "var(--text-secondary)",
              }}
            >
              <Mic size={18} strokeWidth={1.5} />
            </button>

            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              placeholder={t("assistant.placeholder")}
              className="flex-1 min-w-0 resize-none bg-transparent outline-none ds-body py-2"
              style={{ minHeight: 36, maxHeight: 120, color: "var(--text-primary)" }}
            />

            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              aria-label={t("assistant.attachPhoto")}
              className="ds-pressable flex items-center justify-center shrink-0"
              style={{ width: 36, height: 36, borderRadius: "var(--radius-field)", color: "var(--text-secondary)" }}
            >
              <Camera size={18} strokeWidth={1.5} />
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => onPickPhoto(event.target.files?.[0])}
            />
          </div>

          <button
            type="button"
            onClick={() => void send(draft)}
            disabled={busy || (!draft.trim() && !photo)}
            aria-label={t("assistant.send")}
            className="ds-pressable flex items-center justify-center shrink-0 disabled:opacity-45"
            style={{
              width: 48,
              height: 48,
              borderRadius: "var(--radius-field)",
              background: "var(--ink)",
              color: "var(--ink-fg)",
            }}
          >
            <Send size={20} strokeWidth={1.5} />
          </button>
        </div>

        {/* Wraps, because Urdu needs more room than English for the same two controls and a
            squeezed two-line label next to a chip reads as a mistake. */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <button
            type="button"
            className="ds-chip whitespace-nowrap"
            onClick={() => {
              const next = !voiceMode;
              setVoiceMode(next);
              if (next) startListening();
              else {
                stopMic();
                window.speechSynthesis?.cancel();
              }
            }}
            aria-pressed={voiceMode}
            style={
              voiceMode
                ? { background: "var(--brand-light)", color: "var(--brand-dark)", borderColor: "transparent" }
                : undefined
            }
          >
            <Volume2 size={14} strokeWidth={1.5} />
            {t("assistant.voiceMode")}
          </button>
          {entries.length > 0 && (
            <button
              type="button"
              className="ds-meta underline whitespace-nowrap"
              onClick={() => {
                setEntries([]);
                setHistory([]);
                window.speechSynthesis?.cancel();
              }}
            >
              {t("assistant.clear")}
            </button>
          )}
        </div>
      </div>

      {showAbilities && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "var(--scrim)" }}
          onClick={() => setShowAbilities(false)}
        >
          <div
            className="w-full max-w-[480px] mx-auto rounded-t-[var(--radius-sheet)] p-5 max-h-[80vh] overflow-y-auto"
            style={{ background: "var(--tone-sheet)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3">
              <p className="text-17" style={{ fontWeight: "var(--weight-strong)" }}>
                {t("assistant.abilities")}
              </p>
              <button type="button" onClick={() => setShowAbilities(false)} aria-label={t("common.close")} style={{ color: "var(--text-secondary)" }}>
                <X size={16} />
              </button>
            </div>
            {abilities ? (
              <>
                <p className="ds-meta pb-3">{t("assistant.abilitiesIntro")}</p>
                <p className="ds-section pb-1">{t("assistant.canUse")}</p>
                {abilities.tools.map((tool) => (
                  <div key={tool.name} className="ds-row">
                    <ShieldCheck size={18} strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
                    <span className="ds-row-label flex-1">{toolName(t, tool)}</span>
                  </div>
                ))}
                {/* Only when there is something to list: an owner holds every tool, and a
                    heading over an empty column reads as a list that failed to load. */}
                {abilities.withheld.length > 0 && (
                  <>
                    <p className="ds-section pt-4 pb-1">{t("assistant.cannotUse")}</p>
                    {abilities.withheld.map((tool) => (
                      <div key={tool.name} className="ds-row">
                        <X size={18} strokeWidth={1.5} style={{ color: "var(--text-tertiary)" }} />
                        <span className="ds-row-label flex-1" style={{ color: "var(--text-tertiary)" }}>
                          {toolName(t, tool)}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : (
              <p className="ds-meta">{t("assistant.abilitiesLoading")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
