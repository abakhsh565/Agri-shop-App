import { describe, expect, it } from 'vitest';
import {
  channelForEnvironment,
  compareVersions,
  decideOffer,
  isBundleUrl,
  isOtaChannel,
  isVersion,
  type ManifestOffer,
  type UpdateContext,
} from '../../src/lib/otaPolicy';

const EMPTY_CONTEXT: UpdateContext = { channel: 'staging', nativeVersion: 2, currentVersion: '1.0.0' };

/** A valid offer, so every refusal test changes exactly one field. */
function offer(overrides: ManifestOffer = {}): ManifestOffer {
  return {
    update: true,
    channel: 'staging',
    version: '1.1.0',
    url: 'https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/ota-bundles/staging/1.1.0.zip',
    checksum: 'a'.repeat(64),
    size_bytes: 1024,
    required_native: 2,
    notes: 'fix: credit reminder',
    ...overrides,
  };
}

describe('channel per environment', () => {
  it('maps each environment to its own channel', () => {
    expect(channelForEnvironment('development')).toBe('dev');
    expect(channelForEnvironment('staging')).toBe('staging');
    expect(channelForEnvironment('production')).toBe('production');
  });

  it('refuses an environment it cannot name rather than guessing', () => {
    expect(() => channelForEnvironment('qa')).toThrow(/cannot derive a channel/);
    expect(() => channelForEnvironment('')).toThrow(/cannot derive a channel/);
  });

  it('accepts an explicit channel only when it agrees with the environment', () => {
    expect(channelForEnvironment('staging', 'staging')).toBe('staging');
    expect(() => channelForEnvironment('staging', 'production')).toThrow(/One build, one channel/);
    expect(() => channelForEnvironment('production', 'staging')).toThrow(/One build, one channel/);
  });

  it('recognises only the three channels', () => {
    expect(isOtaChannel('staging')).toBe(true);
    expect(isOtaChannel('Staging')).toBe(false);
    expect(isOtaChannel('release')).toBe(false);
  });
});

describe('version order', () => {
  it('compares numbers, not strings', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('treats a prerelease as older than its release', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.1')).toBe(1);
  });

  it('reports equality and refuses malformed input without inventing an order', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(isVersion('1.2.3')).toBe(true);
    expect(isVersion('1.2.3-beta.1')).toBe(true);
    expect(isVersion('v1.2.3')).toBe(false);
    expect(isVersion('1.2')).toBe(false);
  });
});

describe('deciding whether to install an offer', () => {
  it('applies a newer bundle from the same channel that this shell can run', () => {
    const decision = decideOffer(offer(), EMPTY_CONTEXT);
    expect(decision.apply).toBe(true);
    if (decision.apply) {
      expect(decision.version).toBe('1.1.0');
      expect(decision.checksum).toBe('a'.repeat(64));
      expect(decision.notes).toBe('fix: credit reminder');
    }
  });

  it('refuses a bundle from another channel', () => {
    expect(decideOffer(offer({ channel: 'production' }), EMPTY_CONTEXT)).toEqual({
      apply: false,
      reason: 'CHANNEL_MISMATCH',
    });
  });

  it('refuses a bundle the installed shell cannot run', () => {
    expect(decideOffer(offer({ required_native: 3 }), EMPTY_CONTEXT)).toEqual({
      apply: false,
      reason: 'NATIVE_TOO_OLD',
    });
    // ...and accepts it once the shell is new enough.
    expect(decideOffer(offer({ required_native: 2 }), { ...EMPTY_CONTEXT, nativeVersion: 3 }).apply).toBe(true);
  });

  it('refuses a version that is not newer than what is running', () => {
    expect(decideOffer(offer({ version: '1.0.0' }), EMPTY_CONTEXT)).toEqual({ apply: false, reason: 'NOT_NEWER' });
    expect(decideOffer(offer({ version: '0.9.9' }), EMPTY_CONTEXT)).toEqual({ apply: false, reason: 'NOT_NEWER' });
  });

  it('refuses a bundle whose integrity cannot be checked', () => {
    expect(decideOffer(offer({ checksum: 'not-a-checksum' }), EMPTY_CONTEXT)).toEqual({
      apply: false,
      reason: 'BAD_CHECKSUM',
    });
    expect(decideOffer(offer({ checksum: 'A'.repeat(64) }), EMPTY_CONTEXT).apply).toBe(true); // case-normalised
  });

  it('refuses a download that is not https', () => {
    expect(decideOffer(offer({ url: 'http://example.com/1.1.0.zip' }), EMPTY_CONTEXT)).toEqual({
      apply: false,
      reason: 'BAD_URL',
    });
  });

  it('accepts http only on loopback, where the local stack serves the dev channel', () => {
    expect(isBundleUrl('http://127.0.0.1:54321/storage/v1/object/public/ota-bundles/dev/1.1.0.zip')).toBe(true);
    expect(isBundleUrl('http://localhost:54321/x.zip')).toBe(true);
    expect(isBundleUrl('http://192.168.1.10:54321/x.zip')).toBe(false);
    expect(isBundleUrl('http://evil.example/x.zip')).toBe(false);
  });

  it('carries the server’s reason through when there is no update', () => {
    expect(decideOffer({ update: false, reason: 'UP_TO_DATE' }, EMPTY_CONTEXT)).toEqual({
      apply: false,
      reason: 'UP_TO_DATE',
    });
    expect(decideOffer({}, EMPTY_CONTEXT)).toEqual({ apply: false, reason: 'NO_UPDATE' });
  });
});
