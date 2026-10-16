import { describe, expect, it, vi } from "vitest";
import { BIOMETRIC_REASON_KEY, __testing, originCanHostFingerprint } from "@/lib/biometric";
import { translations } from "@/lib/i18n";

/**
 * What this file is for.
 *
 * Fingerprint unlock is verified **locally**: the assertion the phone returns is checked
 * here with WebCrypto rather than trusted because it arrived. Two pieces of that are easy
 * to get subtly wrong and impossible to notice by reading —
 *
 *   1. the public key a WebAuthn registration returns has to be turned into a JWK — and it
 *      arrives in **two different shapes**: Chrome sends a DER SubjectPublicKeyInfo, while the
 *      spec's other spelling is a CBOR COSE_Key map. The reader once understood only the map,
 *      which passed the test below that built a map itself, and failed on every real browser;
 *   2. WebAuthn signs with ASN.1 DER while WebCrypto verifies P-256 in raw form, so the
 *      signature must be converted before it is checked.
 *
 * Both fail *closed* (nothing unlocks) which is the safe direction, and both fail silently
 * in the sense that a screens-only check would still look fine. So they are driven here
 * against a real key pair and real WebCrypto: the last test proves a converted signature is
 * actually accepted, and that a signature over different bytes is not.
 *
 * The tempting shortcut — call `credentials.get()` and treat a return value as success — is
 * exactly what these tests make unnecessary.
 */

const { readCborMap, coseToJwk, publicKeyToJwk, derToRawP256, toB64url, fromB64url } = __testing;

/** Run the origin rule as if the page had been opened at this host. */
function originAt(hostname: string): boolean {
  vi.stubGlobal("window", { location: { hostname } });
  try {
    return originCanHostFingerprint();
  } finally {
    vi.unstubAllGlobals();
  }
}

const subtle = globalThis.crypto.subtle;

// ─── Real P-256 material, generated per run ───────────────────────────────────────────
async function makeKeyPair() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk };
}

/** Raw r||s → the ASN.1 DER an authenticator actually sends. */
function rawToDer(raw: Uint8Array): Uint8Array {
  function encodeInteger(bytes: Uint8Array): number[] {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let trimmed = bytes.slice(start);
    // DER integers are signed: a high bit needs a leading zero.
    if (trimmed[0] & 0x80) trimmed = new Uint8Array([0, ...trimmed]);
    return [0x02, trimmed.length, ...trimmed];
  }
  const r = encodeInteger(raw.slice(0, 32));
  const s = encodeInteger(raw.slice(32, 64));
  const body = [...r, ...s];
  return new Uint8Array([0x30, body.length, ...body]);
}

/** The COSE_Key CBOR map a WebAuthn registration returns, built from a real public key. */
function coseFromJwk(jwk: JsonWebKey): Uint8Array {
  const x = fromB64url(jwk.x!);
  const y = fromB64url(jwk.y!);
  // {1: 2, 3: -7, -1: 1, -2: h'..x.., -3: h'..y..'} — five pairs, all short form.
  const bytes: number[] = [
    0xa5, // map of 5
    0x01, 0x02, // 1: 2  (kty EC2)
    0x03, 0x26, // 3: -7 (alg ES256, negative int major 1, value 6)
    0x20, 0x01, // -1: 1 (crv P-256)
    0x21, 0x58, 0x20, ...x, // -2: bytes(32)
    0x22, 0x58, 0x20, ...y, // -3: bytes(32)
  ];
  return new Uint8Array(bytes);
}

describe("biometric — base64url", () => {
  it("round-trips every byte value, including the ones that need padding", () => {
    for (const length of [1, 2, 3, 4, 16, 31, 32, 33]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 200) % 256;
      const encoded = toB64url(bytes);
      // URL-safe alphabet only: a "+" or "/" in a credential id breaks it in a URL.
      expect(encoded).not.toMatch(/[+/=]/);
      expect(Array.from(fromB64url(encoded))).toEqual(Array.from(bytes));
    }
  });
});

