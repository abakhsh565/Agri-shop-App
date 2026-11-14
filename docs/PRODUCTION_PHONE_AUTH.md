# Production phone auth — the runbook

How a sign-in code is delivered in **production**, what the Supabase project must and must not carry,
and how to prove it from outside the app. Written after a real bypass was found on the live project on
2026-10-27 (`docs/FAILURE-LOG.md` → F-0002).

The app half of this is already enforced in the repository: a production build refuses to run unless
`VITE_OTP_DELIVERY=sms` (`src/lib/environmentContract.ts`), the shared code `123456` is rejected outside
demo mode (`src/lib/authMode.ts`, guarded by `tests/unit/authSafetyGuard.test.ts`), and the code screens
count down the server's window (`src/lib/otpPolicy.ts`). **None of that controls what the project
itself accepts.** This document is that other half, and it is a human procedure on purpose: no tool in
this repository may write production's auth configuration.

---

## 1. What "correct" looks like on the production project

Project ref **`gkswcfljxlutkfdvvqng`** ("Agrishop APp"). Dashboard → **Authentication → Providers → Phone**.

| Setting | Required value | Why |
|---|---|---|
| Phone provider | a real provider (Twilio / MessageBird / Textlocal / Vonage), **live** credentials | Without it, `signInWithOtp` fails and nobody can sign in. The app now shows "The code could not be sent" instead of waiting forever. |
| **Test OTPs** (test phone numbers) | **empty — never set in production** | A listed number plus its fixed code mints a real session. It is a login bypass, not a testing convenience. This is F-0002. |
| `sms_otp_exp` (SMS OTP expiry) | **60 seconds** — the value the app displays | Measured 2026-10-27. The screens count down `OTP_VALIDITY_SECONDS`, and `tests/unit/otpPolicy.test.ts` fails if the app promises longer than the number recorded here. |
| `sms_otp_length` | 6 | The code screen has six boxes; the app never accepts a shorter code. |
| `sms_template` | contains `{{ .Code }}` | The app reads nothing from the message body; this only decides what the person receives. |
| `sms_max_frequency`, `rate_limit_sms_sent` | ≥ 30 s between sends for one number | "Resend" becomes usable after 30 s on the code screens. A tighter server throttle turns that button into a refusal. |
| Sender | a real Messaging Service SID (`MG…`) or the account's default sender, plus a Content SID if the messaging service requires one | Twilio refuses to send without a sender. |

Placeholder credentials are worse than none: `"Test"` / `"test"` look configured in the dashboard, and
every send fails at delivery time with the failure only visible to the person waiting.

## 2. The bypass, precisely

Supabase Auth checks the **Test OTPs** list *before* it consults the provider
(`GOTRUE_SMS_TEST_OTP`, honoured while `sms_test_otp_valid_until` is in the future, or indefinitely when
that is unset). For a listed number, the fixed code is accepted as if it had been texted — no SMS is
sent, and the answer is a normal session.

Measured on 2026-10-27, production carried:

```
sms_test_otp: 923001234567=123456, 923001122334=123456,
              923008888888=000000, 923009988776=000000,
              923009988777=000000, 923009988778=000000
sms_test_otp_valid_until: 2026-11-29T19:00:00+00:00
sms_provider: twilio · account_sid: "Test" · message_service_sid: "test"
```

`03001234567` normalises to `923001234567` (`normalizePhone`), which is the first entry — so the owner's
own registration test reached the shop-details form by typing `123456`, while the *app* was already
running in `sms` mode and refusing the shared demo code. Six numbers were open, each with a published
code in the list itself.

### 2a. The state after clearing it (measured 2026-10-27)

The production project now reads `sms_test_otp: null` (the list is gone), and a live probe — the app's
own target and public key, from outside the app — answers:

| Request | Result |
|---|---|
| `923001234567` + `123456` (the bypass) | **403 `otp_expired`** — "Token has expired or is invalid", **no session** |
| `923001234567` + `000000` (control) | 403 `otp_expired`, no session |
| `923001122334` + `123456` | 403 `otp_expired`, no session |

The registration screen behaves the same way from the front: with the provider credential still a
placeholder, **Send Verification Code** fails at Twilio and the screen shows the failure — the code
screen is never reached. That is the correct fail-closed state, and it is also the current limit:
**until the real SMS credentials are in place, no production sign-in is possible.**

