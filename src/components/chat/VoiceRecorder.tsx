import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Pause, Play, Send, Trash2 } from "lucide-react";
import { startVoiceRecording, type Recording } from "@/lib/chatMedia";
import { useT } from "@/lib/i18n";

/**
 * Voice messages, following WhatsApp's gesture rather than an imitation of its colours.
 *
 * ONE BUTTON, NEVER REMOUNTED. The mic is the same element in every state — idle mic, the button
 * under the finger while recording, and the green send when there is something to send. That is
 * not cosmetic: the pointer is captured by it, so if it were swapped for another element when the
 * recording started (as an earlier version did) the moves and the release would go to a button
 * that no longer exists, and the note could neither be dragged, stopped, nor cancelled.
 *
 * THE STATES, AND WHAT EACH ONE LETS YOU PRESS
 *
 *   idle      one big green mic at the end of the composer. Press and hold it.
 *
 *   hold      the composer field gives way to a bar: red dot, clock counting, live waveform, and
 *             "Slide to cancel" inside it. The mic stays under the finger and pulses. Drag left
 *             past 90 px and a red bin grows in where the mic sits — the waveform is what goes
 *             into it; release there and the note is discarded. Drag up past 42 px and a lock
 *             appears; release there and recording continues with no finger down.
 *
 *   locked    hands-free. The bar keeps clock and wave and the row underneath is the whole set of
 *             actions, left to right: bin (throw it away), wide Pause (stop the clock, same
 *             button resumes), green send (finish and send). Nothing is hidden.
 *
 *   preview   releasing the mic after a real hold ends the note and shows it: the same row, now
 *             playing — bin, play/pause with a scrubbable waveform and a sweeping playhead, send.
 *
 * A release that arrives before the microphone has finished opening is remembered and applied the
 * moment recording starts, so a tap always lands somewhere: it opens hands-free recording.
 *
 * Edge cases: a note under 1.5 s is refused instead of sent; a denied microphone reports why; a
 * backgrounded tab pauses the note instead of losing it; every exit path stops the tracks.
 */
const SAMPLE_MS = 70;
const MIN_MS = 1500;
const CANCEL_PX = 90;
const LOCK_PX = 42;
const BARS = 32;

