import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Send, Trash2 } from "lucide-react";
import { startVoiceRecording, type Recording } from "@/lib/chatMedia";
import { useT } from "@/lib/i18n";

/**
 * Recording a voice message, in this app's own design system.
 *
 * WHY THIS EXISTS. The shapes and the gesture are the good part of Bencho's pill (`ui/VoiceNote`):
 * hold to record, one bar per sample, slide left to throw it away, and a clip you can scrub. What
 * the app needs instead of Bencho's stand-in level is the *microphone*: this reads the real
 * AnalyserNode out of `startVoiceRecording`, so the bars move with the voice and stop when the
 * room is quiet, and the clip it hands back is the compressed Opus the server receives.
 *
 * WHAT IT DOES NOT DO. It does not decide anything about delivery: sending is one call the screen
 * owns, and a refusal comes back as an error the screen shows. Nothing is uploaded while the pill
 * is open — the clip only leaves when the person presses send.
 *
 * COST. One interval at 70 ms while recording, and no timer at all afterwards: playback progress is
 * a CSS variable on the wave, painted from a `<audio>` element's own events.
 */

const SAMPLE_MS = 70;
/** shorter than this is a tap, not a recording */
const MIN_MS = 500;
/** pointer travel, in px, that throws the recording away */
const CANCEL_PX = 80;
const BARS = 26;

