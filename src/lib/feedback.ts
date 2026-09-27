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
 *   • **Short and quiet.** ~300ms, peaking at 0.16 gain. This plays at the counter, not
 *     in headphones, and a loud chime every sale is the fastest way to make people mute
 *     the app.
 *   • **Two rising notes (E5 → A5)**, which reads as "done" rather than as an alert —
 *     alerts in this app are toasts and red text, this is a confirmation.
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
    const notes: Array<[number, number]> = [
      [659.25, 0], // E5
      [880, 0.13], // A5
    ];

    for (const [freq, offset] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      // Raised slowly, dropped quickly: no click at either end.
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.34);
    }
  } catch {
    /* No audio: the sale is still complete. */
  }
}
