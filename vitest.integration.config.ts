/**
 * The integration suite's config: **one file at a time**, against the QA database.
 *
 * WHY THIS FILE EXISTS (measured by configuration, not by a run)
 *   Integration files share ONE database. Their isolation is ownership-based — each file deletes the
 *   rows it registered — but a parallel file's cleanup can still delete a row a sibling is mid-assertion
 *   on when both resolve to the same shared fixture. `ci.yml` and `build-apk.yml` have always run this
 *   suite with `--fileParallelism=false`; `npm run test:integration` and the tier-2 `verify` gate did
 *   not, so the same suite ran under two different execution semantics depending on who started it.
 *   Phase-3 exit criterion EC1 is that every runner agrees.
 *
 * WHY NOT `fileParallelism: false` IN `vitest.config.ts`
 *   That would also serialise the whole unit tree — files that open no database and exist to be fast.
 *   Seriality belongs to the run that can reach QA, not to the whole test tree.
 *
 * WHAT IS INHERITED FROM THE BASE CONFIG, AND WHY IT MATTERS
 *   Everything: `globalSetup` (the QA run lock and the opt-in data teardown), the declared
 *   staging environment, `setupFiles`, timeouts and the `@` alias. Only two things are overridden:
 *
 *     · `include` — narrowed to the integration directory, so this config can never run a unit file;
 *     · `fileParallelism` — false, which is the entire point.
 *
 *   The base config narrows its own `include` to `tests/unit/**`, so a bare `npx vitest run` cannot
 *   reach QA, and `npx vitest run tests/integration` selects zero files there (measured with
 *   `npx vitest list tests/integration`) — an unnoticed invocation finds nothing to run rather than
 *   running the suite with parallel files. `tests/unit/integrationSerialGuard.test.ts` holds all of
 *   this.
 */
import fs from 'node:fs';
import { defineConfig, type UserConfig } from 'vitest/config';
import baseConfig from './vitest.config';
import parallelIntegrationGroup from './scripts/dev/integration-parallel-group.json';

const base = baseConfig as UserConfig;
const integrationFiles = fs
  .readdirSync(new URL('./tests/integration/', import.meta.url))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/integration/${file}`);
const parallelFiles = parallelIntegrationGroup.files.map((file) => `tests/integration/${file}`);
const serialFiles = integrationFiles.filter((file) => !parallelFiles.includes(file));

export default defineConfig({
  ...base,
  test: {
    ...(base.test ?? {}),
    // ONLY the integration directory. The base config's include is unit-only; this is its mirror.
    include: integrationFiles,
    // Root-level run stays serial. Only the explicitly measured project below opts into parallel
    // files; the ordered projects run in the same Vitest process and hold the QA lock once.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'integration-measured-parallel',
          include: parallelFiles,
          exclude: serialFiles,
          fileParallelism: true,
          maxWorkers: 4,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration-serial-remainder',
          include: serialFiles,
          exclude: parallelFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
