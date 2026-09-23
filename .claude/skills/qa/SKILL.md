---
name: qa
description: Verify changed behaviour on the real surface — real browser, real database, targeted lanes — with strict PASS/FAIL/UNKNOWN reporting.
---

# /qa

**Purpose.** Exercise the change, don't re-read it. A rendered component or a success toast is
not evidence that the underlying state changed correctly.

## Choose the smallest sufficient set

```bash
npx playwright test tests/e2e/<the affected lanes>.spec.ts
```

Lanes: `rtlLtr` `overlayRtl` `designLanguage` `interactionLayer` `dependencyContinuity`
`accessUx` `adminMicrocopy` `dashboardScope` `productOpeningStock`. Add a targeted spec for
behaviour no lane covers — a permanent one, in the repo, not a scratch file.

## Discipline

- Report `PASS` / `FAIL` / `UNKNOWN`, each with the exact command and what it printed.
  **`UNKNOWN` is never `PASS`.**
- On failure, classify it — implementation bug, test bug, environment problem, or genuine
  pre-existing issue — **with proof**. Do not reach for "pre-existing" as a label.
- If the UI says it worked, verify the database separately. A mismatch is a real bug.
- Remember the viewport: assert phone behaviour at phone width (390×844), not 1280×720.
- Fixture accounts must still exist after the run; the lanes silently misreport without them.

## Clean-up

Remove seeded data, and confirm emptiness with an **independent** query — the cleaner's own
output is not proof. Restore the QA fixture baseline.

## Output

```
STATUS: PASS | FAIL | UNKNOWN
Ran:
Observed:
DB state:
Cleanup:
```
