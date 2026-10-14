import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which phones can use a fingerprint, and what every other phone is told.
 *
 * The plugin-name bug that made the installed app claim "This phone cannot use a fingerprint" on
 * every Android phone, including one with a finger enrolled, was invisible to the unit suite: the
 * only biometry test here checked that each *reason* had a sentence, never that the right reason
 * was reached. A verdict is decided from the device's own report, so the matrix is the thing worth
 * driving — one row per kind of phone in the field:
 *
 *   · Android 6-8 (API 23-27), fingerprint enrolled, screen lock set   → usable
 *   · Android 9/10 where only weak biometry (face) may be used by apps → usable (the prompt asks
 *     for `weak`, so a phone without fingerprint but with face is not turned away)
 *   · no biometric hardware at all                                     → no_sensor
 *   · hardware present, nothing registered on it                        → no_enrolment
 *   · hardware present, no PIN/pattern behind it                        → no_screen_lock
 *   · an older sideloaded APK with no native bridge in it                → no_plugin
 *
 * `minSdkVersion = 23` in `android/variables.gradle` matches the plugin's own, so API 23 is the
 * floor this matrix has to hold down to; `aapt2 dump permissions` on the release APK shows both
 * `USE_BIOMETRIC` (28+) and `USE_FINGERPRINT` (23-27) merged in, which is what the 23-27 row needs.
 *
 * The last two cases matter as much as the first: a row may not crash, and it may not blame the
 * phone for a missing bridge. Both were real — one on a Sparx Neo 7 Ultra (Android 12, one finger
 * enrolled) where the row read `native=false plugin=no`, one on OEM builds that throw instead of
 * answering.
 */

/** The device's own answer, held where the mocked bridge can read it. */
const standby = vi.hoisted(() => ({
  answer: {} as Record<string, unknown>,
  throws: false,
}));

// The bridge is mocked rather than imported: the package ships an ESM build whose imports carry
// no file extension, which is why `src/lib/biometric.ts` loads it lazily. Mocking keeps the
// verdict logic — the part that decides what a person reads — under test in Node.
vi.mock("@aparajita/capacitor-biometric-auth", () => ({
  BiometricAuth: {
    checkBiometry: async () => {
      if (standby.throws) throw new Error("SecurityException: permission denied");
      return standby.answer;
    },
    authenticate: async () => undefined,
  },
}));

import { Capacitor } from "@capacitor/core";
import {
  BIOMETRIC_REASON_KEY,
  biometricPlatformAvailable,
  biometricUnavailableReason,
} from "@/lib/biometric";
import { translations } from "@/lib/i18n";

/**
 * Be the installed app, and say whether the native bridge made it into this build.
 *
 * `Capacitor.isNativePlatform()` is false under Node, so without this every case would take the
 * browser path — which is exactly how the shipped bug hid.
 */
function beTheApp(bridgeInBuild: boolean): void {
  const patched = Capacitor as unknown as Record<string, unknown>;
  patched.isNativePlatform = () => true;
  patched.isPluginAvailable = () => bridgeInBuild;
}

/** Return what the plugin returns, field for field. */
function deviceReports(report: Record<string, unknown>): void {
  standby.throws = false;
  standby.answer = report;
}

