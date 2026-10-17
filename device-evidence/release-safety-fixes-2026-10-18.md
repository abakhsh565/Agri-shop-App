# The two release-safety fixes — what is gated now, and what was actually run

**Date:** 2026-10-18 · Branch `production/schema-reconciliation` · Production untouched by this pass

The earlier audit (`release-pipeline-verification-2026-10-18.md`) left two holes: the web deploy did
not wait for CI, and the migration gate hashed files rather than rows. Both are now closed in code,
and both were exercised. Where a step could not be run without publishing or writing production, it
says so instead of claiming a pass.

---

## 1. Production deploys only after the gate — **PASS** (gate + decision), **UNVERIFIED** (live Vercel deployment)

### What changed

| File | Change |
|---|---|
| `vercel.json` | `git.deploymentEnabled.main = false` — a push to `main` no longer auto-deploys. Previews are untouched. |
| `.github/workflows/deploy-production.yml` | Runs on a completed CI run (or a dispatch). The job's `if:` requires `conclusion == 'success'` **and** `head_branch == 'main'`; a failed run never enters the job. |
| `scripts/lib/deploy-gate.mjs` | The decision, pure: trigger, conclusion, branch, gated SHA vs current `main` head, token and project present. |
| `scripts/deploy/trigger-production.mjs` | Resolves `origin/main` with `git ls-remote`, asks the gate, and **only then** asks Vercel for `POST /v13/deployments` with `gitSource.sha` = the gated commit — never "the branch". A dispatch fetches that commit's own CI conclusion from GitHub and applies the same rule. |
| `tests/unit/productionDeployGate.test.ts` | 18 tests: the decision matrix, the repository wiring, and the script end to end against a local fake Vercel API. |

### Failed-gate behaviour — measured

The CLI is spawned for real against a local HTTP server that records every request:

```
✓ deploys the gated SHA when every rule holds, and sends exactly one request
✓ makes no request at all when CI failed            (exit 2, 0 requests)
✓ makes no request when the gated commit is stale   (exit 2, 0 requests)
✓ makes no request when the token is missing        (exit 2, 0 requests)
✓ makes no request in a dry run                     (exit 0, 0 requests)
```

Decision matrix (all pass): `failure` / `cancelled` / `skipped` / `timed_out` / `null` conclusions,
a run on another branch, a SHA that is no longer `main`'s head, an unreadable `main` head, a short or
non-hex SHA, a missing token or project, and an unknown trigger — every one refuses with a reason.

Against the real repository, with no network write:

```
gated: bfd4eb79b8…   main: 7d19c2576d…   mode: refused
  ✗ the gated commit … is not main's head …. A newer push must be gated before anything is deployed.   (exit 2)

gated: 7d19c2576d…   main: 7d19c2576d…   mode: dry-run
  DRY RUN — the gate passed and NOTHING was sent to Vercel.                                              (exit 0)
```

### Successful-deployment behaviour — measured up to the network boundary

The successful case sends **exactly one** POST to `/v13/deployments`, with `authorization: Bearer …`,
`target: "production"`, and `gitSource: {type:"github", repoId:"1345429482", ref:"main", sha:<gated>}`.
A deployment id in the answer is required; a 2xx without one is a refusal.

### What is **not** proven, and why

* **No live deployment was triggered.** Doing so would publish this branch to production, which is a
  release decision, not a test. The only untested step is Vercel's own accept-and-build; the request
  it would receive is asserted byte-for-byte.
* **`VERCEL_TOKEN` does not exist yet.** Until it is added as a repository secret (with
  `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID` as variables), the workflow refuses at that step and
  nothing deploys. Fail-closed, as intended — but it means the release path is *blocked* rather than
  merely gated until that one owner action.
* **`vercel.json` takes effect with the commit that carries it.** The push that first lands this file
  may still be auto-deployed by Vercel (it is a config-only change, no app code); from the next push
  onward `main` is not auto-deployed. This is the documented first-commit behaviour of
  `git.deploymentEnabled`, not an assumption of safety.

---

## 2. User data is fingerprinted and preserved — **PASS** (mechanism), **PARTIAL** (production apply)

