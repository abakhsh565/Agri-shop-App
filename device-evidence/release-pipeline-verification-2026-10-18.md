# Release pipeline — inspected, measured, and what is still not safe

**Date:** 2026-10-18 · Branch `production/schema-reconciliation` · HEAD `9ae65ec` at measurement (the branch is not pushed; this report and the gate fixes are its own commit)
**Production app commit:** `7d19c25` (`main`) — 19 commits behind this branch's HEAD
**Production ledger:** 44 rows, latest `0231`

Nothing in production was written by this pass. Every production command below ran inside
`BEGIN … READ ONLY`, or was the allow-listed restore verifier.

---

## 0. One line

**Migrations: gated, verified, backed up, and measured — PASS.** **Web releases: not gated.** Production went
live at 2026-10-16T15:18:55Z on commit `7d19c25`, whose own CI run began one second later and failed
14m46s in (QA job, 6 integration files). Nothing in the repository can require CI green before a
push to `main` deploys, because branch protection and rulesets are unavailable on this private repo's
GitHub plan (both endpoints return 403). The branch that fixes those 6 files is not pushed, so the
fix is not deployable yet.

---

## 1. Only approved code and required migrations reach production — **FAIL** (code half), **PASS** (schema half)

### Code: deployed without a green gate — evidence

| Fact | Evidence |
|---|---|
| Live production deployment is `7d19c25` on `main`, `READY` / `PROMOTED` | Vercel `VERCEL_GET_DEPLOYMENTS` (target=production): `meta.githubCommitSha = 7d19c257…`, deployment created **2026-10-16T15:18:55.864Z** |
| That commit's CI was **red** | `gh run view 38922913714`: started 15:18:56Z, `failure`, 14m46s; QA job `Test Files 6 failed \| 37 passed` |
| Nothing requires the check | `gh api …/branches/main/protection` → 403 "Upgrade to GitHub Pro"; `…/rulesets` → 403. The gate exists; the **requirement** does not |
| The red commit also produced no APK | `gh run view 38922912558`: Build APK failed in **Run Tests** (the same 6 files), so the build never started |

So "approved" means "the owner pushed it", not "the gate passed".

### Schema: the gate is real — evidence

`scripts/migrate.mjs` refuses `--env production` before reading a credential, except
`apply --files <batch>`. `scripts/lib/production-batch-gate.mjs` enforces four preconditions (named,
ascending, in-position batch; a PASS report on production's own baseline ≤60 min old and not outpaced
by a file edit; a backup ≤60 min old; that exact backup restore-verified), all pure and unit-tested.
`0230` and `0231` each went through it:

| File | Verification | Backup / restore | Applied |
|---|---|---|---|
| `0230` (storage write policies) | PASS, 10 statements, 0 failures, baseline sha256 verified (`backups/0230-verified.json`) | backup 19:41Z, restore PASS | 2026-10-17T19:44Z |
| `0231` (PIN columns) | PASS, 3 statements, 0 failures (`backups/0231-verified.json`) | backup 19:59Z, restore PASS (integrity/replay/counts/structure/digests/auth all true) | 2026-10-17T20:01Z |

Measured afterwards (read-only): ledger **44 rows**, latest `0231`, **0 unapplied** files, **223/223**
files byte-identical to the hash the ledger recorded, every batch-era version carrying both its
statement rows and its file row.

**Smallest fix:** stop auto-deploying `main` to production; deploy from a workflow that runs after the
`gates` + `qa` jobs (`needs:`/workflow_run) or through a Vercel Deploy Hook called only on a green
run. Branch protection is not available on this plan, so the gate has to live in the deploy path,
not in a repository setting.

---

## 2. QA/demo users, transactions, images and test data never enter production — **PASS** (measured now)

`scripts/measure-production-final-state.mjs --env production` (read-only transaction), **19/19**:

```
PASS  no seeded demo identity or login survives — {"users":0,"logins":0,"identities":0}
PASS  the tenant shell survived the reset — {"shops":1,"branches":1,"users":0,"memberships":0,...}
PASS  no test transaction survives in any transactional table — 14 tables, all 0
      (sales, sale_items, returns, return_items, voids, purchases, purchase_items,
       customer_payments, supplier_payments, inventory_movements, stock_adjustments,
       notifications, audit_events, sale_submissions)
PASS  no derived figure is left over from a deleted row — balances, purchases, paid, stock all 0
PASS  no stored image or object survives in any bucket — {"total":0,"byBucket":{}}
PASS  anon holds no privilege on any public table — {"grants":0}
PASS  no policy in public is addressed to anon or public — {"policies":0}
```

