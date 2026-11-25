/**
 * OTA policy — the rules, with no network and no capacitor in sight.
 *
 * Every decision an update can go wrong on lives here so it can be tested without a phone: which
 * channel a build belongs to, whether a version is newer, and whether an offer from the manifest is
 * safe to install into *this* shell. `src/lib/ota.ts` is the only caller; it does the I/O and holds no
 * second copy of these rules.
 *
 * The three rules that matter:
 *
 *   1. A build has exactly one channel, derived from the environment it was compiled for. There is no
 *      runtime switch, because a runtime switch is how a staging phone ends up on production code.
 *   2. A version is compared numerically. `1.10.0` is newer than `1.9.0`; a plain string comparison
 *      says the opposite, and an OTA system that stops updating is invisible until someone notices
 *      the app is months old.
 *   3. A bundle is only offered to a shell that can run it. `required_native` is the APK's
 *      `versionCode`; a bundle that calls a plugin the installed shell does not have is the one way
 *      an OTA update can leave a working app broken.
 */

/** The channels an app can receive updates from. One per environment. */
export const OTA_CHANNELS = ['dev', 'staging', 'production'] as const;
export type OtaChannel = (typeof OTA_CHANNELS)[number];

/** The environments the app can be built for. */
const CHANNEL_BY_ENVIRONMENT: Record<string, OtaChannel> = {
  development: 'dev',
  staging: 'staging',
  production: 'production',
};

export function isOtaChannel(value: unknown): value is OtaChannel {
  return typeof value === 'string' && (OTA_CHANNELS as readonly string[]).includes(value);
}

/**
 * The channel a build belongs to.
 *
 * `VITE_OTA_CHANNEL` may name it explicitly (the APK workflow sets it), but it may never name a
 * channel that disagrees with the environment the build was compiled for — an override that crosses
 * environments is a misconfiguration, not a feature.
 */
export function channelForEnvironment(
  appEnvironment: string | null | undefined,
  configuredChannel?: string | null,
): OtaChannel {
  const environment = String(appEnvironment ?? '').trim().toLowerCase();
  const expected = CHANNEL_BY_ENVIRONMENT[environment];
  if (!expected) {
    throw new Error(
      `[OTA] cannot derive a channel from environment "${String(appEnvironment)}" — ` +
        `expected one of ${Object.keys(CHANNEL_BY_ENVIRONMENT).join(', ')}`,
    );
  }

  const override = String(configuredChannel ?? '').trim().toLowerCase();
  if (!override) return expected;
  if (override !== expected) {
    throw new Error(
      `[OTA] VITE_OTA_CHANNEL is "${override}" but this build is "${environment}" ` +
        `(channel "${expected}"). One build, one channel.`,
    );
  }
  return expected;
}

const VERSION_PATTERN = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([A-Za-z0-9.]+))?$/;

export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value.trim());
}

/**
 * Semantic order for the versions this app publishes: `major.minor.patch[-prerelease]`.
 * Returns 1 when `left` is newer, -1 when it is older, 0 when they are the same.
 */
export function compareVersions(left: string, right: string): number {
  const a = VERSION_PATTERN.exec(String(left).trim());
  const b = VERSION_PATTERN.exec(String(right).trim());
  if (!a || !b) return 0;

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }

  // A prerelease is older than the release it leads to: 1.0.0-rc.1 < 1.0.0.
  if (a[4] === undefined && b[4] !== undefined) return 1;
  if (a[4] !== undefined && b[4] === undefined) return -1;
  if ((a[4] ?? '') === (b[4] ?? '')) return 0;
  return (a[4] ?? '') > (b[4] ?? '') ? 1 : -1;
}

/** What the manifest answered. Everything is optional because it comes off the wire. */
export interface ManifestOffer {
  update?: unknown;
  channel?: unknown;
  version?: unknown;
  url?: unknown;
  checksum?: unknown;
  size_bytes?: unknown;
  required_native?: unknown;
  notes?: unknown;
  reason?: unknown;
}

export interface UpdateContext {
  channel: OtaChannel;
  /** The installed shell's `versionCode`. */
  nativeVersion: number;
  /** The bundle that is running now. */
  currentVersion: string;
}

export type OfferDecision =
  | {
      apply: true;
      version: string;
      url: string;
      checksum: string;
      sizeBytes: number;
      notes: string | null;
    }
  | { apply: false; reason: string };

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Where a bundle may be downloaded from.
 *
 * https, always — with one exception that exists so the updater can be exercised against the local
 * stack: a loopback address over plain http. A phone cannot reach that address, so the exception
 * cannot be used to deliver anything; it only keeps the dev channel testable.
 */
export function isBundleUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  return url.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}\//.test(url);
}

/**
 * Whether this offer may be installed. Every refusal names itself, because "no update" with no reason
 * is indistinguishable from a broken pipeline.
 */
export function decideOffer(offer: ManifestOffer, context: UpdateContext): OfferDecision {
  if (!offer || offer.update !== true) {
    return { apply: false, reason: typeof offer?.reason === 'string' ? offer.reason : 'NO_UPDATE' };
  }

  if (offer.channel !== context.channel) {
    return { apply: false, reason: 'CHANNEL_MISMATCH' };
  }

  const version = typeof offer.version === 'string' ? offer.version.trim() : '';
  if (!isVersion(version)) return { apply: false, reason: 'BAD_VERSION' };
  if (compareVersions(version, context.currentVersion) <= 0) {
    return { apply: false, reason: 'NOT_NEWER' };
  }

  const url = typeof offer.url === 'string' ? offer.url.trim() : '';
  if (!isBundleUrl(url)) return { apply: false, reason: 'BAD_URL' };

  const checksum = typeof offer.checksum === 'string' ? offer.checksum.trim().toLowerCase() : '';
  if (!CHECKSUM_PATTERN.test(checksum)) return { apply: false, reason: 'BAD_CHECKSUM' };

  const requiredNative = Number(offer.required_native ?? 1);
  if (!Number.isFinite(requiredNative) || context.nativeVersion < requiredNative) {
    return { apply: false, reason: 'NATIVE_TOO_OLD' };
  }

  const sizeBytes = Number(offer.size_bytes ?? 0);

  return {
    apply: true,
    version,
    url,
    checksum,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
    notes: typeof offer.notes === 'string' && offer.notes.trim() ? offer.notes.trim() : null,
  };
}
