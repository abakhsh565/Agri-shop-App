import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ImageOff, Pause, Play } from "lucide-react";
import { useT } from "@/lib/i18n";
import { chatMediaLink, formatDuration } from "@/lib/chatMedia";

/**
 * The file half of a chat bubble.
 *
 * WHY A LINK IS FETCHED ON DEMAND, NOT RENDERED INTO THE BUBBLE. Audio is private: the URL is a
 * 60-second signature, and minting one for every message on every render would both waste calls and
 * hand out playable links nobody asked for. So the bubble shows the duration it already has from
 * `get_farmer_media`, and only pressing play asks the server for a link.
 *
 * WHY AN <audio> ELEMENT RATHER THAN A PLUGIN. It is the one player every Android WebView has, it
 * streams from a signed URL without CORS games, and the plugin shell does not have to grow a
 * media API. Pause/resume is the element's own state.
 */

function useSignedLink(messageId: string, active: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  // A flag, not the exception's text: the bubble says it in the reader's own language.
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const cache = useRef<{ url: string; until: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    if (cache.current && cache.current.until > Date.now()) {
      setUrl(cache.current.url);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    chatMediaLink(messageId)
      .then((link) => {
        if (cancelled) return;
        // Keep 10 seconds of headroom: a link that expires mid-playback stops the audio.
        cache.current = { url: link.url, until: Date.now() + Math.max(10, link.expires_in - 10) * 1000 };
        setUrl(link.url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [messageId, active]);

  return { url, failed, loading };
}

/**
 * The shape of a voice note, the way a messenger draws one.
 *
 * A thin line is a progress bar; a voice note is read as a shape. The bars are fixed per message
 * (hashed from its id, not randomised on render) so a clip looks the same every time it scrolls
 * back into view, and they are painted with one clip-path instead of thirty animated nodes.
 */
const BAR_COUNT = 30;

function waveform(messageId: string): number[] {
  let seed = 0;
  for (let i = 0; i < messageId.length; i += 1) seed = (seed * 31 + messageId.charCodeAt(i)) % 100003;
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const noise = (seed / 2147483648);
    // A slow envelope keeps it looking like speech instead of noise.
    const envelope = 0.55 + 0.45 * Math.sin((i / BAR_COUNT) * Math.PI);
    bars.push(0.28 + noise * 0.72 * envelope);
  }
  return bars;
}

export function VoiceNote({
  messageId,
  durationMs,
  mine,
}: {
  messageId: string;
  durationMs: number | null;
  mine: boolean;
}) {
  const t = useT();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [wanted, setWanted] = useState(false);
  const { url, failed, loading } = useSignedLink(messageId, wanted && !playing);
  const bars = useRef(waveform(messageId));

  const toggle = () => {
    if (playing) {
      audio.current?.pause();
      return;
    }
    setWanted(true);
    const element = audio.current;
    if (!element || !url) return;
    void element.play().catch(() => setPlaying(false));
  };

  useEffect(() => {
    const element = audio.current;
    if (!element || !url || !wanted) return;
    if (element.src !== url) element.src = url;
    if (!playing) {
      void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
    // `url` arriving after the tap is what starts playback; `playing` is the result, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const total = durationMs ?? 0;
  const ratio = Math.min(1, Math.max(0, progress || 0));
  const elapsed = total > 0 ? Math.round(ratio * total) : 0;
  // Idle shows the length, playing shows how far along it is — the same reading order as a player.
  const clock = playing || ratio > 0 ? elapsed : total;

  const seek = (event: ReactMouseEvent<HTMLDivElement>) => {
    const element = audio.current;
    const box = event.currentTarget.getBoundingClientRect();
    if (!element || !box.width) return;
    const next = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setProgress(next);
    if (Number.isFinite(element.duration) && element.duration > 0) {
      element.currentTime = next * element.duration;
    } else if (total > 0) {
      element.currentTime = (next * total) / 1000;
    }
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  return (
    <div className="flex items-center gap-2.5 min-w-[168px]" data-testid={`voice-${messageId}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("messages.voicePause") : t("messages.voicePlay")}
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{
          background: mine ? "var(--brand)" : "var(--brand-tint)",
          color: mine ? "var(--brand-fg)" : "var(--brand-dark)",
        }}
        data-testid={`voice-toggle-${messageId}`}
      >
        {playing ? (
          <Pause size={16} strokeWidth={2} fill="currentColor" />
        ) : (
          <Play size={16} strokeWidth={2} fill="currentColor" style={{ marginInlineStart: 2 }} />
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1">
        {/* The bars: one wrapper paints the played half in brand, the rest stays muted. */}
        <div
          onClick={seek}
          role="slider"
          tabIndex={0}
          aria-label={t("messages.voicePlay")}
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(elapsed / 1000)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") void toggle();
          }}
          className="flex h-6 cursor-pointer items-center gap-[2px] touch-none"
        >
          {bars.current.map((height, index) => {
            const played = index / BAR_COUNT <= ratio;
            return (
              <span
                key={index}
                className="w-[2px] shrink-0 rounded-full"
                style={{
                  height: Math.round(height * 22),
                  background: played
                    ? mine
                      ? "var(--brand-dark)"
                      : "var(--brand)"
                    : mine
                      ? "color-mix(in srgb, var(--brand-dark) 34%, transparent)"
                      : "var(--divider)",
                  transition: "background-color 120ms linear",
                }}
              />
            );
          })}
        </div>
        <span className="flex items-center gap-1.5 text-10 tabular-nums" style={{ color: "var(--text-tertiary)" }}>
          {loading
            ? t("messages.voiceLoading")
            : failed
              ? t("messages.voiceUnavailable")
              : playing
                ? formatDuration(elapsed)
                : formatDuration(clock)}
          {playing && (
            <span className="size-1.5 rounded-full" style={{ background: "var(--brand)" }} aria-hidden="true" />
          )}
        </span>
      </div>

      {/* Speed: only meaningful once there is audio to speed up. */}
      <button
        type="button"
        onClick={cycleRate}
        aria-label={`${t("messages.voiceSpeed")} ${rate}×`}
        className="flex h-6 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 text-10 font-semibold tabular-nums"
        style={{
          background: rate === 1 ? "transparent" : "var(--brand-tint)",
          color: rate === 1 ? "var(--text-tertiary)" : "var(--brand-dark)",
          border: "1px solid var(--hairline)",
        }}
        data-testid={`voice-rate-${messageId}`}
      >
        {rate}×
      </button>

      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          if (element.duration && Number.isFinite(element.duration)) {
            setProgress(element.currentTime / element.duration);
          } else if (total > 0) {
            // A MediaRecorder WebM reports Infinity until it is seeked; the stored duration is truth.
            setProgress(Math.min(1, (element.currentTime * 1000) / total));
          }
        }}
      />
    </div>
  );
}

export function PhotoMessage({ messageId, mine }: { messageId: string; mine: boolean }) {
  const t = useT();
  const [wanted, setWanted] = useState(false);
  const { url, failed } = useSignedLink(messageId, wanted);

  return (
    <button
      type="button"
      onClick={() => setWanted(true)}
      className="block overflow-hidden rounded-[12px]"
      style={{ background: "var(--tone-card)", minWidth: 140, minHeight: 96 }}
      data-testid={`photo-${messageId}`}
      aria-label={t("messages.photoOpen")}
    >
      {url ? (
        <img src={url} alt={t("messages.photoAlt")} className="max-h-64 w-full object-cover" loading="lazy" />
      ) : failed ? (
        <span className="flex flex-col items-center justify-center gap-1 p-4 text-10" style={{ color: "var(--text-tertiary)" }}>
          <ImageOff size={16} />
          {t("messages.photoUnavailable")}
        </span>
      ) : (
        <span className="flex items-center justify-center p-6 text-10" style={{ color: mine ? "var(--brand-dark)" : "var(--text-tertiary)" }}>
          {t("messages.photoTapToLoad")}
        </span>
      )}
    </button>
  );
}
