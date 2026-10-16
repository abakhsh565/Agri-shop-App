# Schema strategy — frozen baselines, forward-only migrations

**Status:** decided and implemented, 2026-10-01. This supersedes the "A — synchronize the ledger /
B — build a baseline" choice left open in `ENGINEERING_OS_STATE.md` (September 2026), because the
measurements below show **neither alone is sufficient**.

- **Decision:** no environment is ever rebuilt by replaying `supabase/migrations`; each environment
  has a **frozen baseline** (a schema-only *view* of its accepted logical dump), and future changes
  are **new forward files** that are verified by replay onto the target's baseline before they are
  applied anywhere. Production is **read-only** to this whole workstream.
- **Tooling:** [verify-forward-on-baseline.mjs](scripts/verify-forward-on-baseline.mjs) (new),
  [baseline.mjs](scripts/lib/baseline.mjs) (new), records in
  [supabase/baseline/](supabase/baseline/README.md), guard
  [schemaBaseline.test.ts](tests/unit/schemaBaseline.test.ts) (new).
- **Evidence:** every number below is measured; the logs are listed in §7.

---

## 1. Why "replay history" is not available on any environment

The migration directory is a **patch set**, not a baseline: nothing in it creates the base tables
(this was already recorded by `tests/unit/migrationReplayability.test.ts`). Four independent replays,
all in-process PGlite with Supabase scaffolding stubbed:

