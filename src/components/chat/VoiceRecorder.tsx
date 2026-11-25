import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, Send, Trash2 } from "lucide-react";
import { startVoiceRecording, type Recording } from "@/lib/chatMedia";
import { useT } from "@/lib/i18n";

/**
 * The voice-note gesture, in this app's own design system.
 *
 * FOUR STATES, ONE PILL (the shapes are the good part of Bencho's `ui/VoiceNote`):
 *
 *   hold    press the mic and keep holding. A pill opens: a dot, the running clock, one bar per
 *           real microphone sample, a bin at the end. Under the pill: "Slide left to cancel".
 *   lock    a tap, or a slide up, keeps the microphone open without a finger on it — the pill
 *           stays and gains pause and send, because a note longer than a sentence needs a breath.
 *   clip    released. The recording becomes a paused clip: bin on the left, a wide Pause/Play
 *           button in the middle, send on the right. Nothing is uploaded yet.
 *   cancel  slid far enough left: the bars fall into the bin, the pill closes, nothing is sent.
 *
 * WHY THE BARS ARE REAL. `startVoiceRecording` hands back an AnalyserNode reading of the same
 * stream that is being encoded, so the wave rises with the voice and sits flat in a quiet room.
 * It is 70 ms of an interval, and it is the only thing running while recording.
 *
 * THE PLAYHEAD IS A CSS VARIABLE, NOT A RENDER. Playing a clip paints `--prog` on the wave; each
 * bar lights itself in calc(). No React renders during playback.
 */

const SAMPLE_MS = 70;
/** shorter than this is a tap, not a hold */
const HOLD_MS = 450;
/** pointer travel left, in px, that throws the recording away */
const CANCEL_PX = 80;
/** pointer travel up, in px, that keeps the microphone open without the finger */
const LOCK_PX = 40;
const BARS = 30;

