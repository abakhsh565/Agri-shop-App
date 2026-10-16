# Production data policy

**Effective 2026-10-13. Enforced by `tests/unit/productionDataPolicy.test.ts` — this document and that
guard are the rule; neither is advisory.**

Production is `gkswcfljxlutkfdvvqng` ("Agrishop APp"). It holds a real shop's records: sales, payments,
customers, stock. The QA/staging project is `bpybjrjenwccowvtrevu`. The two are separate Supabase
projects and the refs are the only names used for them anywhere — see `environments.json`.

## 1. The rule, in one line

**Code and schema move forward; DATA never moves up.** Nothing that a developer, a test, a lane, a
seed file or a cleanup script produced may ever exist in production, and nothing may delete a
customer's records except the shop owner acting in the app.

## 2. What may touch production at all

| Path | Access | Why it is allowed |
|---|---|---|
| `.github/workflows/backup-database.yml` | **read-only** | it is the only verified backup path; it reads and writes an artifact, never a row |
| `scripts/migrate.mjs` via the release workflow | **schema only** | migrations are the way the schema moves forward |
| `scripts/backup-database.mjs` | **read-only** | produces the artifact + manifest |
| the app itself, for its signed-in users | **business operations** | this is the product |

Everything else **refuses**. These refusals are executable, not conventional:

* `envGuard` / `environmentContract.ts` — the app refuses a configuration it cannot name, and refuses a
  hosted project it was not configured for.
* `productionReachGuard` (`tests/unit/productionReachGuard.test.ts`) — nothing on the automated surface
  (shipped code, CI, configs, scripts, test suites) may even *name* the production URL or key.
* Every QA tool that can delete rows refuses any target that is not the QA project:
  `clean-test-data.mjs` (line 28), `reset-qa-baseline.mjs`, `scripts/dev/qa.mjs`, `qa-tenant.mjs`,
  `qa-baseline.mjs`, `qa-attribution.mjs`.
* There are no production credentials in this checkout: `environments.json` sets production's
  `localEnvFile` to `null`, and `scripts/run-with-production-credentials.mjs` refuses any credentials
  file that resolves **inside** the repository (exit 2 before spawning anything).

## 3. Test data may never reach production

The concrete definition, all of it machine-checked by the guard:

* **Fixture identities** — the seeded user ids `10000000-…`, customer ids `20000000-…`, product ids
  `30000000-…`, variant ids `40000000-…`, supplier `50000000-…`, the QA phone numbers
  (`923009999999`, `923008888888`, `92300PERM…`, `92300DST…`, `92300FIN…`, `92300INV…`) and the
  fixture names (`QA Supplier A`, `QA Product …`, `Test Product`) — may not appear in `src/`,
  `supabase/migrations/`, `supabase/baseline/`, `.github/workflows/` or `utils/`.
* **`supabase/seed.sql`** is the local-stack seeder and does contain fixtures. It is safe by isolation,
  not by convention: the only thing that reads it is `scripts/dev/local-db.mjs` (the Docker stack), and
  the guard pins that no migration, workflow or release script references it.
* **No data promotion.** There is no export/import path from QA to production anywhere in the
  repository, and the guard fails if one is added. Schema arrives by migrations only.
* **No cleanup in production.** The QA cleaner appears in CI exactly once
  (`build-apk.yml`, `if: always()`) and runs with `QA_*` credentials only; the guard fails if that step
  ever references a `PROD_*` secret.
* **No migration seeds test data.** A migration is what every environment runs, so a seeded row is a
  row production gets. The guard (rule 7) refuses any `INSERT` in `supabase/migrations/` that puts a
  demo/QA identity in a row, and any migration that names the production project at all. The four
  files that already did this before the rule existed — `0009`, `0018`, `0026`, `0107` — are recorded
  in `FROZEN_SEED_MIGRATIONS` with a reason each, as history the forward-only migration policy will
  not let us edit; the list is a ratchet that may only shrink.

Measured on the last production backup (2026-10-01) with `npm run audit:production-data`:

| Finding | Count |
|---|---|
| rows whose OWN id is a demo identity (`00000000-…`) | **23** — 4 products, 10 variants, 3 customers, 3 companies, 2 users, 1 shop |
| accounts on a demo phone number | **4** — 2 `users` + 2 `auth.users` logins |
| records carrying a demo name | **2** — a shop named `Default Shop`, a user named `Test QA User` |
| rows merely *scoped* to the demo tenant | 79 (52 sales, 6 customers, 6 products, …) |

So production was **not** clean, and an earlier read of the same artifact that concluded "zero test
data" was wrong: it searched for the `10000000-…`/`20000000-…` families and two phone numbers, and
missed the demo family, the two numbers migration 0018 seeds, and the demo names. The mechanism is
not data being copied from development: **migrations seeded it.** `0018_seed_demo_users.sql` creates
the `Default Shop` and two accounts on fixture phone numbers, and its header tells the reader to run
it in the *production* SQL editor; `0009` and `0026` re-assert the same tenant. Any environment those
files are applied to gets the demo rows, and this one did.

