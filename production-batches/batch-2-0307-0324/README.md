# Batch 2 — 0307 … 0324 (production)

Prepared with `npm run release:prepare` on `dev` against the recorded production baseline
(`backups/production-baseline-local.json`, dump sha256 4e4668a6… verified on load).
Forward replay: **PASS — 16 files, 118 statements, 0 SQL failures, 0 env-gaps.**
Backup and restore evidence: `database-backup-production-93` (2026-11-20T15:51:23Z), restore-verified in the same
`Backup Database` run (44767394098).

## Why 0313 is not in the batch
`0313_the_decision_calls_the_shop_writer_it_finds.sql` is already applied in production — its function
`public.shop_request_make_shop` and the `shop_requests_apply_decision` trigger both appear in the captured
baseline (the trigger 4×). Its final self-check raises `0313: public.create_shop_internal is missing`, and
production genuinely has **no** shop writer (its own successor says so). `0314_a_decision_provisions_with_or_without_the_shop_writer.sql`
is the file written for that database and restates the trigger function, so the behaviour is carried by 0314.

## Included, in version order
0307, 0308, 0309, 0311, 0312, 0314, 0315, 0316, 0317, 0318, 0319, 0320, 0321, 0322, 0323, 0324.
