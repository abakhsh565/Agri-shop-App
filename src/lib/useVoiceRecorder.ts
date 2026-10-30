import { useCallback, useEffect, useRef, useState } from "react";
import { mediaMime } from "@/lib/financeMedia";

/**
 * Recording a voice note for a finance entry.
 *
 * WHY THE BROWSER'S OWN RECORDER. The app has no native audio plugin, and a voice note is a file
 * the owner may want to keep. `MediaRecorder` writes one, keeps it local until the entry is saved,
 * and needs no server round-trip. The reference screen's mic uses the phone's SPEECH engine to turn
 * talk into text; this is a different thing — a spoken explanation attached to the money row.
 *
 * WHAT IT REFUSES TO DO. It never records silently: `start()` asks for the microphone and reports a
 * refusal as `permission`, not as a generic failure. It stops the tracks on every exit path, so the
 * phone's microphone indicator goes away when the form does, and `stop()` is idempotent — a stop
 * tapped twice cannot resolve two recordings.
 *
 * The length is measured with the wall clock, not with the number of audio chunks: chunks arrive in
 * variable sizes, and a size-derived duration drifts from what the owner heard.
 */

export type VoiceRecorderError = "permission" | "unsupported" | "failed";

/**
 * State codes, not copy.
 *
 * The screen that draws the error translates the code (FinanceMediaField), so the words live in
 * the dictionary and this file never holds an English sentence. Naming them also keeps a refusal
 * and a broken recorder distinguishable at every call site.
 */
const ERR_UNSUPPORTED: VoiceRecorderError = "unsupported";
const ERR_DENIED: VoiceRecorderError = "permission";
const ERR_FAILED: VoiceRecorderError = "failed";

/** A browser's own refusal, by the names the spec gives it. */
function refusedByUser(caught: unknown): boolean {
  const name = (caught as DOMException | undefined)?.name;
  return name === "NotAllowedError" || name === "SecurityError";
}

export interface VoiceRecording {
  file: File;
  durationMs: number;
  mime: string;
}

/** The first container this browser can actually write. Safari/iOS prefers mp4, Chrome webm. */
function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // `isTypeSupported` is absent on a few old WebViews; the default constructor still works.
    }
  }
  return "";
}

export function useVoiceRecorder(): {
  recording: boolean;
  elapsedMs: number;
  error: VoiceRecorderError | null;
  start: () => Promise<boolean>;
  stop: () => Promise<VoiceRecording | null>;
  cancel: () => void;
} {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<VoiceRecorderError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const resolveRef = useRef<((value: VoiceRecording | null) => void) | null>(null);

  const releaseStream = useCallback(() => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => releaseStream, [releaseStream]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(ERR_UNSUPPORTED);
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      setError(ERR_UNSUPPORTED);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = (recorder.mimeType || "audio/webm").split(";")[0].trim();
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        releaseStream();
        setElapsedMs(0);

        // A tap that lasted no time is not a note. Resolving null keeps the rule in one place.
        if (durationMs < 300 || blob.size === 0) {
          resolveRef.current?.(null);
          resolveRef.current = null;
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${extension}`, {
          type: mediaMime(new File([blob], "voice", { type }), "voice"),
        });
        resolveRef.current?.({ file, durationMs, mime: file.type });
        resolveRef.current = null;
      };
      recorder.onerror = () => {
        releaseStream();
        setError(ERR_FAILED);
        resolveRef.current?.(null);
        resolveRef.current = null;
      };

      recorder.start(250);
      setRecording(true);
      setElapsedMs(0);
      tickRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 200);
      return true;
    } catch (caught) {
      releaseStream();
      setError(refusedByUser(caught) ? ERR_DENIED : ERR_FAILED);
      return false;
    }
  }, [releaseStream]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return null;
    return new Promise<VoiceRecording | null>((resolve) => {
      resolveRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        releaseStream();
        resolveRef.current = null;
        resolve(null);
      }
    });
  }, [releaseStream]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    resolveRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // The stream is released below either way.
      }
    }
    chunksRef.current = [];
    releaseStream();
    setElapsedMs(0);
  }, [releaseStream]);

  return { recording, elapsedMs, error, start, stop, cancel };
}
