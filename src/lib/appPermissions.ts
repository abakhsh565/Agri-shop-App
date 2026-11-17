import { Capacitor } from "@capacitor/core";

/**
 * What the app asks the phone for, in one place.
 *
 * WHY A REGISTRY. Permission handling used to be scattered: the barcode scanner called
 * `requestPermissions()` every time it opened, the map asked the WebView and hoped, and nothing
 * anywhere told the user what the app could access or what to do when a dialog had been dismissed
 * with "don't ask again". Android's own rule is simple — ask when you need it, remember the answer,
 * never ask twice for the thing that was granted, and show the way to Settings when the OS will no
 * longer ask. This module is that rule, encoded once, so every screen asks the same way.
 *
 * WHAT IS *NOT* A RUNTIME PERMISSION, and why the list still shows it:
 *   · biometrics — the OS fingerprint dialog authenticates; no app permission is requested.
 *   · files — receipts and CSV exports are written to the app's own cache and handed to another app
 *     through the FileProvider, which grants exactly one file. No storage permission exists to ask
 *     for, and asking for one would be a lie on the store listing.
 * Those two are reported as `granted`/`not-needed` so the screen can say so out loud instead of
 * leaving the user wondering whether the app is hiding something.
 */

export type CapabilityId = "camera" | "location" | "microphone" | "biometrics" | "files";

export type CapabilityState =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported"
  /** Nothing to ask for: the capability needs no permission at all. */
  | "not-needed";

export interface CapabilityStatus {
  id: CapabilityId;
  state: CapabilityState;
  /**
   * True when the OS will no longer show its dialog. Only the system Settings can change it, so the
   * screen stops offering a button that cannot work.
   */
  blocked: boolean;
}

const ASKED_KEY = "hisabpay.permissions.asked";

function asked(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(ASKED_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Records that the OS dialog has been shown for this capability, so we never loop it. */
export function markAsked(id: CapabilityId) {
  try {
    localStorage.setItem(ASKED_KEY, JSON.stringify({ ...asked(), [id]: true }));
  } catch {
    // Storage unavailable (private mode): the dialog itself is still the source of truth.
  }
}

export function wasAsked(id: CapabilityId): boolean {
  return asked()[id] === true;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Maps Capacitor's permission states onto this module's vocabulary. */
function fromCapacitor(state: string | undefined): CapabilityState {
  if (state === "granted" || state === "limited") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

async function cameraPlugin() {
  try {
    return await import("@capacitor-mlkit/barcode-scanning");
  } catch {
    return null;
  }
}

async function checkCamera(): Promise<CapabilityState> {
  const mod = await cameraPlugin();
  if (!mod) return "prompt";
  try {
    const status = await mod.BarcodeScanner.checkPermissions();
    return fromCapacitor(status.camera);
  } catch {
    return "prompt";
  }
}

/** The camera: barcode scanning, and the only thing in the app that uses it. */
export async function requestCamera(): Promise<CapabilityState> {
  const state = await checkCamera();
  if (state === "granted") return "granted";
  if (wasAsked("camera") && state === "denied") return "denied";
  const mod = await cameraPlugin();
  if (!mod) {
    markAsked("camera");
    return state;
  }
  markAsked("camera");
  try {
    const status = await mod.BarcodeScanner.requestPermissions();
    return fromCapacitor(status.camera);
  } catch {
    return "prompt";
  }
}

async function permissionState(name: "geolocation" | "microphone"): Promise<CapabilityState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "prompt";
  try {
    const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Location is the WebView's, not a plugin's: Capacitor hands the page's request to Android when the
 * app declares ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION (see AndroidManifest). Asking here is
 * what makes the *system* dialog appear; granting is remembered by Android itself.
 */
export async function requestLocation(): Promise<CapabilityState> {
  const state = await permissionState("geolocation");
  if (state === "granted") return "granted";
  if (wasAsked("location") && state === "denied") return "denied";
  markAsked("location");
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
  return new Promise<CapabilityState>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "prompt"),
      { timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** The microphone: voice input. The stream is opened and closed at once — nothing is recorded. */
export async function requestMicrophone(): Promise<CapabilityState> {
  const state = await permissionState("microphone");
  if (state === "granted") return "granted";
  if (wasAsked("microphone") && state === "denied") return "denied";
  markAsked("microphone");
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch {
    return "denied";
  }
}

/** Biometrics are asked for by the OS at the moment of use; there is no app permission. */
async function biometricsState(): Promise<{ state: CapabilityState; blocked: boolean }> {
  try {
    const { biometricUnavailableReason } = await import("@/lib/biometric");
    const reason = await biometricUnavailableReason();
    if (!reason) return { state: "granted", blocked: false };
    if (reason === "no_enrolment" || reason === "no_screen_lock") return { state: "prompt", blocked: false };
    return { state: "unsupported", blocked: false };
  } catch {
    return { state: "unsupported", blocked: false };
  }
}

/** Every capability, as the settings screen lists it. */
export async function capabilityReport(): Promise<CapabilityStatus[]> {
  const [camera, location, microphone, biometrics] = await Promise.all([
    checkCamera(),
    permissionState("geolocation"),
    permissionState("microphone"),
    biometricsState(),
  ]);

  const withBlocked = (id: CapabilityId, state: CapabilityState): CapabilityStatus => ({
    id,
    state,
    // Only the OS dialog can stop appearing when it was already shown and refused.
    blocked: state === "denied" && wasAsked(id),
  });

  return [
    withBlocked("camera", camera),
    withBlocked("location", location),
    withBlocked("microphone", microphone),
    { id: "biometrics", state: biometrics.state, blocked: false },
    { id: "files", state: "not-needed", blocked: false },
  ];
}

/** Ask for one capability, doing nothing at all when it is already granted. */
export async function requestCapability(id: CapabilityId): Promise<CapabilityState> {
  if (id === "camera") return requestCamera();
  if (id === "location") return requestLocation();
  if (id === "microphone") return requestMicrophone();
  if (id === "biometrics") {
    const { state } = await biometricsState();
    return state === "prompt" ? "prompt" : state;
  }
  return "not-needed";
}
