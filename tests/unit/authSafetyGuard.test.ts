/**
 * Authentication safety — the shared code `123456` must be unusable in production.
 *
 * What this suite is guarding, precisely:
 *
 *   `VITE_OTP_DELIVERY` is set nowhere in this repository. `authMode.ts` used to read
 *   `VITE_OTP_DELIVERY === "sms" ? "sms" : "demo"`, so *unset* meant demo — and demo means the
 *   shared code `123456` is accepted for any registered phone number, after which a real Supabase
 *   session is minted for that person's profile. Knowing a phone number was enough to sign in as
 *   its owner, in every build this repo produced.
 *
 * Two independent locks now hold, and both are tested here:
 *
 *   1. a production configuration cannot resolve to demo at all (environmentContract refuses it,
 *      and `otpModeFor` answers "sms" for any configuration that is refused);
 *   2. `demoCodeAccepted` answers false for every mode except demo.
 *
 * The non-vacuity half of each test is the assertion that the *correct* configuration still works:
 * a rule that rejects everything would satisfy a "must reject" test while breaking sign-in.
 */

import { describe, expect, test } from 'vitest';

import {
  DEMO_OTP_CODE,
  OTP_DELIVERY_MODE,
  demoCodeAccepted,
  isDemoOtpMode,
  otpModeFor,
} from '@/lib/authMode';
import {
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  resolveEnvironment,
  type EnvironmentInput,
} from '@/lib/environmentContract';

const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_ID}.supabase.co`;
const STAGING_URL = `https://${STAGING_PROJECT_ID}.supabase.co`;

const PRODUCTION_BUILD: EnvironmentInput = {
  appEnv: 'production',
  supabaseUrl: PRODUCTION_URL,
  supabaseProjectId: PRODUCTION_PROJECT_ID,
  supabaseAnonKey: 'sb_publishable_production_key',
  otpDelivery: 'sms',
};

describe('production can never resolve to demo mode', () => {
  test('production + VITE_OTP_DELIVERY=sms resolves to sms', () => {
    const verdict = resolveEnvironment(PRODUCTION_BUILD);
    expect(verdict.ok).toBe(true);
    expect(otpModeFor(verdict)).toBe('sms');
  });

  test('production + VITE_OTP_DELIVERY=demo is refused at the environment layer', () => {
    const verdict = resolveEnvironment({ ...PRODUCTION_BUILD, otpDelivery: 'demo' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEMO_OTP_IN_PRODUCTION');
    // Even if a caller ignored the refusal, the mode it implies is still the strict one.
    expect(otpModeFor(verdict)).toBe('sms');
  });

  test('production with VITE_OTP_DELIVERY unset is refused — missing is the dangerous case', () => {
    const verdict = resolveEnvironment({ ...PRODUCTION_BUILD, otpDelivery: undefined });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEMO_OTP_IN_PRODUCTION');
    expect(otpModeFor(verdict)).toBe('sms');
  });

  test('production with a nonsense VITE_OTP_DELIVERY value is refused', () => {
    const verdict = resolveEnvironment({ ...PRODUCTION_BUILD, otpDelivery: 'DEMO' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEMO_OTP_IN_PRODUCTION');
  });

  test('any configuration the guard refuses implies sms, never the permissive mode', () => {
    const refused: EnvironmentInput[] = [
      { ...PRODUCTION_BUILD, appEnv: undefined },
      { ...PRODUCTION_BUILD, appEnv: 'nonsense' },
      { ...PRODUCTION_BUILD, supabaseUrl: undefined, supabaseProjectId: undefined },
      { ...PRODUCTION_BUILD, supabaseAnonKey: undefined },
      { ...PRODUCTION_BUILD, appEnv: 'staging' },
      { ...PRODUCTION_BUILD, otpDelivery: undefined },
    ];
    for (const input of refused) {
      const verdict = resolveEnvironment(input);
      expect(verdict.ok).toBe(false);
      expect(otpModeFor(verdict)).toBe('sms');
    }
  });
});

describe('the shared code is accepted only in demo mode', () => {
  test('`123456` is rejected in sms mode — the production answer', () => {
    expect(demoCodeAccepted(DEMO_OTP_CODE, 'sms')).toBe(false);
  });

  test('`123456` is accepted in demo mode — so the check above is not vacuous', () => {
    expect(demoCodeAccepted(DEMO_OTP_CODE, 'demo')).toBe(true);
  });

  test('near-miss codes are rejected in either mode', () => {
    for (const wrong of ['12345', '1234567', '000000', '', 'abcdef']) {
      expect(demoCodeAccepted(wrong, 'demo')).toBe(false);
      expect(demoCodeAccepted(wrong, 'sms')).toBe(false);
    }
  });

  test('the mode a production build resolves to is the one that rejects the code', () => {
    const verdict = resolveEnvironment(PRODUCTION_BUILD);
    const mode = otpModeFor(verdict);
    expect(demoCodeAccepted(DEMO_OTP_CODE, mode)).toBe(false);
  });
});

describe('this test process itself is a non-production build', () => {
  test('the suite runs in demo mode, so the demo path is genuinely reachable here', () => {
    // vitest.config.ts declares VITE_APP_ENV=staging and VITE_OTP_DELIVERY=demo. If this ever
    // resolves to sms the tests below would be passing for the wrong reason.
    expect(isDemoOtpMode).toBe(true);
    expect(OTP_DELIVERY_MODE).toBe('demo');
    expect(demoCodeAccepted(DEMO_OTP_CODE)).toBe(true);
  });
});
