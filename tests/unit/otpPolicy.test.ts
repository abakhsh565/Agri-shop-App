/**
 * The code screens must count down the server's window, and must never report a send that did not
 * happen.
 *
 * WHY BOTH RULES EXIST — measured on the live environments, 2026-10-27:
 *
 *   1. `sms_otp_exp` (Auth → Providers → Phone) is **60 seconds** on the hosted projects, and the
 *      code screens counted down from **2:00**. The last minute of that clock promised a code the
 *      server had already discarded.
 *
 *   2. Three call sites sent a code and ignored the answer — "Resend" on `RegisterOTPPage` and
 *      `OTPVerifyPage`, and the send on `ForgotPINPage` — so a refused send (no provider, a
 *      throttle, a bad number) restarted the clock and the cooldown as though an SMS were on its
 *      way. Every other caller (sign-in, sign-up, business profile, delete flow) already read the
 *      result, which is what makes the three an oversight rather than a policy.
 *
 * Asserted on the source, for the same reason `loginDoor.test.ts` asserts position: a broken send
 * looks exactly like a working one, and the only way to see the difference is to read the code.
 * The non-vacuity of each rule is the second assertion in its test — the correct value and the
 * correct call shape still pass.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { OTP_RESEND_DELAY_SECONDS, OTP_VALIDITY_SECONDS } from '../../src/lib/otpPolicy';

/**
 * The hosted projects' `sms_otp_exp`, in seconds — the server's half of the promise.
 *
 * If someone raises the project's setting, this number moves in the same change as
 * `OTP_VALIDITY_SECONDS`; if the project is only ever lowered, the screen clock must come down
 * too, and this test fails until it does.
 */
const HOSTED_SMS_OTP_EXP_SECONDS = 60;

/** Screens that show a validity clock. */
const CLOCK_SCREENS = [
  'src/pages/auth/OTPVerifyPage.tsx',
  'src/pages/register/RegisterOTPPage.tsx',
];

/** Screens that send a verification code. */
const SENDING_SCREENS = [...CLOCK_SCREENS, 'src/pages/auth/ForgotPINPage.tsx'];

function read(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
}

describe('the code validity window', () => {
  it('never promises a longer life than the server gives the code', () => {
    expect(OTP_VALIDITY_SECONDS).toBeGreaterThan(0);
    expect(
      OTP_VALIDITY_SECONDS,
      'the screen would count down past the project\'s sms_otp_exp — raise the project setting first, then this constant and HOSTED_SMS_OTP_EXP_SECONDS',
    ).toBeLessThanOrEqual(HOSTED_SMS_OTP_EXP_SECONDS);
  });

  it('is short enough to leave time to type the code', () => {
    // Not vacuity: a window of zero seconds would pass the rule above while making the screen
    // useless, so the constant has to be a real window.
    expect(OTP_VALIDITY_SECONDS).toBeGreaterThanOrEqual(30);
  });

  it('is what the screens count down', () => {
    for (const file of CLOCK_SCREENS) {
      expect(read(file), `${file} no longer counts down the shared window`).toContain(
        'OTP_VALIDITY_SECONDS',
      );
    }
  });

  it('is declared once — no screen keeps its own copy', () => {
    for (const file of CLOCK_SCREENS) {
      expect(read(file), `${file} declares its own validity window again`).not.toMatch(
        /const OTP_VALIDITY\s*=/,
      );
    }
  });

  it('has a resend cooldown shorter than the window it restarts', () => {
    expect(OTP_RESEND_DELAY_SECONDS).toBeGreaterThan(0);
    expect(OTP_RESEND_DELAY_SECONDS).toBeLessThan(OTP_VALIDITY_SECONDS);
  });
});

describe('a send that was refused', () => {
  it('is reported on every screen that asks for a code', () => {
    for (const file of SENDING_SCREENS) {
      const source = read(file);
      expect(source, `${file} sends a code without reading the answer`).toMatch(
        /const result = await sendOTP\(/,
      );
      expect(source, `${file} drops the failed-send answer`).toContain('!result.success');
    }
  });

  it('does not leave the old fire-and-forget call shape behind', () => {
    for (const file of SENDING_SCREENS) {
      expect(read(file), `${file} sends a code and ignores the result`).not.toMatch(
        /\bawait sendOTP\([^)]*\);\s*\n\s*set(ResendCountdown|Step|Countdown)/,
      );
    }
  });
});

/**
 * The runbook (`docs/PRODUCTION_PHONE_AUTH.md`) is the human half of this rule: it records what the
 * production project must carry, and it is the only place the project's own expiry is written down.
 * These two tests keep it in step with the app — the document and the constant move together or the
 * suite says so. They were added with the entry `docs/FAILURE-LOG.md` F-0002 records.
 */
describe('the production phone-auth runbook', () => {
  const RUNBOOK = 'docs/PRODUCTION_PHONE_AUTH.md';

  it('the runbook and the app agree on the code expiry', () => {
    const doc = read(RUNBOOK);
    const line = doc.split('\n').find((row) => row.includes('`sms_otp_exp`'));
    expect(line, `${RUNBOOK} no longer states the project's sms_otp_exp`).toBeTruthy();

    const documented = Number((line as string).match(/(\d+)\s*second/i)?.[1]);
    expect(Number.isFinite(documented), `the expiry in ${RUNBOOK} is not a number of seconds`).toBe(true);
    expect(
      documented,
      'the runbook and HOSTED_SMS_OTP_EXP_SECONDS disagree — change both, and the project, together',
    ).toBe(HOSTED_SMS_OTP_EXP_SECONDS);
    expect(
      OTP_VALIDITY_SECONDS,
      'the app promises a longer life than the runbook records the project giving the code',
    ).toBeLessThanOrEqual(documented);
  });

  it('names the setting the bypass came from, and how to check the project from outside the app', () => {
    const doc = read(RUNBOOK);
    // The bypass was a project-side list of fixed codes; a runbook that stopped naming it would be
    // describing a different system than the one that failed.
    expect(doc).toContain('sms_test_otp');
    expect(doc).toMatch(/Test OTPs/);
    // And the verification has to be the live one: the app's own guards cannot see the project.
    expect(doc).toContain('/auth/v1/verify');
  });
});
