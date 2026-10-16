/**
 * localStackHealth.test.ts — the check that stops development from starting against nothing.
 *
 * The rule under test is narrow and deliberate: ordinary development (`npm run dev`, Vite mode
 * "development") serves only the Supabase CLI stack on this machine, so the only thing that may be
 * probed is a loopback URL — never staging, never production. The last test in the second block is
 * the non-vacuity check: it fails if the loopback guard is removed, because the hosted URL would
 * then be probed.
 */
import { describe, expect, it } from 'vitest';
import {
  LOCAL_STACK_HEALTH_TIMEOUT_MS,
  LOOPBACK_HOSTS,
  localStackHealthUrl,
  localStackUnreachableReason,
  type FetchLike,
} from '../../src/lib/localStackHealth';
// The hosted URLs below are built from the project ids rather than written out: the automated
// surface may not contain a production endpoint literal at all (see productionReachGuard), and a
// test that hardcodes one to prove it is refused would be the exception that breaks that rule.
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '../../src/lib/environmentContract';

describe('local stack health — which URLs may be probed', () => {
  it('derives the health URL for the stack address environments.json records', () => {
    expect(localStackHealthUrl('http://127.0.0.1:54321')).toBe(
      'http://127.0.0.1:54321/auth/v1/health',
    );
  });

  it('accepts localhost and IPv6 loopback, with a trailing slash or a path', () => {
    expect(localStackHealthUrl('http://localhost:54321/')).toBe(
      'http://localhost:54321/auth/v1/health',
    );
    expect(localStackHealthUrl('http://[::1]:54321')).toBe('http://[::1]:54321/auth/v1/health');
    // The path is dropped on purpose: the health endpoint is derived from the origin, so a URL
    // that happens to carry `/rest/v1` cannot make the probe ask a different service.
    expect(localStackHealthUrl('http://127.0.0.1:54321/rest/v1')).toBe(
      'http://127.0.0.1:54321/auth/v1/health',
    );
  });

  it('refuses a hosted project — staging and production alike', () => {
    expect(PRODUCTION_PROJECT_ID).not.toBe(STAGING_PROJECT_ID); // the two ids are real and distinct
    expect(localStackHealthUrl(`https://${STAGING_PROJECT_ID}.supabase.co`)).toBeNull();
    expect(localStackHealthUrl(`https://${PRODUCTION_PROJECT_ID}.supabase.co`)).toBeNull();
  });

  it('refuses other machines, other protocols and malformed values', () => {
    const refused = [
      'http://192.168.1.5:54321',
      'http://10.0.0.5:54321',
      'http://example.com:54321',
      'file:///tmp/stack',
      'localhost:54321',
      'not a url',
      '',
    ];
    for (const target of refused) {
      expect(localStackHealthUrl(target), `should refuse: ${target}`).toBeNull();
    }
  });

  it('keeps the loopback list free of any hosted suffix', () => {
    expect(LOOPBACK_HOSTS.some((host) => host.includes('supabase'))).toBe(false);
  });
});

describe('local stack health — the reason development refuses to start', () => {
  it('is null when the stack answers, and the probe is the health endpoint with a timeout', async () => {
    const calls: Array<{ url: string; init?: { signal?: AbortSignal } }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };

    await expect(localStackUnreachableReason('http://127.0.0.1:54321', fetchImpl)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:54321/auth/v1/health');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('names the HTTP status when something answers but is not healthy', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 503 });
    await expect(localStackUnreachableReason('http://127.0.0.1:54321', fetchImpl)).resolves.toMatch(
      /HTTP 503/,
    );
  });

  it('names the socket failure when nothing is listening', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:54321');
    };
    await expect(localStackUnreachableReason('http://127.0.0.1:54321', fetchImpl)).resolves.toMatch(
      /ECONNREFUSED/,
    );
  });

  it('refuses a hosted base URL WITHOUT probing it (non-vacuity: fails if the guard is removed)', async () => {
    let called = 0;
    const fetchImpl: FetchLike = async () => {
      called += 1;
      return { ok: true, status: 200 };
    };

    const reason = await localStackUnreachableReason(
      'https://bpybjrjenwccowvtrevu.supabase.co',
      fetchImpl,
    );

    expect(reason).toMatch(/loopback/);
    expect(called, 'a hosted URL must never be probed').toBe(0);
  });

  it('gives the stack a bounded moment, not forever', () => {
    expect(LOCAL_STACK_HEALTH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LOCAL_STACK_HEALTH_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});