The storage check is **new in this pass**: images are data too, and nothing in the recurring
measurement counted them before. Prior evidence for the removal itself:
`production-demo-identities-removed-2026-10-18.md` (71 objects) and `0230` (0 anonymous write
policies remain).

No import path from QA to production exists in the repository (no dump/restore-into-production
script); the executable guards are `tests/unit/productionDataPolicy.test.ts` and this measurement.

---

## 3. Existing users' accounts, data and balances untouched by unrelated releases — **UNKNOWN** (nothing to measure) + one real gap

Production holds **0 users and 0 memberships** right now (measured above). There is no existing user
data to compare before/after, so an empirical invariance proof cannot be produced today — and a
report claiming "balances unchanged" would be claiming a measurement that does not exist.

Structurally the four files added in this release only create/replace functions and policies and
add columns (`0230`, `0231`), each in its own transaction, each pre-verified on production's frozen
baseline. But the apply gate hashes **files**, not **rows**: it would not notice a migration that
performed an `UPDATE` or `DELETE` on user tables.

**Smallest fix:** capture a read-only data fingerprint at apply time — row counts plus an
`md5(string_agg(id … order by id))` for `users`, `shops`, `branches`, `memberships`, `customers`,
`products`, `product_variants`, `sales`, `sale_items`, `customer_payments`, `purchases`,
`supplier_payments`, `inventory_movements`, `companies` — and refuse the batch if a profiled table's
fingerprint changes and the batch was not explicitly marked data-changing. Write pre/post into the
verification report so the "unchanged" claim is a number, not a reading of the SQL.

---

## 4. Migrations preserve data, and failure/rollback is safe — **PASS**, with rollback = restore

| Guarantee | Where it is enforced | Evidence |
|---|---|---|
| The file and its ledger rows commit or roll back **together** | `scripts/migrate.mjs` — one transaction per file containing the statements and both ledger halves | header contract + `tests/unit/productionBatchGate.test.ts` (42 tests, green in the 1020-test suite) |
| A failed statement stops the run; nothing half-applied is recorded | same; the ledger is read back after the batch and a file that ran without its row fails the run | plan §7.1, gate rule 4 |
| Re-running resumes instead of double-applying | matching hash → skipped; different hash or no hash → stop | `migrations.mjs` + gate tests |
| An applied file is never edited to fix it | hash drift is a stop, and `measure-production-final-state` re-checks all 223 files | 223/223 match, 0 drifted |
| Every production write starts from a restorable backup | gate rule 3/4; `restore-verify` replays into a throwaway database and compares structure, counts and digests | `restore-verification-0230/0231.json` — integrity, replay, counts, structure, digests, auth all true |
| The nightly backup still runs | `.github/workflows/backup-database.yml` + watchdog | scheduled runs green 2026-10-16T06:46Z and 2026-10-17T06:38Z; watchdog green 08:47Z |

**Rollback is a restore, not a down-migration.** `docs/RECOVERY.md` records that production restore
has never been performed and is human-approved only; `0230`/`0231` were applied with a verified
backup minutes old, which is the rollback point. That is safe for additive files; it is **not**
sufficient for a destructive migration, and the gate's "no pre-0177 files" rule is what keeps
destructive history from being replayed.

---

## 5. Production and QA credentials, databases and configuration stay isolated — **PASS**

| Proof | Result |
|---|---|
| Target resolution refuses the wrong environment | `node scripts/verify-targeting-refusals.mjs` — **8/8**: unknown env, dev without a ref, production without credentials, production **carrying QA credentials**, QA **carrying production credentials**, unverifiable pooler user; plus a control proving valid credentials are not refused |
| Credential intake cannot be repurposed or leak | `node scripts/verify-credential-intake.mjs` — **23/23**, including the fresh-canary leak test and a mutation test proving the validation call site is load-bearing; the file must live outside the repo |
| Production's deployed config points at production | Vercel production env `VITE_SUPABASE_PROJECT_ID = gkswcfljxlutkfdvvqng` (production), `VITE_APP_ENV = production`, `VITE_OTP_DELIVERY` set; CI/QA secrets resolve `bpybjrjenwccowvtrevu` (`[EnvGuard] Environment verified: bpybjrjenwccowvtrevu` in every integration run) |
| The app refuses the wrong project itself | `src/lib/environmentContract.ts`: a non-production build naming the production project is refused, and production naming anything else is refused |
| Workflow safety | `node scripts/verify-workflow-safety.mjs` — **24/24**, including "the staging artefact is refused for a production run" and "QA credentials do not satisfy a production preflight" |

