# Post-merge proof, first live alert, and a timed recovery drill — 2026-10-16

Three things were outstanding after the production credentials pass of 2026-10-16, and all three are
answered here with the artefact's or the API's own record: the corrected workflow had never run **on
`main`**, nothing had ever **alerted** about a bad backup, and the RTO was an agreed figure that no
restore had ever produced. What follows is measured, and the parts that could not be measured are named
as such rather than implied.

---

## 1. PR #1 merged, and the corrected workflow proved on `main`

| Observation | Value |
|---|---|
| Merge | **PR #1 merged** `2026-10-16T00:45:48Z`, merge commit **`de1a962e`**, 64 commits, base `main` |
| `main` now carries | the workflow fix, the **upload-before-reporters** ordering, `tests/unit/backupTargeting.test.ts` (28 tests), `tests/unit/backupHealthWatchdog.test.ts` (25 tests), `.github/workflows/backup-watchdog.yml`, `scripts/check-backup-health.mjs` |
| Step order on `main` | `Upload the backup and its verification report` (L186) **before** `Summary` (L199) and `Failure notice` (L233) — read from `origin/main`, not from the working tree |
| Run on `main` | **`38831480604`**, `workflow_dispatch`, `environment=production`, reason *"post-merge proof: the corrected workflow must run on main and upload its verified artefact"* |
| Conclusion | **success** — every step ✓ in order: *Take the backup* → *Verify the backup against the environment it names* → *Confirm the artefact names the environment it was asked for* → **Upload** → *Summary* |
| Artefact stored by it | **`database-backup-production-37`** — **53,239 bytes**, digest `sha256:f5134f9c7e8149618c8bb3ffc5ec010189e4e36d6f96c66a5d5d50019062130c`, **expires 2026-11-15T00:48:15Z** |

This is the thing the phase had been missing: before this run, the *only* production artefact on GitHub
came from a dispatch on the branch (`38828524870`), and the scheduled 02:00 UTC run on `main` still took
the pre-fix workflow — green, and discarding its own artefact at the Summary step. There are now two
production artefacts, the newest of them produced by `main`.

*Not carried over:* the branch's `ci-proof/full-tree` was left in place, not deleted.

## 2. The first real alert, and the watcher closing it by itself

No simulation was needed for either half. `main`'s newest completed backup run at the moment the
watchdog first ran was **`38826369696` — `failure`**, so the condition was real.

| Step | Run / result |
|---|---|
| Watcher dispatched on `main` | **`38831384562`** — conclusion `failure` (exit 1, by design) |
| Its decision | `"state": "red"`, `"completedRuns": 2`, `"simulated": false`, *"The newest completed backup run ended \"failure\", so the newest verified backup is older than the RPO allows."* |
| Alert action | `"action": "opened"`, **`"issue": 2`** — *Backup watchdog alert — red* (no `[SIMULATED]` prefix) |
| The issue body | the marker `<!-- backup-watchdog state=red run=38826369696 -->`, the failing run linked (`#35`, `workflow_dispatch`, `2026-10-15T23:54:32Z`), live artefacts `0`, the RPO row (*24 h (+3 h slack = 27 h)*), and four numbered next steps ending in "re-run this watcher; it closes this issue when the backup is healthy again" |
| After the successful backup above, the watcher re-run | **`38831620800`** — conclusion `success`; decision `"state": "ok"`, *"Verified backup 0.0 h old with 1 live artefact(s), within the 24 h RPO."*; action `"closed"`, issue `2` |
| Issue #2 now | `state=CLOSED`, `stateReason=COMPLETED`, `closedAt=2026-10-16T00:49:04Z` |

So the whole loop is demonstrated against real conditions, not a rehearsal: a red run opened an issue
that names the cause and the next step, and a healthy check closed it without a human touching it. The
rehearsal path (`--simulate`) exists and is guarded, but it was not needed to prove firing, and the
scheduled watcher is armed on `main` at **04:40 UTC daily**, after the 02:00 UTC backup it judges.

*One thing this does not prove:* that the alert reaches a human who is not looking at GitHub. It is an
issue in the repository, which is the channel that was asked for; there is still no email or push.

## 3. The timed recovery drill

The drill starts where a real recovery would start if this machine were lost: **from the artefact stored
on GitHub**, not from the local copy. Source: the artefact of run `38831480604` (§1), i.e. a backup taken
by `main` minutes earlier.