### What changed

| File | Change |
|---|---|
| `scripts/lib/data-fingerprint.mjs` | 32 protected tables (accounts, memberships, customers, catalogue, stock, every transactional table, derived balances, `storage.objects`). Digest = row count + md5 over the row text **of the columns that existed before**, so an additive column is invisible while an UPDATE/DELETE/INSERT is not. |
| `scripts/lib/data-rehearsal.mjs` | Applies a batch inside `BEGIN … ROLLBACK`, fingerprints both sides, and diffs. Shared by the production apply, the probe, and the tests. |
| `scripts/migrate.mjs` | `apply --env production` now rehearses the whole batch first. An undeclared change refuses **before** anything commits, naming the tables and the `--data-change` flag. After the real apply it re-fingerprints and fails if the committed effect differs from the rehearsal. |
| `scripts/data-fingerprint.mjs` | Read-only CLI (`BEGIN … READ ONLY`) with `--json` and `--compare`; on the production credential allow-list. |
| `scripts/dev/probe-data-fingerprint.mjs` | Real-Postgres proof on the disposable local stack; refuses any non-loopback host. |

### Real Postgres — 10/10 (`node scripts/dev/probe-data-fingerprint.mjs`)

```
PASS  two reads with nothing in between agree
PASS  an UPDATE inside a transaction is detected
PASS  ROLLBACK restores the rows exactly — {"digestEqual":true,"id1":"10"}
PASS  an additive column is invisible to the digest — {"comparedColumns":["id","amount"]}
PASS  a DELETE is detected by count and digest
PASS  a vanished table is a change, not an empty result
PASS  a rehearsed additive migration is allowed and leaves no column behind
PASS  a rehearsed UPDATE of real data is refused, and the rows are untouched — id1 still "10"
PASS  the same UPDATE is allowed when that table is named as approved
PASS  the probe cleans up after itself
```

The seventh through ninth lines are the **same function** `migrate.mjs` calls, not a second
implementation. A rehearsal that would rewrite a balance is refused with the rows untouched; naming
the table allows it and records the change.

### Hosted databases, read-only

| Environment | First read | Second read |
|---|---|---|
| staging (`bpybjrjenwccowvtrevu`) | 32 tables, 5591 rows | **UNCHANGED** (exit 0) |
| production (`gkswcfljxlutkfdvvqng`) | 32 tables, 102 rows, `storage.objects` 0 | **UNCHANGED** (exit 0) |

Both ran inside `BEGIN … READ ONLY`; production through the credential wrapper. The production file
is `backups/fingerprint-production-2026-10-18.json` (gitignored, as the baseline artifacts are).

### What is **not** proven

The production apply's rehearsal has not run against production with a real batch, because
**nothing is pending**: the ledger holds 44 rows, latest `0231`, and every file is recorded. The
mechanism is proven on real Postgres and in unit tests; the first batch that follows this change will
be the first production rehearsal, and it is designed to refuse rather than write if a protected row
moves.

---

## 3. Unrelated work preserved, and the checks that passed

* `npx tsc --noEmit` — clean.
* `npx vitest run tests/unit` — **81 files, 1051/1051** (was 1020 before these tests; the 31 new ones
  are the gate and fingerprint suites).
* `npm run build` — succeeds.
* `node --check` on every changed script, and `node scripts/migrate.mjs --help` loads the new imports.
* Only the files named in §1/§2 are staged; the working tree's other changes (`.freebuff/*`,
  `tests/e2e/results.*`, untracked screenshots) are left exactly as found.
* Production was read (fingerprint, measurement) and never written; QA was read, not modified.

## 4. Remaining, and it is an owner action

1. Add `VERCEL_TOKEN` (secret) and `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` (variables). Until then the
   deploy job refuses and no web release can happen.
2. Push the branch and merge to `main`; the workflow only runs from the default branch, and the
   `vercel.json` switch takes effect from the commit after it lands.
3. Watch the first production deployment end to end. Until that happens, "the live deploy is gated" is
   **UNVERIFIED** even though every gate in front of it is measured.
