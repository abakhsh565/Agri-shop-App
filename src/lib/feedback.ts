/**
 * The app's own confirmation sound.
 *
 * Why synthesised, not a file: a sound file would be one more asset in the APK and one
 * more thing to get wrong on a slow connection, and this is two sine-ish tones with an
 * envelope — a few hundred bytes of code that render identically everywhere. It also
 * cannot 404.
 *
 * Deliberate limits:
 *
 *   • **Quiet.** Peaks at 0.15 gain. This plays at the counter, not in headphones, and a
 *     loud chime every sale is the fastest way to make people mute the app.
 *   • **Rising, then settling.** Five notes climb, and the gaps between them widen
 *     (0.20s → 0.24s → 0.31s → 0.40s) so the phrase audibly **slows down** toward a final
 *     chord that is held and left to fade. Total ~3.8s: long enough to feel like a
 *     completion, slow enough at the end that it never competes with the next sale.
 *   • **Rising notes read as "done", not as an alert** — alerts in this app are toasts and
 *     red text; this is a confirmation.
 *   • **Failure is silent and harmless.** Browsers refuse audio until the page has had a
 *     gesture, WebViews vary, and a missing chime must never break the screen that
 *     confirms a sale. Every step is wrapped.
 *   • **Respects a stored preference**, so one shop can turn it off without a rebuild.
 */

const MUTE_KEY = "agri_mute_feedback";

let ctx: AudioContext | null = null;

/** Off switch, remembered on the device. */
export function setFeedbackMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode: the sound simply keeps its default */
  }
}

export function isFeedbackMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The two-note confirmation. Safe to call from anywhere, at any time: it either plays or
 * does nothing.
 */
export function playConfirmation(): void {
  if (isFeedbackMuted()) return;
  try {
    const Ctor =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    ctx = ctx ?? new Ctor();
    if (ctx.state === "suspended") void ctx.resume();

    const start = ctx.currentTime;

    // freq, offset, hold — offsets widen on purpose, that is the slowing down.
    const notes: Array<[number, number, number]> = [
      [659.25, 0.0, 0.9], // E5
      [880.0, 0.2, 0.95], // A5
      [1046.5, 0.44, 1.0], // C6
      [1318.5, 0.75, 1.1], // E6
      [880.0, 1.15, 2.9], // A5, held — the settling
      [1318.5, 1.15, 2.9], // E6, same breath, so the close is a chord not a note
    ];

    for (const [freq, offset, hold] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      // Soft in, and a long exponential tail out: the attack is 30ms so there is no click,
      // and the release is most of the note so the last chord dies away instead of stopping.
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, start + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + hold);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + hold + 0.05);
    }
  } catch {
    /* No audio: the sale is still complete. */
  }
}
