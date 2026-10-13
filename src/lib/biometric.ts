import { Capacitor } from "@capacitor/core";
//
// The plugin's TYPES only, at module scope.
//
// Its runtime is imported inside the native branches below, and that is deliberate: the
// package ships an ESM build whose internal imports carry no file extension, which webpack
// and Vite resolve and Node does not — so a static import here would break every consumer
// that is not a bundler (the unit tests, and any script that loads this module), for a file
// the browser never executes. Loading it where it is used fixes that and keeps ~40KB of
// native bridge out of the web bundle at the same time.
import type { BiometryErrorType } from "@aparajita/capacitor-biometric-auth";
import { tNow } from "@/lib/i18n";
import { secureGet, secureSet, secureHas, secureRemove } from "@/lib/secureStorage";

/**
 * Fingerprint (or face) unlock, as a faster second way to open a device that already
 * belongs to someone.
 *
 * ── Where this sits in the trust model ────────────────────────────────────────────────
 *
 * The PIN is checked by the database against a bcrypt hash (`verify_user_pin`, 0148); this
 * device stores only a marker saying "a PIN has been set", which contains no secret. The
 * fingerprint is a *stronger marker of the same kind*: it proves the person holding the
 * phone is the person the phone belongs to, and nothing more. It deliberately does not
 * replace the code flow, and it does not touch the Supabase session — the PIN row in
 * Settings, the code (SMS) screen and account recovery are all unchanged.
 *
 * That means it is a convenience gate, and it is worth being plain about that: anyone who
 * can run script in this origin can bypass a client-side gate, exactly as they could
 * bypass the PIN marker. What it buys over a 4-digit PIN is real and worth having — it
 * cannot be guessed, cannot be watched over a shoulder, and is bound to the phone's secure
 * hardware rather than to a number.
 *
 * ── Why the assertion is verified rather than trusted ─────────────────────────────────
 *
 * The common shortcut in a device-unlock implementation is to call `credentials.get()` and
 * treat "it returned something" as success. That is one line in a console away from being
 * irrelevant. So the assertion is actually checked here: the challenge we generated, the
 * origin and type in `clientDataJSON`, the RP-ID hash over `authenticatorData`, the
 * user-present and user-verified flags, a signature over
 * `authenticatorData || SHA-256(clientDataJSON)` verified against the public key captured
 * at enrolment, and a sign counter that has not gone backwards.
 *
 * ── Platform reality ─────────────────────────────────────────────────────────────────
 *
 * ── Android WebView has no WebAuthn, so the APK gets the OS instead ───────────────────
 *
 * Capacitor renders the APK in an Android WebView, which has no `PublicKeyCredential` at
 * all. WebAuthn alone therefore means "works in a browser, invisible inside the app" — and
 * invisible is what the app used to be: the fingerprint button simply never appeared on
 * the phone it was built for.
 *
 * So there are two authenticators behind one interface:
 *
 *   browser → WebAuthn platform authenticator (created and verified in this file)
 *   APK     → the device's own BiometricPrompt, through
 *             `@aparajita/capacitor-biometric-auth`
 *
 * Which one is in play is decided by `isNative()` below, at every entry point, so no screen
 * has to know. The APK's authenticator is the stronger of the two — it is the platform's
 * own enrolled fingerprint, checked in secure hardware — and it needs no key material kept
 * on our side, so enrolment there records only that the person chose to use it.
 */

const RP_NAME = "AgriShop";
/** Where the enrolment for one account on this device is kept. */
const ENROL_KEY = (userId: string) => `agri_bio_${userId}`;
const CHALLENGE_BYTES = 32;
/** ES256 only: it is what every platform authenticator is required to support. */
const ES256 = -7;
const COSE_EC2 = 2;
const COSE_P256 = 1;
const UP_FLAG = 0x01;
const UV_FLAG = 0x04;

