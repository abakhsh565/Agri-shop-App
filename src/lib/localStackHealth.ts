/**
 * localStackHealth.ts — is the local Supabase stack actually there?
 *
 * WHY THIS EXISTS
 *   `environmentContract.ts` answers "which environment is this configuration, and may it talk to
 *   that project?". It cannot answer "is that project reachable?", because it is pure: no I/O, no
 *   sockets, cheap enough to run in every test. That gap showed up in ordinary development, whose
 *   target is the Supabase CLI stack in Docker on this machine: with the stack stopped, the dev
 *   server still started and every read failed, which reads as an app bug until someone thinks to
 *   check Docker. The Vite config now asks this module BEFORE the development server starts, and
 *   refuses with the command that fixes it.
 *
 * THE RULES, AND WHY THEY ARE THESE
 *   • Only a loopback URL is ever probed. A development configuration may not name a hosted
 *     project (environmentContract.ts refuses that), and this module must not become a second way
 *     of touching one: a non-loopback base URL is a refusal, never a target.
 *   • The endpoint is GoTrue's own `/auth/v1/health`, which the local stack answers without any
 *     key — so no credential is read, sent or logged by this check.
 *   • Every failure to answer is a reason string, never "ok". A check that turns "could not ask"
 *     into "fine" is worse than no check at all.
 */

/** Hosts that mean "this machine". `new URL()` returns IPv6 in brackets. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

/** How long the stack gets to answer before development refuses to start. */
export const LOCAL_STACK_HEALTH_TIMEOUT_MS = 2500;

/**
 * What this module needs from fetch — narrowed so a test can pass a plain function and so the
 * module carries no dependency on how the real fetch is implemented.
 */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * The health URL for a base URL, or null when the base is not this machine.
 *
 * Returning null rather than a URL is the fail-closed direction: a caller that forgets to check
 * would probe `null`, not a hosted project.
 */
export function localStackHealthUrl(baseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl ?? '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) return null;
  return `${parsed.origin}/auth/v1/health`;
}

/**
 * null = the stack answered; a reason string = it did not, phrased for the refusal that prints it.
 *
 * A non-loopback base URL is itself a reason: ordinary development is only ever local, so there is
 * nothing here to probe and no request is made.
 */
export async function localStackUnreachableReason(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const healthUrl = localStackHealthUrl(baseUrl);
  if (!healthUrl) {
    // An explicit branch rather than `baseUrl || '(unset)'`: the fallback form is what the microcopy
    // guard flags, and an unset value deserves its own sentence rather than quotes around a word.
    const shown = String(baseUrl ?? '').trim();
    if (!shown) return 'the local stack base URL is not set, so it is not the local stack';
    return `"${shown}" is not a loopback URL, so it is not the local stack`;
  }
  try {
    const response = await fetchImpl(healthUrl, {
      signal: AbortSignal.timeout(LOCAL_STACK_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return `${healthUrl} answered HTTP ${response.status}`;
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${healthUrl} did not answer (${message})`;
  }
}
