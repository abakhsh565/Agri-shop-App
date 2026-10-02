#!/usr/bin/env node
/**
 * RETIRED. This file used to apply migration files to QA and record nothing at all.
 *
 * That is how `supabase_migrations.schema_migrations` ended up holding three rows while the
 * directory held 167 files: every deploy through this script was invisible to the database, so no
 * environment could answer "what has been applied here?" — the audit's B5 finding.
 *
 * There is now exactly one path that applies a migration, and it records the file and its sha256 in
 * the same transaction as the file itself:
 *
 *     node scripts/migrate.mjs apply --env staging --apply
 *
 * This file remains (instead of being deleted) because an operator or an older runbook may still
 * call it, and the failure mode of "deleted script" is a confusing ENOENT while the failure mode of
 * "refusing script" is an instruction. It exits non-zero and applies nothing.
 */
console.error(
  [
    '',
    '[MIGRATE REFUSED] scripts/deploy-migrations.mjs is retired: it applied migrations without',
    'recording them, which is the defect the ledger fixes. Nothing was applied.',
    '',
    'Use the ledgered runner instead:',
    '  node scripts/migrate.mjs status --env staging      # directory vs ledger, read-only',
    '  node scripts/migrate.mjs verify --env staging      # the check CI runs',
    '  node scripts/migrate.mjs apply  --env staging --apply',
    '',
    'Production is not a target of any of these, by policy — see the header of scripts/migrate.mjs.',
    '',
  ].join('\n'),
);
process.exit(2);
