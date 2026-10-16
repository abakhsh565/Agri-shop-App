# The Development environment — status, the local stack, and the (superseded) hosted-project path

**SUPERSEDED IN PART, 2026-10-12 (later the same day).** The blocker below — Supabase's free-plan
limit of two active projects — is **no longer blocking Development**, because Development was moved
to the **Supabase CLI stack on this machine** instead of a third hosted project. The runbook is
[docs/LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md): start/stop, baseline init, seed, verify, and the
workflows that were verified in a browser with database evidence. Nothing in the section below was
performed: no third project was created and no `DEV_*` credential was ever handed over.

**What the local stack changes:** Development is reachable, isolated by construction (it can only
reach a `supabase_db_*` container on this machine) and costs no hosted project. **What it does not
change:** the APK path (§7) and the QA/production rules are untouched — local development produces
no APK, and `.github/workflows/build-apk.yml` remains the only authorized APK workflow.

Status of the environments, measured **2026-10-12**:

| Environment | Supabase project | Status today |
|---|---|---|
| **Development** | *none — local CLI stack on this machine* | ✅ **USABLE for web development and testing.** Built from the frozen staging baseline + forward files; verified end-to-end (see `LOCAL_DEVELOPMENT.md` §6). It is **not** a hosted project and produces **no APK**. |
| **Staging / QA** | `bpybjrjenwccowvtrevu` | ✅ Active, untouched by this work. Ledger agrees with the directory exactly (189 files, newest `0197`). |
| **Production** | `gkswcfljxlutkfdvvqng` | ✅ Active, untouched. Read-only to this tooling; no `PROD_DB_*` credentials exist in this checkout. |
| **PGlite** | in-process | Disposable: migration replay, baseline checks and restore verification only — not an application environment. |

> The isolation claim still has the same shape: it is only true to the extent each leg is proven. The
> statement that is now safe is narrower and local: **a local command can only reach the local
> container** (it refuses anything that is not a `supabase_db_*` container, and reads no QA/PROD
> credential — asserted by `tests/unit/localDevDatabaseOrdering.test.ts` and
> `npm run verify:targeting`). Hosted-to-hosted isolation is unchanged by local development, and
> `npm run verify:isolation` still reports on it as before.

---

## 1. What the gap actually is (historical — the hosted-project route)

Kept because it explains what was tried and why the local stack was chosen instead. The gap described
here is the *hosted* Development project; the local stack does not need one.

`environments.json` already knows three environments and refuses to guess any of them. Development
is the one with no project:

```json
"development": { "projectRef": null, "status": "not-created", … }
```

Two consequences, both intended and both fail-closed:

* `.env.local` (the file `.env.example` documents as the development file, and the file Vite loads in
  every mode) carries the **staging** project's URL, anon key and `VITE_APP_ENV`.
* Every tool that is asked to operate on Development is refused, because a target that cannot be
  verified is not a target:

  ```
  [TARGETING] Refusing to run for "development": no project ref is recorded for it in
  environments.json (status: "not-created").
  ```

## 2. Why nothing has been created yet — the actual blocker

Supabase's free plan allows **2 active projects per member**, and the two are already spent on this
account. `supabase projects create` was refused, verbatim:

```
Unexpected error creating project: {"message":"The following organization members have reached
their maximum limits for the number of active free projects in organization ...: <owner>
(2 project limit). To continue, these users will need to either delete, pause or upgrade ..."}
```

Measured state of the organisation (read-only, `supabase projects list`):

```
bpybjrjenwccowvtrevu   ACTIVE_HEALTHY   ← staging / QA
gkswcfljxlutkfdvvqng   ACTIVE_HEALTHY   ← production
```

**Decision taken (2026-10-12): a dedicated Development project on a SECOND Supabase account/org.**
Not an upgrade of the existing organisation, and not pausing or deleting production: the free limit
is *per member*, so a second owner account has its own allowance, and nothing that carries real
business data is disturbed. A new **organisation** alone would not have helped — the limit follows
the member, not the org.

## 3. What is already implemented and must be reused (not rebuilt)

Everything below is in place, tested, and is what the provisioning path calls into:

| Piece | Where | What it already does |
|---|---|---|
| Environment map | `environments.json` | The one place a project ref lives; every consumer reads it |
| Targeting rules | `scripts/lib/environments.mjs` | Refuses an unnamed/unknown/unverifiable target; checks the credential names its project; checks the cluster fingerprint |
| Migration ledger | `scripts/migrate.mjs` | `status`/`verify`/`adopt`/`apply`/`reconcile`; each file + its ledger rows commit in one transaction |
| Baseline strategy | `SCHEMA_STRATEGY.md`, `supabase/baseline/*.json` | Frozen per-environment schema, forward-only files, `npm run verify:baseline` |
| Backups / restore verification | `scripts/backup-database.mjs`, `scripts/restore-verify.mjs` | Per-environment dumps with manifests; restore verification into a throwaway database |
| Safety guards | `npm run verify:targeting`, `verify:workflow`, `verify:credentials`, `tests/unit/*` | Each refusal is an exit code, proved at the process boundary |
| Isolation proof | **`npm run verify:isolation`** (added 2026-10-12) | Plants a random canary in Development, scans **every** text column of every `public` table in all three environments, and reports PASS / FAIL / BLOCKED |

