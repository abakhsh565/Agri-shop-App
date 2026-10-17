# Demo identities removed from production — 2026-10-18

**Target:** `gkswcfljxlutkfdvvqng` (production), named by the credential guard on every run.
**Authorization:** the owner's instruction — "remove all dummy login number and data added including
phone number, now login will be from an actual OTP … I think these are demo numbers, you can remove
that without any approval".
**Starting point:** `production-completion-2026-10-17.md` §6 item 2 (the two leftover identities).

## 1. What was removed — PASS

Executed by `scripts/clean-production-demo-data.mjs --env production --apply --confirm …` after a
rehearsal of the same statements (transaction, every check, `rollback`). Backup first:
`backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-17T19-19-14.sql` (+ manifest, 151 rows,
90 FKs, 161 policies), taken through the same wrapper.

| Removed | Rows |
|---|---|
| `public.users` — `Yaqoob Malik` 923001234567, `Ahmed Khan` 923009876543, `Akram` 923001122334, `Test QA User` 923001999999 | 4 |
| `auth.users` — the two demo logins (84deb713…, e7cbbff3…) | 2 |
| `auth.identities` | 2 |
| `auth.sessions` — including the stale browser session the earlier walk used | 2 |
| `memberships`, `user_active_shops` | 4 + 4 |
| customers (incl. the hand-typed `abk`, `Malik Henry`, `Naveed` rows), suppliers, products, variants | 6 · 4 · 6 · 12 |
| `business_settings` (the demo Cotton/Maize crops), `shop_requests`, `customer_crops` | 1 · 4 · 0 |

**Not removed, deliberately:** the tenant shell — 1 shop, its branch, its 4 role templates, 59
`role_permissions`, 32 permissions, 5 `app_settings` defaults. They are the configuration the app
reads, not people or business records; production has no `approve_shop_request`/`create_shop_for_me`,
so deleting the shop would leave the database with no route back to a working tenant.

**The 71 demo images were removed too, later the same day — see §5.**

### The guards that ran before the delete

The run refuses if any of these is not exactly true — each is asserted in the script, not assumed:

- the credential's own user string ends with `gkswcfljxlutkfdvvqng`;
- `public.users` is **exactly** the four seeded ids/phones (a fifth row stops it);
- `auth.users` holds **only** the two demo numbers;
- 26 transaction/config tables are **empty** (`sales`, `customer_payments`, `voids`, …) — if any
  holds a row, somebody's real work exists and this is not a seed reversal;
- every catalog row belongs to that one shop;
- the counts it will delete match the counts it measured (a surprise row fails the run);
- after the deletes: every target table is 0, the shell survived (shop 1 · branches 1 · roles 4 ·
  permissions 32 · app_settings 5 · 127 functions), **no demo phone survives in any of the 6 phone
  columns** in `public`, and the 8 write RPCs still exist.

`--apply` without `--confirm CLEAN-PRODUCTION-DEMO-IDENTITIES-2026-10-18` is refused (exit 2,
verified), and `--env` must be `production` (verified for no argument and for `staging`).

## 2. The state after — PASS

`measure-production-final-state.mjs --env production` → **17/17**, report
`backups/final-production-verification-identities-2026-10-18.json`. The one check that changed is
the configuration assertion: it no longer requires `users ≥ 1` (production is entitled to hold none
until the owner signs in) and instead asserts **no seeded demo identity or login survives**.

Independent read after the apply:

```
public.users 0 · auth.users 0 · auth.identities 0 · auth.sessions 0
lookup_user_by_phone('923001234567') → null
lookup_user_by_phone('923001999999') → null
shops 1 (Default Shop, owner_id null) · branches 1 · roles 4 (tenant templates) · permissions 32
```

Everything else the earlier close-out measured is unchanged: ledger 42 rows latest `0229`, 221 files
byte-verified, zero transactional rows, `anon` holds 0 table privileges and 0 policies, 9 branch-stamp
triggers, all write RPCs present.

## 3. The login is now a real OTP sign-in — verified as far as it can be without a phone

The device that carried the demo session (this browser profile) had `agri_auth`,
`sb-gkswcfljxlutkfdvvqng-auth-token`, `agri_last_profile`, `agri_device_session` and the demo-profile
key in `localStorage`. Those are demo login data too, and they were cleared.

What the deployed site shows now:

```
[welcome] → Skip → /login
"Welcome back · Enter your phone number to sign in"
  Shop owner | Employee   Phone Number [e.g. 03001234567]   [Send Code]   "Register your shop"
[console] [EnvGuard] PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)
```

No number is pre-filled, no PIN screen is offered (a PIN screen with no account behind it is how the
old device looked), and the app is in `otp: sms` mode — the demo phone→password bridge is refused on
production by design.

