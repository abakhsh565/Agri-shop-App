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
 * Android WebView — what Capacitor renders the APK in — has no `PublicKeyCredential` at
 * all, so this works in a browser and on Android Chrome, and simply reports itself
 * unavailable inside the APK. That is why `biometricSupported()` is a feature test rather
 * than an assumption, and why the whole feature has to stay behind one interface: the
 * native bridge for the APK is a drop-in replacement for this file, not a second code path
 * scattered through the screens.
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

export interface EnrolledBiometric {
  /** base64url of the credential's raw id. */
  credentialId: string;
  /** The captured public key, as a JWK so it survives JSON storage. */
  publicKeyJwk: JsonWebKey;
  rpId: string;
  /** Last signature counter seen, so a replay cannot reuse an older assertion. */
  signCount: number;
  enrolledAt: string;
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
 * A WebAuthn public key arrives as a CBOR map — {@link COSE_EC2} for the key type, the
 * curve, and the two coordinates. Only integers and byte strings occur in the maps this is
 * asked to read, so the reader covers those and refuses anything else rather than guessing
 * at a shape it does not understand.
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

/** Is the API even present? False in Android WebView, which is why it is asked. */
export function biometricSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

/** Is there a finger or a face on this device to check? */
export async function biometricPlatformAvailable(): Promise<boolean> {
  if (!biometricSupported()) return false;
  try {
    const available = await (
      window as unknown as { PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> } }
    ).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available === true;
  } catch {
    return false;
  }
}

// ─── Enrolment ────────────────────────────────────────────────────────────────────────

export function hasBiometricEnrolment(userId: string): boolean {
  return secureHas(ENROL_KEY(userId));
}

export async function getBiometricEnrolment(userId: string): Promise<EnrolledBiometric | null> {
  try {
    const raw = await secureGet(ENROL_KEY(userId));
    if (!raw) return null;
    return JSON.parse(raw) as EnrolledBiometric;
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
      publicKeyJwk: coseToJwk(new Uint8Array(cose)),
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
export const __testing = { readCborMap, coseToJwk, derToRawP256, toB64url, fromB64url };
