import { useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, Square, X } from "lucide-react";
import ImageCrop from "@/components/ui/ImageCrop";
import Photo from "@/components/ui/Photo";
import { useT } from "@/lib/i18n";
import {
  MAX_PHOTOS,
  MAX_VOICE_MS,
  MAX_VOICES,
  formatDuration,
  type FinanceMediaKind,
} from "@/lib/financeMedia";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";

/**
 * The receipts and voice notes on the money form and its detail sheet.
 *
 * ONE COMPONENT, TWO STATES. A file is either a saved attachment (it has a signed URL and an id)
 * or a draft (it has an object URL and the owner has not saved yet). Both are drawn as the same
 * tile; only the remove action differs, and the parent owns that decision because a saved file
 * must be removed at the database and a draft only from memory.
 *
 * WHY THE RECORDER LIVES HERE. It needs the same limit labels and the same error words on both
 * screens. Putting it in the page would mean the sheet grew a second, slightly different
 * recorder — the drift this app keeps removing.
 *
 * A refusal to use the microphone is reported in the language being read, and it is not a generic
 * failure: "allow the microphone" and "this device cannot record" ask the owner to do different
 * things.
 */

export interface FinanceMediaView {
  /** Attachment id, or a local draft key. */
  key: string;
  kind: FinanceMediaKind;
  /** Signed URL for a saved object, object URL for a draft. Null while it is still being signed. */
  url: string | null;
  durationMs: number | null;
  /** True while the file has not reached the server. */
  draft: boolean;
}

interface FinanceMediaFieldProps {
  photos: FinanceMediaView[];
  voices: FinanceMediaView[];
  busy?: boolean;
  /**
   * Draw the papers but offer no way to change them. The database refuses a non-owner's write,
   * but a control that exists only to be refused misstates what the account can do.
   */
  readOnly?: boolean;
  onAddPhotos: (files: File[]) => void;
  onRemove: (media: FinanceMediaView) => void;
  onRecorded: (file: File, durationMs: number) => void;
}

