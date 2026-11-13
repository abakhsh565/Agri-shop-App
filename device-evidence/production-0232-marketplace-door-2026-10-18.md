# Production's marketplace door — `0232` applied 2026-10-17T23:26Z

**What was broken.** `0223` narrowed `anon` to nothing across `public`, which took
`marketplace_listings` with it. That view is not a demo-era accident: `0185` created it as the
allowlisted projection of a listing and granted `SELECT` to `anon, authenticated`; `0210` and `0214`
re-issue the same grant as the ledger's own ACL; and the boundary is the owner's `marketplace_enabled`
flag plus the farmer's own radius (`0186`, `0187`), not the caller's identity. Production carries
`0223`, so production's public catalogue was closed — a live product defect: the Farmer App's only
read contract answers `42501 permission denied for view marketplace_listings`.

**What was applied.** Exactly one file, exactly one grant:

```
supabase/migrations/0232_the_curated_view_is_the_public_door_again.sql
  grant select on public.marketplace_listings to anon      (inside a to_regclass guard)
  do $verify$ … asserts: the door is open · anon holds no privilege on any other
                  relation in public · the door is read-only for anon
```

No other relation was re-opened, no write was granted, no row was touched, and no other migration
was named.

## Preconditions, measured rather than asserted

| # | Precondition | Evidence |
|---|---|---|
| 1 | Named batch of one file | `--files …/0232_…sql`; the gate refuses a directory replay and any file before `0017` |
| 2 | PASS on production's own baseline | Frozen 2026-10-01 baseline **predates** the view (`0210` creates it), so a fresh read-only capture was taken: `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-17T23-16-38.sql`, sha256 `41af029e…`, 761,862 bytes, 1,136 statements (102 data statements skipped, never executed). `verify-forward-on-baseline` → **PASS**, 2 statements, 0 failures, `baseline.environment: production`, `sha256Verified: true` (`backups/0232-production-verified.json`) |
| 3 | Restore-verified backup | `restore-verify --from <manifest> --compare-with production` → **PASS** on integrity, replay, counts, structure, digests and auth; 44/44 tables matched, every protected history table content-identical (`backups/restore-verification-production.json`) |
| 4 | Ledger says it is unapplied | Dry run read production's ledger: `0232` absent, batch partitions to exactly one file, "DRY RUN — nothing was written" (`backups/0232-production-dryrun.json`) |
| 5 | The write itself | Rehearsed inside `BEGIN … ROLLBACK`: 32 tables fingerprinted, **0 unexpected row changes**; then applied, file and ledger rows in one transaction (`backups/0232-production-apply.json`) |

The gate is the guard, not a formality: it runs before a credential is resolved and again with
production's ledger in hand, and every refusal is a rule with a test in
`tests/unit/productionBatchGate.test.ts` (42 cases).

## After

```
✓ 0232 (2 statements, recorded)      Production's ledger now: 45 row(s), latest 0232
Data after apply matches the rehearsal exactly.
```

`measure-production-final-state --env production` → **20/20 checks passed**, including:

| Check | Measured |
|---|---|
| anon holds SELECT on the curated marketplace view and no other privilege in public | exactly one grant: `marketplace_listings / SELECT` |
| anon can read the curated marketplace view | succeeds |
| anon cannot read a business table at all | `permission denied for table sales` |
| no policy in public is addressed to anon or public | 0 |
| ledger | 45 rows, latest `0232`, nothing unapplied, 224 files matching their recorded bytes |
| batch-era applies carry statements **and** a file row | 45 statements / 37 file rows / 8 legacy pre-batch rows, none missing |
| tenant shell survived | 1 shop, 1 branch, 4 roles, 32 permissions, 0 users |

`measure-production-acls --env production` (read-only, `transaction_read_only = on`) now reads:

```
relations measured: 23 · missing from production: none
anon          : SELECT 1 · INSERT 0 · UPDATE 0 · DELETE 0
authenticated : SELECT 23 · INSERT 9 · UPDATE 9 · DELETE 9
```

The single `SELECT` is `marketplace_listings`. Every business table — `sales`, `products`,
`product_variants`, `shops`, `customers`, `inventory_movements`, `purchases`, `returns`,
`customer_payments` and the rest — is unreachable to `anon`, and `anon` cannot write the view either.

## Two evidence tools were corrected (and why that is part of the change)

Both edits make the tooling state the post-`0232` contract instead of the pre-`0232` one; neither
touches the database.

1. `scripts/measure-production-final-state.mjs` asserted **"anon holds no privilege on any public
   table"** — which `0232` deliberately falsifies for exactly one view. It now names the grant
   instead of forbidding all grants (`anon` holds `SELECT` on `marketplace_listings` and nothing
   else), and adds the positive check that the door actually opens. A bare count of zero would have
   failed while the contract held; a bare count would also have passed if the single grant had been
   a write. Both halves are asserted, and the control (`anon` reading `sales` → denied) is kept.
2. `scripts/measure-production-acls.mjs` measured 22 business tables and left the view out, so it
   printed `anon: SELECT 0` — a reassuring number that would read as "anon can read nothing" while
   the public door was open. `marketplace_listings` is now in the measured set.

Guards after the edits: `npx vitest run tests/unit/productionScriptsRefuse.test.ts
tests/unit/productionBatchGate.test.ts tests/unit/marketplaceContractGuard.test.ts` → **66 passed**.

## Scope

Applied: `0232` only. Not touched: APK, E2E lanes, QA/staging, any other migration, any row, any
policy, any function. The backup and the reports live in the gitignored `backups/` directory because
the artifact is a production snapshot containing real rows.

## How to undo

The reversal is one statement, and per this repository's rule it is a **new file**, never an edit to
an applied one:

```sql
revoke select on public.marketplace_listings from anon;
```

Restoring the pre-apply state otherwise means restoring
`backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-17T23-16-38.sql`, which was proven
restorable and compared table by table with production before the apply.

## Observed, pre-existing, not introduced here

* `authenticated` holds `INSERT`/`UPDATE`/`DELETE` grants on the `marketplace_listings` view. `0232`
  granted nothing to `authenticated`; this is the state `0185`/`0223` left. The view is a join
  projection, so it is not automatically updatable, and no insert policy exists for it — but the
  grant itself is wider than the contract and is worth a follow-up file.
* `anon` can still execute 37 functions in `public`, including `current_shop_id`,
  `get_my_permissions` and `has_effective_permission`. They carry guards, and `0224` repaired the
  write RPCs, but the `EXECUTE` surface is unchanged by this work.