## 4. Three measured facts that fix the provisioning method

1. **The migration directory cannot build a database from empty.** The first file fails and
   cascades: `0009 … relation "users" does not exist`. It is a patch set, not a baseline
   (`SCHEMA_STRATEGY.md` §1).
2. **The accepted staging artifact is usable as a seed**: it is **`public`-schema only** (zero
   `CREATE SCHEMA` statements, every object qualified, `@phase:` markers, idempotent guards) —
   `backups/backup-staging-bpybjrjenwccowvtrevu-2026-10-06T17-00-31.sql`, sha256 recorded in
   `supabase/baseline/staging-baseline.json`.
3. **The artifact sits at ledger position `0187`; staging is now at `0197`.** So a Development
   project seeded from the artifact needs exactly the forward range `0188 → 0197`, which is the same
   selection already proven in PGlite:

   ```
   npm run verify:baseline -- --baseline staging --since 0188
   → 10 files, 134 statements, 0 SQL failures, 0 environment-gap failures, SUMMARY PASS
   ```

## 5. What the owner has to do (no secret ever goes into a chat, a file in the checkout, or a commit)

**Step 0 — pick the owner account.** Any Supabase account that is *not* the current owner of the two
existing projects. Creating the project under it is all that is needed; no upgrade, and nothing about
the existing org changes.

**Step 1 — create the project** (either route is fine):

* *Route A, in the dashboard* of the second account: New project → name `Agri-shop-App-Dev` →
  region **the same region as QA** → Database password: generate, do not reuse → create.
* *Route B, through the CLI*: authenticate the CLI as that account once —
  `supabase login` (paste the token into the CLI's own prompt; it is stored in
  `~/.supabase/access-token` and never needs to be shown to anyone) — then say so, and I will run
  `supabase projects create` myself and read the ref back.