/** A browser enrolment: the key material this app must hold to check an assertion itself. */
export interface EnrolledBiometric {
  /** Absent on records written before the APK path existed, which are all WebAuthn. */
  kind?: "webauthn";
  /** base64url of the credential's raw id. */
  credentialId: string;
  /** The captured public key, as a JWK so it survives JSON storage. */
  publicKeyJwk: JsonWebKey;
  rpId: string;
  /** Last signature counter seen, so a replay cannot reuse an older assertion. */
  signCount: number;
  enrolledAt: string;
}

/**
 * What enrolment means on each side, kept apart at the type level.
 *
 * The APK has no key material of ours to store — the platform holds the fingerprint and
 * answers for itself — so its record is the opt-in and nothing else. Writing that shape into
 * the WebAuthn interface would leave four fields that are always absent, and a reader that
 * cannot tell "not enrolled" from "enrolled a different way".
 */
export type StoredEnrolment = EnrolledBiometric | { kind: "native"; enrolledAt: string };

/**
 * Is the OS's own biometric prompt the authenticator here?
 *
 * True inside the built app, false in every browser — and asked through the plugin itself
 * rather than assumed from the user agent, so a build that forgot to sync the plugin
 * reports "no biometrics" instead of failing at the prompt.
 */
function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BiometricAuth");
  } catch {
    return false;
  }
}

/**
 * The plugin's error codes, as values rather than as an enum import.
 *
 * `` `${BiometryErrorType}` `` is the union of the enum's own values, so these strings are
 * still checked against the package at compile time — misspell one and it stops building.
 * What it avoids is needing the package at runtime just to compare two strings.
 */
type NativeErrorCode = `${BiometryErrorType}`;

/** Dismissals. A person who closed the prompt has not failed to be recognised. */
const NATIVE_CANCELLED: ReadonlySet<NativeErrorCode> = new Set([
  "userCancel",
  "systemCancel",
  "appCancel",
  "userFallback",
]);

/** The device cannot do this at all — as opposed to the person getting it wrong. */
const NATIVE_UNAVAILABLE: ReadonlySet<NativeErrorCode> = new Set([
  "biometryNotAvailable",
  "biometryNotEnrolled",
  "passcodeNotSet",
  "noDeviceCredential",
  "notInteractive",
]);

/**
 * The APK's authenticator, mapped onto the same three answers as the WebAuthn one.
 *
 * The distinction that matters is *cancelled* versus *failed*: someone who dismissed the
 * prompt must not be told their fingerprint was wrong, and someone whose finger did not match
 * must not be left thinking nothing happened.
 */
