import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/biometric";

/**
 * What this file is for.
 *
 * Fingerprint unlock is verified **locally**: the assertion the phone returns is checked
 * here with WebCrypto rather than trusted because it arrived. Two pieces of that are easy
 * to get subtly wrong and impossible to notice by reading —
 *
 *   1. the COSE_Key a WebAuthn public key arrives as has to be turned into a JWK, and
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

const { readCborMap, coseToJwk, derToRawP256, toB64url, fromB64url } = __testing;

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
