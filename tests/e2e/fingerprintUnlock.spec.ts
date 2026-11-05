import { expect, test } from './base';
import type { Page } from "@playwright/test";

/**
 * Fingerprint unlock, against a real browser and a real authenticator.
 *
 * Why this lane exists rather than more unit tests. `tests/unit/biometric.test.ts` already
 * drives the two pieces that are easy to get subtly wrong — the COSE_Key a device returns and
 * the DER signature a device signs with — but it drives them as *functions*. Nothing in it can
 * tell you whether the ceremony the app actually performs is one a browser will honour: the RP
 * ID it names, the user-verification flag it demands, the credential it allows, the counter it
 * stores back. Every one of those is decided by the browser, and every one of them fails
 * closed — silently, with nothing to unlock.
 *
 * A CDP virtual authenticator makes that testable without a phone and without a real biometric
 * prompt: it is a CTAP2 authenticator that signs with a real P-256 key, so the app's own
 * verification runs for real, and it counts its signatures like hardware does.
 *
 * The lane is deliberately module-level for the unlock itself (the app's own source, loaded
 * through the dev server, with no backend involved) and UI-level for the wiring (the mark, the
 * sheet, and which credential the tap actually asks for). What it does NOT claim is that the
 * whole journey reaches a dashboard — that depends on the sign-in session, which is not what
 * "does the fingerprint work" means.
 */

/** A CTAP2 authenticator with a real key: internal transport, so the app sees a platform one. */
async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: false,
      hasUserVerification: true,
      // The fingerprint matches. What is under test is the app, not the sensor.
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** The app's own module, through the dev server — not a copy of its logic. */
const MODULE = "/src/lib/biometric.ts";

// The server under test is this repository's QA server, on whichever port it runs (5173 may be held
// by another project on this machine). `npm run preflight` and playwright.config.ts read the same
// variable. Read as a fallback only, so a spec can never navigate somewhere the identity guard did
// not verify.
const BASE_URL = process.env.QA_APP_URL || "http://localhost:5173";

/**
 * The same server, addressed by IP literal — the case the test below exists for: WebAuthn treats an
 * IP literal as an insecure origin, so the app must say so instead of offering a fingerprint mark
 * that could never work. Built from the configured base URL, never from a fixed port.
 */
const IP_ORIGIN = BASE_URL.replace(/\/\/[^/:]+/, "//127.0.0.1");

const USER_ID = "e2e-fingerprint-user";

