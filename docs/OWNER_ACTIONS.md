# Owner actions — the only things that are not mine to do

Three actions need you (plus one optional decision). Each one is a few clicks.
**Never paste a secret, password or key into the chat.** Write it into the file named
below and tell me "ho gaya" — I read the value from the file.

---

## Action 1 — the phone (this is what unlocks items 6 / 7-device / 9-device / 12)

1. Phone → **Settings → About phone**.
2. Tap **Build number** 7 times. (Samsung: About phone → Software information → Build number.)
   Your phone asks for your PIN and says *"You are now a developer"*.
3. Back → **Settings → System → Developer options** (Xiaomi/Redmi: Settings → Additional settings →
   Developer options).
4. Turn **USB debugging** ON.
5. Plug the phone into this laptop with a **data** cable (a charge-only cable will not work).
6. On the phone a popup appears: **"Allow USB debugging?"** → tick **Always allow from this computer**
   → **Allow**. (If no popup: pull down the notification shade → "Charging this device via USB" →
   choose **File transfer / MTP**.)
7. Tell me: **"phone laga diya"**.

What I do then, in this order: `adb devices` shows the serial → `adb install -r` the verified
release APK → items 6, 7, 9, 12 by hand on the phone (login, branch switch, permissions, invite link,
language, reopen) with screenshots and database checks as the evidence.

If a popup does not appear or `adb devices` stays empty: on Windows you may need the phone vendor's
USB driver, or use a different cable/port. Tell me what you see and I will diagnose from there.

---

## Action 2 — Supabase console, QA password rotation (security item)

1. Open <https://supabase.com/dashboard> and sign in.
2. Choose the **QA** project — ref **`bpybjrjenwccowvtrevu`** (the production project is a different
   one; do not touch it).
3. **Project Settings → Database → Database password → Reset database password**. Copy the new
   password when Supabase shows it.
4. Open `.env.qa` in this checkout and replace the value on the **`QA_DB_PASS=`** line with the new
   password. Save the file. (Leave every other line alone.)
5. Tell me **"password badal diya"**.

What I do then: read `QA_DB_PASS` from `.env.qa`, set the `QA_DB_PASS` GitHub secret from it (the value
never appears in the chat or in a log), then prove it works with `npm run preflight` /
`scripts/check-qa-connectivity.mjs`, and confirm the secret list shows a fresh timestamp.

**Is this a blocker? No.** Staging works today with the current password; this is security hygiene, and
the staging checkpoint can be called done without it (it stays recorded as an open item).

### The measured position, so the request is not taken on trust

`ENGINEERING_OS_STATE.md` records a guard that, on 2026-10-13, found *two credentials in this
repository's git history* and asked the owner to rotate the QA database password and the old project's
service-role key. Re-checked on 2026-10-15, the position is narrower than that sentence suggests:

| Check | Result |
|---|---|
| `.env.qa`, `.env.local`, `.env` tracked by git? | **No** — no environment file with values is committed |
| A `service_role` key value anywhere in the tree or in `-S` history search? | **Not found** — only the *name* `service_role`, in docs and env-var lists |
| Any key at all in the tracked tree? | anon keys, which ship in the browser bundle by design: the QA key in `playwright.config.ts`, and an **older** project's key (`cmubdztiiqnxxpw…`) in `SUPABASE_CONNECTION_GUIDE.md` and `dev-guide-extracted/utils/supabase/info.tsx` |

So there are two real, low-urgency follow-ups: rotate the QA database password (Action 2 above), and —
because an old project's anon key is published in this repo — confirm that old project's credentials are
revoked in the Supabase account that owns it, if that project still exists. Neither is a staging defect.

---

## Action 3 — back up the keystore (one minute, most important)

1. Open this project folder → `keystore`.
2. Copy the whole folder to somewhere off this machine — Google Drive, OneDrive, a pen drive, or a
   password manager's file vault.
3. Tell me **"backup ho gaya"** (or nothing — it needs no follow-up).

Why it matters: `keystore/release.jks` **is the app's signing identity**. Once an APK signed with it is
installed, every future update must be signed with the same key. Lose it and Android will refuse to
install any new build over the existing one — the user would have to uninstall and lose local data.
`keystore/KEYSTORE-DETAILS.txt` holds the alias and passwords, so back that up with it.

---

## Action 4 (optional decision) — `main`

The verified work is on branch **`ci-proof/full-tree`** (head `9d527836`); **`main`** is still at
`ca1e0c2b`. `.github/workflows/build-apk.yml` also triggers on a push to `main`, so until the branch is
merged, every APK build has to be dispatched by hand.

- Say **"merge kar do"** and I will merge the verified branch into `main` (no history rewrite) and let the
  workflow run on the push.
- Or say nothing and keep dispatching manually.

---

## Action 5 — production: clear the test OTPs — DONE 2026-10-27, verified

**Done and verified.** The test-OTP list is gone (`sms_test_otp: null`) and a live probe with
`923001234567` + `123456` now answers **403 `otp_expired` with no session**; the registration screen
fails at the provider instead of accepting a code. Full result: `docs/FAILURE-LOG.md` → F-0002 and
`docs/PRODUCTION_PHONE_AUTH.md` §2a. What is left is the real SMS provider, which you will send later
— **never paste its credentials into the chat.**

The steps below are kept for the record.

Production's Supabase project carries a list of test phone numbers with fixed codes, and that list is a
login bypass: a listed number plus its published code signs in without any SMS. It is why `03001234567`
accepted `123456` on the live site (`docs/FAILURE-LOG.md` → F-0002). The app side is already correct;
this is the project side, and no tool here may write it.

1. Open <https://supabase.com/dashboard> → the **production** project, ref **`gkswcfljxlutkfdvvqng`**
   ("Agrishop APp"). Staging is a different project — do not touch it.
2. **Authentication → Providers → Phone → Test OTPs**. Delete every entry — it currently reads
   `923001234567=123456, 923001122334=123456, 923008888888=000000, 923009988776=000000,
   923009988777=000000, 923009988778=000000`.
3. Save. Leave the Twilio fields as they are for now; with the list gone, phone sign-in fails closed
   instead of accepting a fixed code. The real provider values go in when you send them.
4. Tell me **"test otp hata diye"**.

What I do then: read the project's auth configuration back and require `sms_test_otp` to be empty, then
probe production from outside with `923001234567` + `123456` and require a refusal with **no session** in
the response. Both checks, and what each result means, are in `docs/PRODUCTION_PHONE_AUTH.md` §4. Until
the first one passes, production is not secure and I will say so.

The real SMS provider (Twilio, or a 2L-style sender) is configured later, in the same screen —
**never paste its credentials into the chat**; put them in a file outside this repository and tell me the
path, as with every other secret.

---

## What needs nothing from you

CI gates, the APK artifact verification, QA residue pruning, tier-2 verification, migrations, the
signing secrets (already set) and the documentation. Those are mine, and they run in the order the plan
describes.
