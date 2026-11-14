---
name: release
description: Run the release gate — typecheck, guard suite, browser lanes, production build, migration replay, QA baseline — and the Android APK path.
---

# /release

**Purpose.** One repeatable gate, run at meaningful checkpoints. Never declare success from a
partial artifact.

## The gate

```bash
npx tsc --noEmit                 # types
npm test                         # unit + integration; integration runs ONE FILE AT A TIME
npx playwright test              # or: npm run test:e2e:lanes
npm run build                    # production build
```

`npm test` is two runs on purpose: the unit suite keeps its parallel files, and the integration
suite goes through `vitest.integration.config.ts` (`fileParallelism: false`) because its files share
one QA database. A bare `npx vitest run` is unit-only — it can no longer be called "the full suite".

Then, independently:

- **Migration replay** — the chain applies from zero (`migrationReplayability` guard).
- **QA state** — business tables empty, fixture accounts intact, verified by your own query.
- **Git** — report `HEAD`, branch, and whether it matches the remote. Do not commit, push, or
  open a PR unless asked.

Report every check with its **real** result. A check you did not run is `UNKNOWN`, not passing.

## Android / APK

The release path is `.github/workflows/build-apk.yml`. Run it from the verified commit.

- Do **not** substitute a different APK source, a local build, or another service, and do not
  alter the workflow merely to bypass an infrastructure problem.
- If the workflow fails: capture the exact error, find the root cause, make the minimum fix,
  re-run the affected verification, then re-run the same workflow. Repeat until it succeeds.
- Confirm the artifact actually exists and is usable before reporting success.

## Output

```
FINAL RELEASE: GO | NO
commit SHA:
typecheck / unit / e2e / build:
migration / QA state:
APK workflow + artifact:
blockers:
```
