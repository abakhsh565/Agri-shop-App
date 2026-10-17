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

**One remnant, named rather than hidden:** 71 demo images remain in the four storage buckets.
Supabase refuses `delete from storage.objects` ("Direct deletion from storage tables is not allowed.
Use the Storage API instead") and this process holds the database password, not a service-role key.
No row references them any more.

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

## 4. No demo phone number remains

The four seeded numbers (`923001234567`, `923009876543`, `923001122334`, `923001999999`) exist
nowhere in `public.users`, `auth.users`, `auth.identities`, `shop_requests` or the customer/supplier
phone columns — measured inside the applying transaction and again afterwards.

## 5. Verification run for this change

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx vitest run` | **120 files / 1525 tests pass**, exit 0 |
| `productionDataPolicy` guard (rules 1/5 extended for this writer) | 43 tests pass, including the new non-vacuity half (removing the confirmation comparison or either decision token makes the script unrecognized) |
| `npm run build` | exit 0 (3.77s) |
| production `measure-production-final-state` | **17/17** |
| production `audit-app-surface` | last measured PASS (2026-10-17); `src/` unchanged by this work |
| Playwright lanes | **not run** — no `src/` file changed |
