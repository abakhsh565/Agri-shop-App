/**
 * OTA on the device — the only file that talks to the updater.
 *
 * WHAT IT DOES, in order, and the order is the whole design:
 *
 *   1. `notifyAppReady()` — immediately, before any network call. The plugin keeps a freshly installed
 *      bundle on probation until the app says the JavaScript actually started; if this does not arrive
 *      within `appReadyTimeout` the shell restores the previous bundle by itself. That is the rollback
 *      that needs no dashboard, no operator and no connectivity: a bundle that cannot boot cannot
 *      survive its own first launch.
 *   2. Check the manifest a few seconds later, once the screens are up. Never before the app is usable,
 *      and never on the critical path.
 *   3. Download, verify the checksum, and schedule the bundle for the next launch. The user is never
 *      restarted out of what they were doing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not throw, block, retry aggressively, or surface anything
 * to the user. An update check is housekeeping: if it fails the app runs exactly as it did before, and
 * the next launch will try again.
 *
 * CHANNEL. `VITE_OTA_CHANNEL` (set by the build) and `VITE_APP_ENV` must agree — `channelForEnvironment`
 * throws when they do not, so a mis-built APK is caught in the build, not on a shopkeeper's phone.
 */

import { Capacitor } from '@capacitor/core';
import {
  channelForEnvironment,
  compareVersions,
  decideOffer,
  type ManifestOffer,
  type OtaChannel,
} from './otaPolicy';

declare const __APP_VERSION__: string;

const MANIFEST_URL = String(import.meta.env.VITE_OTA_MANIFEST_URL ?? '').trim();
const CONFIGURED_CHANNEL = String(import.meta.env.VITE_OTA_CHANNEL ?? '').trim();
const APP_ENV = String(import.meta.env.VITE_APP_ENV ?? '').trim();
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** How long after the first paint before the check runs. Long enough not to compete with sign-in. */
const CHECK_DELAY_MS = 4000;

type Updater = typeof import('@capgo/capacitor-updater').CapacitorUpdater;

let started = false;
let pendingVersion: string | null = null;

/** The channel this build may update from, or null when OTA is not configured for it. */
export function otaChannel(): OtaChannel | null {
  try {
    return channelForEnvironment(APP_ENV, CONFIGURED_CHANNEL);
  } catch (error) {
    // A channel/environment disagreement is a build defect. It is reported, and then OTA stays off:
    // refusing to update is always safer than updating from the wrong channel.
    console.error((error as Error).message);
    return null;
  }
}

/** The version of the bundle that is running right now. */
export async function currentBundleVersion(updater: Updater): Promise<string> {
  try {
    const current = await updater.current();
    const version = current?.bundle?.version;
    if (typeof version === 'string' && version.trim()) return version.trim();
  } catch {
    // fall through to the compiled version
  }
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
}

/** The installed shell's `versionCode`, which is what `required_native` is compared against. */
async function nativeVersionCode(): Promise<number> {
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    const code = Number.parseInt(String(info.build ?? ''), 10);
    if (Number.isFinite(code) && code > 0) return code;
  } catch {
    // plugin unavailable — treat the shell as its first build
  }
  return 1;
}

async function fetchOffer(channel: OtaChannel, nativeVersion: number, current: string): Promise<ManifestOffer | null> {
  const response = await fetch(MANIFEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
    },
    body: JSON.stringify({ channel, nativeVersion, current, platform: Capacitor.getPlatform() }),
  });
  if (!response.ok) return null;
  return (await response.json()) as ManifestOffer;
}

/**
 * One check. Returns what it did, so a caller (a debug screen, a test) can report it; the normal boot
 * path ignores the result.
 */
export async function checkForUpdate(updater: Updater): Promise<string> {
  if (!MANIFEST_URL) return 'NO_MANIFEST_URL';

  const channel = otaChannel();
  if (!channel) return 'NO_CHANNEL';

  const [nativeVersion, currentVersion] = await Promise.all([nativeVersionCode(), currentBundleVersion(updater)]);

  const offer = await fetchOffer(channel, nativeVersion, currentVersion);
  if (!offer) return 'NO_ANSWER';

  const decision = decideOffer(offer, { channel, nativeVersion, currentVersion });
  if (!decision.apply) return decision.reason;

  const bundle = await updater.download({
    url: decision.url,
    version: decision.version,
    checksum: decision.checksum,
  });
  // Applied at the next launch rather than now: an update must never take the phone away from a sale
  // being recorded.
  await updater.set({ id: bundle.id });
  pendingVersion = decision.version;
  return `SCHEDULED:${decision.version}`;
}

/** The version downloaded and waiting for the next launch, when there is one. */
export function pendingUpdateVersion(): string | null {
  return pendingVersion;
}

/**
 * Boot hook. Safe on web (does nothing) and safe to call twice.
 *
 * The `notifyAppReady` call comes first and does not wait for anything: it is the difference between a
 * bad bundle being rolled back automatically and a phone being stuck on it.
 */
export async function bootstrapOta(): Promise<void> {
  if (started) return;
  started = true;

  if (!Capacitor.isNativePlatform()) return;

  let updater: Updater;
  try {
    ({ CapacitorUpdater: updater } = await import('@capgo/capacitor-updater'));
  } catch {
    return; // plugin absent from this shell — an APK built before OTA existed
  }

  try {
    await updater.notifyAppReady();
  } catch {
    // Nothing to do: the plugin's own timeout is the safety net.
  }

  if (!MANIFEST_URL || !otaChannel()) return;

  const run = () => {
    void checkForUpdate(updater).catch(() => {
      // Housekeeping only. The next launch retries.
    });
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
      .requestIdleCallback(run, { timeout: CHECK_DELAY_MS });
  } else {
    setTimeout(run, CHECK_DELAY_MS);
  }
}

/** Re-exported so a screen can show which version is running without importing the plugin. */
export { compareVersions };
