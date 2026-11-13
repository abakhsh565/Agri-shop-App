# QA ledger — 7 superseded files, measured 2026-11-13

`node scripts/migrate.mjs verify --env staging` on 2026-11-13 reported 7 files "changed after it was
applied" after `dev` merged `main` (`ba6aaad`) into it:

| version | QA recorded | repo now carries |
|---|---|---|
| 0277 | `b3739720008a…` (14706 B, applied 2026-11-06) | main's reconciled copy (`f94a95fbeaf0…`, 13549 B) |
| 0280 | `e41548bed71a…` (32312 B, applied 2026-11-06) | main's reconciled copy (`0aab2d9751ae…`, 31145 B) |
| 0281 | applied dev variant | main's reconciled copy |
| 0282 | applied dev variant | main's reconciled copy |
| 0285 | applied dev variant | main's reconciled copy |
| 0288 | applied dev variant | main's reconciled copy |
| 0289 | applied dev variant | main's reconciled copy |

What happened: QA applied the **dev** lineage of these files. `main` had separately reconciled the
same versions for the production replay (production has never recorded them — its ledger stops at
`0304`, and `0233–0289` is the known production gap). Merging `main` into `dev` kept main's copies,
so the bytes QA applied and the bytes the repo now carries are two different texts of one version.

`reconcile` refuses this correctly: the difference is not comments and whitespace, so recording a new
hash would be a lie about what ran. The tool's own instruction for this case is `diverge`, which
records the fact and the reason in `supabase_migrations.schema_migration_divergences` and prints it on
every `verify`:

```
node scripts/migrate.mjs diverge --env staging --version 0277 --kind superseded \
  --reason "QA applied the pre-merge dev variant of this file; the repo now carries main's
  reconciled copy, which is the lineage production will replay (production has not recorded this
  version). Same objects and grants; only the statements' shape differs." --apply
```

Run for `0277 0280 0281 0282 0285 0288 0289`. Result:

```
  DIVERGED — recorded in the ledger, with a reason (9)
  VERIFY: PASS
```

(9 = these 7 plus the two already documented in `qa-ledger-0220-0224-2026-10-18.md`.)

Not done, and deliberately: no bytes were rewritten on QA, no ledger row was re-hashed, and the
production copies were not reverted to the QA lineage — production's replay still needs main's text,
and QA's state is what it measured. If a later release needs QA to hold main's exact bytes, that is a
new forward migration, not an edit to an applied file.

Also in this commit: `0307_the_notifications_table_is_readable_by_its_roles.sql` was missing from the
tree (the merge kept the ledger row but not the file, so `verify` reported it as ledger-only). The file
is restored byte-for-byte from `pull/41/head`, which is what QA applied on 2026-11-13.