function classifyNativeFailure(err: unknown): "cancelled" | "unsupported" | "failed" {
  const raw = (err as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" ? (raw as NativeErrorCode) : null;
  if (code && NATIVE_CANCELLED.has(code)) return "cancelled";
  if (code && NATIVE_UNAVAILABLE.has(code)) return "unsupported";
  return "failed";
}

/**
 * The plugin, loaded only where it is used.
 *
 * Returns null when the module cannot be loaded at all — a build that shipped without the
 * native bridge — so every caller reports "this phone cannot do it" rather than throwing in
 * the middle of a lock screen.
 */
async function nativePlugin(): Promise<typeof import("@aparajita/capacitor-biometric-auth") | null> {
  if (!isNative()) return null;
  try {
    return await import("@aparajita/capacitor-biometric-auth");
  } catch {
    return null;
  }
}

/** The words the system prompt shows inside the app. Localized, because it is read. */
function nativePrompt() {
  return {
    reason: tNow("fingerprint.reason"),
    cancelTitle: tNow("common.cancel"),
    // Biometric only. The device passcode is not this app's fallback — the app's own PIN is,
    // and offering the phone's passcode here would quietly widen what opens the shop.
    allowDeviceCredential: false,
  } as const;
}

export type EnrolResult =
  | { status: "ok" }
  | { status: "unsupported" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type UnlockResult =
  | { status: "ok" }
  | { status: "not_enrolled" }
  | { status: "unsupported" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

// ─── base64url ────────────────────────────────────────────────────────────────────────
// WebAuthn speaks ArrayBuffers; storage speaks strings. Both directions live here so no
// caller re-implements the padding.

function toB64url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: WebCrypto and the WebAuthn
// dictionary both take a BufferSource, and a plain `Uint8Array` is typed over
// `ArrayBufferLike`, which includes SharedArrayBuffer and is therefore refused.
function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The COSE_Key CBOR reader, limited to what a public key can actually be.
 *
 * One of the two shapes a browser may use for a credential's public key — {@link COSE_EC2} for
 * the key type, the curve, and the two coordinates. Chrome sends a DER SubjectPublicKeyInfo
 * instead, so this is the branch that serves the other browsers rather than the only branch: see
 * {@link publicKeyToJwk}, which decides between them. Only integers and byte strings occur in the
 * maps this is asked to read, so the reader covers those and refuses anything else rather than
 * guessing at a shape it does not understand.
 */
function readCborMap(data: Uint8Array<ArrayBuffer>): Map<number, number | Uint8Array<ArrayBuffer>> {
  let offset = 0;

  function readLength(additional: number): number {
    if (additional < 24) return additional;
    const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 8;
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 256 + data[offset++];
    return value;
  }

  function readItem(): number | Uint8Array<ArrayBuffer> | Map<number, number | Uint8Array<ArrayBuffer>> {
    const initial = data[offset++];
    const major = initial >> 5;
    const additional = initial & 0x1f;

    if (major === 0) return readLength(additional);
    // Major 1: negative integers. The map's own keys are negative in COSE.
    if (major === 1) return -1 - readLength(additional);
    if (major === 2) {
      const length = readLength(additional);
      const bytes = data.slice(offset, offset + length);
      offset += length;
      return bytes;
    }
    if (major === 5) {
      const count = readLength(additional);
      const map = new Map<number, number | Uint8Array<ArrayBuffer>>();
      for (let i = 0; i < count; i++) {
        const key = readItem();
        const value = readItem();
        if (typeof key !== "number") throw new Error("COSE map key is not an integer");
        if (value instanceof Map) throw new Error("COSE map value is not a scalar");
        map.set(key, value);
      }
      return map;
    }
    throw new Error(`Unsupported CBOR major type ${major} in a public key`);
  }

  const parsed = readItem();
  if (!(parsed instanceof Map)) throw new Error("A public key must be a CBOR map");
  return parsed;
}

/** COSE_Key → JWK, so WebCrypto can import it. */
function coseToJwk(cose: Uint8Array<ArrayBuffer>): JsonWebKey {
  const map = readCborMap(cose);
  if (map.get(1) !== COSE_EC2) throw new Error("Only elliptic-curve public keys are supported");
  if (map.get(3) !== ES256) throw new Error("Only ES256 public keys are supported");
  if (map.get(-1) !== COSE_P256) throw new Error("Only the P-256 curve is supported");

  const x = map.get(-2);
  const y = map.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) throw new Error("Public key is missing a coordinate");

  return { kty: "EC", crv: "P-256", x: toB64url(x), y: toB64url(y), ext: true };
}

/**
 * The public key of a freshly created credential, as a JWK — in either shape a browser uses.
 *
 * This is the piece that was wrong, and it is worth recording exactly how, because the wrong
 * version was invisible: it passed its own unit test, which built the COSE map it expected.
 *
 * A real browser does not return that map. Measured in Chrome against a real authenticator,
 * `getPublicKey()` answers with 91 bytes of ASN.1:
 *
 *     30 59 30 13 06 07 2a 86 48 ce 3d 02 01 06 08 2a 86 48 ce 3d 03 01 07 03 …
 *     ^SEQUENCE  ^SEQUENCE  ^OID ecPublicKey      ^OID prime256v1        ^BIT STRING
 *
 * — a DER SubjectPublicKeyInfo, whose last 65 bytes are the uncompressed `04 || X || Y` point.
 * The reader here understood only the CBOR COSE_Key spelling, so it answered
 * "A public key must be a CBOR map" and **every enrolment in a browser failed** while looking
 * like a device that refused the finger. Inside the app this never ran, because the app uses
 * the OS prompt instead — which is why it went unnoticed for so long.
 *
 * WebCrypto imports a SubjectPublicKeyInfo directly, so the DER path needs no parser of ours at
 * all: the bytes go straight to `importKey`, and a key that is not P-256 is refused by the
 * browser rather than misread here. The COSE path stays for the browsers that do return the
 * map: which spelling arrives is a fact about the browser, not something to assume either way.
 */
export async function publicKeyToJwk(key: BufferSource): Promise<JsonWebKey> {
  // Copied onto its own ArrayBuffer first: WebCrypto and the CBOR reader are both typed over
  // `ArrayBuffer`, and a view over a SharedArrayBuffer is refused by both. Copying also makes
  // the two spelling-branches below take one type each, instead of casting at the boundary.
  const view = ArrayBuffer.isView(key)
    ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength)
    : new Uint8Array(key as ArrayBuffer);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(view);

  // 0x30 is a DER SEQUENCE and the only thing a SubjectPublicKeyInfo can start with. A CBOR
  // map starts 0xa0-0xbf, so the two shapes cannot be confused.
  if (bytes[0] !== 0x30) return coseToJwk(bytes);

  const imported = await crypto.subtle.importKey(
    "spki",
    bytes,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", imported);
  if (jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Only the P-256 curve is supported");
  }
  return jwk;
}

/**
 * WebAuthn signatures are ASN.1 DER; WebCrypto wants P-256 as two fixed-width integers.
 * Converting here rather than "letting verify fail" is what makes a real signature pass.
 */
function derToRawP256(der: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("Signature is not a DER sequence");

  let length = der[offset++];
  if (length & 0x80) {
    const width = length & 0x7f;
    length = 0;
    for (let i = 0; i < width; i++) length = length * 256 + der[offset++];
  }

  function readInteger(): Uint8Array<ArrayBuffer> {
    if (der[offset++] !== 0x02) throw new Error("Signature integer is malformed");
    const len = der[offset++];
    const bytes = der.slice(offset, offset + len);
    offset += len;
    // DER integers are signed, so a leading zero is padding, not part of the number.
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    return bytes.slice(start);
  }

  const r = readInteger();
  const s = readInteger();
  if (r.length > 32 || s.length > 32) throw new Error("Signature integer is too wide for P-256");

  const raw = new Uint8Array(64);
  // Each integer is padded to its own 32 bytes and placed by its OWN length. Reading
  // `r.length` here instead of `s.length` looks symmetrical and is wrong: it happened to
  // work for the common case, because a random 32-byte integer rarely begins with a zero
  // byte, and then shifted the whole second half of the signature whenever it did — so
  // roughly one unlock in 256 would have refused a correct finger. Caught by the boundary
  // test in `tests/unit/biometric.test.ts`.
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

// ─── Availability ─────────────────────────────────────────────────────────────────────

/**
 * Is there an authenticator to ask at all?
 *
 * Inside the app this is true as soon as the plugin is there — whether a finger is actually
 * enrolled is a separate, asynchronous question ({@link biometricPlatformAvailable}), and
 * conflating the two is how a device with no fingerprint ends up drawing a fingerprint
 * button.
 */
export function biometricSupported(): boolean {
  if (isNative()) return true;
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

/**
 * Why this phone cannot offer a fingerprint — the answer the device gives, not a guess.
 *
 * The row used to say one thing for every cause ("This phone cannot use a fingerprint"), so a
 * phone whose owner uses fingerprints in every other app was told it had none, with nothing to
 * act on. The three real causes are fixed in three different places:
 *
 *   no_plugin      — this build shipped without the native bridge. It is not the phone's fault
 *                    and no setting will change it: the app has to be updated. That is worth
 *                    saying out loud, because it is exactly what an older sideloaded APK does.
 *   no_enrolment   — the sensor is there and the phone is unlocked, but no finger is registered.
 *                    Fixed in the phone's own settings, in a minute.
 *   no_screen_lock — biometrics need a device credential behind them; a phone with no PIN or
 *                    pattern cannot use them at all.
 *   no_sensor      — the hardware is not there. Nothing to do.
 */
export type BiometricReason =
  | "no_plugin"
  | "no_sensor"
  | "no_enrolment"
  | "no_screen_lock"
  | "no_domain_origin"
  | "unknown";

/**
 * The sentence that goes under the row for each cause, as dictionary keys.
 *
 * A map rather than an interpolated key, so a new reason cannot be added without a screen deciding
 * what it says — and so `i18nParity` proves both languages carry every one of them.
 */
export const BIOMETRIC_REASON_KEY: Record<BiometricReason, string> = {
  no_plugin: "settings.fingerprint.why.noPlugin",
  no_sensor: "settings.fingerprint.why.noSensor",
  no_enrolment: "settings.fingerprint.why.noEnrolment",
  no_screen_lock: "settings.fingerprint.why.noScreenLock",
  no_domain_origin: "settings.fingerprint.why.noDomainOrigin",
  unknown: "settings.fingerprint.why.unknown",
};

/**
 * Can the address this page was opened at host a fingerprint at all?
 *
 * WebAuthn names a credential by its *relying party ID*, and the spec requires that to be a
 * registrable domain. An IP literal is an address, not a domain, so Chrome refuses the whole
 * ceremony on an origin like `http://127.0.0.1:5174` — before any authenticator is consulted —
 * with `SecurityError: This is an invalid domain`. Passing no `rp.id` does not rescue it: the
 * browser then falls back to the same origin's effective domain, which is the same IP.
 *
 * This was measured, not assumed, on a real browser:
 *
 *     http://127.0.0.1:5174  →  SecurityError: This is an invalid domain.
 *     http://localhost:5174  →  credential created, public key returned
 *
 * It matters because it is the one cause of "the fingerprint does not work" that no phone
 * setting and no rebuild can fix, so it is named rather than folded in with the hardware
 * causes. Opening the app by name — `localhost` in development, the installed app's own
 * `https://localhost`, or the product's domain — is the whole remedy.
 */
export function originCanHostFingerprint(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.replace(/\.$/, "");
  if (!host) return false;
  // `localhost` is the one hostname WebAuthn accepts without a dot, and it is what the
  // installed app serves itself from, so it must keep working.
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // An IPv6 literal always carries a colon; an IPv4 one is four dotted octets.
  if (host.includes(":")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  // Anything else has to be a real domain name, and a name without a dot is not one.
  return host.includes(".");
}

/**
 * Whether biometrics can be used here, and — when they cannot — which of the causes above it is.
 *
 * `null` means it can be used. Anything else is the reason, read from the plugin's own report
 * (`isAvailable`, `biometryTypes`, `deviceIsSecure`, `reason`) rather than inferred.
 */
export async function biometricUnavailableReason(): Promise<BiometricReason | null> {
  const native = isNative();
  const plugin = await nativePlugin();

  // Native, but the bridge is missing from the build. Distinguished from "no sensor" on purpose:
  // this one is fixed by updating the app, and saying "your phone cannot do it" would be a lie.
  if (native && !plugin) return "no_plugin";

  if (plugin) {
    try {
      const result = await plugin.BiometricAuth.checkBiometry();
      if (result.isAvailable === true) return null;
      const types = result.biometryTypes ?? [];
      const sensorPresent = types.length > 0 || Number(result.biometryType) > 0;
      if (!sensorPresent) return "no_sensor";
      if (result.deviceIsSecure === false) return "no_screen_lock";
      // A sensor, a screen lock, and still nothing usable: nothing is enrolled.
      if (result.strongBiometryIsAvailable === false) return "no_enrolment";
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  if (native) return "no_plugin";
  // Asked before the availability question, and before the hardware is blamed: a browser
  // happily answers "yes, this machine has a fingerprint reader" for an origin that cannot
  // use one, so the hardware would be reported as present while every enrolment fails.
  if (!originCanHostFingerprint()) return "no_domain_origin";
  if (!biometricSupported()) return "unknown";
  try {
    const available = await (
      window as unknown as { PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> } }
    ).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available === true ? null : "no_enrolment";
  } catch {
    return "unknown";
  }
}

/** Is there a finger or a face on this device to check? */
export async function biometricPlatformAvailable(): Promise<boolean> {
  return (await biometricUnavailableReason()) === null;
}

// ─── Enrolment ────────────────────────────────────────────────────────────────────────

export function hasBiometricEnrolment(userId: string): boolean {
  return secureHas(ENROL_KEY(userId));
}

export async function getBiometricEnrolment(userId: string): Promise<StoredEnrolment | null> {
  try {
    const raw = await secureGet(ENROL_KEY(userId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredEnrolment;
  } catch {
    // A record that cannot be read is a record that cannot be trusted; the PIN still works.
    return null;
  }
}

/** Turn a WebAuthn failure into something the screen can say. */
function classifyFailure(err: unknown): "cancelled" | "unsupported" | "failed" {
  const name = (err as { name?: string } | null)?.name ?? "";
  // NotAllowedError covers both "the person dismissed the prompt" and "the finger did not
  // match" — indistinguishable to the relying party by design, so they share an answer.
  if (name === "NotAllowedError" || name === "AbortError") return "cancelled";
  if (name === "NotSupportedError" || name === "SecurityError") return "unsupported";
  return "failed";
}

/**
 * Enrol this device's finger for one account.
 *
 * `userVerification: "required"` is not decoration: without it the assertion may come back
 * with the user-verified flag clear, and a lock screen that accepts "present" is a lock
 * screen that accepts a phone being held.
 */
export async function enrolBiometric(
  userId: string,
  displayName: string,
): Promise<EnrolResult> {
  if (!(await biometricPlatformAvailable())) return { status: "unsupported" };

  // The app's path: prove the finger works once, then remember only that the choice was
  // made. There is no key to keep — the OS holds the biometric and the APK holds nothing
  // that could be replayed from a file.
  const plugin = await nativePlugin();
  if (plugin) {
    try {
      await plugin.BiometricAuth.authenticate(nativePrompt());
      await secureSet(
        ENROL_KEY(userId),
        JSON.stringify({ kind: "native", enrolledAt: new Date().toISOString() }),
      );
      return { status: "ok" };
    } catch (err) {
      const kind = classifyNativeFailure(err);
      if (kind === "cancelled") return { status: "cancelled" };
      if (kind === "unsupported") return { status: "unsupported" };
      return { status: "failed", message: err instanceof Error ? err.message : "Enrolment failed" };
    }
  }

  const rpId = window.location.hostname;
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES)),
        rp: { name: RP_NAME, id: rpId },
        // The handle is the account's own id, so an assertion can only ever be for this
        // account and not for "whoever last enrolled on this phone".
        user: {
          id: new TextEncoder().encode(userId),
          name: displayName,
          displayName,
        },
        pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
        },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) return { status: "cancelled" };

    const response = credential.response as AuthenticatorAttestationResponse;
    const cose = response.getPublicKey?.();
    if (!cose) return { status: "failed", message: "The device did not return a public key" };

    const enrolment: EnrolledBiometric = {
      credentialId: toB64url(credential.rawId),
      publicKeyJwk: await publicKeyToJwk(cose),
      rpId,
      signCount: 0,
      enrolledAt: new Date().toISOString(),
    };

    await secureSet(ENROL_KEY(userId), JSON.stringify(enrolment));
    return { status: "ok" };
  } catch (err) {
    const kind = classifyFailure(err);
    if (kind === "cancelled") return { status: "cancelled" };
    if (kind === "unsupported") return { status: "unsupported" };
    return { status: "failed", message: err instanceof Error ? err.message : "Enrolment failed" };
  }
}

export function removeBiometric(userId: string): void {
  secureRemove(ENROL_KEY(userId));
}

// ─── Unlock ───────────────────────────────────────────────────────────────────────────

/**
 * Ask for the finger and check the answer.
 *
 * Every step that can disagree does disagree out loud — a wrong origin, a missing
 * user-verified flag, a signature that does not verify — because the only alternative is a
 * lock screen that opens for anything that looks like an answer.
 */
export async function unlockWithBiometric(userId: string): Promise<UnlockResult> {
  const enrolment = await getBiometricEnrolment(userId);
  if (!enrolment) return { status: "not_enrolled" };
  if (!biometricSupported()) return { status: "unsupported" };

  // Inside the app the OS does the checking, so there is nothing to verify here: a resolved
  // prompt means the platform matched the enrolled finger, and its answer is not ours to
  // second-guess. The local record is only the person's own opt-in.
  const plugin = await nativePlugin();
  if (plugin) {
    try {
      await plugin.BiometricAuth.authenticate(nativePrompt());
      return { status: "ok" };
    } catch (err) {
      const kind = classifyNativeFailure(err);
      if (kind === "cancelled") return { status: "cancelled" };
      if (kind === "unsupported") return { status: "unsupported" };
      return { status: "failed", message: err instanceof Error ? err.message : "Unlock failed" };
    }
  }

  // A record written by the APK cannot be checked here: there is no public key in it, by
  // design. That happens when the same account is opened in a browser on a phone whose app
  // enrolled first, and the honest answer is "not usable here" rather than a crash.
  if (!("publicKeyJwk" in enrolment)) return { status: "failed", message: "Enrolment was made in the app" };

  const challenge = crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: fromB64url(enrolment.credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    const kind = classifyFailure(err);
    if (kind === "cancelled") return { status: "cancelled" };
    if (kind === "unsupported") return { status: "unsupported" };
    return { status: "failed", message: err instanceof Error ? err.message : "Unlock failed" };
  }

  if (!assertion) return { status: "cancelled" };
  // The credential must be the one this device enrolled; an authenticator is allowed to
  // answer with a different one only if we let it, and we did not.
  if (toB64url(assertion.rawId) !== enrolment.credentialId) {
    return { status: "failed", message: "A different credential answered" };
  }

  try {
    const response = assertion.response as AuthenticatorAssertionResponse;
    const clientData = JSON.parse(new TextDecoder().decode(response.clientDataJSON)) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };

    if (clientData.type !== "webauthn.get") return { status: "failed", message: "Wrong ceremony" };
    if (clientData.challenge !== toB64url(challenge)) return { status: "failed", message: "Challenge mismatch" };
    if (clientData.origin !== window.location.origin) return { status: "failed", message: "Origin mismatch" };

    const authData = new Uint8Array(response.authenticatorData);
    if (authData.length < 37) return { status: "failed", message: "Authenticator data too short" };

    const expectedRpIdHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(window.location.hostname)),
    );
    const rpIdHash = authData.slice(0, 32);
    if (!rpIdHash.every((byte, i) => byte === expectedRpIdHash[i])) {
      return { status: "failed", message: "RP ID mismatch" };
    }

    const flags = authData[32];
    if (!(flags & UP_FLAG)) return { status: "failed", message: "User was not present" };
    // The one flag that makes this a lock rather than a door.
    if (!(flags & UV_FLAG)) return { status: "failed", message: "User was not verified" };

    let signCount = 0;
    for (let i = 33; i < 37; i++) signCount = signCount * 256 + authData[i];
    // Authenticators that do not keep a counter always report zero; when one does keep a
    // counter, a value that has not moved is a replay of an older assertion.
    if (signCount !== 0 && signCount <= enrolment.signCount) {
      return { status: "failed", message: "Signature counter went backwards" };
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      enrolment.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", response.clientDataJSON));
    const signed = new Uint8Array(authData.length + clientDataHash.length);
    signed.set(authData, 0);
    signed.set(clientDataHash, authData.length);

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRawP256(new Uint8Array(response.signature)),
      signed,
    );
    if (!valid) return { status: "failed", message: "Signature did not verify" };

    await secureSet(ENROL_KEY(userId), JSON.stringify({ ...enrolment, signCount }));
    return { status: "ok" };
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : "Verification failed" };
  }
}

/** Exposed for the unit tests, which drive it with a locally generated key pair. */
export const __testing = { readCborMap, coseToJwk, publicKeyToJwk, derToRawP256, toB64url, fromB64url, originCanHostFingerprint };