What that does **not** say: whether the 52 sales and 6 customers under the demo tenant are a real
shop's records entered through the app. The audit reports scope separately from identity for exactly
that reason, and clearing anything is a decision for the owner (see §6), never for a script.

## 4. Who may delete a customer's records

**Only the shop owner, by acting in the app, inside their own shop.** Nothing automatic, scheduled,
migrated, scripted or tested may delete them.

* The deletion paths are RPCs that take the shop as a parameter (`p_shop_id`) and scope every delete
  (`0147_admin_full_access_and_account_deletion.sql`); they exist for the account/shop deletion the
  owner performs deliberately.
* No migration contains an unscoped delete of a business table. The guard checks every statement-level
  `DELETE FROM` in `supabase/migrations/` for a `WHERE`/`USING` scope and fails on a new unscoped one.
* One reviewed exception, recorded rather than hidden: `0046_phone_uniqueness_constraint.sql` deletes
  duplicate `customers` rows (`DELETE FROM customers a USING customers b`) as a one-time repair before
  the phone uniqueness constraint. It is scoped by the join, it ran once, and it is allowlisted in the
  guard with this reason — the allowlist is a ratchet that may only shrink.
* Nothing in the repository purges on a schedule: the guard fails if a workflow gains a
  `DELETE`/`TRUNCATE`/`psql` deletion step, and the only cron workflows are backup and release.

**Consequence, stated plainly:** production records are preserved until their owner deletes them in the
app. A record deleted by its owner is deleted — see §6 for what is deliberately not built yet.

## 5. Verifying the policy

This policy is the production half of the four-stage model in
[`docs/ENVIRONMENT_PIPELINE.md`](ENVIRONMENT_PIPELINE.md), which states per stage what the repository
enforces and where the gap is — including that production currently has no release path and no
working backup credentials.

```bash
npx vitest run tests/unit/productionDataPolicy.test.ts   # this policy, as executable rules
npx vitest run tests/unit/productionReachGuard.test.ts   # the automated surface cannot name production
npx vitest run tests/unit/environmentSafety.test.ts      # the app refuses a foreign project
npm run audit:production-data                            # READ ONLY: the newest production artifact
npm run audit:production-data -- --from backups/<artifact>.sql --json
QA_DATABASE_URL=<production-url> node scripts/dev/qa-baseline.mjs   # refuses: not the QA project
```

`audit:production-data` reads a backup artifact and answers one question per row: is this row's own
key a demo identity (then the row is test data), or does it merely live inside the demo tenant (then
it is scope, and the count is reported apart so it cannot be misread). It reports the table and the
identity label — never the row's other values. Exit `0` = no demo row, `1` = found, `2` = nothing was
audited, which is never a pass. It is a tool for a verdict, not a cleanup: it holds no target and no
credentials, and it cannot delete.

## 6. Clearing demo data from production — the owner's decision, not a script's

Production holds demo rows from the seeding migrations (§3). Removing them is **destructive and
irreversible**, and this repository deliberately holds no production credentials, so it is not
something an agent does on its own initiative. The options, stated so the owner can choose:

1. **Remove only the demo identities** — the logins on fixture phone numbers, the accounts and
   companies keyed by `00000000-…`, the records named `TEST`, and the shop named `Default Shop`.
   Everything keyed by nobody (52 sales, …) stays. **This is only correct if the sales are also test
   data**, because a sale whose parent tenant is gone is an orphan.
2. **Reset production to an empty, migrated database** — no shop, no rows, schema only. Correct if
   the real shop has never used it, which the demo tenant id and the `Default Shop` name suggest.
3. **Leave the data and enforce the rule from here on** — nothing is deleted; the fix is that no
   new test data can arrive (rule 7) and the auditor makes the state visible.

Whichever is chosen, it is run by the owner against production, deliberately, with a fresh backup
taken first (`backup-database.yml`). A wrong choice here is unrecoverable without a restore.

The reviewed, statement-by-statement version of those options is
[`docs/PRODUCTION_DEMO_DATA_CLEANUP.md`](PRODUCTION_DEMO_DATA_CLEANUP.md): measured counts, the
foreign-key order the deletes have to follow (55 of production's 56 FKs are `NO ACTION`), a
precondition that aborts on a database holding a real shop, and `rollback;` as the last statement
of every destructive block so the file as committed cannot delete anything. Rule 10 keeps it that
way, and the first step is not SQL at all — it is the backup credentials production does not have.

## 7. Not built yet (recorded, not silently dropped)

Requested 2026-10-13, deliberately **not** started: an in-app trash/restore folder so that a shop owner
who deletes records can recover them later (a backup of owner-deleted data, restorable by the owner).
Today deletion is final. When this is built it is a **product feature with its own data-retention
design** (what is retained, for how long, who can restore, and how it interacts with the owner's right
to have data deleted) — not a change to this policy, and not something to bolt on inside a QA or
signing task.
