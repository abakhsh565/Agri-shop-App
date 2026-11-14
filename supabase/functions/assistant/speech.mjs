/**
 * Urdu speech for the assistant.
 *
 * A browser's SpeechSynthesis queue is only as good as the voices installed on the device. On a
 * phone with no Urdu voice, asking it to read `ur-PK` still produces an English voice — or no
 * sound. The assistant therefore asks the same model provider that already answers its questions
 * for a spoken Urdu rendering, and returns the audio to the screen. The screen plays it; no voice
 * pack has to be installed, and the result is the same on the web build and the Android app.
 *
 * Nothing here is stored. The reply is translated and synthesized for this one press, and the
 * browser keeps the returned audio only in memory.
 */

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Gemini 2.5 TTS is scheduled to shut down on 17 November 2026. Use the current GA model
// first, with the old preview model only as a compatibility fallback for keys that still
// have it enabled.
const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
const TTS_VOICE = "Kore";
const MAX_SPEECH_CHARS = 2000;
const URDU_SCRIPT = /[\u0600-\u06FF]/;

const TRANSLATE_PROMPT = `Translate this AgriShop assistant reply into natural spoken Urdu for Pakistan.
Translate every sentence. Do not stop early or summarise.
Return only the Urdu translation in Urdu script. No English prose, no quotes, no markdown.
Keep every number, amount, name, date and identifier exactly as given. Do not add, remove or estimate any fact.

REPLY:
`;

function endpoint(baseUrl, model) {
  const base = String(baseUrl || GOOGLE_BASE).replace(/\/+$/, "");
  return `${base}/models/${model}:generateContent`;
}

async function callModel({ apiKey, baseUrl, model, body }) {
  const response = await fetch(endpoint(baseUrl, model), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    // A model that never answers must not hold the speaker open forever. The client has its own
    // longer timeout, but the server should abandon a stuck translation before that happens.
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || `The voice service replied with ${response.status}.`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

function canTryAnotherModel(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return true;
  const status = Number(error?.status ?? 0);
  return status === 403 || status === 404 || status === 429 || status >= 500;
}

function textFrom(payload) {
  return (payload?.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

async function translateToUrdu({ text, apiKey, model, fallbackModel, baseUrl }) {
  const source = String(text ?? "").trim().slice(0, MAX_SPEECH_CHARS);
  const models = [model, fallbackModel].filter(
    (name, index, all) => Boolean(name) && all.indexOf(name) === index,
  );
  let lastError = null;

  for (const name of models) {
    try {
      const payload = await callModel({
        apiKey,
        baseUrl,
        model: name,
        body: {
          contents: [{ role: "user", parts: [{ text: `${TRANSLATE_PROMPT}${source}` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        },
      });
      const candidate = payload?.candidates?.[0];
      const urdu = textFrom(payload)
        .replace(/^```(?:\w+)?\s*/, "")
        .replace(/\s*```$/, "")
        .replace(/^(?:Urdu|اردو)\s*[:：]\s*/i, "")
        .trim();
      if (!URDU_SCRIPT.test(urdu)) {
        throw new Error("The voice service did not return Urdu text.");
      }
      // A cut-off translation is worse than no speech: it can drop the second money figure from
      // an answer. `MAX_TOKENS` proves the model stopped early, and the numeric check catches a
      // translation that silently omitted a figure even when it finished normally.
      const numbers = source.match(/\d[\d,.]*/g) ?? [];
      const missingNumbers = numbers.filter((number) => !urdu.includes(number));
      if (candidate?.finishReason === "MAX_TOKENS" || missingNumbers.length) {
        throw new Error("The voice service returned an incomplete Urdu translation.");
      }
      return urdu;
    } catch (error) {
      lastError = error;
      if (!canTryAnotherModel(error) || name === models[models.length - 1]) throw error;
    }
  }

  throw lastError ?? new Error("The voice service did not return Urdu text.");
}

async function synthesizeUrdu({ text, apiKey, baseUrl }) {
  let lastError = null;

  for (const model of TTS_MODELS) {
    try {
      // Gemini 3.8 uses the current voiceConfig shape and returns a complete WAV for unary
      // requests. The 2.5 fallback still expects prebuiltVoiceConfig and returns raw PCM.
      const current = model.startsWith("gemini-3.8-");
      const payload = await callModel({
        apiKey,
        baseUrl,
        model,
        body: {
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: current
                ? { voice: TTS_VOICE }
                : { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
            },
          },
        },
      });
      const inline = (payload?.candidates?.[0]?.content?.parts ?? []).find(
        (part) => part?.inlineData?.data,
      )?.inlineData;
      if (!inline?.data) throw new Error("The voice service returned no audio.");
      return {
        data: inline.data,
        mimeType: inline.mimeType || "audio/L16;codec=pcm;rate=24000",
      };
    } catch (error) {
      lastError = error;
      if (!canTryAnotherModel(error)) throw error;
    }
  }

  throw lastError ?? new Error("The voice service returned no audio.");
}

function audioFormat(mimeType) {
  return {
    sampleRate: Number(/rate=(\d+)/i.exec(String(mimeType))?.[1] ?? 24000),
    channels: Number(/channels=(\d+)/i.exec(String(mimeType))?.[1] ?? 1),
    bitsPerSample: 16,
  };
}

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64FromBytes(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Gemini 3.8 returns a complete WAV; older models return headerless PCM. */
function isWave(bytes) {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

/** Wrap raw 16-bit PCM in the WAV header browser audio elements expect. */
export function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  const blockAlign = channels * (bitsPerSample / 8);

  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}

/**
 * Translate one reply to Urdu and return a playable WAV.
 *
 * `model` is the assistant's configured text model, with its existing smaller fallback for a
 * spent quota. The speech model is separate: a text quota must not make the speaker silently
 * fall back to an English voice.
 */
export async function urduSpeech({ text, apiKey, model, fallbackModel, baseUrl } = {}) {
  if (!apiKey) {
    const error = new Error("Urdu speech is not switched on for this shop.");
    error.status = 503;
    throw error;
  }
  const source = String(text ?? "").trim();
  if (!source) {
    const error = new Error("There is nothing to read.");
    error.status = 400;
    throw error;
  }

  const urdu = await translateToUrdu({ text: source, apiKey, model, fallbackModel, baseUrl });
  const audio = await synthesizeUrdu({ text: urdu, apiKey, baseUrl });
  const raw = bytesFromBase64(audio.data);
  const wav = isWave(raw) ? raw : pcmToWav(raw, audioFormat(audio.mimeType));

  return {
    urdu,
    audio: base64FromBytes(wav),
    mimeType: "audio/wav",
  };
}
