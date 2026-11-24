import { useEffect, useRef, useState } from "react";
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
  const [wanted, setWanted] = useState(false);
  const { url, failed, loading } = useSignedLink(messageId, wanted && !playing);

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
  const elapsed = total > 0 ? Math.round((progress || 0) * total) : 0;

  return (
    <div className="flex items-center gap-2" data-testid={`voice-${messageId}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("messages.voicePause") : t("messages.voicePlay")}
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{
          background: mine ? "var(--brand)" : "var(--brand-tint)",
          color: mine ? "var(--brand-fg)" : "var(--brand-dark)",
        }}
      >
        {playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
      </button>
      <div className="flex flex-1 flex-col gap-1 min-w-[110px]">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
          <div
            className="h-full"
            style={{ width: `${Math.min(100, Math.max(0, (progress || 0) * 100))}%`, background: "var(--brand)" }}
          />
        </div>
        <span className="text-10" style={{ color: "var(--text-tertiary)" }}>
          {loading ? t("messages.voiceLoading") : failed ? t("messages.voiceUnavailable") : formatDuration(elapsed || total)}
        </span>
      </div>
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