type Phase = "rec" | "clip";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function resample(src: number[], n: number) {
  if (!src.length) return Array(n).fill(0.04);
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
  const [pull, setPull] = useState<number>(0);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const recording = useRef<Recording | null>(null);
  const raw = useRef<number[]>([]);
  const tick = useRef(0);
  const origin = useRef(0);
  const pullRef = useRef(0);
  const wave = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const progress = useRef(0);
  const scrub = useRef(false);
  const clipRef = useRef<RecordedClip | null>(null);
  clipRef.current = clip;

  const paint = () => {
    wave.current?.style.setProperty("--prog", progress.current.toFixed(4));
    if (clock.current && clipRef.current) {
      const p = progress.current;
      clock.current.textContent = fmt(p > 0 && p < 1 ? p * clipRef.current.durationMs : clipRef.current.durationMs);
    }
  };

  // Mounting is the gesture: the mic was pressed, so the microphone opens now.
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
        tick.current = window.setInterval(() => {
          const took = performance.now() - origin.current;
          raw.current.push(rec.level());
          setLevels(raw.current.slice(-64));
          setMs(took);
        }, SAMPLE_MS);
      })
      .catch(() => onError(t("messages.voiceDenied")));
    return () => {
      cancelled = true;
      clearInterval(tick.current);
      recording.current?.cancel();
    };
    // One recorder per mount; the screen decides when the pill lives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
  }, [clipUrl]);

  const toClip = async (keep: boolean) => {
    if (phaseRef.current !== "rec") return;
    clearInterval(tick.current);
    const rec = recording.current;
    if (!rec) {
      onClose();
      return;
    }
    const took = performance.now() - origin.current;
    if (!keep || took < MIN_MS) {
      rec.cancel();
      onClose();
      return;
    }
    try {
      phaseRef.current = "clip";
      const result = await rec.stop();
      const next = { blob: result.blob, mimeType: result.mimeType, durationMs: result.durationMs };
      progress.current = 0;
      setClip(next);
      setClipUrl(URL.createObjectURL(result.blob));
      setPhase("clip");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t("messages.actionFailed"));
      onClose();
    }
  };

  // A ref copy of the phase, because pointer handlers close over the render that created them.
  const phaseRef = useRef<Phase>("rec");
  // Where the finger went down, and whether it is still down: the gesture is the distance it moved.
  const downX = useRef(0);
  const dragging = useRef(false);

  const toggle = () => {
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
    if (element.duration && Number.isFinite(element.duration)) {
      element.currentTime = progress.current * element.duration;
    } else {
      element.currentTime = (progress.current * c.durationMs) / 1000;
    }
    paint();
  };

  const bars = resample(levels.length ? levels : raw.current, BARS);
  const armed = pull >= 1;
  const shift = -pull * CANCEL_PX * 0.5;

  return (
    <div className="vr" data-phase={phase} style={{ "--pull": pull.toFixed(3) } as CSSProperties}>
      {phase === "rec" ? (
        <div
          className="vr-row"
          style={{ translate: `${shift}px 0` }}
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* a scripted pointer */
            }
            downX.current = e.clientX;
            dragging.current = true;
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            const next = clamp((downX.current - e.clientX) / CANCEL_PX, 0, 1);
            pullRef.current = next;
            setPull(next);
          }}
          onPointerUp={() => {
            dragging.current = false;
            void toClip(pullRef.current < 1);
          }}
          onPointerCancel={() => {
            dragging.current = false;
            void toClip(false);
          }}
        >
          <span className="vr-dot" aria-hidden="true" />
          <span className="vr-time" aria-live="off">{fmt(ms)}</span>
          <span className="vr-wave" aria-hidden="true">
            {bars.map((v, i) => (
              <i key={i} className="vr-bar" style={{ "--l": Math.max(0.05, v).toFixed(3) } as CSSProperties} />
            ))}
          </span>
          {/* While recording, the same bin the clip will offer: one gesture to throw it away
              without having to slide, for anyone who changed their mind immediately. */}
          <button
            type="button"
            className="vr-cancel"
            aria-label={t("messages.voiceDiscard")}
            onClick={() => {
              void toClip(false);
            }}
            data-testid="voice-cancel"
          >
            <Trash2 size={16} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div className="vr-row">
          <button
            type="button"
            className="vr-play"
            aria-label={playing ? t("messages.voicePause") : t("messages.voicePlay")}
            onClick={toggle}
            data-testid="voice-preview-play"
          >
            {playing ? <span className="vr-pause" aria-hidden="true" /> : <span className="vr-tri" aria-hidden="true" />}
          </button>
          <span
            ref={wave}
            className="vr-wave vr-scrub"
            style={{ "--n": BARS, "--prog": 0 } as CSSProperties}
            role="slider"
            tabIndex={0}
            aria-label={t("messages.voicePlay")}
            aria-valuemin={0}
            aria-valuemax={Math.round((clip?.durationMs ?? 0) / 1000)}
            onPointerDown={(e) => {
              scrub.current = true;
              seek(e.clientX);
            }}
            onPointerMove={(e) => {
              if (scrub.current) seek(e.clientX);
            }}
            onPointerUp={() => {
              scrub.current = false;
            }}
            onPointerCancel={() => {
              scrub.current = false;
            }}
            data-testid="voice-preview-wave"
          >
            {resample(clip ? raw.current : [], BARS).map((v, i) => (
              <i
                key={i}
                className="vr-bar"
                style={{ "--l": Math.max(0.05, v).toFixed(3), "--i": i } as CSSProperties}
              />
            ))}
          </span>
          <span ref={clock} className="vr-time">{fmt(clip?.durationMs ?? 0)}</span>
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
                const c = clipRef.current;
                if (element.duration && Number.isFinite(element.duration)) {
                  progress.current = element.currentTime / element.duration;
                } else if (c) {
                  progress.current = Math.min(1, (element.currentTime * 1000) / c.durationMs);
                }
                paint();
              }}
            />
          )}
          {/* After recording, before sending: the clip can be played, scrubbed, sent — or binned.
              A voice note cannot be unsent, so deleting it here is the last honest chance. */}
          <button
            type="button"
            className="vr-cancel"
            aria-label={t("messages.voiceDiscard")}
            onClick={() => {
              audio.current?.pause();
              onClose();
            }}
            data-testid="voice-preview-discard"
          >
            <Trash2 size={16} strokeWidth={1.8} />
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
            <Send size={17} strokeWidth={2} />
          </button>
        </div>
      )}
      <span className="vr-hint" data-armed={armed || undefined}>
        {phase === "rec" ? (armed ? t("messages.voiceReleaseCancel") : t("messages.voiceSlideCancel")) : null}
      </span>
    </div>
  );
}