const PHONES: ReadonlyArray<{ what: string; report: Record<string, unknown>; verdict: string | null }> = [
  {
    what: "an Android 6-8 phone with a fingerprint enrolled",
    report: {
      isAvailable: true,
      strongBiometryIsAvailable: true,
      biometryTypes: [1],
      biometryType: 1,
      deviceIsSecure: true,
      reason: "",
    },
    verdict: null,
  },
  {
    what: "an Android 9/10 phone where only weak biometry (face) is usable by apps",
    report: {
      isAvailable: true,
      strongBiometryIsAvailable: false,
      biometryTypes: [2],
      biometryType: 2,
      deviceIsSecure: true,
      reason: "",
    },
    verdict: null,
  },
  {
    what: "a phone with no biometric hardware at all",
    report: {
      isAvailable: false,
      strongBiometryIsAvailable: false,
      biometryTypes: [],
      biometryType: 0,
      deviceIsSecure: true,
      reason: "No biometric hardware",
    },
    verdict: "no_sensor",
  },
  {
    what: "a phone whose sensor exists but has nothing registered on it",
    report: {
      isAvailable: false,
      strongBiometryIsAvailable: false,
      biometryTypes: [1],
      biometryType: 1,
      deviceIsSecure: true,
      reason: "No fingerprints enrolled",
    },
    verdict: "no_enrolment",
  },
  {
    what: "a phone with a sensor and no screen lock behind it",
    report: {
      isAvailable: false,
      strongBiometryIsAvailable: false,
      biometryTypes: [1],
      biometryType: 1,
      deviceIsSecure: false,
      reason: "No device credential",
    },
    verdict: "no_screen_lock",
  },
];

beforeEach(() => {
  standby.throws = false;
  standby.answer = {};
  beTheApp(true);
});

afterEach(() => {
  const patched = Capacitor as unknown as Record<string, unknown>;
  delete patched.isNativePlatform;
  delete patched.isPluginAvailable;
});

describe("biometric — the verdict for every kind of phone in the field", () => {
  for (const { what, report, verdict } of PHONES) {
    it(`reads ${what} correctly`, async () => {
      deviceReports(report);
      const reason = await biometricUnavailableReason();
      expect(reason).toBe(verdict);
      // The same question the Settings row and the PIN screens ask before offering a
      // fingerprint. A verdict of "usable" that this answered false would draw a row nobody
      // can use; the other way round it would hide the feature from a phone that has it.
      expect(await biometricPlatformAvailable()).toBe(verdict === null);
    });
  }

  it("tells a build that lost the native bridge to update, and does not blame the phone", async () => {
    // This is the shipped bug, kept as a case: the same phone, the same enrolled finger, and the
    // only difference is a plugin name that the build does not answer to.
    const samePhone = PHONES[1].report;

    beTheApp(false);
    deviceReports(samePhone);
    expect(await biometricUnavailableReason()).toBe("no_plugin");

    beTheApp(true);
    deviceReports(samePhone);
    expect(await biometricUnavailableReason()).toBeNull();
  });

  it("survives a device that throws instead of answering, and still says something true", async () => {
    // Some OEM builds raise a SecurityException from `checkBiometry()` (a stripped permission, an
    // old WebView). A row that propagated it would blank the screen the person is reading.
    standby.throws = true;
    expect(await biometricUnavailableReason()).toBe("unknown");
    expect(await biometricPlatformAvailable()).toBe(false);
  });

  it("still finds the sensor on a plugin that reports only the older single-type field", async () => {
    // `biometryType` is the pre-`biometryTypes` spelling. Reading only the array would report
    // "this phone has no sensor" on a phone that has one.
    deviceReports({
      isAvailable: false,
      strongBiometryIsAvailable: false,
      biometryType: 1,
      deviceIsSecure: true,
      reason: "No fingerprints enrolled",
    });
    expect(await biometricUnavailableReason()).toBe("no_enrolment");
  });

  it("has a sentence in both languages for every verdict it can reach", async () => {
    const en = translations.en as unknown as Record<string, string>;
    const ur = translations.ur as unknown as Record<string, string>;
    const reachable = new Set<string>([...PHONES.map((p) => p.verdict), "no_plugin", "unknown"]);
    for (const verdict of reachable) {
      if (verdict === null) continue;
      const key = BIOMETRIC_REASON_KEY[verdict as keyof typeof BIOMETRIC_REASON_KEY];
      expect(key, `no dictionary key for ${verdict}`).toBeTruthy();
      expect(en[key], `en is missing ${verdict} (${key})`).toBeTruthy();
      expect(ur[key], `ur is missing ${verdict} (${key})`).toBeTruthy();
    }
  });
});
