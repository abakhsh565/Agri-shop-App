/**
 * Adaptive preparation for a recorded voice note — the audio half of the app's media pipeline.
 *
 * A voice note is a spoken sentence attached to a recorded expense, not a piece of music. A phone
 * browser records one at its own default bitrate (Chrome's is 128 kbps in Opus), which is about
 * four times what speech needs: a 30-second note then costs ~480 KB and the private bucket's 10 MB
 * ceiling arrives after twenty of them. So the target here is the same trade WhatsApp makes for a
 * voice message — mono Opus at 32 kbps — where speech is still perfectly intelligible and the
 * file is a quarter of the size.
 *
 * TWO PLACES, ONE RULE
 *   · At capture: `useVoiceRecorder` asks MediaRecorder for this bitrate, so a new note is
 *     compressed BY THE ENCODER and never needs a second pass (no generation loss).
 *   · Before upload: `prepareVoice` is the safety net for anything already recorded — an older
 *     draft, or a browser that ignored the bitrate hint. It only re-encodes when the effective
 *     bitrate is above `VOICE_SKIP_AT_OR_BELOW_BPS`, so a note that is already small is uploaded
 *     untouched rather than being decoded and encoded again for nothing.
 *
 * WHAT IT NEVER DOES: it does not touch non-audio files (a PDF or a text file is passed straight
 * through by the caller), it does not replace a file with one that came out larger, and if the
 * browser cannot decode or re-encode at all it returns the original instead of failing the save.
 */

/** The encoder target for a spoken note: mono Opus, 32 kbps (WhatsApp's voice-note class). */
export const VOICE_BITS_PER_SECOND = 32_000;

/**
 * At or below this, the note is already optimised and is left alone.
 *
 * The gap between 32 and 48 kbps is deliberate: it absorbs container overhead and an encoder that
 * rounds the request, so a freshly recorded note (which lands near 32) is never re-encoded just
 * because it measured 40.
 */
export const VOICE_SKIP_AT_OR_BELOW_BPS = 48_000;

/**
 * Re-encoding happens in real time (the browser's encoder wants a live stream), so a very long
 * file would hold the save button for minutes. Above this the note is uploaded as it is — it is
 * still capped by the bucket, and a long note is rare enough that size matters less than the wait.
 */
export const VOICE_MAX_TRANSCODE_SECONDS = 120;

export interface PreparedAudio {
  file: File;
  originalBytes: number;
  bytes: number;
  /** False means the original file was kept as-is (already small, or not transformable). */
  changed: boolean;
  mime: string;
  /** Bits per second measured from the file itself, when its length is known. */
  bitrate: number | null;
  durationSeconds: number | null;
}

/** Bits per second of a file of `bytes` that plays for `durationSeconds`, or null when unknown. */
export function effectiveBitrate(bytes: number, durationSeconds: number | null): number | null {
  if (!durationSeconds || durationSeconds <= 0 || !Number.isFinite(durationSeconds)) return null;
  return Math.round((bytes * 8) / durationSeconds);
}

/** Whether a note is worth a second encode. Unknown length = leave it alone. */
export function shouldReencode(bytes: number, durationSeconds: number | null): boolean {
  const bitrate = effectiveBitrate(bytes, durationSeconds);
  if (bitrate === null) return false;
  return bitrate > VOICE_SKIP_AT_OR_BELOW_BPS;
}

/** The first Opus container this browser can write, the same order the recorder uses. */
function pickAudioMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const candidate of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // `isTypeSupported` is absent on a few old WebViews; the next candidate still works.
    }
  }
  return "";
}

/** The mime the app stores for a container, without its codec parameter. */
function baseMime(mime: string): string {
  const type = (mime || "").split(";")[0].trim().toLowerCase();
  if (type === "audio/x-m4a") return "audio/mp4";
  return type || "audio/webm";
}

/** The stored extension for a container. */
function extensionForMime(mime: string): string {
  if (mime === "audio/mp4") return "m4a";
  if (mime === "audio/ogg") return "ogg";
  return "webm";
}

/**
 * How long the file plays, read from the media element's metadata.
 *
 * The element is enough for every container the app accepts and costs one metadata fetch of a
 * local object URL; decoding the whole file just to ask its length would be the expensive way.
 */