| Phase | Measured | What it did |
|---|---|---|
| Fetch the artefact | **3.584 s** | `gh run download 38831480604 --name database-backup-production-37` — dump + manifest + the run's verification report |
| Verify it is the artefact GitHub recorded | **3.145 s** | downloaded the raw archive (`53,239 bytes`) and hashed it: local `sha256=f5134f9c…` **=** the API's `digest` — **bit-identical to storage** |
| Replay and verify against live production | **23.235 s** | `run-with-production-credentials.mjs -- node scripts/restore-verify.mjs --from <manifest> --compare-with production` |
| **Mechanical total (artefact → verified)** | **29.964 s ≈ 30 s** | of which 1.08 s is the replay itself; ~22 s is the live comparison over the network |
| Elapsed wall clock of the drill as performed | 139.8 s | includes the pauses between three separately-issued steps by hand; reported so the 30 s figure is not mistaken for what a human typing it out takes |

What the verification tool reported, in its own words (`verdict` from the report it wrote):

| Check | Result |
|---|---|
| Integrity | `sha256Matches: true`, `bytesMatch: true` — dump `ad7bfd2ef85063792c0578b4…`, `333,989 bytes` |
| Replay | **`769` statements, `failures: 0`**, `expectedFailures: 0`, `durationMs: 1079`, 2 auth-shim tables |
| Counts | per table `content identical` — `shops 1/1`, `users 4/4`, `customers 6/6`, `products 6/6`, `product_variants 12/12`, … |
| Structure | tables `live 28 / restored 28`, `missing 0`, `extra 0`, `changed 0` |
| Digests | all compared tables identical |
| Auth | `auth.users 2/2`, `auth.identities 2/2` through the shim |
| **Verdict** | **`PASS` on all six — `failures: []`** |
| Restore target | **`pglite`** — the isolated, in-process real PostgreSQL the repository permits; `SAFE_RESTORE_TARGETS` refuses production and staging as restore destinations by design |
| Compared against | live production, read-only: identity `postgres.gkswcfljxlutkfdvvqng`, server user `postgres`, cluster `7666007964130682852` |

### What this drill does and does not settle

**Settled.** The stored artefact is bit-identical to what GitHub recorded; it restores into a Postgres
engine with the schema, the 104 policies, the foreign keys and the auth shim all applied; every count and
digest agrees with live production; and the mechanical path takes **~30 s** at the current size (30 tables
· 249 rows). The `[CREDS]` line the wrapper printed (`host : aws-0-ap-northeast-1.pooler.supabase.com`) is
the connection metadata for that read-only comparison — no credential is printed anywhere.

**Not settled, deliberately.** The drill did **not** provision a production-shaped *Supabase* target, and
did **not** repoint the app. The repository refuses a Supabase restore destination by design, and standing
up a second home for production personal data is the owner's decision, not a side effect of a drill. So
the 4-hour RTO objective in `docs/RECOVERY.md` §9 stands for exactly the parts this drill did not exercise:
provisioning the target, credentials, network access, and the cut-over. The measured 30 s is the part that
was always going to be the easy part — and it is now measured instead of asserted.

**Cleanup:** the drill directory (`backups/drill-2026-10-16/`, gitignored) held a second copy of the
production dump; it was deleted after the run, so this machine holds no additional copy of production data.
The numbers above are the record.

## 4. What is still open, in the same voice as the rest of this phase

1. **The 4-hour RTO has never been drilled against a real target** (§3). What is measured is the tool path.
2. **Alerting reaches GitHub only.** Issue #2 is actionable and self-closing; it does not page anyone.
3. **The scheduled run's own history is still short.** Two completed runs existed on `main` when this
   evidence was written — one failed, one dispatched by hand and green — and the newest, `38831480604`,
   was a manual dispatch, not the cron. So "the schedule fires daily on `main` and stays green" is not yet
   a claim this repository can make; the first *scheduled* run on the corrected `main` is the next one at
   02:00 UTC.
4. **Vercel's preview deployment for the branch is red, and was red before this work.** Every branch
   deployment since `2026-10-14` failed while `main`'s production deployment succeeded, and `npm run build`
   on this head exits 0 — so it is a preview-scope environment condition, not this branch's code. It is
   recorded here rather than quietly ignored, and it does not gate the merge (no branch protection is
   configured on this plan).

## 5. Records updated

* `docs/RECOVERY.md` §9 — the production RTO row now names the measured drill and what remains uncovered;
  §11 gains the run on `main` and the drill.
* `device-evidence/production-credentials-and-backup-2026-10-16.md` §6 — the merge row is closed.
* This file is the drill's record: phases, digests, verdict and limits.