type Phase = "idle" | "hold" | "locked" | "preview";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function resample(src: number[], n: number) {
  if (!src.length) return Array(n).fill(0.06);
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * src.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / n));
    let m = 0;
    for (let k = a; k < b && k < src.length; k += 1) m = Math.max(m, src[k]);
    return m;
  });
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function haptic(kind: "tap" | "lock" | "delete" = "tap") {
  try {
    navigator.vibrate?.(kind === "delete" ? [18, 40, 18] : kind === "lock" ? 14 : 8);
  } catch {
    /* no haptics on this device */
  }
}

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export function VoiceRecorder({
  busy,
  onSend,
  onError,
  onRecordingChange,
}: {
  busy: boolean;
  /** true when the clip is on the server, so the recorder knows it may clear itself */
  onSend: (clip: RecordedClip) => Promise<boolean | void>;
  onError: (message: string) => void;
  onRecordingChange?: (active: boolean) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [levels, setLevels] = useState<number[]>([]);
  const [ms, setMs] = useState(0);
  const [pull, setPull] = useState(0);
  const [lift, setLift] = useState(0);
  const [paused, setPaused] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const recording = useRef<Recording | null>(null);
  const raw = useRef<number[]>([]);
  const tick = useRef(0);
  const origin = useRef(0);
  const pausedMs = useRef(0);
  const pauseStartedAt = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  // A ref, not the state above: a second tap in the same task still sees the old render.
  const discardingRef = useRef(false);
  const downX = useRef(0);
  const downY = useRef(0);
  const pullRef = useRef(0);
  const liftRef = useRef(0);
  const held = useRef(false);
  const releasedEarly = useRef(false);
  const startedAt = useRef(0);
  const wave = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const progress = useRef(0);
  const scrub = useRef(false);
  const clipRef = useRef<RecordedClip | null>(null);
  clipRef.current = clip;

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    onRecordingChange?.(phase !== "idle");
  }, [phase, onRecordingChange]);

  const elapsed = () => performance.now() - origin.current - pausedMs.current;

  useEffect(() => () => { recording.current?.cancel(); recording.current = null; }, []);
  useEffect(() => {
    const url = clipUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [clipUrl]);

  const runClock = (rec: Recording) => {
    window.clearInterval(tick.current);
    tick.current = window.setInterval(() => {
      if (!rec.paused()) setMs(elapsed());
      raw.current.push(rec.level());
      setLevels(raw.current.slice(-96));
    }, SAMPLE_MS);
  };

  /* ── finishing, discarding, pausing ───────────────────── */
  const finish = async (): Promise<RecordedClip | null> => {
    const rec = recording.current;
    if (!rec) return null;
    window.clearInterval(tick.current);
    if (rec.paused()) {
      pausedMs.current += performance.now() - pauseStartedAt.current;
      rec.resume();
      setPaused(false);
    }
    if (elapsed() < MIN_MS) {
      rec.cancel();
      recording.current = null;
      onError(t("messages.voiceTooShort"));
      go("idle");
      return null;
    }
    try {
      const result = await rec.stop();
      recording.current = null;
      const next = { blob: result.blob, mimeType: result.mimeType, durationMs: result.durationMs };
      progress.current = 0;
      setMs(result.durationMs);
      setClip(next);
      setClipUrl(URL.createObjectURL(result.blob));
      return next;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t("messages.actionFailed"));
      go("idle");
      return null;
    }
  };

  const toPreview = async () => {
    const next = await finish();
    if (next) go("preview");
  };

  const discard = () => {
    if (discardingRef.current) return;
    discardingRef.current = true;
    setPhase("idle");
    haptic("delete");
    setDiscarding(true);
    window.clearInterval(tick.current);
    recording.current?.cancel();
    recording.current = null;
    window.setTimeout(() => {
      discardingRef.current = false;
      setDiscarding(false);
      setClip(null);
      setClipUrl(null);
      setPull(0);
      setLift(0);
      setMs(0);
      raw.current = [];
      setLevels([]);
      pullRef.current = 0;
      liftRef.current = 0;
      go("idle");
    }, 320);
  };

  const toggleRecordingPause = () => {
    const rec = recording.current;
    if (!rec) return;
    haptic("tap");
    if (rec.paused()) {
      pausedMs.current += performance.now() - pauseStartedAt.current;
      rec.resume();
      setPaused(false);
      runClock(rec);
      return;
    }
    pauseStartedAt.current = performance.now();
    rec.pause();
    setPaused(true);
    window.clearInterval(tick.current);
  };

  const togglePlayback = () => {
    const element = audio.current;
    if (!element) return;
    haptic("tap");
    if (!element.paused) {
      element.pause();
      return;
    }
    void element.play().catch(() => setPlaying(false));
  };

  const paint = () => {
    wave.current?.style.setProperty("--prog", progress.current.toFixed(4));
  };

  const seek = (clientX: number) => {
    const el = wave.current;
    const element = audio.current;
    const current = clipRef.current;
    if (!el || !element || !current) return;
    const box = el.getBoundingClientRect();
    progress.current = clamp((clientX - box.left) / box.width, 0, 1);
    element.currentTime = (progress.current * current.durationMs) / 1000;
    paint();
  };

  /* ── opening the microphone ───────────────────────────── */
  const begin = async () => {
    if (phaseRef.current !== "idle") return;
    raw.current = [];
    setLevels([]);
    setMs(0);
    setPull(0);
    setLift(0);
    pullRef.current = 0;
    liftRef.current = 0;
    startedAt.current = performance.now();
    try {
      const rec = await startVoiceRecording();
      recording.current = rec;
      origin.current = performance.now();
      pausedMs.current = 0;
      go("hold");
      runClock(rec);
      haptic("tap");
      // The finger may already be up: a tap waited only for the microphone to open, so it keeps
      // recording hands-free rather than landing on a screen with nothing to press.
      if (releasedEarly.current) {
        releasedEarly.current = false;
        haptic("lock");
        go("locked");
      }
    } catch {
      releasedEarly.current = false;
      held.current = false;
      onError(t("messages.voiceDenied"));
      go("idle");
    }
  };

  /** What the release means, given where the finger had travelled. */
  const resolveRelease = () => {
    if (phaseRef.current !== "hold") return;
    if (pullRef.current >= 1) {
      discard();
      return;
    }
    if (liftRef.current >= 1) {
      haptic("lock");
      setPull(0);
      setLift(0);
      pullRef.current = 0;
      liftRef.current = 0;
      go("locked");
      return;
    }
    void toPreview();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phaseRef.current === "preview") {
      sendClipNow();
      return;
    }
    if (phaseRef.current === "locked") {
      sendNow();
      return;
    }
    if (phaseRef.current !== "idle") return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointer */
    }
    downX.current = event.clientX;
    downY.current = event.clientY;
    held.current = true;
    releasedEarly.current = false;
    void begin();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!held.current) return;
    const nextPull = clamp((downX.current - event.clientX) / CANCEL_PX, 0, 1);
    const nextLift = clamp((downY.current - event.clientY) / LOCK_PX, 0, 1);
    pullRef.current = nextPull;
    liftRef.current = nextLift;
    setPull(nextPull);
    setLift(nextLift);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!held.current) return;
    held.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    if (phaseRef.current === "idle") {
      // Not recording yet (still waiting for the microphone): remember the release.
      releasedEarly.current = true;
      return;
    }
    if (performance.now() - startedAt.current < 300 && pullRef.current < 1) {
      // A quick tap opens hands-free recording, the way a locked note stays open.
      haptic("lock");
      go("locked");
      return;
    }
    resolveRelease();
  };

  // Interruptions pause the note instead of ending it behind the user's back.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      const rec = recording.current;
      if (!rec || rec.paused() || phaseRef.current === "preview" || phaseRef.current === "idle") return;
      pauseStartedAt.current = performance.now();
      rec.pause();
      setPaused(true);
      window.clearInterval(tick.current);
      if (phaseRef.current === "hold") go("locked");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [go]);

  /** Back to the composer once the note is sent. It stays put on a failure, clip and all. */
  const resetToIdle = () => {
    window.clearInterval(tick.current);
    recording.current?.cancel();
    recording.current = null;
    progress.current = 0;
    raw.current = [];
    discardingRef.current = false;
    setPlaying(false);
    setDiscarding(false);
    setPaused(false);
    setClip(null);
    setClipUrl(null);
    setLevels([]);
    setMs(0);
    setPull(0);
    setLift(0);
    pullRef.current = 0;
    liftRef.current = 0;
    go("idle");
  };

  const ship = async (next: RecordedClip) => {
    const ok = await onSend(next);
    if (ok !== false) resetToIdle();
  };

  const sendClipNow = () => {
    if (!clip || busy) return;
    const current = clip;
    void ship(current);
  };

  const sendNow = () => {
    if (busy) return;
    void finish().then((next) => {
      if (next) void ship(next);
    });
  };

  const liveBars = resample(levels.length ? levels : raw.current, BARS);
  const clipBars = resample(raw.current, BARS);
  const recordingLike = phase === "hold" || phase === "locked";

  const bars = (values: number[], live: boolean) => (
    <span className="vr-wave" ref={live ? undefined : wave} style={{ "--n": BARS } as CSSProperties} aria-hidden="true">
      {values.map((v, i) => (
        <i key={i} className="vr-bar" style={{ "--l": Math.max(0.05, v).toFixed(3), "--i": i } as CSSProperties} data-live={live || undefined} />
      ))}
    </span>
  );

  return (
    <div
      className="vr"
      data-phase={phase}
      data-discarding={discarding || undefined}
      style={{ "--pull": pull.toFixed(3), "--lift": lift.toFixed(3) } as CSSProperties}
    >
      <div className="vr-line">
        {phase !== "idle" && (
          <div className="vr-pill" style={{ translate: `${-pull * CANCEL_PX * 0.45}px 0` }}>
            <span className="vr-dot" data-paused={paused || undefined} aria-hidden="true" />
            <span className="vr-time">{fmt(ms)}</span>
            {recordingLike ? bars(liveBars, true) : bars(clipBars, false)}
            {phase === "hold" && (
              <span className="vr-slide">
                {pull > 0.05 ? t("messages.voiceReleaseCancel") : `‹ ${t("messages.voiceSlideCancelShort")}`}
              </span>
            )}
          </div>
        )}

        {/* One button for the whole gesture: press it, hold it, drag it, and later press it to
            send. It is the same element in every state so the pointer never loses it. */}
        <button
          type="button"
          className="vr-mic"
          data-act={phase === "idle" ? "record" : phase === "hold" ? "release" : "send"}
          aria-label={
            phase === "idle"
              ? t("messages.voiceRecord")
              : phase === "hold"
                ? t("messages.voiceSend")
                : t("messages.voiceSend")
          }
          disabled={busy && phase !== "hold"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            held.current = false;
            if (phaseRef.current === "hold") discard();
          }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (phase === "preview") sendClipNow();
          }}
          data-testid="voice-mic"
        >
          {phase === "preview" || phase === "locked" ? (
            <Send size={22} strokeWidth={2} />
          ) : (
            <MicGlyph size={26} />
          )}
          {phase === "hold" && <span className="vr-lock-hint" data-on={lift > 0.4 || undefined} aria-hidden="true">↑</span>}
        </button>

        {/* sliding left puts the bin where the mic was; the wave is what goes into it */}
        <span className="vr-bin" data-open={pull > 0.02 || discarding || undefined} aria-hidden="true">
          <Trash2 size={24} strokeWidth={2} />
        </span>
      </div>

      {(phase === "locked" || phase === "preview") && (
        <div className="vr-controls">
          <button
            type="button"
            className="vr-delete"
            aria-label={t("messages.voiceDiscard")}
            onClick={() => {
              audio.current?.pause();
              discard();
            }}
            data-testid={phase === "preview" ? "voice-preview-discard" : "voice-cancel"}
          >
            <Trash2 size={21} strokeWidth={1.9} />
          </button>

          <button
            type="button"
            className="vr-mid"
            onClick={phase === "preview" ? togglePlayback : toggleRecordingPause}
            aria-label={phase === "preview" ? (playing ? t("messages.voicePause") : t("messages.voicePlay")) : paused ? t("messages.voiceResume") : t("messages.voicePause")}
            data-testid={phase === "preview" ? "voice-preview-play" : "voice-pause"}
          >
            {(phase === "preview" ? playing : !paused) ? <Pause size={20} strokeWidth={2.4} /> : <Play size={20} strokeWidth={2.4} />}
            <span>
              {phase === "preview" ? (playing ? t("messages.voicePause") : t("messages.voicePlay")) : paused ? t("messages.voiceResume") : t("messages.voicePause")}
            </span>
          </button>

          <span className="vr-send-gap" aria-hidden="true" />
        </div>
      )}

      {phase === "hold" && !discarding && (
        <span className="vr-hint">{lift > 0.4 ? t("messages.voiceReleaseLock") : t("messages.voiceSlideUpLock")}</span>
      )}

      {phase === "preview" && clipUrl && (
        <audio
          ref={audio}
          src={clipUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            progress.current = 0;
            paint();
          }}
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            if (element.duration && Number.isFinite(element.duration)) {
              progress.current = element.currentTime / element.duration;
            } else if (clipRef.current) {
              progress.current = Math.min(1, (element.currentTime * 1000) / clipRef.current.durationMs);
            }
            paint();
          }}
        />
      )}

      {phase === "preview" && (
        <span
          className="vr-scrub"
          aria-hidden="true"
          onPointerDown={(e) => { scrub.current = true; seek(e.clientX); }}
          onPointerMove={(e) => { if (scrub.current) seek(e.clientX); }}
          onPointerUp={() => { scrub.current = false; }}
        />
      )}
    </div>
  );
}

/** The capsule filled, the stand drawn — solid, like the button it sits in. */
function MicGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="8.5" y="2" width="7" height="12.5" rx="3.5" fill="currentColor" stroke="none" />
      <path d="M5 11.5a7 7 0 0 0 14 0" />
      <path d="M12 18.5V22" />
    </svg>
  );
}
