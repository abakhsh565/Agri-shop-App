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

Optional, same session: **Project Settings → API** → rotate the `service_role` key, and put the new
value in `.env.qa` on the **`QA_SUPABASE_SERVICE_ROLE=`** line. The old key's value sits in this
repository's git history, which is why it should be rotated. (The anon key only needs updating if you
rotate that too.)

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

## What needs nothing from you

CI gates, the APK artifact verification, QA residue pruning, tier-2 verification, migrations, the
signing secrets (already set) and the documentation. Those are mine, and they run in the order the plan
describes.
