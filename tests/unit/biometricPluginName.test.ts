import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The biometric plugin's name, agreed by three files that never see each other.
 *
 * WHY THIS GUARD EXISTS — measured, not imagined.
 *
 * `isPluginAvailable(name)` answers false for any name nobody registered, and the app then takes
 * its browser path: no biometric call is attempted at all. So the failure is not an error message
 * anywhere — it is the owner of a phone that unlocks with a fingerprint all day being told, by a
 * released APK, "This phone cannot use a fingerprint".
 *
 * That is exactly what shipped. `src/lib/biometric.ts` asked for `"BiometricAuth"` while the
 * package registers `"BiometricAuthNative"` in both halves. It was found on a real device
 * (Sparx Neo 7 Ultra, Android 12, one finger enrolled, release-signed APK): the diagnostics built
 * for the device pass printed `native=false plugin=no` on the settings screen, and every Android
 * phone would have shown the same sentence.
 *
 * WHAT IT CHECKS. The name the app asks for must equal the name the package's JS registers AND the
 * name its Android plugin annotation declares. A rename in either half fails here, in one second,
 * instead of on a phone in someone's hand.
 */
const APP_SOURCE = path.resolve(__dirname, '../../src/lib/biometric.ts');
const PACKAGE = '@aparajita/capacitor-biometric-auth';
const PACKAGE_DIR = path.resolve(__dirname, `../../node_modules/${PACKAGE}`);
const JS_ENTRY = path.join(PACKAGE_DIR, 'dist/esm/index.js');
const ANDROID_SOURCE = path.join(
  PACKAGE_DIR,
  'android/src/main/java/com/aparajita/capacitor/biometricauth/BiometricAuthNative.java',
);

function read(file: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} is missing. This guard reads the installed package on disk, so it needs ` +
        `\`npm install\` to have run (CI installs before it tests).`,
    );
  }
  return fs.readFileSync(file, 'utf8');
}

const appSource = read(APP_SOURCE);

/** The one place the app names the plugin. */
const appName = /const BIOMETRIC_PLUGIN_NAME = "([^"]+)"/.exec(appSource)?.[1] ?? null;

/** `registerPlugin('<name>'` — the name Capacitor's JS half answers to. */
const jsName = /registerPlugin\(\s*'([^']+)'/.exec(read(JS_ENTRY))?.[1] ?? null;

/** `@CapacitorPlugin(name = "<name>")` — the name the Android half answers to. */
const nativeName = /@CapacitorPlugin\(\s*name\s*=\s*"([^"]+)"\s*\)/.exec(read(ANDROID_SOURCE))?.[1] ?? null;

describe('the biometric plugin is asked for by the name it actually registers', () => {
  it('the names were found at all — a rename of any of the three shapes fails here first', () => {
    expect(appName, 'BIOMETRIC_PLUGIN_NAME is missing from src/lib/biometric.ts').toBeTruthy();
    expect(jsName, `no registerPlugin name found in ${JS_ENTRY}`).toBeTruthy();
    expect(nativeName, `no @CapacitorPlugin name found in ${ANDROID_SOURCE}`).toBeTruthy();
  });

  it('the app asks for the name the package registers in JS', () => {
    expect(
      appName,
      `the app asks for "${appName}" but the package registers "${jsName}" — ` +
        'isPluginAvailable() would answer false and every phone would be read as a browser',
    ).toBe(jsName);
  });

  it('the app asks for the name the Android plugin declares', () => {
    expect(appName).toBe(nativeName);
  });

  it('isPluginAvailable is called with that constant, never with a string of its own', () => {
    expect(appSource).toContain('Capacitor.isPluginAvailable(BIOMETRIC_PLUGIN_NAME)');
    expect(
      /isPluginAvailable\(\s*["'`]/.test(appSource),
      'a literal name was reintroduced at an isPluginAvailable call — that is the defect this guards',
    ).toBe(false);
  });

  it('the package is still a declared dependency, so the guard cannot pass on a stale copy', () => {
    const pkg = JSON.parse(read(path.resolve(__dirname, '../../package.json'))) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = { ...pkg.dependencies, ...pkg.devDependencies }[PACKAGE];
    expect(declared, `${PACKAGE} is not declared in package.json`).toBeTruthy();
  });
});
