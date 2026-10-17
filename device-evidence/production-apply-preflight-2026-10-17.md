# Production apply — preflight passed, apply blocked at the credential intake

**When:** 2026-10-17 14:36–14:38Z. **Target:** `gkswcfljxlutkfdvvqng` (Agrishop APp, cluster
`7666007964130682852`) — confirmed against `environments.json`, and by the credential guard itself.
**Outcome:** every preflight check passed. The apply was **not** run: `scripts/migrate.mjs` is refused
by `run-with-production-credentials.mjs` by design, and that refusal was not bypassed.

## 1. Preflight, measured

| Check | Command | Result |
|---|---|---|
| Credential names production | `run-with-production-credentials.mjs --check` | OK — 3 keys, `PROD_DB_USER` names `postgres.gkswcfljxlutkfdvvqng` |
| Fresh backup | `backup-database.mjs --env production` | 30 tables / **249 rows** / 56 FKs / 104 policies · 326.1 KB · sha256 `8cabbea7ae9b9b3d…` · artifact `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-17T14-36-24.sql` |
| Restore into a scratch database, compare with production | `restore-verify.mjs --compare-with production` | **PASS** — integrity, replay, counts, structure, digests, auth · `backups/restore-verification-production.json` |
| Batch replays onto production's baseline | `verify-forward-on-baseline.mjs --baseline production --files <24>` | **PASS — 24 files, 452 statements, 0 sql failures, 0 env-gap** · `backups/prod-batch-24-verified.json` |
| ACL state before | `measure-production-acls.mjs --env production` | `anon` still executes `create_sale`, `void_sale`, `process_return`, `adjust_stock`, `record_customer_payment`, `current_shop_id`; **16** app-called functions absent · `backups/production-acls-before.json` |

**Batch order** is ascending by version, which is what the gate requires: `0179, 0181, 0190, 0199,
0200–0206`, batch 2 (`0207, 0208`), the re-issue (`0209–0214`), the ACL closures (`0215–0217`), and
the Own-shop closures (`0218, 0219`).

**Gate windows.** The backup was taken at 14:36:24Z and the verification report written at 14:37:37Z;
both are refused after **15:36Z**. An apply started after that needs a new backup, restore and
verification, in that order.

## 2. The one blocked step, and why it was not forced

```text
[CREDENTIAL INTAKE REFUSED] "scripts/migrate.mjs" is not on the allow-list. Production credentials are
handed only to the commands that read production and write nothing:
  scripts/backup-database.mjs
  scripts/restore-verify.mjs
  scripts/measure-production-acls.mjs
```

The intake exists so that the moment a production schema changes is a deliberate human act. Sourcing
`~/.agrishop/production.env` by hand would defeat exactly that control, so it was not done. The owner
runs this one command, from the repository root, inside the window:

```bash
node scripts/migrate.mjs apply --env production \
  --files "$(ls supabase/migrations/*.sql | grep -E '/(0179|0181|0190|0199|020[0-9]|021[0-9])_' | paste -sd, -)" \
  --verification backups/prod-batch-24-verified.json \
  --backup backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-17T14-36-24.manifest.json \
  --restored backups/restore-verification-production.json --apply
```

The gate re-checks all four preconditions itself before it opens a connection: the batch is named and
ascending, the verification is PASS against production's baseline and resolves to these 24 files, the
backup is production's and fresh, and the restore report names that same artifact and passed.

## 3. What is verified after the apply, not claimed now

Nothing above proves the post-state; it is the before-state. After the apply the same read-only ACL
measurement is the acceptance test, and it has to show: `anon`-executable functions at **0** on the
write surface, `users` with **no** always-true policy, `user_permissions` writes naming the target's
shop, the 16 missing app functions present, and the 104 production policies still enforced over the
249 rows. Cross-shop refusal is then probed the way it was on QA — inside a rolled-back transaction.

Until that measurement, the Own-shop model is verified on QA and **not** on production.
