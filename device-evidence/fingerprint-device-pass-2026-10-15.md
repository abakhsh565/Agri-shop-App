# Fingerprint login — the device pass, and why it failed on every Android phone

**Date:** 2026-10-15 · **Device:** Sparx Neo 7 Ultra, Android 12 (API 31), one finger enrolled,
screen lock set · **Build under test:** release APK from the repository's own release path
(`.github/inject-permissions.cjs` → `./gradlew assembleRelease` with the release keystore — the
same steps `.github/workflows/build-apk.yml` runs), against the QA environment.

---

## 1. What was wrong

Two defects, both invisible from a screen and neither reachable by the existing unit suite.

### 1.1 The plugin was asked for by a name no build answers to

`src/lib/biometric.ts` asked for the bridge as **`BiometricAuth`**. The package registers itself as
**`BiometricAuthNative`** in both halves — `registerPlugin('BiometricAuthNative')` in its JS and
`@CapacitorPlugin(name = "BiometricAuthNative")` in its Android source.

`Capacitor.isPluginAvailable("BiometricAuth")` answers **false** for a name nobody registered, so
`isNative()` reported the installed app as a browser **on every Android phone**: `nativePlugin()`
returned null, the plugin was never called, and the row read the generic "this phone cannot use a
fingerprint" sentence. Measured on the device, verbatim from the screen:

```
This phone cannot use a fingerprint :: native=false plugin=no
```

The native class *was* in the build — `classes.dex` contains `BiometricAuthNative` — so the only
thing missing was the name the app used to ask for it.

### 1.2 The "the app needs updating" sentence could never be shown

`isNative()` folded two different questions into one boolean: *is this the installed app* and *did
the build ship the native half*. A build with no bridge therefore reported `native=false` and took
the **browser** path, whose answer is `unknown` — so `no_plugin`, the one honest sentence for a
build that has to be updated, was unreachable. The new verdict test found this on its first run.

---

## 2. What changed

| File | Change |
|---|---|
| `src/lib/biometric.ts` | `BIOMETRIC_PLUGIN_NAME = "BiometricAuthNative"`, written once and guarded; `isInstalledApp()` split out of `isNative()` so a missing bridge is reported as `no_plugin` |
| `src/pages/admin/settings/AdminSettingsPage.tsx` | the row's "unavailable" line is the reason sentence again (the temporary device diagnostic is removed); no `BIOMETRY_SNAPSHOT` |
| `tests/unit/biometricPluginName.test.ts` | reads the installed package's JS **and** Android sources and fails if the constant stops matching either |
| `tests/unit/biometricDeviceVerdict.test.ts` | the verdict matrix below |

---

## 3. Evidence

### 3.1 The verdict matrix — what every kind of phone is told

`tests/unit/biometricDeviceVerdict.test.ts`, 9 tests, all passing:

| Phone | Verdict |
|---|---|
| Android 6–8 (API 23–27), finger enrolled, screen lock set | usable |
| Android 9/10 where only weak biometry (face) may be used by apps | usable |
| no biometric hardware | `no_sensor` |
| hardware present, nothing registered | `no_enrolment` |
| hardware present, no screen lock behind it | `no_screen_lock` |
| older sideloaded APK with no native bridge | `no_plugin` |
| a plugin that throws instead of answering (OEM builds) | `unknown`, no crash |
| a plugin reporting only the older single-type field | still finds the sensor |
| every verdict | has an EN and a UR sentence |

Both guards are **non-vacuous**, proven by injecting the failure once:

* reverting the constant to `"BiometricAuth"` → `biometricPluginName` fails (2 failed / 3 passed),
  restoring it → 5 passed;
* making `strongBiometryIsAvailable === false` answer `no_sensor` → `biometricDeviceVerdict` fails
  (2 failed / 7 passed), restoring it → 9 passed;
* keeping `isNative()` folded (the shipped shape) → the `no_plugin` case fails, which is how 1.2
  was found.

### 3.2 Compatibility, from the artifacts rather than from intent

| Fact | Where it was read |
|---|---|
| `minSdkVersion 23` (Android 6.0) — identical to the plugin's own floor, so the app cannot install without its bridge | `android/variables.gradle`, `aapt2 dump badging` on the release APK |
| `USE_BIOMETRIC` **and** `USE_FINGERPRINT` merged into the APK (the 23–27 era needs the second) | `aapt2 dump permissions` |
| prompt asks for `BIOMETRIC_WEAK` with `allowDeviceCredential: false` — the most permissive strength, and the phone's passcode is never a way in | `nativePrompt()` + the plugin's Android default |
| the native class is in the shipped dex | `classes.dex` scan |
| bundle: 842/842 unit tests, `tsc --noEmit` clean | `npx vitest run tests/unit`, `npx tsc --noEmit` |

### 3.3 The device pass

| Step | What the phone itself said |
|---|---|
| before the fix | `This phone cannot use a fingerprint :: native=false plugin=no` |
| after the fix, same phone | `Fingerprint login  Use your finger instead of the PIN` — an offered, usable row |
| tapping the row | the OS's own dialog: `Fingerprint Authentication / Verify your fingerprint to open AgriShop / Touch the fingerprint sensor` |
| the prompt left untouched for **22 s** | still `Touch the fingerprint sensor`, app still locked — **no bypass without a real match** |
| cold start → lock screen | `Use fingerprint` offered next to the PIN pad, and the app's own sheet: `Fingerprint login / Touch the sensor / Enter PIN instead` |
| finger on the sensor | app opened to the dashboard; row back to `Fingerprint login  On for this phone` |
| browser lane | `fingerprintUnlock` 5 passed |

---

## 4. What is *not* proven

Stated plainly, because the difference matters:

* No API 23–27 and no API 30+ face-only phone was available to test on. What is proven is the
  floor (`minSdk 23` = the plugin's own), the merged permissions, the `weak` prompt, and that each
  device answer is turned into the right sentence instead of a crash — not a physical pass on those
  versions.
* OEM skins that throw from `checkBiometry()` are covered by the `unknown` branch, not by a device.

**Checking another phone, without a build:** install the APK, open More → Settings, and read the
fingerprint row. It should say *Use your finger instead of the PIN* when the phone can do it, and a
sentence naming the actual cause when it cannot. Any other wording is a defect worth reporting with
the row's own text.
