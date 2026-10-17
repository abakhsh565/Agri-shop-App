# Fingerprint sign-in: staging vs production, measured — 2026-10-18

**Question:** the fingerprint failure was fixed during live testing on staging. Is production aligned,
and if not, what was fixed?

**Answer in one line:** the *client/native* half was already aligned (production serves the fixed
build), but the *server* half was not — production could not set or verify a PIN at all
(`42703 column "pin_failed_count" does not exist`), which is the fallback the fingerprint sheet opens
the app through. That is fixed forward in `0231` and verified on production. Both environments now
agree on the PIN surface.

## 1. What the fix actually was

| Commit | Change | Environment-specific? |
|---|---|---|
| `4dbce64` | the biometric bridge, the PIN-sheet UI, i18n sentences, the settings row | no — shipped code |
| `3c48af6` | `BIOMETRIC_PLUGIN_NAME = "BiometricAuthNative"` (the app asked for `BiometricAuth`, a name no build registers), `isInstalledApp()` split from `isNative()` so a build without the bridge reports `no_plugin` instead of taking the browser path | no — shipped code |
| `f93c4e6` | the constant is read from the installed package's JS and Android sources by a guard | no — test |
| `e986aa0` | the device pass + staging blockers, evidence only | no — docs |

There is **no migration** in that fix: fingerprint sign-in is a native plugin + client code, and the
PIN path it falls back on is served by `set_user_pin` / `verify_user_pin`.

## 2. Client half — production is aligned (verified from the deployed bundle)

```
GET https://hisaabkitaab.dpdns.org/ → /assets/index-bpFgmwIr.js (878,769 bytes)
  contains "BiometricAuthNative"   → true
  contains the old literal         → false
  contains "no_plugin" verdict     → true
```

The production build carries the corrected plugin name and the split verdict, i.e. the same code the
device pass was measured against. Staging/QA runs the same repository code, so the two are identical
here.

## 3. Server half — production was NOT aligned (this is what broke)

`public.users` in production was missing two columns that production's own PIN functions read:

| Column | Staging | Production before | Production after `0231` |
|---|---|---|---|
| `pin_failed_count` | `integer NOT NULL DEFAULT 0` | **absent** | `integer NOT NULL DEFAULT 0` |
| `pin_locked_until` | `timestamptz` | **absent** | `timestamptz` |
| `pin_hash` | `varchar(255)` | present | present |

Cause: `0208` re-issued `set_user_pin` and `verify_user_pin` with `0148`'s bodies, but the **columns**
were created only by `0148`'s ALTERs, and production's curated history never received that file. Both
`.sql` files carry the same body (identical definition hash in both environments), so this was a
schema gap, not a code gap. PL/pgSQL resolves column names at execution, so the apply passed and the
failure waited for the first person to use a PIN:

```
BEFORE (production, rolled back)
  set_user_pin('1234')    → 42703: column "pin_failed_count" of relation "users" does not exist
  verify_user_pin('1234') → 42703: column "pin_failed_count" does not exist

AFTER 0231 (production, the same rehearsal, not rolled back for the check itself)
  set_user_pin('1234')    → ok
  verify_user_pin('1234') → ok
  verify wrong ×5         → wrong, attemptsLeft 4 → 0
  verify right (locked)   → locked, retryAfterSeconds 60
  set_user_pin('abcd')    → invalid
  stored state            → pin_failed_count 5, pin_locked_until set, hash 60 chars
```

`0231_the_pin_functions_need_the_columns_they_count.sql` adds exactly those two columns with `0148`'s
types and defaults, asserts the shape, and touches no function — the deployed bodies are correct once
their columns exist. Applied through the production gate (verification PASS on production's baseline,
backup `…19-59-17` restored and compared, ledger now **44 rows, latest `0231`**).

## 4. Everything else on the PIN surface, compared

| Fact | Staging | Production | Aligned |
|---|---|---|---|
| `set_user_pin(text)` definition | same `md5(pg_get_functiondef)` | same `md5(pg_get_functiondef)` | **yes** |
| `verify_user_pin(text)` definition | same `md5(pg_get_functiondef)` | same `md5(pg_get_functiondef)` | **yes** |
| `EXECUTE` on both | `authenticated` only (`public`/`anon` revoked) | same, plus `service_role` | **yes** — `service_role` is privileged by design |
| `lookup_user_by_phone`, `set_active_shop`, `current_shop_id`, `provision_member_login` | — | identical definitions | **yes** |
| `complete_member_onboarding()` | 885 bytes | 1093 bytes — **comments only**; same statements | **yes** (diff reviewed) |
| `users` columns as a set | 20 columns | 20 columns, same names/types/defaults except `shop_id`'s default (production defaults to the seeded tenant) | **yes** |
| OTP delivery mode | `demo` (`VITE_OTP_DELIVERY`) | `sms` | **intentionally different** — not a fingerprint defect |
| Native APK | built with QA env (`bpybjrjenwccu…`) | no production APK built | **not aligned by design**: a production APK needs production env vars; the biometric plugin name and `USE_BIOMETRIC`/`USE_FINGERPRINT` permissions are in the shared build, not per-environment |
| Device pass of fingerprint on a **production** build | passed on QA APK | not run | **UNKNOWN** for production on a physical phone |

## 5. What this does and does not prove

**Proven:** production serves the fixed client code; production's PIN surface now sets, verifies,
counts failures, locks after five attempts, and rejects a malformed PIN — measured on production
through the real RPCs with a real identity claim; the staging and production PIN surfaces are
function-for-function and column-for-column the same.

**Not proven:** a fingerprint unlock on a physical phone against a **production** build. The device
pass was measured on the QA-targeted APK (`fingerprint-device-pass-2026-10-15.md`), and production
has no installed APK. The code and the server are aligned; the production device pass is a separate
step that needs a production APK and a phone.

## 6. Guards added

- `tests/unit/pinSurfaceParity.test.ts` — every `pin_*` identifier `0208` references must be created by
  some migration, the lockout columns must keep `int NOT NULL DEFAULT 0` / `timestamptz`, `0148` and
  `0231` must both exist, no later migration may drop a pin column, and the scanner is proven
  non-vacuous against an identifier nothing creates.
- `scripts/measure-production-final-state.mjs` now asserts the two columns' shape on production
  (**18/18** checks passed after `0231`).