test.describe("fingerprint unlock", () => {
  test("the browser ceremony the app performs is one a real authenticator answers", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await page.goto("/");

    const result = await page.evaluate(async (userId) => {
      const bio = await import("/src/lib/biometric.ts");
      bio.removeBiometric(userId);
      const before = await bio.getBiometricEnrolment(userId);
      const enrol = await bio.enrolBiometric(userId, "E2E Owner");
      const stored = await bio.getBiometricEnrolment(userId);
      const first = await bio.unlockWithBiometric(userId);
      const second = await bio.unlockWithBiometric(userId);
      return {
        before,
        enrol,
        kind: stored && "kind" in stored ? stored.kind : stored ? "webauthn" : null,
        hasPublicKey: !!stored && "publicKeyJwk" in stored,
        signCount: stored && "signCount" in stored ? stored.signCount : null,
        first,
        second,
        reason: await bio.biometricUnavailableReason(),
        supported: bio.biometricSupported(),
      };
    }, USER_ID);

    // Nothing enrolled to begin with, and a browser that can do this at all.
    expect(result.before).toBeNull();
    expect(result.supported).toBe(true);
    expect(result.reason).toBeNull();

    // Enrolment records the key material this app must hold to check an assertion later —
    // the whole difference between verifying and trusting.
    expect(result.enrol).toEqual({ status: "ok" });
    expect(result.kind).toBe("webauthn");
    expect(result.hasPublicKey).toBe(true);

    // The signature a real authenticator produced verified against that key...
    expect(result.first).toEqual({ status: "ok" });
    // ...and a second unlock still works, which is the counter rule: hardware that counts
    // its signatures must not be refused for having moved forward.
    expect(result.second).toEqual({ status: "ok" });
    // A soft authenticator keeps no counter and reports zero, which is a value the rule has
    // to tolerate rather than read as a replay. Hardware that *does* count, and the "counter
    // went backwards" refusal it enables, is covered against a real signature in
    // tests/unit/biometric.test.ts.
    expect(result.signCount).toBe(0);
  });

  test("a tampered public key is refused rather than trusted", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await page.goto("/");

    const outcome = await page.evaluate(async (userId) => {
      const bio = await import("/src/lib/biometric.ts");
      bio.removeBiometric(userId);
      await bio.enrolBiometric(userId, "E2E Owner");

      // Hand the app an assertion that is real in every way except its signature: same
      // credential, same authenticator data, same client data, one byte of the signature
      // changed. The device did sign — it signed something else. Whether that is *checked* is
      // the question, and the only wrong answer is "ok".
      const original = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.get = (async (options?: CredentialRequestOptions) => {
        const assertion = (await original(options)) as PublicKeyCredential;
        const signature = new Uint8Array(assertion.response.signature as ArrayBuffer);
        signature[10] ^= 0xff;
        return {
          rawId: assertion.rawId,
          response: {
            clientDataJSON: (assertion.response as AuthenticatorAssertionResponse).clientDataJSON,
            authenticatorData: (assertion.response as AuthenticatorAssertionResponse).authenticatorData,
            signature: signature.buffer,
          },
        };
      }) as typeof navigator.credentials.get;

      const outcome = await bio.unlockWithBiometric(userId);
      navigator.credentials.get = original;
      return outcome;
    }, USER_ID);

    expect(outcome.status).toBe("failed");
    expect(String((outcome as { message?: string }).message)).toMatch(/signature|key/i);
  });

  test("an address that cannot host a fingerprint says so, instead of blaming the phone", async ({ page }) => {
    // The preview used to be opened at an IP literal, where WebAuthn refuses the ceremony
    // before any authenticator is consulted ("SecurityError: This is an invalid domain").
    // The old answer to that was a row offering a fingerprint that could never work.
    await addVirtualAuthenticator(page);
    await page.goto(`${IP_ORIGIN}/`);

    const onAddress = await page.evaluate(async () => {
      const bio = await import("/src/lib/biometric.ts");
      return {
        origin: location.origin,
        hostname: location.hostname,
        // The browser still claims a platform authenticator exists here — which is exactly
        // why the hardware must not be what gets blamed.
        uvp: await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
        reason: await bio.biometricUnavailableReason(),
        available: await bio.biometricPlatformAvailable(),
      };
    });

    expect(onAddress.hostname).toBe("127.0.0.1");
    expect(onAddress.uvp).toBe(true);
    expect(onAddress.reason).toBe("no_domain_origin");
    expect(onAddress.available).toBe(false);
  });

  test("the mark on the PIN screen asks the real authenticator for the enrolled credential", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await page.goto("/");

    // Enrol on this origin, for the account the screen is about to be told is signed in.
    const enrolled = await page.evaluate(async (userId) => {
      const bio = await import("/src/lib/biometric.ts");
      bio.removeBiometric(userId);
      const enrol = await bio.enrolBiometric(userId, "E2E Owner");
      const stored = await bio.getBiometricEnrolment(userId);
      return { enrol, credentialId: stored && "credentialId" in stored ? stored.credentialId : null };
    }, USER_ID);
    expect(enrolled.enrol).toEqual({ status: "ok" });
    expect(enrolled.credentialId).toBeTruthy();

    await page.addInitScript(
      ({ userId }) => {
        localStorage.setItem(
          "agri_auth",
          JSON.stringify({
            state: {
              user: {
                id: userId,
                name: "E2E Owner",
                phone: "923019800009",
                role: "admin",
                isOriginalOwner: true,
                isActive: true,
                tenantId: "00000000-0000-0000-0000-00000000e2e2",
                membershipRole: "owner",
                membershipStatus: "active",
                firstLoginAt: "2026-10-04T00:00:00Z",
              },
            },
            version: 0,
          }),
        );
        localStorage.setItem("agrishop-theme", JSON.stringify({ state: { language: "en", theme: "light" }, version: 0 }));
      },
      { userId: USER_ID },
    );

    // Watch which credential the app asks for. The real call still happens — this observes
    // the argument rather than replacing the ceremony, so nothing is passed by a stub.
    await page.addInitScript(() => {
      (window as unknown as { __asked: string[] }).__asked = [];
      const original = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.get = ((options?: CredentialRequestOptions) => {
        const id = options?.publicKey?.allowCredentials?.[0]?.id;
        // Recorded as raw bytes, in hex: the app stores base64url and a browser hands back
        // whatever BufferSource it likes, and comparing encodings compares the wrong thing.
        const bytes = !id
          ? new Uint8Array()
          : id instanceof ArrayBuffer
            ? new Uint8Array(id)
            : new Uint8Array((id as ArrayBufferView).buffer, (id as ArrayBufferView).byteOffset, (id as ArrayBufferView).byteLength);
        (window as unknown as { __asked: string[] }).__asked.push(
          [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        );
        return original(options);
      }) as typeof navigator.credentials.get;
    });

    await page.goto("/login/pin");

    // The mark is drawn because this account has a finger on this phone, and nothing else,
    // and the ask arrives as a sheet the screen controls — with the way out beside it.
    const sheet = page.getByTestId("fingerprint-sheet");
    await expect(sheet).toBeVisible();
    const mark = page.getByTestId("use-fingerprint");
    await expect(mark).toBeVisible();
    const usePin = page.getByTestId("fingerprint-use-pin");
    await expect(usePin).toBeEnabled();

    // Dismissing it costs nothing and changes nothing: the keypad is untouched underneath.
    await usePin.click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toHaveLength(0);

    // One tap on the mark is both the gesture WebAuthn needs and the intention.
    await mark.click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __asked: string[] }).__asked.length), {
        message: "the tap never reached the authenticator",
      })
      .toBe(1);

    const asked = await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
    // The credential it asked for is the one this device enrolled, byte for byte, so an
    // unrelated credential on the same phone can never answer for this account.
    const enrolledHex = Buffer.from(enrolled.credentialId!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("hex");
    expect(asked[0]).toBe(enrolledHex);
  });

  test("an account with no finger enrolled is never offered one", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await page.goto("/");
    await page.evaluate(async (userId) => {
      const bio = await import("/src/lib/biometric.ts");
      bio.removeBiometric(userId);
    }, USER_ID);

    await page.addInitScript(
      ({ userId }) => {
        localStorage.setItem(
          "agri_auth",
          JSON.stringify({
            state: {
              user: {
                id: userId,
                name: "E2E Owner",
                phone: "923019800009",
                role: "admin",
                isOriginalOwner: true,
                isActive: true,
                tenantId: "00000000-0000-0000-0000-00000000e2e2",
                membershipRole: "owner",
                membershipStatus: "active",
                firstLoginAt: "2026-10-04T00:00:00Z",
              },
            },
            version: 0,
          }),
        );
      },
      { userId: USER_ID },
    );

    await page.goto("/login/pin");
    await expect(page.getByTestId("fingerprint-sheet")).toHaveCount(0);
    await expect(page.getByTestId("use-fingerprint")).toHaveCount(0);
  });
});
