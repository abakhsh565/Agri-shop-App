/**
 * Whether this device has already shown the pre-login introduction.
 *
 * The introduction runs before anybody is signed in, so there is no account to
 * hang the state on — this one flag legitimately belongs to the device. Once it
 * is set, opening the app goes straight to sign-in, which is what a shop that has
 * been using the app for a month should see.
 *
 * Storage failures are not errors here: a blocked `localStorage` (private mode)
 * means the introduction shows once per launch, which is harmless — it is three
 * skippable screens, not a gate.
 */
const KEY = "agrishop-intro-seen";

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // storage blocked — see above
  }
}
