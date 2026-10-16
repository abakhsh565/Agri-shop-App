# Production credentials & secure configuration — closed and measured, 2026-10-16

**Branch** `ci-proof/full-tree` @ **`8ee19eb3`** (0 ahead / 0 behind `origin`) · **Production project**
`gkswcfljxlutkfdvvqng` · **enrolled cluster fingerprint** `7666007964130682852` · **QA project**
`bpybjrjenwccowvtrevu`. No credential value appears anywhere in this record, in any log, or in any
command line — that is asserted below, not assumed.

**The item this answers, verbatim:** *"Production credentials and secure configuration — production
cannot be configured or deployed safely without the required credentials and environment settings.
Identify the exact missing credentials and configuration. Set them securely through the approved
secrets system. Never expose secrets in code, logs, or chat."*

---

## 1. The exact required set — from the repository's own declarations, not from memory

`scripts/lib/credentials-file.mjs:33` is the authority:

```js
export const CREDENTIAL_KEYS = ['PROD_DB_HOST', 'PROD_DB_USER', 'PROD_DB_PASS'];
```

Two consumers, both named by the repository itself:

| Consumer | Where it is declared | Which of the keys it needs |
|---|---|---|
| CI backup / restore-verify job | `.github/workflows/backup-database.yml:72-74` (`secrets.PROD_DB_*`) | all three |
| Local read-only production run | `scripts/run-with-production-credentials.mjs`, file at `~/.agrishop/production.env` (`docs/RECOVERY.md:53`) | all three |

One configuration item is **not** a credential: `vars.APP_LINK_HOST` (`build-apk.yml:211,256`), the
https App-Link host for `assetlinks.json`, deliberately gated until a real https host exists
(`build-apk.yml:208`).

## 2. What was present, and what was missing — measured, before and after

| Item | Before this pass | After |
|---|---|---|
| `PROD_DB_HOST` (Actions secret) | present (set 2026-09-30) | **re-set 2026-10-16T23:54Z** from the validated file |
| `PROD_DB_USER` (Actions secret) | present (set 2026-09-30) | **re-set 2026-10-16T23:54Z** from the validated file |
| `PROD_DB_PASS` (Actions secret) | **ABSENT** — the recorded cause of run `38696121562` dying at the credential preflight | **set 2026-10-16T23:54Z** |
| `~/.agrishop/production.env` (local, outside the repo) | present; not re-measured this session | **validated**: `OK — 3 keys loaded, PROD_DB_USER names production (gkswcfljxlutkfdvvqng)`, host `aws-0-ap-northeast-1.pooler.supabase.com`, `pass: loaded, value withheld`, exit 0 (`npm run creds:production -- --check`) |
| `APP_LINK_HOST` (Actions variable) | unset (`gh variable list` → empty) | **still unset — owner decision**, see §6 |

**How the value was moved, so this claim is checkable.** The two existing secrets were refreshed and
the missing one set from the single validated out-of-repo file, through the repository's own parser
(`parseCredentialsFile`) writing to `gh secret set <name>` **stdin** — `--body` was never used, so the
value never entered argv, never entered the process environment, was never written to any temporary
file, was never echoed, and was never typed into chat. `gh secret set` encrypts locally before
sending. Proof of the write is the secret listing's own timestamp: `PROD_DB_PASS 2026-10-15T23:54:19Z`
(UTC; = 2026-10-16 local), where the same key did not exist an hour earlier.

## 3. The end-to-end proof — CI, production target, restore-verified

