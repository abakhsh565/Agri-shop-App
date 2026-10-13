# Baseline records

Each file here is the **frozen schema of one environment** that forward migrations are checked
against. The artifact itself is the environment's accepted logical dump and **contains real rows**
(personal data and password hashes), so it lives only in gitignored `backups/`. This folder records
what it is: path, sha256, byte length, structure counts, the exact number of data statements (which
the verification tool counts, compares, and never executes), and the policy that governs it.

- [production-baseline.json](production-baseline.json) — production is **read-only**. It is checked
  against; it is never written by the migration tooling and history is never replayed onto it.
- [staging-baseline.json](staging-baseline.json) — staging is the ledgered forward target.

Why this exists: `supabase/migrations` is a patch set, not a baseline, and it does not replay cleanly
onto any real environment either (measured 2026-10-01: 30/169 files fail on the production schema,
24/169 on staging). The decision and its evidence are in `SCHEMA_STRATEGY.md` at the repository root.

Check a proposed change against a baseline before applying it anywhere:

```bash
npm run verify:baseline -- --baseline production --since 0017
npm run verify:baseline -- --baseline staging --since 0188
```

`--since` MUST be one past the artifact's own recorded position, and the position is in the JSON
next to it (`ledgerOnServer.latest`). Passing a smaller number replays migrations the snapshot
already contains, which fails on the first `create` of something that already exists — that is what
made the SQL behaviour suite die at setup on `policy "audit_events_no_client_writes" already exists`
while the range still started at 0178 against a snapshot whose ledger already read 0187.

The tool loads the recorded artifact's schema into an in-process PGlite (skipping every data
statement), applies the selected files, and reports every statement that failed, separating PGlite
environment gaps from real SQL failures. `PASS` requires zero of both; a partial check exits 1 as
`UNVERIFIABLE` and is never reported as a pass.