export async function audioDurationSeconds(file: File): Promise<number | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number | null>((resolve) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      const done = (value: number | null) => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        resolve(value);
      };
      audio.onloadedmetadata = () => {
        const seconds = audio.duration;
        if (Number.isFinite(seconds) && seconds > 0) {
          done(seconds);
          return;
        }
        // A MediaRecorder WebM reports `Infinity` until the browser has read to the end: the
        // stream's length is not in its header. Seeking past the end makes the element resolve
        // it, which is the only way to learn how long our own recordings are.
        if (!Number.isFinite(seconds)) {
          audio.ondurationchange = () => {
            const resolved = audio.duration;
            if (Number.isFinite(resolved) && resolved > 0) done(resolved);
          };
          try {
            audio.currentTime = 1e101;
          } catch {
            done(null);
          }
          return;
        }
        done(null);
      };
      audio.onerror = () => done(null);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downmix to mono so a stereo recording cannot double the file it becomes. */
async function toMono(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (buffer.numberOfChannels === 1) return buffer;
  const frames = buffer.length;
  const mono = new AudioBuffer({ length: frames, numberOfChannels: 1, sampleRate: buffer.sampleRate });
  const out = mono.getChannelData(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) out[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

/**
 * Re-encode one decoded buffer to mono Opus at the voice bitrate.
 *
 * MediaRecorder only writes a live stream, so the buffer is played through a
 * `MediaStreamAudioDestinationNode` at normal speed and captured. That is why the caller keeps
 * `VOICE_MAX_TRANSCODE_SECONDS` small: this is a note, not a podcast.
 */
async function encodeVoice(buffer: AudioBuffer): Promise<{ blob: Blob; mime: string } | null> {
  if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") return null;
  const context = new AudioContext();
  try {
    const mono = await toMono(buffer);
    const destination = context.createMediaStreamDestination();
    // The recorder takes its channel count from the destination node, and the node's default is
    // stereo. Forcing one channel is what makes the stored note mono — the same 32 kbps then buys
    // twice the bits for the voice instead of being split across two silent-to-identical sides.
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";
    destination.channelInterpretation = "speakers";
    const source = context.createBufferSource();
    source.buffer = mono;
    source.connect(destination);

    const requested = pickAudioMime();
    const recorder = requested
      ? new MediaRecorder(destination.stream, { mimeType: requested, audioBitsPerSecond: VOICE_BITS_PER_SECOND })
      : new MediaRecorder(destination.stream, { audioBitsPerSecond: VOICE_BITS_PER_SECOND });

    const chunks: Blob[] = [];
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.start(250);
    source.start();
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
    // Give the encoder the final chunk before closing the stream.
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;

    const mime = baseMime(recorder.mimeType || requested || "audio/webm");
    const blob = new Blob(chunks, { type: mime });
    return blob.size > 0 ? { blob, mime } : null;
  } catch {
    return null;
  } finally {
    void context.close();
  }
}

/**
 * The audio equivalent of `prepareImage`: return a note that is ready to upload.
 *
 * Never throws for a media problem — a voice note that cannot be improved is still a voice note,
 * and losing the owner's explanation to a codec quirk would be the wrong trade.
 */
export async function prepareVoice(file: File): Promise<PreparedAudio> {
  const mime = baseMime(file.type);
  const unchanged: PreparedAudio = {
    file,
    originalBytes: file.size,
    bytes: file.size,
    changed: false,
    mime: mime || "audio/webm",
    bitrate: null,
    durationSeconds: null,
  };

  if (!mime.startsWith("audio/")) return unchanged;
  if (typeof AudioContext === "undefined" || typeof MediaRecorder === "undefined") return unchanged;

  const durationSeconds = await audioDurationSeconds(file);
  unchanged.durationSeconds = durationSeconds;
  unchanged.bitrate = effectiveBitrate(file.size, durationSeconds);
  if (!shouldReencode(file.size, durationSeconds)) return unchanged;
  if (durationSeconds === null || durationSeconds > VOICE_MAX_TRANSCODE_SECONDS) return unchanged;

  let decoded: AudioBuffer;
  const context = new AudioContext();
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    return unchanged;
  } finally {
    void context.close();
  }

  const encoded = await encodeVoice(decoded);
  if (!encoded) return unchanged;
  // A "compressed" file that came out larger is a regression, not an optimisation.
  if (encoded.blob.size >= file.size) return unchanged;

  const prepared = new File(
    [encoded.blob],
    `${file.name.replace(/\.[^.]+$/, "") || "voice"}.${extensionForMime(encoded.mime)}`,
    { type: encoded.mime, lastModified: Date.now() },
  );
  return {
    file: prepared,
    originalBytes: file.size,
    bytes: prepared.size,
    changed: true,
    mime: encoded.mime,
    bitrate: effectiveBitrate(prepared.size, durationSeconds),
    durationSeconds,
  };
}