export default function FinanceMediaField({
  photos,
  voices,
  busy = false,
  readOnly = false,
  onAddPhotos,
  onRemove,
  onRecorded,
}: FinanceMediaFieldProps) {
  const t = useT();
  const photoInput = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();
  const [notice, setNotice] = useState("");
  // The chosen pictures wait here one at a time. Each is framed before the parent sees it, so
  // the form and the detail sheet upload exactly the crop the owner approved.
  const [cropQueue, setCropQueue] = useState<File[]>([]);

  // A minute is the form's cap. The recorder itself does not decide that; the screen that knows
  // the limit stops it, and the database carries the final say.
  useEffect(() => {
    if (!recorder.recording) return;
    if (recorder.elapsedMs < MAX_VOICE_MS) return;
    void recorder.stop().then((result) => {
      if (result) onRecorded(result.file, result.durationMs);
    });
  }, [recorder, onRecorded]);

  const recorderMessage =
    recorder.error === "permission"
      ? t("finance.media.micDenied")
      : recorder.error === "unsupported"
        ? t("finance.media.micUnsupported")
        : recorder.error === "failed"
          ? t("finance.media.micFailed")
          : "";

  async function toggleRecording() {
    setNotice("");
    if (recorder.recording) {
      const result = await recorder.stop();
      if (result) onRecorded(result.file, result.durationMs);
      return;
    }
    if (voices.length >= MAX_VOICES) {
      setNotice(t("finance.media.limitVoices"));
      return;
    }
    await recorder.start();
  }

  function pickPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (photoInput.current) photoInput.current.value = "";
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setNotice(t("finance.media.limitPhotos"));
      return;
    }
    setNotice(files.length > room ? t("finance.media.limitPhotos") : "");
    if (files.length > 0) setCropQueue(files.slice(0, room));
  }

  function confirmCrop(picture: File) {
    onAddPhotos([picture]);
    setCropQueue((current) => current.slice(1));
  }

  const labelCls = "text-12 font-semibold";
  const hintCls = "text-11";
  const canAddPhoto = photos.length < MAX_PHOTOS && !busy && !readOnly;

  return (
    <div className="flex flex-col gap-4" data-testid="finance-media-field">
      {/* ── Receipts ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
            {t("finance.media.receipts")}
          </p>
          <span className={hintCls} style={{ color: "var(--text-tertiary)" }}>
            {t("finance.media.receiptsHint", { count: String(MAX_PHOTOS) })}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <div
              key={photo.key}
              className="relative rounded-[var(--radius-tile)] overflow-hidden"
              style={{ width: 76, height: 76, background: "var(--tone-sunken)" }}
              data-testid={`finance-photo-${photo.key}`}
            >
              <Photo
                src={photo.url}
                className="w-full h-full object-cover"
                fallback={<span className="absolute inset-0 animate-pulse" style={{ background: "var(--tone-sunken)" }} />}
              />
              {photo.draft && (
                <span
                  className="absolute bottom-1 start-1 text-8 font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
                >
                  {t("finance.media.pending")}
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRemove(photo)}
                  aria-label={t("finance.media.remove")}
                  data-testid={`finance-photo-remove-${photo.key}`}
                  className="absolute top-0 end-0 size-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}

          {canAddPhoto && (
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              data-testid="finance-photo-add"
              className="rounded-[var(--radius-tile)] flex flex-col items-center justify-center gap-1 ds-pressable"
              style={{
                width: 76,
                height: 76,
                background: "var(--tone-sunken)",
                color: "var(--text-secondary)",
              }}
            >
              <ImagePlus size={18} />
              <span className="text-9 font-semibold">{t("finance.media.addPhoto")}</span>
            </button>
          )}
        </div>

        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={pickPhotos}
          className="hidden"
          data-testid="finance-photo-input"
        />
      </div>

      {/* ── Voice notes ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
            {t("finance.media.voice")}
          </p>
          <span className={hintCls} style={{ color: "var(--text-tertiary)" }}>
            {t("finance.media.voiceHint", {
              count: String(MAX_VOICES),
              seconds: String(Math.round(MAX_VOICE_MS / 1000)),
            })}
          </span>
        </div>

        {voices.map((voice) => (
          <div
            key={voice.key}
            className="rounded-[var(--radius-tile)] p-2 flex flex-col gap-1"
            style={{ background: "var(--tone-sunken)" }}
            data-testid={`finance-voice-${voice.key}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-10 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {voice.durationMs != null ? formatDuration(voice.durationMs) : t("finance.media.voiceNote")}
                {voice.draft ? ` · ${t("finance.media.pending")}` : ""}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRemove(voice)}
                  aria-label={t("finance.media.remove")}
                  data-testid={`finance-voice-remove-${voice.key}`}
                  className="size-7 rounded-full flex items-center justify-center"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {voice.url && (
              <audio
                controls
                preload="metadata"
                src={voice.url}
                className="w-full h-9"
                data-testid={`finance-voice-audio-${voice.key}`}
              />
            )}
          </div>
        ))}

        {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={busy || (!recorder.recording && voices.length >= MAX_VOICES)}
            data-testid="finance-voice-record"
            className="h-10 px-4 rounded-full flex items-center gap-2 text-12 font-semibold disabled:opacity-45 ds-pressable"
            style={
              recorder.recording
                ? { background: "var(--error)", color: "#fff" }
                : { background: "var(--tone-sunken)", color: "var(--text-primary)" }
            }
          >
            {recorder.recording ? <Square size={13} /> : <Mic size={15} />}
            {recorder.recording
              ? t("finance.media.stop")
              : t("finance.media.record")}
          </button>
          {recorder.recording && (
            <span
              className="text-12 font-semibold tabular-nums"
              style={{ color: "var(--error)" }}
              data-testid="finance-voice-timer"
            >
              {formatDuration(recorder.elapsedMs)}
            </span>
          )}
        </div>
        )}

        {(recorderMessage || notice) && (
          <p className="text-11" style={{ color: recorderMessage ? "var(--error)" : "var(--text-tertiary)" }}>
            {recorderMessage || notice}
          </p>
        )}
      </div>

      {cropQueue[0] && (
        <ImageCrop
          key={`${cropQueue[0].name}-${cropQueue[0].size}-${cropQueue[0].lastModified}`}
          file={cropQueue[0]}
          // The receipt tile is square, so the saved paper is the part the tile will actually draw.
          aspect={1}
          onCancel={() => setCropQueue([])}
          onConfirm={confirmCrop}
        />
      )}
    </div>
  );
}
