# Updates without reinstalling — the OTA runbook

An APK is installed **once**. Everything that is not native — screens, copy, business rules, RPC
calls, fixes — arrives as a web bundle the app downloads in the background and applies on its next
launch. This document is how that is published, promoted, rolled back, and when it must not be used.

```
                    ┌──────────────── the APK (native) ────────────────┐
   install once  →  │ shell + plugins + the bundle it shipped with     │
                    └──────────────────────────────────────────────────┘
                                    ↑ replaced by
   published web bundle  ───────────┘   (zip + sha256, one per channel)
```

## 1. What ships over the air, and what needs a new APK

| Change | Delivery |
|---|---|
| Screen, layout, copy, Urdu, colour, flow | **OTA** |
| RPC call, validation, business rule in the client | **OTA** |
| Database migration / new RPC | Migration (gated batch) **and** an OTA bundle — the code that calls it must ship too |
| New Capacitor plugin | **APK** |
| Android permission, `AndroidManifest`, intent filter, deep link | **APK** |
| Bumping `@capacitor/*`, `@capgo/capacitor-updater`, any native dependency | **APK** |
| `google-services.json`, signing config, app id, icons, splash | **APK** |

The rule behind the table: a bundle may only call native code that every shell it can be installed
into already contains. That is what `native_min` enforces (§4).

**Bootstrap**: the first shell that can receive OTA is `versionCode 2` (`package.json` →
`nativeVersion`). A `versionCode 1` install cannot be updated over the air; it must be replaced with
the version-2 APK once.

## 2. Channels — one per environment, structurally separated

| Channel | Environment | Database | Who it serves |
|---|---|---|---|
| `dev` | development | local Docker stack | the developer's own device |
| `staging` | staging | `bpybjrjenwccowvtrevu` | the owner's verification |
| `production` | production | `gkswcfljxlutkfdvvqng` | shops |

Three locks keep them apart:

1. **The build decides.** `VITE_OTA_CHANNEL` is compiled in, and `channelForEnvironment` throws when it
   disagrees with `VITE_APP_ENV`. A mis-built APK fails the build, not a shopkeeper's phone.
2. **The deployment decides.** Each channel's ledger lives in that environment's own database. A
   staging phone cannot be offered a production bundle: the row does not exist in the project it can
   reach.
3. **The manifest decides.** `ota-manifest` serves only the channels in that project's
   `OTA_ALLOWED_CHANNELS` secret (`dev,staging` on the QA project, `production` on production) and
   answers `403 CHANNEL_NOT_SERVED` otherwise.

## 3. Publishing

```bash
# 1. build the web bundle for the environment (same VITE_* as the APK it updates)
VITE_APP_ENV=staging \
VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… VITE_SUPABASE_PROJECT_ID=bpybjrjenwccowvtrevu \
VITE_OTA_CHANNEL=staging \
VITE_OTA_MANIFEST_URL=https://bpybjrjenwccowvtrevu.supabase.co/functions/v1/ota-manifest \
npm run build

# 2. publish it (records sha256 + native floor; --activate offers it immediately)
node scripts/ota/publish.mjs --env staging --activate \
  --url https://bpybjrjenwccowvtrevu.supabase.co --key-file .cloud-attachments/qa-service-role.txt \
  --notes "fix: credit reminder wording"
```

The script zips `dist/`, refuses to leave `index.html` out, uploads to the `ota-bundles` bucket under
`<channel>/<version>.zip`, and writes one row in `ota_bundles`. `--dry-run` does everything except
write.

**A candidate is not live.** Without `--activate` the row is stored as `candidate`: you can publish,
inspect, and only then offer it.

## 4. Version and compatibility

* `version` is `major.minor.patch[-prerelease]`, taken from `package.json` unless `--version` says
  otherwise. It is the *bundle* version, independent of the APK.
* `native_min` is the minimum `versionCode` that may install this bundle. It defaults to
  `package.json` → `nativeVersion` and is recorded per bundle.
* The manifest compares numerically (`1.10.0` is newer than `1.9.0`) and refuses a bundle to a shell
  below its `native_min` — the app answers `NATIVE_TOO_OLD` and stays on what it has.
* Bumping `nativeVersion` means: new APK, then publish bundles with the new floor. Old shells keep
  receiving only the bundles whose floor they meet.

## 5. Promotion — the same bytes, not a rebuild

```
dev  ──promote──▶  staging  ──promote──▶  production
```

```bash
node scripts/ota/promote.mjs \
  --from-environment staging --from-url … --from-key-file … \
  --to-environment production --to-url … --to-key-file … \
  --version 1.1.0 --confirm-production --activate
```

It downloads the staged zip, re-checks its sha256 against the ledger, uploads those exact bytes to the
next channel, records the same checksum, and refuses if a byte differs. **Nothing reaches production
that has not been exercised on staging**, and what reaches production is the file that was exercised.

A rebuild is never a promotion: minifiers and dependency updates produce a different zip, so a green
staging run would prove nothing about the production artifact.

## 6. Rollback

Three layers, fastest first:

1. **Automatic, per device.** An installed bundle must call `notifyAppReady()` within
   `appReadyTimeout` (15 s). A bundle that cannot boot does not get the call, and the shell restores
   the previous bundle by itself. This needs no operator and no connectivity.
2. **Channel rollback, seconds.** `node scripts/ota/publish.mjs --env staging --rollback 1.1.0`.
   The previously active row becomes `superseded` and the named one becomes `active`; the partial
   unique index makes "two active bundles on one channel" impossible.
3. **APK fallback.** If a bad bundle is somehow kept, `resetWhenUpdate` plus reinstalling the APK
   returns the shell to the bundle it shipped with (`CapacitorUpdater.reset()` has the same effect
   for a support call).

Rollback does not delete the bad bundle: it stays in the ledger as `superseded`, which is the record
of what shipped and when.

## 7. Safety properties, and where they are enforced

| Property | Enforced by |
|---|---|
| One channel per build | `channelForEnvironment` (`src/lib/otaPolicy.ts`), unit-tested |
| No cross-environment delivery | separate projects + `OTA_ALLOWED_CHANNELS` (`supabase/functions/ota-manifest`) |
| Bundle cannot break a shell | `required_native` vs installed `versionCode` |
| Tampered download | sha256 in the ledger, verified by the plugin before install |
| Broken bundle | `notifyAppReady()` timeout → automatic rollback |
| Two active bundles | partial unique index `ota_bundles_one_active_per_channel` |
| Ledger not readable by clients | RLS on + every grant revoked from `anon`/`authenticated` (migration 0334) |
| Only the publisher writes | `service_role` only; the manifest is the single reader |

## 8. Operating notes

* **Publish before you promote a migration-dependent feature.** A bundle that calls a new RPC against
  a database without it fails on the first tap; the schema goes first, then the bundle.
* **Watch the first ten minutes.** `select channel, version, status, activated_at from ota_bundles
  where status = 'active';` plus the app's own error feed (`client_error_events`) is the fastest read
  on a bad release.
* **One version, one channel row.** Republishing the same version overwrites the bytes and the
  checksum; if you need a different artifact, publish a different version.
* **Never publish a build made with another environment's `VITE_SUPABASE_*`.** It would be a working
  app pointed at the wrong shop.