describe("biometric — reading the public key a device returns", () => {
  it("turns the COSE_Key map into a JWK the browser can import", async () => {
    const { jwk } = await makeKeyPair();
    const parsed = coseToJwk(coseFromJwk(jwk));

    expect(parsed.kty).toBe("EC");
    expect(parsed.crv).toBe("P-256");
    expect(parsed.x).toBe(jwk.x);
    expect(parsed.y).toBe(jwk.y);

    // The real test of a parse: WebCrypto accepts the result.
    const imported = await subtle.importKey("jwk", parsed, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(imported.type).toBe("public");
  });

  it("refuses a key it does not understand instead of guessing", () => {
    // A map that is not an EC2/ES256/P-256 key must fail loudly. Reading it as if it were
    // one would produce a key that silently never verifies anything.
    const notEc2 = new Uint8Array([0xa4, 0x01, 0x01, 0x03, 0x26, 0x20, 0x01, 0x21, 0x41, 0x00, 0x22, 0x41, 0x00]);
    expect(() => coseToJwk(notEc2)).toThrow(/elliptic-curve/i);

    const wrongAlg = new Uint8Array([0xa4, 0x01, 0x02, 0x03, 0x27, 0x20, 0x01, 0x21, 0x41, 0x00, 0x22, 0x41, 0x00]);
    expect(() => coseToJwk(wrongAlg)).toThrow(/ES256/i);
  });

  it("reads a map by its own declared length rather than assuming a shape", async () => {
    const { jwk } = await makeKeyPair();
    const map = readCborMap(coseFromJwk(jwk));
    expect(map.get(1)).toBe(2);
    expect(map.get(3)).toBe(-7);
    expect(map.get(-1)).toBe(1);
    expect((map.get(-2) as Uint8Array).length).toBe(32);
  });
});

describe("biometric — the address a fingerprint can be enrolled on", () => {
  it("accepts the names WebAuthn accepts, and refuses an address", () => {
    // Measured on a real browser, not reasoned about: an IP-literal origin raises
    // `SecurityError: This is an invalid domain` before any authenticator is consulted, so
    // a row that offers a fingerprint there is offering something that cannot work. The
    // dev preview used to be opened exactly that way, which is why the feature looked
    // broken on a machine where every other app's fingerprint login works.
    expect(originAt("localhost")).toBe(true);
    expect(originAt("localhost.")).toBe(true);
    expect(originAt("app.agrishop.pk")).toBe(true);
    expect(originAt("127.0.0.1")).toBe(false);
    expect(originAt("192.168.1.20")).toBe(false);
    expect(originAt("::1")).toBe(false);
    // A single-label host is not a registrable domain either.
    expect(originAt("mybrowser")).toBe(false);
  });
});

describe("biometric — every reason it is unavailable can actually be said", () => {
  it("has a sentence in both languages for every reason", () => {
    // The type makes the map total; this makes every entry of that map *readable*. A reason
    // added without a sentence in one language would otherwise render as a blank row where
    // the device is supposed to explain itself.
    const en = translations.en as unknown as Record<string, string>;
    const ur = translations.ur as unknown as Record<string, string>;
    for (const [reason, key] of Object.entries(BIOMETRIC_REASON_KEY)) {
      expect(en[key], `en is missing ${reason} (${key})`).toBeTruthy();
      expect(ur[key], `ur is missing ${reason} (${key})`).toBeTruthy();
    }
  });
});

describe("biometric — the public key a real browser sends", () => {
  it("reads the DER SubjectPublicKeyInfo Chrome actually returns", async () => {
    // Not a hand-built fixture: this is the exact encoding `getPublicKey()` hands back, taken
    // from WebCrypto's own SPKI export of a real P-256 key.
    const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
    const expected = await subtle.exportKey("jwk", pair.publicKey);

    // The shape this test exists to pin down. A CBOR map starts 0xa0-0xbf; this starts 0x30.
    expect(spki[0]).toBe(0x30);
    expect(spki.length).toBe(91);

    const jwk = await publicKeyToJwk(spki);
    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(jwk.x).toBe(expected.x);
    expect(jwk.y).toBe(expected.y);

    // And it is a key that can actually verify.
    const imported = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(imported.type).toBe("public");
  });

  it("still reads the CBOR spelling, so a browser that sends the map is not broken", async () => {
    const { jwk } = await makeKeyPair();
    const parsed = await publicKeyToJwk(coseFromJwk(jwk));
    expect(parsed.x).toBe(jwk.x);
    expect(parsed.y).toBe(jwk.y);
  });

  it("refuses a curve it cannot use rather than importing the wrong one", async () => {
    const p384 = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await subtle.exportKey("spki", p384.publicKey));
    await expect(publicKeyToJwk(spki)).rejects.toThrow();
  });
});

describe("biometric — the signature conversion every unlock depends on", () => {
  it("round-trips a raw signature through DER and back", async () => {
    const { pair } = await makeKeyPair();
    const message = new TextEncoder().encode("authenticatorData || clientDataHash");
    for (let i = 0; i < 5; i++) {
      const raw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message));
      expect(raw.length).toBe(64);
      expect(Array.from(derToRawP256(rawToDer(raw)))).toEqual(Array.from(raw));
    }
  });

  it("accepts a real converted signature and rejects a tampered one", async () => {
    // This is the crux: if the conversion were wrong, every genuine assertion would fail
    // verification and the feature would simply never unlock for anyone.
    const { pair, jwk } = await makeKeyPair();
    const key = await subtle.importKey("jwk", coseToJwk(coseFromJwk(jwk)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

    const signed = new TextEncoder().encode("authenticator data, then the client data hash");
    const raw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed));
    const converted = derToRawP256(rawToDer(raw));

    expect(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, converted, signed)).toBe(true);

    const tampered = new TextEncoder().encode("authenticator data, then a DIFFERENT client data hash");
    expect(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, converted, tampered)).toBe(false);

    // ...and a different key cannot satisfy the stored one.
    const other = await makeKeyPair();
    const otherKey = await subtle.importKey("jwk", other.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, otherKey, converted, signed)).toBe(false);
  });

  it("left-pads to a fixed 32 bytes at the right offset", () => {
    // A raw signature whose `s` happens to start with a zero byte is one byte shorter in
    // DER. Padded to 32 and placed at 64 - 32 = 32, byte 32 comes back 0 and the value
    // lands at 33; a conversion that placed it at 32 instead would shift the whole second
    // half of the signature and never verify.
    // Written out rather than built by the round-trip helper, so this cannot pass because
    // the helper and the reader happen to share a mistake:
    //   0x30 0x43            sequence, 67 bytes
    //   0x02 0x20 0x01 0*31  integer r = 1, exactly 32 bytes
    //   0x02 0x1f 0x02 0*30  integer s = 2, only 31 bytes after the leading zero is dropped
    const der = new Uint8Array([
      0x30, 0x43,
      0x02, 0x20, 0x01, ...new Array(31).fill(0),
      0x02, 0x1f, 0x02, ...new Array(30).fill(0),
    ]);
    expect(der.length).toBe(69);
    const out = derToRawP256(der);

    expect(out.length).toBe(64);
    expect(out[0]).toBe(0x01);
    expect(out[32]).toBe(0x00);
    expect(out[33]).toBe(0x02);
    // Nothing else may be set: the padding must be zeros, not leftover bytes.
    expect([...out].filter((byte, i) => byte !== 0 && i !== 0 && i !== 33)).toEqual([]);
  });
});