Dispatched through the repository's own workflow, `environment=production`, run
**[38826369696](https://github.com/abakhsh565/Agri-shop-App/actions/runs/38826369696)**. Step-level
result (`gh run view --json jobs`), which is where the diff from the recorded failure lives:

| Step | Result |
|---|---|
| Confirm the target is a known environment | ✓ success |
| **Preflight — the selected environment must have credentials** | ✓ **success** — this is the step run `38696121562` failed |
| **Take the backup** | ✓ **success** — production dumped |
| **Verify the backup against the environment it names** | ✓ **success** — restore-replay accepted |
| Confirm the artefact names the environment it was asked for | ✓ success |
| Summary | ✗ **failure — a workflow bug, root-caused and fixed, §4** |
| Upload the backup and its verification report | **skipped** — because the Summary step died first |
| Failure notice | ✗ (by design; it is the failure path) |

So: **the credentials are correct and the production backup + restore verification both succeed in
CI** — the run is red on a reporting defect, not on a credential or a data defect. That defect is
repaired, committed (`92a8802a`) and published in PR #1, with the repository's own guard re-run green
(§4); the consequence while it is unmerged is stated plainly in §6.

**Update, later the same day — the fix proven on the branch, artefact stored off-machine.**
`workflow_dispatch` runs the workflow file from the ref it is given, so the corrected file was run
directly: `gh workflow run backup-database.yml --ref ci-proof/full-tree` → run **`38828524870`**, **every
step ✓** — *Preflight*, *Take the backup*, *Verify the backup against the environment it names*,
*Confirm the artefact names the environment it was asked for*, **Summary**, **Upload**. The verify step's
own executed output on that run: *Statements: 769 applied in 0.3 s · Failures: 0 · PASS integrity ·
replay · counts · structure · digests*, with the live source identity compared; the logs mask the
credentials (`PROD_DB_PASS: ***`). The artefact now exists **off this machine**:
`database-backup-production-36`, **53,237 bytes**, digest
`sha256:1c8d0abd7a6d1023ac3ae83f39a1542f4da09392a9c70416692654ea659a00ca`, **expires 2026-11-15**
(the agreed 30-day retention). Coverage therefore no longer waits on the merge — only the *scheduled*
02:00 UTC run does.

## 4. The defect this pass found, and its fix

The Summary step read the manifest with `require(process.argv[1])`, and the argument is a **relative
path** (`backups/backup-production-….manifest.json`). A relative specifier without a `./` prefix is
resolved as a *package name*, so the child died:

```
Error: Cannot find module 'backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-54-54.manifest.json'
    at Function._resolveFilename …  code: 'MODULE_NOT_FOUND'
```

Because the Summary step is ordered **before** the upload and carries `if: always()`, a typo in the
report discarded a **verified** production backup. The fix is the idiom the neighbouring step in the
same file already uses:

```js
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
```

**Guard re-run after the edit** (the repository's own workflow-safety checker, which syntax-checks the
shell blocks and refuses vacuous invariants): `node scripts/verify-workflow-safety.mjs` →
**24 checks: 24 passed, 0 failed, 0 skipped (6 shell blocks syntax-checked) — CERTIFIED**, exit 0.
The edit is **committed on `ci-proof/full-tree`** (`92a8802a`, edited + committed after this guard run)
and published in **[PR #1](https://github.com/abakhsh565/Agri-shop-App/pull/1)** → `main` (OPEN,
`MERGEABLE`, 59 commits); until it is merged the 02:00 UTC scheduled run keeps succeeding at the
backup and losing the artefact (§6, item 1).

## 5. The local read-only path, measured end to end — fresh artefact, verified restore

The repository's documented production path (no `export`, one allow-listed child):

```bash
npm run creds:production -- --check
npm run creds:production -- -- node scripts/backup-database.mjs --env production
npm run creds:production -- -- node scripts/restore-verify.mjs --from <manifest> --compare-with production \
  --json backups/restore-verification-production.json
```

**Backup — exit 0** (`backups/`, gitignored; contains personal data and password hashes, never
committed):

| Field | Value |
|---|---|
| environment / project | `production` / `gkswcfljxlutkfdvvqng` |
| cluster fingerprint | **`7666007964130682852`** — matches the value enrolled in `environments.json` / `docs/RECOVERY.md:53` |
| credential used | `postgres.gkswcfljxlutkfdvvqng` (the project-naming user; a bare `postgres` is refused by design) |
| artefact | `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.sql` — **333,989 bytes**, sha256 `ceb62aa9d3b89c4b…` |
| manifest | `…-2026-10-15T23-57-01.manifest.json` — 2,335 bytes |
| contents | **30 tables · 249 rows · 56 FKs · 104 policies** |

**Restore verification — `RESTORE VERIFICATION: PASS`, exit 0**, report set at
`backups/restore-verification-production.json`:

| Section | Result |
|---|---|
| Integrity | `sha256 == manifest`, `bytes == manifest` → PASS |
| Replay | fresh in-process Postgres (PGlite), **769 statements applied in 1.6 s, 0 failures** → PASS |
| Counts | per-table backup-vs-restored, every table `content identical` (e.g. `supplier_payments` 2/2, `inventory_movements` 17/17, `notifications` 51/51, `voids` 3/3) → PASS |
| Structure | PASS |
| Digests | PASS |
| Auth | `auth.users` 2/2, `auth.identities` 2/2 → PASS |

**One refusal worth keeping, because it is a guard doing its job:** run *without* the injector, the
same command refused the live comparison — `[TARGETING] Refusing to run for "production": missing
PROD_DB_HOST, PROD_DB_USER, PROD_DB_PASS … It will not fall back to another environment's
credentials` → exit 2. The tool cannot reach production by accident.

## 6. What is still open — stated, not smoothed

1. ~~**The workflow fix is not merged to the default branch yet.**~~ **CLOSED 2026-10-16** — **[PR #1](https://github.com/abakhsh565/Agri-shop-App/pull/1)** is **MERGED** (merge commit `de1a962e`, 2026-10-16T00:45:48Z), and the fix has been **run on `main` and proved there**: run **`38831480604`** is green with every step ✓, *Upload* ordered before *Summary*, and it stored **`database-backup-production-37`** (53,239 bytes, digest `sha256:f5134f9c…`, expires 2026-11-15). The same merge delivered the **upload-ordering fix** and the **`Backup Watchdog`** (§8), both guarded by tests. The watchdog then produced the **first real alert** from a real red run and closed it by itself after the successful backup, and a **timed recovery drill** from that run's stored artefact reached a full `PASS` in 30.0 s — all three in
   `device-evidence/recovery-drill-2026-10-16.md`. What is *not* closed: the drill's target was PGlite,
   and the first **scheduled** run on the corrected `main` is still ahead (02:00 UTC).
2. **`APP_LINK_HOST` is unset, and only the owner can fill it** — it needs the real https host the app
   will be served from (`scripts/android-assetlinks.mjs:18` gives `app.agrishop.pk` as an *example*,
   not a decision). The action is one command, and it is a plain variable, not a secret:
   `gh variable set APP_LINK_HOST --repo abakhsh565/Agri-shop-App --body <host>`. Until then the App
   Links `assetlinks.json` upload stays skipped **by design** (deep links still work through the app
   scheme) — unchanged from the recorded state, not a regression.
3. **Deploying production remains refused, and this pass does not change that.** The credentials
   being configured does not touch the repository's other, deliberate refusals: `migrate verify --env
   production` refuses by policy (production's ledger is 182 entries behind; what it needs is the
   `SCHEMA_STRATEGY.md` §D decision, not a replay), `scripts/release-gate.mjs` refuses without
   `--owner-approved`, and `PRODUCTION_READINESS_AUDIT.md` B9 records that nothing is monitored. **A
   backup being possible is not a release being safe** — those two rows read exactly as they did.
4. **The artefact is a production dump** and contains personal data and password hashes. It is stored
   in the gitignored `backups/` directory, the CI copy will live in the owner's GitHub artefacts
   (retention 30 days, and the workflow file itself instructs keeping the repository private and the
   retention window short). Nothing was mirrored anywhere public.

## 7. Records updated

* `device-evidence/production-release-checklist-status-2026-10-15.md` — the *Fresh production backup +
  verified restore* row, the summary table's *Fresh production backup* row, and the top blocking
  list's production-credentials item.
* `feature-registry.json` — not touched: no product behaviour changed, so no feature's evidence is
  invalidated. `productionReachGuard` / `productionDataPolicy` / the credential-literal guards are
  unaffected by a secret existing in GitHub; the local runs above are the measurement.
* The workflow edits carry their own guard: `verify:workflow` 24/24 after the change (§4), re-run green
  after the upload reordering; the ordering and the watchdog are additionally pinned by
  `tests/unit/backupTargeting.test.ts` and `tests/unit/backupHealthWatchdog.test.ts`.
* `docs/RECOVERY.md` §9 — the *time to notice* row moved from *unbounded* to ≤ 27 h, and §11 now records
  the arrangement that discarded run `38826369696`'s artefact and what replaced it.
* `.github/workflows/backup-watchdog.yml`, `scripts/check-backup-health.mjs` — new; they hold no
  production credential and never connect to the database.

## 8. The ordering that discarded a backup, and the watcher the backup never had

Two gaps were still open after §4's fix, and both were closed in the same pass, on the same branch.

**1 — a reporting step could still discard a verified backup.** §4 fixed the summary's `require()` typo,
but the arrangement that made the typo expensive was untouched: `Summary` (`if: always()`) was ordered
*before* the upload. Any failure in a step that only describes the run therefore skipped storage — the
precise mechanism of run `38826369696`, where every gate passed and the artefact was thrown away anyway.
Storage is now the first step after the last gate, and everything after it is a reporter that runs
regardless of the outcome. The upload deliberately still has **no** `if:`: an unverified artefact must
remain impossible to store, so the change removes the ability to *lose* a verified backup without adding
the ability to *publish* an unverified one.

*Guarded:* `tests/unit/backupTargeting.test.ts` parses the job's steps in order and fails when any
reporting step is placed before storage, when the upload becomes conditional, or when a step is inserted
between verification and storage. **Proven non-vacuous by injection:** the old arrangement was restored
once, the suite went red naming run `38826369696` (2 failures, exit 1), the file was restored and the
suite re-run green — **28 tests, exit 0** *(24 before this pass)*.

**2 — nothing noticed a backup that did not happen.** The gap §9 of `docs/RECOVERY.md` had recorded as
*unbounded*: a red run, a green run with no artefact, and a run that never started all looked identical
from outside. `Backup Watchdog` + `scripts/check-backup-health.mjs` now reads the Actions record — never
the database — and decides `ok` · `red` · `missing-artifact` · `stale` · `never-ran` · `unknown`, opening
one issue (commented, not duplicated) and closing it when a healthy check runs. It is a separate workflow
on purpose: a backup cannot report its own absence. It holds no production credential at all, which is
itself guarded.

*Guarded:* `tests/unit/backupHealthWatchdog.test.ts` — **25 tests, exit 0**: one case per shape the
failure has actually taken (including an artefact that *expired*, which is not a backup either), the
threshold boundary at exactly 24 h + 3 h, the schedule's position after the backup it watches, the empty
rehearsal default that keeps an automated run on the real check, the permissions ceiling, and the rule
that a watcher which cannot look reports **unhealthy** (`unknown` → exit 2), never healthy. Run directly
without a token it returns `unknown`, not `ok` — a blind watcher does not report health.

## 9. Recovery objectives — agreed in this pass, and guarded

The same pass closed the one open backup question: **what recovery actually promises**. The figures are
recorded in `docs/RECOVERY.md` §9 and are *enforced*, not merely written:

| Objective | Agreed value | Where it takes effect |
|---|---|---|
| Production RPO | **24 hours**, conditional on the daily run (02:00 UTC = 07:00 PKT, before the trading day) | the workflow's `schedule.cron` |
| Production RTO | **4 hours from the decision to restore** (database, current size) — an agreed target; no drill into a real production target has been run | `docs/RECOVERY.md` §9 |
| Time to notice | **≤ 27 hours** — one `Backup Watchdog` period (daily 04:40 UTC) plus the 24 h RPO and 3 h slack; the watchdog opens an issue labelled `backup-alert` and closes it by itself when the backup is healthy again | `.github/workflows/backup-watchdog.yml` + `scripts/check-backup-health.mjs` |
| Retention | **30 days** of daily artefacts, each travelling with its verification report | the workflow's `retention_days` default |
| PITR | none (Free plan); Pro + PITR → seconds at ~$100/month plus compute | owner decision |

**The guard, and its proof.** `tests/unit/backupTargeting.test.ts` now reads the workflow and §9 and fails
if either side drifts — the cron *is* the RPO, the retention default *is* the retention policy. It was
proven able to fail by injecting the drift once on each side (cron → `0 3 * * *`; §9's RPO → 12 hours),
with each injected file restored **byte-identically** (`cmp`) and the suite re-run green: **24 tests,
exit 0**; `verify:workflow` **24/24** after the workflow comment edits that cite the agreed figures.

**Still outstanding, named rather than implied:** the RTO is a target, not a drilled result — no restore
has been performed into a real production target (PGlite is the stand-in). Detection of *backup*
failure is now bounded (§8); nothing else about production is monitored, so
`PRODUCTION_READINESS_AUDIT.md` B9 still stands for every other signal.