**What that does not prove, and why it is not reported as PASS:** an SMS actually arriving. That needs
a real phone, and no OTP was requested in this work — sending one to a demo number would text a
person who does not own this product.

**The owner's step (one minute):**

1. Open https://hisaabkitaab.dpdns.org (or the Preview tab) → `/login`.
2. Enter your real mobile number → **Send Code** → enter the 6-digit SMS.
3. You will land on **"not registered"** or the shop-registration screen, because no profile exists
   for that number yet. **Stop there and tell me the number you used.**
4. I attach that account to the existing tenant as its owner (one `users` row + the owner
   membership + `shops.owner_id`), and the app works with the empty shop exactly as a fresh install
   would. No demo row, no demo number, no bypass.

### The attach is built and rehearsed, waiting only on the sign-in

`scripts/attach-production-owner.mjs` writes the profile, the owner membership, the active-shop row
and `shops.owner_id` for the id Supabase creates when the owner verifies a code on their own phone.
It refuses a non-production target, a tenant that is not the empty one, a number with no login
(`exit 3`, "sign in with the code first"), and `--apply` without `--confirm ATTACH-PRODUCTION-OWNER`;
`--simulate-first-signin` is a rehearsal aid that is refused with `--apply`.

Rehearsed on production with a throwaway auth row, rolled back:

```
simulated first sign-in: throwaway auth row …   (rolled back)
wrote profile …, owner membership in 00000000-…0001, active shop/branch, shops.owner_id
lookup by phone → Shop Owner, owner · active shop 00000000-…0001 · 32 permissions
REHEARSAL PASSED — rolling back, nothing changed
```

That rehearsal also proves the two door properties: an unauthenticated `lookup_user_by_phone` returns
the door answer with **no `id`**, and the same call under the owner's claim returns the full profile.

## 4. No demo phone number remains

The four seeded numbers (`923001234567`, `923009876543`, `923001122334`, `923001999999`) exist
nowhere in `public.users`, `auth.users`, `auth.identities`, `shop_requests` or the customer/supplier
phone columns — measured inside the applying transaction and again afterwards.

## 5. The 71 demo images, and the policy that let an anonymous client delete them

`storage.objects` refuses a direct delete ("Direct deletion from storage tables is not allowed. Use
the Storage API instead"), so the objects were removed through the Storage API itself —
`DELETE /storage/v1/object/<bucket>` with `{prefixes: […]}` — in four calls:

```
objects before: 71
  company-logos:    5 → HTTP 200
  customer-images: 15 → HTTP 200
  employee-photos: 37 → HTTP 200
  product-images:  14 → HTTP 200
objects after: 0
a former public URL → HTTP 400 (no longer served)
```

**The finding that made this possible, and that is still open.** No service-role key was used: the
four calls carried only the project's *publishable* key, from an unauthenticated client. production's
`storage.objects` carries four policies addressed to role `public` —

```
public_all_storage_delete  DELETE  USING (bucket_id = ANY(ARRAY['product-images','employee-photos','company-logos','customer-images']))
public_all_storage_insert  INSERT  CHECK (bucket_id = ANY(…same four…))
public_all_storage_update  UPDATE  USING (bucket_id = ANY(…same four…))
public_all_storage_select  SELECT  USING (bucket_id = ANY(…same four…))
```

— so anyone who has the key the browser bundle already ships can delete, overwrite or upload any
image in all four buckets. That is the same class of defect `0228` fixed for `business_settings`,
`customer_crops` and `reminder_configs`; the storage policies were missed because they live in the
`storage` schema. The authenticated pair (`images auth delete/update/write`, `Authenticated users can
delete their uploads`) is also bucket-wide rather than owner-scoped, so one signed-in shop could
delete another's images through the API.

**Recommended fix (not applied):** drop the four `public_all_storage_*` policies, keep public
`SELECT` (images must be serveable), and scope `INSERT/UPDATE/DELETE` to `authenticated` with
`owner_id = auth.uid()::text` — the owner column Supabase sets on upload (the demo rows carried an
empty `owner_id` because they predate that). The app only uploads while signed in, so nothing it
does depends on anonymous write.

## 6. Verification run for this change

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx vitest run` | **120 files / 1525 tests pass**, exit 0 |
| `productionDataPolicy` guard (rules 1/5 extended for this writer) | 43 tests pass, including the new non-vacuity half (removing the confirmation comparison or either decision token makes the script unrecognized) |
| `npm run build` | exit 0 (3.77s) |
| production `measure-production-final-state` | **17/17** |
| production `audit-app-surface` | last measured PASS (2026-10-17); `src/` unchanged by this work |
| Playwright lanes | **not run** — no `src/` file changed |