| Base replayed onto | Result | Verdict |
|---|---|---|
| Empty database | 0009 fails immediately (`relation "users" does not exist`) and cascades; 54/133 applied at the time it was measured | no base |
| `ALL_MIGRATIONS_TO_RUN.sql` (0001–0017) | **78 failed statements in the base itself**; it never creates `shops` | no base |
| `COMPLETE_DATABASE_SETUP.sql` (the production project's own setup file) | **26 files with failures, 54 failed statements** from 0009 onward | not a clean chain |
| Captured **staging** schema (2026-09-30) | **24 files with failures, 44 failed statements** | patch set ≠ chain |
| Captured **production** schema (2026-10-01) | **30 files with failures, 71 failed statements** | patch set ≠ chain |

The failures are a mixture of real lineage divergence (production has no `payments` table and no
`public.get_my_shop_request(text)`; staging has both) and non-idempotent historical patches
(`cannot change name of input parameter`, `policy … already exists`). So the old choice was between
two half-answers:

- **A — synchronize the ledger** makes the *bookkeeping* truthful but leaves the directory
  unreplayable (which is exactly what the staging adoption of 167 files did on 2026-10-01).
- **B — dump a baseline** gives a faithful starting point, but replaying the directory *onto* it
  still fails (table above).

The missing third element is the one this document adds: **once an environment has a baseline, only
NEW files move it forward, and each one is verified against that environment's own baseline first.**
History is provenance; it is never a plan.

## 2. The strategy

1. **Every live environment has a frozen baseline record** —
   `supabase/baseline/<env>-baseline.json`: the accepted logical dump's path, sha256, byte length,
   structure counts, the exact number of data statements, and the policy
   (`forwardOnly: true`, `replayHistory: 'never'`, `migrateTarget`). The tool refuses to run when
   the artifact's sha256 or byte length does not match the record.
2. **The artifact is a logical dump and contains real rows** (measured: production 268 data
   statements, staging 1769 — including `auth.users` rows). It therefore lives only in gitignored
   `backups/`; the record refuses an artifact outside it. The verification tool **counts** data
   statements, compares them with the record, and **never executes** them: verification reconstructs
   schema, not data.
3. **Changes are forward-only.** New work is new files (`0178+`). Nothing is ever edited to "fix
   replay": an already-applied file may only be *cosmetically* reconciled with a recorded reason
   (`migrate.mjs reconcile`), and a semantic edit must be a new migration — the ledger tool refuses
   the alternative.
4. **Every file is verified against the environment it will be applied to**, before it is applied:
   `npm run verify:baseline -- --baseline production --since 0178` (or `staging`). The replay happens
   in PGlite on the local artifact; **no environment is contacted**.
5. **Staging is the forward target.** Files that pass the staging baseline check are applied through
   `scripts/migrate.mjs` so the ledger records file + rows in one transaction. Staging's ledger today:
   169 files (0009→0177), all hashed; 2 applied, 167 adopted, 1 reconciled.
6. **Production stays read-only.** `scripts/migrate.mjs` refuses production before connecting
   (exit 2). The production baseline exists to CHECK against. When a release is authorized,
   production receives only the individually verified new files, through the sanctioned path — never
   the directory.
7. **The tool's statuses are the decision's semantics:**
   - `PASS` — zero SQL failures and zero unchecked statements.
   - `FAIL` — at least one real SQL failure; the file does not apply to that baseline.
   - `UNVERIFIABLE` — no SQL failure, but statements could not be exercised in PGlite (it cannot host
     `cron`/`storage`/`pgcrypto`). **Not a pass**; exit 1.
   - `BASELINE-BROKEN` — the baseline itself fails to load with SQL errors; the selection is **not
     applied** and nothing downstream is reported.
   - `REFUSED` — artifact hash/byte mismatch, an invalid record, or asking to verify "everything"
     (a history replay) instead of a named selection.
   - A failure in the dump's own `-- @phase: functions-pre-tables` pass is **expected by
     construction** (a function that returns a table row type cannot exist before the table); it is
     reported and excluded from the counts, exactly as `scripts/restore-verify.mjs` treats it, and a
     genuine defect still surfaces in the authoritative post-data pass.

## 3. Measured results on the real baselines

| Run (2026-10-01) | Selection | Result | Exit |
|---|---|---|---|
| production baseline | `--since 0176` | **FAIL**: `0176` ✓; `0177` ✗ — `public.get_my_shop_request(text)` and `public.process_reminders()` do not exist on production | 1 |
| production baseline | `--since 0176 --upto 0176` | **PASS** — 0176 is production-safe as written | 0 |
| staging baseline | `--since 0176` | **PASS** — both files (already applied there) replay cleanly | 0 |
| production baseline | `--files corpus-d/0178_pin_search_path_where_present.sql` | **PASS** — a *production-shaped* replacement for 0177's intent (pin `search_path` on the functions that actually exist) | 0 |
| staging baseline | same corpus-d file | **PASS** | 0 |
| tampered artifact vs record | any | **REFUSED** — sha256 mismatch | 2 |
| a baseline that cannot load | any | **BASELINE-BROKEN**, 0 files applied | 1 |

**What the 0177 result means.** 0177 was correct for staging (where the functions exist) and is
already applied there. It is *not applicable* to production, and that was invisible until this check
existed. Production's equivalent change must be shaped like the corpus-d file: catalog-driven, a
no-op where the work is already done, verified against the production baseline. This is the concrete
proof that the strategy does what it was chosen to do.

## 4. Reproducibility in DEV / QA / STAGING

The recipe for any environment, including one that does not exist yet:

1. **Capture the baseline** if it does not exist: `npm run backup` (read-only; the Phase 2A tool
   writes the artifact + manifest), then record `supabase/baseline/<env>-baseline.json` with its
   sha256 and measured `dataStatements`.
2. **Reconstruct the environment** from the accepted dump — the restore path in
   [docs/RECOVERY.md](docs/RECOVERY.md) §3. The directory is *not* replayed.
3. **Anchor forward bookkeeping** so "what is applied here" has an answer: on staging/QA,
   `node scripts/migrate.mjs adopt --env staging --attest <newest> --apply`. Production is refused by
   policy (and that is deliberate: adopting the directory as applied on production would claim
   objects that do not exist there).
4. **Verify, then apply**: `npm run verify:baseline -- --baseline <env> --since <version>` → PASS,
   then `node scripts/migrate.mjs apply --env staging --apply`.

Local verification of a single file, no environment at all:
`npm run verify:baseline -- --baseline production --files path/to/0178_x.sql`.

## 5. Rollback and recovery

- **A failed file changes nothing.** `migrate.mjs apply` wraps each file *and* its two ledger rows in
  one transaction; proven by rollback: after an injected failure the file's records are absent and
  its declared objects are 0/1 (`PHASE_2_MIGRATION_LEDGER.md` §8).
- **An applied change is undone by a new forward migration**, never by rewriting history. The
  `reconcile` mode exists only for *cosmetic* edits (sha differs, normalized SQL identical), requires
  `--version` and a reason ≥10 characters, and records `reconciled_at`/`reconcile_note`; a semantic
  edit is refused with "write the change as a new migration".
- **Full recovery** is restoring the accepted dump (restore drill and verification:
  `PHASE_2A_BACKUP_RESTORE.md`), plus re-anchoring the ledger if the restore predates the current
  one. The production baseline artifact is itself restorable, and the restore surface is covered by
  `scripts/restore-verify.mjs`.
- **Production additionally** relies on whatever PITR/backup facility Supabase provides; that is
  unchanged by this workstream, and production was not contacted to decide any of this.

## 6. What this does NOT claim

- It does not make `supabase/migrations` replayable, and deliberately does not try. A permanently
  red "chain applies from nothing" test is indistinguishable from no test.
- It does not prove the *semantics* of a migration — only that it applies to the recorded schema.
  RBAC/behaviour claims still need their own evidence (browser, integration, RLS proofs).
- It does not touch production, in either direction. The production side of this strategy is
  evidence + policy + a verified forward shape, nothing more.
- `UNVERIFIABLE` is not a pass. If a future file's statements need an extension PGlite lacks, the
  exit is 1 and the gap is named in the report.

## 7. Evidence files

`backups/` (gitignored — contains the artifacts and their logs):

- `exp-replay-prod.log`, `exp-replay-compare.log` (prod vs staging failure sets),
  `exp-chain-replay.log` (`ALL_MIGRATIONS_TO_RUN.sql`), `exp-cds-chain.log`
  (`COMPLETE_DATABASE_SETUP.sql`).
- `baseline-prod-since-0176.{log,json}`, `baseline-staging-since-0176.{log,json}`.
- `baseline-proof-0176only.{log,json}`, `baseline-proof-0178-prod.{log,json}`,
  `baseline-proof-0178-staging.{log,json}`, `baseline-proof-tamper.{log,json}`,
  `baseline-proof-broken.{log,json}`.
- `migration-proof/corpus-d/` — the production-shaped file and the two scratch records used to prove
  the refusal paths.

## 8. Files changed by this decision

New: `scripts/verify-forward-on-baseline.mjs`, `scripts/lib/baseline.mjs`,
`supabase/baseline/{production,staging}-baseline.json`, `supabase/baseline/README.md`,
`tests/unit/schemaBaseline.test.ts`, this document.
Extended: `scripts/lib/sql-statements.mjs` (`splitStatementsWithOffsets`; one implementation, same
output), `package.json` (`verify:baseline`).
Updated: [docs/RECOVERY.md](docs/RECOVERY.md), [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md),
[ENGINEERING_OS_STATE.md](ENGINEERING_OS_STATE.md) (decision note).