type Phase = "rec" | "locked" | "clip";

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

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export function VoiceRecorder({
  busy,
  onSend,
  onClose,
  onError,
}: {
  busy: boolean;
  onSend: (clip: RecordedClip) => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("rec");
  const [levels, setLevels] = useState<number[]>([]);
  const [ms, setMs] = useState(0);
  const [pull, setPull] = useState(0);
  const [lifted, setLifted] = useState(false);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPausedState] = useState(false);

  const recording = useRef<Recording | null>(null);
  const raw = useRef<number[]>([]);
  const tick = useRef(0);
  const origin = useRef(0);
  const pausedMs = useRef(0);
  const pullRef = useRef(0);
  const liftedRef = useRef(false);
  const phaseRef = useRef<Phase>("rec");
  const downX = useRef(0);
  const downY = useRef(0);
  const holding = useRef(false);
  const wave = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const progress = useRef(0);
  const scrub = useRef(false);
  const clipRef = useRef<RecordedClip | null>(null);
  clipRef.current = clip;

  const setPhaseBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const elapsed = () => performance.now() - origin.current - pausedMs.current;

  const runClock = (rec: Recording) => {
    window.clearInterval(tick.current);
    tick.current = window.setInterval(() => {
      if (!rec.paused()) setMs(elapsed());
      raw.current.push(rec.level());
      setLevels(raw.current.slice(-64));
    }, SAMPLE_MS);
  };

  // Mounting is the gesture: the finger went down on the mic.
  useEffect(() => {
    let cancelled = false;
    startVoiceRecording()
      .then((rec) => {
        if (cancelled) {
          rec.cancel();
          return;
        }
        recording.current = rec;
        origin.current = performance.now();
        holding.current = true;
        runClock(rec);
      })
      .catch(() => onError(t("messages.voiceDenied")));
    return () => {
      cancelled = true;
      window.clearInterval(tick.current);
      recording.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
  }, [clipUrl]);

  /* ── recording → clip ─────────────────────────────────── */
  const toClip = async () => {
    if (phaseRef.current === "clip") return;
    const rec = recording.current;
    if (!rec) {
      onClose();
      return;
    }
    window.clearInterval(tick.current);
    if (rec.paused()) rec.resume();
    if (elapsed() < 250) {
      rec.cancel();
      onClose();
      return;
    }
    try {
      setPhaseBoth("clip");
      const result = await rec.stop();
      const next = { blob: result.blob, mimeType: result.mimeType, durationMs: result.durationMs };
      progress.current = 0;
      setMs(result.durationMs);
      setClip(next);
      setClipUrl(URL.createObjectURL(result.blob));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t("messages.actionFailed"));
      onClose();
    }
  };

  /* ── cancel: the bars fall into the bin ───────────────── */
  const cancel = () => {
    window.clearInterval(tick.current);
    recording.current?.cancel();
    setPull(1);
    // Let the collapse play before the pill leaves.
    window.setTimeout(onClose, 180);
  };

  const lock = () => {
    setPhaseBoth("locked");
    setLifted(false);
    setPull(0);
    pullRef.current = 0;
  };

  const pauseStartedAt = useRef(0);

  const toggleRecordingPause = () => {
    const rec = recording.current;
    if (!rec) return;
    if (rec.paused()) {
      pausedMs.current += performance.now() - pauseStartedAt.current;
      rec.resume();
      setPausedState(false);
      runClock(rec);
      return;
    }
    pauseStartedAt.current = performance.now();
    rec.pause();
    setPausedState(true);
  };

  const togglePlayback = () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    void element.play().catch(() => setPlaying(false));
  };

  const seek = (clientX: number) => {
    const el = wave.current;
    const element = audio.current;
    const c = clipRef.current;
    if (!el || !element || !c) return;
    const box = el.getBoundingClientRect();
    progress.current = clamp((clientX - box.left) / box.width, 0, 1);
    element.currentTime = (progress.current * c.durationMs) / 1000;
    paint();
  };

  const paint = () => {
    wave.current?.style.setProperty("--prog", progress.current.toFixed(4));
    if (clock.current && clipRef.current) {
      const p = progress.current;
      clock.current.textContent = fmt(p > 0 && p < 1 ? p * clipRef.current.durationMs : clipRef.current.durationMs);
    }
  };

  const recBars = resample(levels.length ? levels : raw.current, BARS);
  const clipBars = resample(raw.current, BARS);
  const armed = pull >= 1;

  /* ── the pill ─────────────────────────────────────────── */
  const pill = (bars: number[], live: boolean) => (
    <span className="vr-wave" ref={live ? undefined : wave} style={{ "--n": BARS } as CSSProperties} aria-hidden="true">
      {bars.map((v, i) => (
        <i
          key={i}
          className="vr-bar"
          style={{ "--l": Math.max(0.05, v).toFixed(3), "--i": i } as CSSProperties}
          data-live={live || undefined}
        />
      ))}
    </span>
  );

  return (
    <div className="vr" data-phase={phase} style={{ "--pull": pull.toFixed(3) } as CSSProperties}>
      {phase === "clip" ? (
        <div className="vr-clip">
          <button
            type="button"
            className="vr-bin-circle"
            aria-label={t("messages.voiceDiscard")}
            onClick={() => {
              audio.current?.pause();
              onClose();
            }}
            data-testid="voice-preview-discard"
          >
            <Trash2 size={19} strokeWidth={1.8} />
          </button>

          <div className="vr-clip-mid">
            <span ref={clock} className="vr-time">{fmt(clip?.durationMs ?? 0)}</span>
            {pill(clipBars, false)}
          </div>

          <button
            type="button"
            className="vr-pause-pill"
            onClick={togglePlayback}
            aria-label={playing ? t("messages.voicePause") : t("messages.voicePlay")}
            data-testid="voice-preview-play"
          >
            {playing ? <Pause size={18} strokeWidth={2.2} /> : <Play size={18} strokeWidth={2.2} />}
            <span>{playing ? t("messages.voicePause") : t("messages.voicePlay")}</span>
          </button>

          <button
            type="button"
            className="vr-send"
            disabled={busy || !clip}
            aria-label={t("messages.voiceSend")}
            onClick={() => {
              if (clip) void onSend(clip);
            }}
            data-testid="voice-preview-send"
          >
            <Send size={19} strokeWidth={2} />
          </button>

          {clipUrl && (
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
        </div>
      ) : (
        <>
          <div
            className="vr-pill"
            style={{ translate: `${-pull * CANCEL_PX * 0.5}px 0` }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* a scripted pointer */
              }
              downX.current = e.clientX;
              downY.current = e.clientY;
              holding.current = true;
            }}
            onPointerMove={(e) => {
              if (!holding.current) return;
              const next = clamp((downX.current - e.clientX) / CANCEL_PX, 0, 1);
              pullRef.current = next;
              setPull(next);
              const up = downY.current - e.clientY >= LOCK_PX;
              if (up !== liftedRef.current) {
                liftedRef.current = up;
                setLifted(up);
              }
            }}
            onPointerUp={(e) => {
              if (!holding.current) return;
              holding.current = false;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* never captured */
              }
              if (pullRef.current >= 1) {
                cancel();
                return;
              }
              // A tap, or a slide up, keeps the microphone open — the same hands-free state.
              if (liftedRef.current || elapsed() < HOLD_MS) {
                lock();
                return;
              }
              void toClip();
            }}
            onPointerCancel={() => {
              holding.current = false;
              void toClip();
            }}
            data-testid="voice-pill"
          >
            <span className="vr-dot" data-paused={paused || undefined} aria-hidden="true" />
            <span className="vr-time" aria-live="off">{fmt(ms)}</span>
            {pill(recBars, true)}
            <button
              type="button"
              className="vr-bin"
              aria-label={t("messages.voiceDiscard")}
              onClick={cancel}
              data-testid="voice-cancel"
            >
              <Trash2 size={17} strokeWidth={1.8} />
            </button>
            {/* The bars fall into the bin as it is thrown away. */}
            <span className="vr-collapse" aria-hidden="true">
              <Trash2 size={16} strokeWidth={2} />
            </span>
          </div>

          {phase === "locked" ? (
            <div className="vr-controls">
              <button
                type="button"
                className="vr-pause-pill"
                onClick={toggleRecordingPause}
                aria-label={paused ? t("messages.voiceResume") : t("messages.voicePause")}
                data-testid="voice-pause"
              >
                {paused ? <Play size={18} strokeWidth={2.2} /> : <Pause size={18} strokeWidth={2.2} />}
                <span>{paused ? t("messages.voiceResume") : t("messages.voicePause")}</span>
              </button>
              <button
                type="button"
                className="vr-send"
                aria-label={t("messages.voiceSend")}
                onClick={() => void toClip()}
                data-testid="voice-send-direct"
              >
                <Send size={19} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <span className="vr-hint" data-armed={armed || undefined} data-lock={lifted || undefined}>
              {armed
                ? t("messages.voiceReleaseCancel")
                : lifted
                  ? t("messages.voiceReleaseLock")
                  : t("messages.voiceSlideCancel")}
            </span>
          )}
        </>
      )}
    </div>
  );
}