**Limitation, stated rather than papered over:** `verify-environment-isolation.mjs` plants a canary in
development and searches for it everywhere. Its development→staging legs ran (not found in 475
columns); its **production leg was BLOCKED** because the credential wrapper does not allow that
script, and the script correctly prints `ISOLATION: BLOCKED - NOT PASS` rather than a pass. Production
identity is proven by the measurement connecting as the production project and reading its ledger,
not by the canary sweep.

---

## 6. GitHub Actions releases the intended commit, without local working-tree changes — **PASS** on identity, **FAIL** on outcome

* Every job starts with `actions/checkout@v7` and builds the SHA GitHub pushed. A local dirty tree
  (`.freebuff/*`, `tests/e2e/results.json`, untracked `device-evidence/`) cannot enter either build —
  Vercel records the same commit (`meta.githubCommitSha`), and the APK workflow runs Gradle against
  the checkout.
* `git status` dirt is therefore not a release risk by construction. What *is* a risk is that the
  last two pushes to `main` produced **red CI and a red APK build** (`38922913714`, `38922912558`,
  `38919815452`): the APK job dies in **Run Tests**, so no signed artifact exists for `7d19c25`.
* The workflows never touch production: CI's env is the QA project only, and `migrate.mjs verify`
  runs with `--env staging`.

**Smallest fix:** the same one as §1 — deploy after the gate — plus fixing the QA job so the APK job
is reachable. At HEAD the cause is gone: the 6 files that failed now pass (§7).

---

## 7. Reuse valid evidence; test only what was uncovered — **PASS**

Reused without re-running: storage/PIN migration evidence and their two restore reports; the
production measurement's 18 checks; demo-removal evidence; targeting/workflow/credential already-green
proofs where the code had not changed.

New, because nothing covered it:

| Risk that had no evidence | What was run | Result |
|---|---|---|
| Do the 6 files that failed on the **deployed** commit still fail? | the exact 6 files, `--fileParallelism=false`, against QA at HEAD | **6 files, 110/110 passed, EXIT=0** — the deployed failure was real and the branch fixes it, not flake |
| Is the branch gate-green overall? | `npx tsc --noEmit`, `npx vitest run tests/unit`, `npm run build` | tsc clean; **1020/1020** unit tests; build 6.68s |
| Do stored images survive in production? | added a `storage.objects` count to the read-only measurement | **0 objects, 19/19 checks** |
| Is the live app the intended commit, and against which project? | Vercel deployments + production env | `7d19c25`, project ref `gkswcfljxlutkfdvvqng` |
| Does every pending migration have a production disposition? | the unit guard found **two missing** (`0230`, `0231`) — a real red gate | added both rows to plan §5 and corrected its status header; `productionMigrationPlan` **17/17** |

The `productionMigrationPlan` failure is the proof that the guard is not vacuous: it caught the two
files this release added, on the first full unit run after they were committed.

---

## 8. Verdict and the two smallest fixes

| # | Item | Status |
|---|---|---|
| 1 | Only approved code + required migrations reach production | **FAIL** (code deploy ungated) / PASS (schema gate) |
| 2 | QA/demo users, transactions, images never in production | **PASS** (19/19 measured) |
| 3 | Existing users' data/balances unchanged by unrelated releases | **UNKNOWN** — 0 users to measure; gate hashes files, not rows |
| 4 | Data preserved; failure/rollback safe | **PASS**, rollback = the restore-verified pre-apply backup |
| 5 | Prod/QA credentials, databases, configs isolated | **PASS** (production canary sweep BLOCKED, stated) |
| 6 | Actions releases the intended commit, no local dirt | **PASS** (identity) / **FAIL** (red artifact) |
| 7 | Reuse evidence, test uncovered risks | **PASS** |

**1. Gate the deploy, not the branch setting.** Run production deployment from a workflow that
`needs:` the gates and QA jobs (or call a Vercel Deploy Hook only on a green run) and turn off
automatic production deploys for `main`. This is the only fix that survives the missing branch
protection.

**2. Fingerprint user data in the apply gate.** Row counts + per-table id digests, before and after,
recorded in the verification report; a change on a table the batch did not declare is a refusal. That
turns §3 from UNKNOWN into a measured PASS on the day production has real users.

Until both exist, this pipeline is **not** fully release-safe: the schema path is, the code path
is not.