One rough edge to fix with the next release: the deployed build prints the provider's own error text
("…invalid username… twilio.com/docs/errors/20003") to the person signing up. The code screens' *Resend*
path now shows a plain sentence instead, but that change is on `release/merge`, not deployed, and the
*initial* send still forwards the provider's message.

## 3. Clearing it

**Dashboard.** Authentication → Providers → Phone → **Test OTPs** → delete every entry → Save. That is
the whole fix for the bypass; the Twilio fields can be filled at the same time or left until the real
provider is ready (sign-in then fails closed rather than falling back to a fixed code).

**Management API**, if you would rather script it — run from outside the repository, with a personal
access token (`sbp_…`, Account → Access Tokens) supplied as an environment variable, never committed and
never pasted into a chat:

```bash
curl -sS -X PATCH "https://api.supabase.com/v1/projects/gkswcfljxlutkfdvvqng/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sms_test_otp":"", "sms_test_otp_valid_until":null}'
```

The repository's own rule applies: production credentials live outside the checkout
(`environments.json` → `localEnvFile: null`), so no token and no Twilio secret belongs in this tree.

## 4. Verifying — two checks, both from outside the app

**a. The list is empty.** Re-read the config and require `sms_test_otp` to be `""`:

```bash
curl -sS "https://api.supabase.com/v1/projects/gkswcfljxlutkfdvvqng/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);
    console.log("sms_test_otp:", JSON.stringify(c.sms_test_otp),
                "valid_until:", c.sms_test_otp_valid_until,
                "provider:", c.sms_provider, "otp_exp:", c.sms_otp_exp);})'
```

**b. The code is refused, live.** The production anon key is public (it ships in the browser bundle);
use it and never print it. Expect a **401**-class refusal with **no `access_token`** in the body. A 200
carrying `access_token` means the bypass is still open, whatever the dashboard says.

```bash
# URL and key come from the deployed bundle, so this measures the app's own target.
node -e '
const {url, key} = require("/tmp/prod-auth.json");   // written by the extraction step, never printed
(async () => {
  const r = await fetch(url + "/auth/v1/verify", {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "923001234567", token: "123456", type: "sms" }),
  });
  const body = await r.text();
  let json = null; try { json = JSON.parse(body); } catch {}
  console.log("status:", r.status, "| error_code:", json?.error_code,
              "| session minted:", !!json?.access_token);
})();'
```

The check that matters most is the real one: request a code on a genuine handset and confirm the SMS
arrives, then sign in with it. Nothing in this repository can stand in for that.

## 5. Keeping the expiry aligned with the app

`src/lib/otpPolicy.ts` holds `OTP_VALIDITY_SECONDS` (the clock the screens show).
`tests/unit/otpPolicy.test.ts` holds `HOSTED_SMS_OTP_EXP_SECONDS` (the number recorded in §1) and fails
when the first exceeds the second. **Raising the project's `sms_otp_exp` is a three-file change**: the
project setting, `OTP_VALIDITY_SECONDS`, and `HOSTED_SMS_OTP_EXP_SECONDS`. Lowering the project setting
requires the same move in reverse — the test catches it in the same run.

## 6. What the repository cannot enforce, and the rules that follow

- No workflow, script or guard here may write production's auth configuration; the intake rule
  (`docs/PRODUCTION_DATA_POLICY.md`) exists so that even the credentials for it stay out of the checkout.
- **Never add Test OTPs to production.** If a code must be tested end to end, use staging
  (`bpybjrjenwccowvtrevu`), where demo mode is a deliberate, documented state.
- A production build with `VITE_OTP_DELIVERY` unset or `demo` is **refused at build time and at
  start-up** — if a deploy ever fails with `DEMO_OTP_IN_PRODUCTION`, the build is wrong, not the gate.
- Placeholder provider credentials are a silent outage, not a fallback: sends fail, and only the person
  waiting at the code screen sees it. That is the symptom this document's §1 is meant to prevent.

## 7. Symptoms → the setting behind them

| Symptom | Look at |
|---|---|
| "The code could not be sent" | provider credentials, sender (Messaging Service SID), account balance |
| The code arrives, is refused within a minute | `sms_otp_exp` shorter than the app's `OTP_VALIDITY_SECONDS` |
| A code works for a number that never received an SMS | **the Test OTPs list** (this document) |
| "Resend" refuses immediately | `sms_max_frequency` above 30 s, or `rate_limit_sms_sent` exhausted |
| Sign-in works in the browser but not in the app build | the build's `VITE_APP_ENV` / project pairing — the env guard's message names it |