**Step 2 — hand over four values, securely.** Create `~/.agrishop/development.env` (outside this
repository, same rule as production's file) containing, from the new project's dashboard
*Settings → API* and *Settings → Database*:

```
DEV_DB_HOST=aws-0-<region>.pooler.supabase.com
DEV_DB_USER=postgres.<new-project-ref>
DEV_DB_PASS=<the database password set in step 1>
DEV_ANON_KEY=<the anon/publishable key>
```

Tell me the path exists — nothing else. I will read it, write `.env.local`, and never print a value.
The same file is what lets the isolation proof's Development leg run.

**Step 3 — nothing else.** The remaining steps are commands I run, and every one of them is
reversible or read-only: provisioning touches only the new project, staging and production are only
ever read.

## 6. The provisioning sequence (runs once step 2 is done)

Each step names what it proves; a step that cannot prove its claim stops the sequence.

```bash
# 6.1 Record the project — Development becomes targetable, and only with DEV_ credentials.
#     environments.json: development.projectRef = "<ref>", status = "active".
#     Prove: node scripts/migrate.mjs status --env development   (refuses only on credentials now)

# 6.2 Point the development files at it.
#     .env.local → VITE_APP_ENV=development, the dev URL + anon key, VITE_OTP_DELIVERY=demo, DEV_DB_*
#     Prove: npx tsc --noEmit && npm run build     (the build gate refuses a development build that
#            reaches the production project; it is the app-side half of the isolation rule)

# 6.3 Seed the new project's schema from the accepted artifact — a logical dump applied to a
#     BRAND-NEW project, which is the only restore shape docs/RECOVERY.md §5 permits.
#     Prove: the object counts in supabase/baseline/staging-baseline.json (54 tables, 163 functions,
#            4 views, 100 indexes, 37 triggers, 83 policies) are counted back on the new project.

# 6.4 Anchor forward bookkeeping — the existing adopt mode, unchanged:
node scripts/migrate.mjs adopt --env development --attest 0197 --apply
#     It records all 189 files with their sha256 AND prints per-file object evidence, so the claim
#     "this schema is at the directory's state" is checked against the live database, not assumed.

# 6.5 Prove the ledger and the directory agree on the new project:
node scripts/migrate.mjs verify --env development
#     Expect: "Directory and ledger agree exactly".
#     (If any file's objects are missing, the correct response is to apply that file through
#      `migrate.mjs apply --env development --apply` after 6.6 — never to re-adopt.)

# 6.6 Verify the forward files against the DEVELOPMENT baseline before/as they are applied:
npm run verify:baseline -- --baseline staging --since 0188      # the selection already proven PASS

# 6.7 Seed disposable data and prove isolation:
npm run verify:isolation -- --json backups/isolation-report-development.json
#     Expect: ISOLATION: PASS — canary present in development, absent from staging and production
#     across every text column of every public table.
```

Two pre-existing limitations, stated rather than papered over:

* **The seeding scripts are QA-prefixed.** `scripts/reset-qa-baseline.mjs` refuses anything but the
  QA project, and `scripts/provision-auth-sessions.mjs` reads `QA_*`/`.env.qa`. Seeding Development
  therefore needs those scripts made prefix-aware through the existing helper
  (`hydrateCredentialsFromEnvFile` + each environment's `envPrefix`). Until that is done, Development
  data is seeded by hand or by loading the artifact in 6.3 (which brings QA's demo fixtures with it).
* **The production leg of the isolation proof needs an approved read path.** `PROD_DB_*` do not exist
  in this checkout by design, and `scripts/run-with-production-credentials.mjs` deliberately
  allow-lists only `backup-database.mjs` and `restore-verify.mjs`, so it will refuse to launch
  `verify:isolation`. Options: extend that allow-list with this read-only tool (a deliberate,
  one-line safety decision, and `npm run verify:credentials` asserts the current allow-list), or
  accept that production's leg is evidenced by the identity/cluster checks and its unchanged ledger.
  **Not decided here — it is the owner's call.**

## 7. Release paths, as they actually are

| Environment | Build / release path today |
|---|---|
| **Development** | The local CLI stack: `npm run local:db -- up\|init\|seed\|verify`, then `npm run dev` (`.env.local` → `http://127.0.0.1:54321`), `npx tsc --noEmit`, unit guards, `npm run build`. No APK, no deployment, no hosted project. See `LOCAL_DEVELOPMENT.md`. |
| **Staging / QA** | Migrations: `node scripts/migrate.mjs apply --env staging --apply`. Browser E2E: `npx playwright test` / `npm run test:e2e:lanes`. APK: **`.github/workflows/build-apk.yml`** only — it runs on push to `main` or `workflow_dispatch`, runs the QA suite, and builds a **staging** APK (`VITE_APP_ENV: staging`, QA project, release-signed) published as release `apk-build-<run>`. |
| **Production** | ⚠️ **There is no production release path in this repository.** The APK workflow is QA-only; `scripts/migrate.mjs` refuses production by policy (its ledger reads `0016` against `0197` in the directory); `backup-database.yml`'s production credentials are not configured, so that job fails by design. No new production workflow has been invented here, and no production migration has been attempted. |

## 8. Evidence index

| Claim | Evidence |
|---|---|
| Development has no project; QA and production do | `supabase projects list` (2 projects, both `ACTIVE_HEALTHY`) |
| Creation is blocked by the free-plan limit | the refusal message quoted in §2, 2026-10-12 |
| The directory cannot build from empty | `0009` → `relation "users" does not exist` |
| The staging artifact is a valid public-schema seed | `supabase/baseline/staging-baseline.json` + `--since 0188` → **SUMMARY PASS** (10 files, 134 statements, 0 failures) |
| QA is untouched and consistent | `node scripts/migrate.mjs status --env staging` → *directory and ledger agree exactly*, 189 files, newest `0197` |
| Isolation is **not** proven yet | `npm run verify:isolation` → `ISOLATION: BLOCKED - NOT PASS` (development: no ref; production: no credentials) |
| The isolation scanner is non-vacuous | `npm run verify:isolation -- --self-test` → 6/6 PASS in-process: a present token is found, an absent token is not |
| The scanner really searches QA | the same run scanned **465 columns** across staging's `public` schema, 0 unreadable |

## Changelog

| Date | Change |
|---|---|
| 2026-10-12 | Written. Records the free-plan blocker, the second-account decision, the provisioning sequence on the existing tooling, and the isolation proof that will close it. Development is **BLOCKED — NOT PASS**. |
| 2026-10-12 (later) | **Superseded for Development.** Local Development moved to the Supabase CLI stack on this machine (no third project, no hosted credentials): `scripts/dev/local-db.mjs` builds the database from the frozen staging baseline artifact + forward files `0188→0197`, applies the hosted platform default privileges first (without them every PostgREST read is 403 — the artifact carries no GRANT), seeds local fixtures and auth logins, and asserts both the object counts and the API-role privileges. Runbook: `LOCAL_DEVELOPMENT.md`. Guard: `tests/unit/localDevDatabaseOrdering.test.ts`. QA, production and the APK workflow are unchanged. |
