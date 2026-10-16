# Vercel configuration, the first scheduled cycle, alerting, and a real-engine recovery drill — 2026-10-16

**What this covers:** the four open items after the production-credentials pass — (1) the Vercel
Production configuration and whether a build with it succeeds, (2) the first *scheduled* backup and
watchdog cycle on `main`, (3) whether GitHub issues alone are an alert, (4) a timed recovery drill in
a production-shaped environment.

**What this does not claim.** Nothing was deployed to production; no production row was read or
written; no Vercel project was read (no credential or project link exists in this checkout). **The
4-hour RTO is NOT validated** — the drill measures the database-restore step, which is the part that
turns out to be seconds, and §4 names everything it excludes. The parallel record on
`post-merge-proof/recovery-drill` (`device-evidence/recovery-drill-2026-10-16.md`) covers the merge,
the first real alert and a PGlite drill; this file adds what that one names as missing — the
*provisioning* half of a recovery, on a real engine — and does not repeat it.

**UPDATED later the same day, with the Vercel project readable at last.** Two sentences above are now
superseded, and are corrected in a named section rather than quietly edited away: a Vercel project
**was** read (§1.4 — the Production scope was wrong in three of its five names, and five consecutive
production deployments had failed because of it), and the **cron pair did fire** (§2.3 — the 02:00
backup `success`, the watchdog `state: ok`). The 4-hour RTO remains unvalidated.

---

## 1. Vercel Production configuration — the required variables, and what the gate does with them

### 1.1 What the dashboard must hold, decided by the code rather than by a document

The contract is `src/lib/environmentContract.ts`, read by the build gate (`vite.config.ts`) and the
app (`src/lib/envGuard.ts`). For a **production** build it requires, at minimum, `VITE_APP_ENV`,
one of `VITE_SUPABASE_URL` / `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_OTP_DELIVERY=sms` (`VITE_APP_URL` is optional). `tests/unit/vercelDeployScopes.test.ts` (new,
**11 tests**) now derives the required *names* from `.env.example`'s own "required" section and puts
each Vercel scope's configuration through the same `resolveEnvironment` decision the build makes.

| Vercel scope | Branch | `VITE_APP_ENV` | Project it must name | Codes |
|---|---|---|---|---|
| Production | `main` | `production` | `gkswcfljxlutkfdvvqng` | `sms` |
| Preview | `staging` | `staging` | `bpybjrjenwccowvtrevu` | `demo` |
| Development | `develop`, `feature/*` | `development` | the local stack (`localdev`) | `demo` |

The guard is non-vacuous, proven by three injections, each of which failed the suite and each of which
was then reverted (the tree is clean): a new required name added to `.env.example`; `VITE_OTP_DELIVERY`
moved out of the required section; and the staging project ref set to production's.

### 1.2 The build Vercel runs, with each configuration — measured, not reasoned

`vite build --mode production` is what `npm run build` runs and what Vercel runs. There is no
`.env.production` in this checkout, so — exactly as on Vercel — the process environment is the only
source of these values.

| Configuration given to the build | Exit | Gate's verdict |
|---|---|---|
| nothing (`VITE_APP_ENV=` … all five empty) | **1** | `[ENVIRONMENT GATE] Refusing to build` — `ENV_NAME_MISSING` |
| `VITE_APP_ENV=production`, production URL + key, **no** `VITE_OTP_DELIVERY` | **1** | `DEMO_OTP_IN_PRODUCTION` |
| `VITE_APP_ENV=production`, `VITE_OTP_DELIVERY=sms`, **staging** project | **1** | `PRODUCTION_ENV_WRONG_PROJECT` |
| `VITE_APP_ENV=production`, production URL, `VITE_SUPABASE_PROJECT_ID`, key, `VITE_OTP_DELIVERY=sms` | **0** | `[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |

The successful run produced a real bundle (an artifact directory with `index.html` and `assets/`) in a
temporary directory, which was then deleted — no production artifact was made, kept, or shipped, and
the key used was a synthetic one in the same shape `tests/unit/environmentSafety.test.ts` already
uses. What the run proves is that **the gate and the build accept exactly this variable set and refuse
everything else**, before an artifact exists.

### 1.3 The honest status of item 1

| Question | Answer |
|---|---|
| Are the required variables known, exactly? | **Yes** — §1.1, machine-checked, with the copy-paste values in `PHASE_1_PRODUCTION_SAFETY_GATES.md` §F3.1 |
| Does a build with them succeed? | **Yes** — exit 0, measured above |
| Does a build without them fail instead of shipping? | **Yes** — three of the four runs above |
| Is the Vercel **dashboard** configured that way today? | **UNKNOWN.** No Vercel CLI, `.vercel` link, or `VERCEL_*` credential exists in this checkout, and the MCP tool registry for this session exposes only `supabase`. The dashboard was not read, so this file does not claim it is fixed. |
| Would a correctly-configured production deploy now work? | **No** — and not because of the variables. Production's schema is 182 ledger entries behind (`supabase/baseline/production-baseline.json`: ledger `{count: 8, latest: "0016"}` vs 198 files), so the deployed app would point at a database without the tables it reads. That is the §D schema decision, unchanged by this work. |

### 1.4 The dashboard, read at last — it was wrong, and that is why deploys were red

A Vercel MCP connection became available, so §1.3's UNKNOWN was answered rather than left standing.
The project is `agri-shop-app` (`prj_tWZoyuctxYUj6RiA60q1d3ZACK52`, scope `ab-s-projects-7cb39308`,
framework `vite`). `filter_project_envs` returns the scope, and the four `VITE_*` names it holds are
**all targeting `production`** — there is no Preview or Development-scoped variable in this project at
all, which is itself worth knowing (a Preview build is refused for `ENV_NAME_MISSING`, by design).

| Name | Held by the Production scope | Must hold |
|---|---|---|
| `VITE_APP_ENV` | `production` ✓ (read decrypted) | `production` |
| `VITE_OTP_DELIVERY` | `sms` ✓ (read decrypted) | `sms` |
| `VITE_SUPABASE_URL` | `https://supabase.com/dashboard/project/bpybjrjenwccowvtrevu` — a **dashboard link**, and the **staging** ref | `https://gkswcfljxlutkfdvvqng.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a JWT whose own `ref` claim decodes to `bpybjrjenwccowvtrevu` — **staging's** key | the production project's publishable/anon key |
| `VITE_SUPABASE_PROJECT_ID` | **absent** | `gkswcfljxlutkfdvvqng` |

All five deployments of `main` @ `de1a962e` (`source: redeploy`, the newest
`dpl_4kxkuW9zowAZBnA6vU2HW5BEqsmD`, 2026-10-16T01:35:00Z) are `state: ERROR` with
`errorCode: BUILD_UTILS_SPAWN_1` and `errorMessage: Command "npm run build" exited with 1`. The env
values were being edited while those builds ran (their `createdAt`/`updatedAt` timestamps interleave
with the deployment timestamps), which is consistent with the cause being the values themselves.
Rebuilding the scope's exact configuration locally — the same command Vercel runs — reproduces the
refusal rather than inferring it:

```
[ENVIRONMENT GATE] Refusing to build.
  PROJECT_ID_UNREADABLE
  Cannot read a Supabase project id from this build's config
  (VITE_SUPABASE_URL="https://supabase.com/dashboard/project/bpybjrjenwccowvtrevu", VITE_SUPABASE_PROJECT_ID="")

  Build mode: production
  VITE_APP_ENV: production
  VITE_OTP_DELIVERY: sms
```

exit 1. **The gate is working; the scope is not.** A dashboard link reads as "the URL is set" while
naming no project, and the bare-ref fallback cannot read it either.

The corrected set was then built with **production's own key**, read from the production project
(`get_publishable_keys gkswcfljxlutkfdvvqng`) rather than synthesised:

```
$ VITE_APP_ENV=production VITE_OTP_DELIVERY=sms VITE_SUPABASE_PROJECT_ID=gkswcfljxlutkfdvvqng \
  VITE_SUPABASE_URL=https://gkswcfljxlutkfdvvqng.supabase.co VITE_SUPABASE_ANON_KEY=<production key> \
  npx vite build --mode production
[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)
```

exit 0, a real `dist/` (18 MB). So the successful row of §1.2 now rests on the real credential, not
a synthetic one.

**What has not happened: the write.** §1.3's answer changes from *UNKNOWN* to *measured, and wrong*,
but it does not become *fixed*, because every path that could change these values is closed:

| Path | Why it cannot be used |
|---|---|
| Vercel MCP (connected, 144 tools) | **Read-only.** Every tool it exposes reports `readOnly: true`; repeated searches for a create/update/redeploy tool return only readers. `list_deployment_events` (build logs) is additionally refused: 403 for this scope |
| Vercel CLI on this machine | Authenticated as a **different account** — `abakhsh56-3780`, team `farmer-app1`; `project ls --scope ab-s-projects-7cb39308` answers `The specified scope does not exist`, and that scope's projects are not in its list |
| A push to `main` | Would only rebuild with the same wrong values — and would fail the same way |

That was the position at 14:25Z. It is no longer: the owner approved a Vercel CLI login and the three
values were set, redeployed and verified — see **§1.6**.

**One trap, reported rather than fixed.** `PROJECT_ID_UNREADABLE` fires *only* because no project id
is set. Leave the dashboard link and add `VITE_SUPABASE_PROJECT_ID` alone and the gate accepts the
build — while `src/lib/supabase.ts` uses `VITE_SUPABASE_URL` verbatim (`resolvedUrl = rawUrl || …`),
so production would serve a client pointed at a dashboard page. Replace the URL; do not merely add
the missing name. Requiring a *usable* hosted URL for staging and production would close the hole, and
it is not done here: that changes the gate's semantics and belongs in its own reviewed pass.

**What production is serving while this is true.** The newest `READY` production deployment is
`dpl_6n2fh2Xgyns3a3Kb29THxs8trz1L`, created **2026-10-02T19:36:11Z** (commit `ca1e0c2b`) — so `main`
has not reached production in fourteen days, and the eight attempts listed above are the gap. One
more fact matters for "does the deployment serve": opening the production alias
(`https://agri-shop-app-ab-s-projects-7cb39308.vercel.app`) redirects to
`https://vercel.com/login?next=/sso-api?url=…agri-shop-app-ab-s-projects-7cb39308.vercel.app…`, i.e.
Vercel's Deployment Protection (**Vercel Authentication**) covers the production URL. Nothing in this
MCP connection exposes the protection setting, so it is *observed* (an anonymous browser is answered
with the SSO wall), not read. Two consequences: the app is not publicly reachable today, and "the
deployment serves" cannot be checked from an anonymous browser even after the values are fixed — the
check is deployment `state: READY` plus a fetch through an authenticated session (or a deliberate
protection exemption while checking).

### 1.5 The guard this pass added

Until now, `PROJECT_ID_UNREADABLE` existed in the contract (`src/lib/environmentContract.ts`) and in
the start-up guard (`src/lib/envGuard.ts`) with **no test feeding it** — so the gate's ability to
catch a URL it cannot read was an assertion, not evidence. `tests/unit/environmentSafety.test.ts` now
carries a `describe` for exactly this shape: nothing is readable in a dashboard link by either route
(`extractProjectId`, `projectIdFromTarget`); production pointed at one is refused with
`PROJECT_ID_UNREADABLE`; staging pointed at one is refused too, not quietly accepted; the same
configuration with the API URL is accepted; and adding the right project id does **not** rescue a key
from the other project (`CREDENTIALS_MISMATCHED`). Proven non-vacuous by injecting the defect once —
making `projectIdFromTarget` read a ref out of a `dashboard/project/<ref>` link — which failed four of
the new cases, after which the injection was reverted (`git diff --quiet` clean).

| Check | Result |
|---|---|
| `npx vitest run tests/unit` | **72 files, 918 tests, passed** (913 before this pass; +5) |
| `npx tsc --noEmit` | exit 0 |

### 1.6 The write, the redeploy, and what the live site does — 14:35Z–14:45Z

The owner approved signing the Vercel CLI in as **`abuxkhawaja56-1850`** (the account that owns the
scope) through the OAuth device flow, into an **isolated config dir** (`../.vercel-agrishop-login`) so
this machine's existing CLI session, which belongs to another account, was left untouched — and the
project link was placed **outside the repository** (`../.vercel-agrishop-link`), so nothing was added
to the checkout.

| Step | How | Result |
|---|---|---|
| Read the scope | `vercel env ls production` | matched §1.4 exactly: four `VITE_*` names, all Production, no `PROJECT_ID` |
| Replace the URL | `env rm VITE_SUPABASE_URL production --yes`, then `env add … --no-sensitive` (value on **stdin**, never argv) | `https://gkswcfljxlutkfdvvqng.supabase.co` |
| Replace the key | the same pair for `VITE_SUPABASE_ANON_KEY` | production's legacy anon JWT — a **publishable** key, which ships in the bundle by design |
| Add the missing name | `vercel env add VITE_SUPABASE_PROJECT_ID production` | `gkswcfljxlutkfdvvqng` |
| Read back, independently | `vercel env pull` into a file **outside** the repo, then decode it | `VITE_APP_ENV="production"`, `VITE_OTP_DELIVERY="sms"`, `VITE_SUPABASE_URL="https://gkswcfljxlutkfdvvqng.supabase.co"`, `VITE_SUPABASE_PROJECT_ID="gkswcfljxlutkfdvvqng"`, and the key's own `ref` claim = `gkswcfljxlutkfdvvqng`; the pulled file was deleted |
| Redeploy `main` | `vercel redeploy dpl_4kxkuW9zowAZBnA6vU2HW5BEqsmD --target production` | **`✓ Ready in 26s`** — `dpl_7eK8MW8YH17cRkSeq7FMb5QBrVdk`, aliased to `https://hisaabkitaab.dpdns.org` |

The build log of that deployment, quoted:

```
2026-10-16T14:40:50.256Z  [EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)
2026-10-16T14:40:50.260Z  vite v8.2.2 building client environment for production...
status   ● Ready
```

The gate that refused this configuration an hour earlier now accepts it, with the key cross-checked.

**What the live site does** — anonymous HTTP, no session:

| URL | Result |
|---|---|
| `https://hisaabkitaab.dpdns.org` | **HTTP 200** — `<title>AgriShop</title>`, `id="root"`: the real app shell |
| `https://agri-shop-app-…vercel.app`, `https://agri-shop-9kjungaj1-…vercel.app` | 200 after a redirect to `vercel.com/sso-api?…` — Deployment Protection, the posture the owner chose to keep |

Rendered in a real browser on the custom domain, the app boots and is interactive (onboarding at
`/welcome`, "Run your shop from the phone") and its **own** console prints
`[EnvGuard] PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)`. In the shipped chunks the ref
appears once in `assets/supabase-*.js` (the value the client was built with) and, separately, in the
contract's bundled environment map — the one `bpybjrjenwccowvtrevu` occurrence is that map from
`environments.json`, not a connection target.

**Not verified, and why.** Production sign-in uses real SMS, so no authenticated end-to-end session
was created here. And production's schema is still 182 ledger entries behind (§1.3), so the app boots
to onboarding while its data-backed screens are expected to fail until that decision is taken. The
variables make the deploy succeed; they were never going to make the app work.

**A pre-existing defect found while verifying it, unrelated to the variables.** `src/main.tsx`
registers a service worker at `/sw.js` in every production web build and injects
`<link rel="manifest" href="/manifest.json">`, but neither `public/sw.js` nor `public/manifest.json`
exists, and `vercel.json`'s catch-all rewrite answers both with `index.html` — so `/sw.js` returns
`HTTP 200` `text/html`, the browser refuses it, and **every production page load logs** *"The script
has an unsupported MIME type ('text/html')"* (observed on the live site). Add-to-Home-Screen is
therefore broken and the service worker never installs — silently, because the registration is
`.catch(() => {})`. Reported rather than fixed here: shipping a real `sw.js`/`manifest.json` is a
product decision, and the narrower alternative — excluding those paths from the rewrite — belongs to
a config pass.

---

## 2. The first scheduled cycle on `main`

### 2.1 What is already proven, and what the scheduled cycle adds

The corrected workflow's steps run correctly on `main` — dispatch `38831480604` (2026-10-16T00:47:23Z)
is green end to end and stored artefacts `database-backup-production-37`. The merge (`de1a962e`,
PR #1, 00:45:48Z) is what puts the fix in front of the **cron**. So the first scheduled cycle to run
against the fix is the **02:00 UTC** backup of 2026-10-16, judged by the **04:40 UTC** watchdog — the
one thing the post-merge record lists as still outstanding ("the scheduled 02:00 UTC run on `main`
still took the pre-fix workflow").

| Fact | Evidence |
|---|---|
| The cron was late: at 02:10 UTC the 02:00 run had not appeared | `gh run list --workflow=backup-database.yml --event schedule` showed only `38696121562` (2026-10-15T07:02:29Z, the pre-fix run, `failure` at the credentials preflight) |
| It is lateness, not a disabled schedule — the failure mode `docs/RECOVERY.md` §9 warns about | `gh workflow list --all` → both `Backup Database (to the environment it names)` and `Backup Watchdog` are **active** (no `disabled_inactivity`), and `main` was committed to at `2026-10-16T00:45:47Z`, fourteen minutes before the cron, so the 60-day inactivity rule cannot apply |
| The previous scheduled run failed **by design preparation**, before the fix | `38696121562` — the missing `PROD_DB_PASS` preflight; the credential was set 2026-10-15T23:54Z |
| `main` now has production credentials | preflight passes in dispatch runs on `main` (above) |

### 2.2 The watchdog's own code path, run against the live API

Rather than only wait for the 04:40 job, the watcher's exact decision code was executed against the
Actions API with `--dry-run` (which decides and prints; it touches no issue and no repository):

```
$ GITHUB_REPOSITORY=abakhsh565/Agri-shop-App node scripts/check-backup-health.mjs --dry-run --json /tmp/watchdog-now.json
{ "checkedAt": "2026-10-16T02:07:47.818Z", "thresholds": { "rpoHours": 24, "slackHours": 3, "thresholdHours": 27 },
  "completedRuns": 3, "inFlightRuns": 0, "simulated": false,
  "state": "ok", "healthy": true,
  "run": { "id": 38831480604, "run_number": 37, "event": "workflow_dispatch", "conclusion": "success", "head_branch": "main" },
  "artefactCount": 1, "ageHours": 1.34,
  "summary": "Verified backup 1.3 h old with 1 live artefact(s), within the 24 h RPO.",
  "responsible": null, "alert": { "action": "none (healthy)", "issue": null } }
exit 0
```

That is the scheduled job's logic, on the live record, at the live clock: healthy, from `main`, with a
live artefact. The alert half of the cycle is already demonstrated with real conditions rather than a
simulation — watchdog run `38831384562` found `state: red` (newest completed run `38826369696`,
`failure`), **opened issue #2**, and run `38831620800` then found `state: ok` and closed it. That is
recorded in `device-evidence/recovery-drill-2026-10-16.md` §2 and is not repeated here.

**Status of item 2, stated precisely:** the pipeline is verified on `main` and the watchdog's decision
is verified against the live API; the **cron-triggered** pair (02:00 backup, 04:40 watchdog) had not
fired by 02:15 UTC when this was written, and the schedule is armed (both workflows `active`). The
watchdog's scheduled slot (04:40 UTC) is more than two hours after this record, so the cron half is
reported as **pending**, not as passing. Confirming it is one command at any later time:

```bash
gh run list --workflow=backup-database.yml --event schedule --limit 1   # expect: schedule, success
gh run list --workflow=backup-watchdog.yml --event schedule --limit 1   # expect: schedule, success
```

### 2.3 Both commands were run — the cron pair fired, and both passed

The status above was *pending*, not failing. It is now resolved, by the runs themselves:

| Slot | Run | Event | Created (UTC) | Conclusion |
|---|---|---|---|---|
| 02:00 backup | [`38863164224`](https://github.com/abakhsh565/Agri-shop-App/actions/runs/38863164224) | **`schedule`** | 2026-10-16T06:46:59Z | **`success`** |
| watchdog | [`38879348888`](https://github.com/abakhsh565/Agri-shop-App/actions/runs/38879348888) | **`schedule`** | 2026-10-16T09:16:39Z | **`success`** |

Both are `head_branch: main`, so both ran against the merged fix. The backup's every step succeeded —
including *Verify the backup against the environment it names* and *Confirm the artefact names the
environment it was asked for* — and it stored `database-backup-production-38` (**53,241 bytes**, not
expired, created 06:47:51Z). This is the first **scheduled** run to succeed: the only earlier one
(`38696121562`, 2026-10-15T07:02:29Z) died at the credentials preflight, which is the pre-fix failure.

The watchdog then judged that artefact **with its own code**, on its own schedule:

```json
{ "run": { "id": 38863164224, "created_at": "2026-10-16T06:46:59Z" },
  "artefactCount": 1, "ageHours": 2.4971558333333332,
  "state": "ok", "healthy": true,
  "summary": "Verified backup 2.5 h old with 1 live artefact(s), within the 24 h RPO.",
  "alert": { "action": "none (healthy)", "issue": null } }
```

exit 0 — and no issue was opened, which is the point: an issue appears only when there is something to
say. **Both slots fired late** (4h47m and ~4h36m after their cron times), which confirms the earlier
lateness finding as a scheduler property rather than a disabled workflow, and is why "late" was
recorded as pending instead of broken. Item 2 is therefore **PASS**: the cron takes a verified backup,
and the watcher that judges it runs on a schedule too.

---

## 3. Are GitHub issues enough of an alert? No — so the alert now names a person

### 3.1 The facts this decision rests on (GitHub's own documentation, quoted in §7)

* Notifications for a **scheduled workflow run** go to *the user who created the workflow*; if the
  cron syntax is later changed, they go to that user instead. There is no documented "the repository
  owner is emailed" rule.
* There is a user-level setting for failed runs (*Settings → Notifications → System → Actions*,
  "Only notify for failed workflows", with On GitHub and Email channels). Its **default is not
  documented** — so it cannot be assumed on.
* A new **issue** notifies the repository's watchers only if what they watch includes Issues (or all
  activity), and delivery still depends on that person having email/inbox notifications on.
* Being **@mentioned** gives a person the `mention` notification reason and subscribes them to the
  conversation. No documented restriction exists for a mention in an issue created with
  `GITHUB_TOKEN`.

### 3.2 Decision

Issue-only alerting is **a durable record, not a delivery**: it reaches a human only if that human
already watches Issues and has notifications on, and nothing in the repository could tell the
difference. So the alert now **addresses a person**, using the one delivery mechanism GitHub itself
documents:

| Change | Where |
|---|---|
| The issue body mentions the responsible handle, and the report/run summary record who was addressed | `scripts/check-backup-health.mjs` (`normalizeResponsible`, `alertBody`, `main`) |
| With no handle configured, the issue and the summary say *"No responsible person is named for this alert"* — an alert with no recipient is not allowed to look like one | same |
| The handle is supplied from the **repository variable** `BACKUP_ALERT_RESPONSIBLE` (not a secret: a handle is public, and the operator must be able to read back who is addressed) | `.github/workflows/backup-watchdog.yml` |
| Four new guard tests: the mention is written plainly enough to be parsed, the absence is stated, a malformed handle is refused rather than pasted in, and the workflow uses `vars.` not `secrets.` | `tests/unit/backupHealthWatchdog.test.ts` (**29 tests**, `0`→ passing) |

`normalizeResponsible` refuses `''`, `'   '`, `'@'`, `'@@owner'`, `'two words'`, `'owner!'` and a
41-character string, and accepts `owner`, `@owner`, `a-b-c` — asserted, so "anything becomes a
mention" cannot pass.

### 3.3 The recipient, set and then proved on GitHub itself

| Step | Result |
|---|---|
| Repository variable set | `BACKUP_ALERT_RESPONSIBLE = abakhsh565` (2026-10-16T02:12:34Z) — the repository owner, and the only account with access; `gh variable list` confirms it |
| Rehearsed alert | dispatch `38839239666` (`simulate=red`) on the branch carrying the change → **issue #5**, `[SIMULATED] Backup watchdog alert — red`, body line **`@abakhsh565 — this alert is addressed to you…`** and `| responsible | @abakhsh565 |`; the run's own report: `"responsible": "@abakhsh565", "action": "opened", "issue": 5` |
| The real check, with the same code | run `38839353287` — `state: ok`, *"Verified backup 1.4 h old with 1 live artefact(s)"*, `"responsible": "@abakhsh565"`, `"action": "closed", "issue": 5` |
| Issue #5 afterwards | `CLOSED`, reason `COMPLETED`, `closedAt 2026-10-16T02:14:07Z` — closed by the watcher, not by hand |

So the mention is in the issue body GitHub actually stores, and the report records who was addressed.
**One scope limit, stated plainly:** both runs above were dispatched on
`production/schema-reconciliation`, because that is where the change is. On `main` the workflow still
carries the previous version until the pull request merges, so the 04:40 UTC scheduled watcher will
not mention anybody yet — and the repository variable alone cannot change that.

### 3.4 What remains, and why it is not mine to set

Two settings decide whether the issue actually reaches a person, and both are **user-level**, not
repository-level: the responsible person's email/inbox notification settings, and — for a failed
*scheduled* run — the Actions notification setting on the workflow's creator. They are recorded in
`docs/RECOVERY.md` §9 as required configurations rather than asserted as done.

A push channel (chat/SMS) would need a destination and a secret, and there is no such integration
connected to this workspace. The issue plus the mention is the strongest delivery this repository can
configure on its own, and it now names who is expected to act. **So: item 3 is answered — issue-only
was insufficient; a named recipient is configured; the residual risk is the two user-level settings
above, which no commit can turn on.**

---

## 4. A real-engine recovery drill, and what the 4-hour RTO still is not

### 4.1 Why this is not the PGlite drill again

`restore-verify` replays into in-process Postgres and compares against live production: a correctness
proof, and the parallel record's drill timed it at 30.0 s. It explicitly names what it could not do —
*"provisioning the recovery target, its credentials and network access, and repointing the app"*. This
drill starts there: it **provisions a database** on the local Supabase CLI stack — the real engine,
**Postgres 17.6**, production's own server version — gives it the platform's `auth`/`storage`/
`extensions` schemas, installs `pgcrypto`/`pg_trgm` where a hosted project keeps them, and then
applies the production artefact **whole, including its 249 rows**, because a row-less restore is the
fast half of the problem. New tool: `scripts/dev/rehearse-restore-local-engine.mjs`
(`npm run rehearse:restore`).

### 4.2 Measured

Source: `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.sql` (333,989 bytes,
sha256 `ceb62aa9…` re-measured and matched against its manifest before anything ran).

| Phase | Measured | What it did |
|---|---|---|
| Provision | **4.5 s** | create database, copy platform schemas schema-only, install the extensions |
| Restore | **3.3 s** | **769 statements** — 520 schema, **249 data** — one `psql` invocation over the whole file |
| Verify | **19.1 s** | structure counts + per-table row counts + auth rows, against the manifest |
| **Total** | **26.9 s** | artefact on disk → verified database |
| SQL errors | **0** | the artefact's documented `functions-pre-tables` phase produced no error on this engine |

Verification, from the drill's own report (`backups/restore-drill-production-2026-10-16.json`) —
`status: PASS`:

| Check | Result |
|---|---|
| Structure vs manifest | **0 deltas** — 28 tables, 37 functions, 2 views (by name), 47 non-constraint indexes, 56 FKs, 9 checks, 9 uniques, 10 triggers, 104 policies, 8 enums |
| Rows vs manifest | **0 deltas** across all 30 dumped tables (249 rows) |
| Auth | `auth.users` **2**, `auth.identities` **2** — a restored database that can be signed into |
| RLS | **28/28** public tables |
| Grants | **0/28** readable by `authenticated` *here*, against **60** in the stack's own database |

The last row is an **environment difference, not a defect**: the dump excludes grants and ownership by
design (its own manifest says so), and this scratch database was given the platform's *schemas* but not
its *default privileges*. A hosted target supplies them for objects the `postgres` role creates. It is
recorded as a thing to measure on the target, which is exactly the kind of gap this drill exists to
find.

### 4.3 The drill is not vacuous — its refusals and its FAIL path were measured too

| Injected condition | Result |
|---|---|
| Manifest's `sha256` altered | **REFUSED**, exit 2 — the artifact hash is re-measured before anything is created |
| Target database named `rehearsal_production` | **REFUSED**, exit 2 — a drill loads rows and may only write to `drill_*` |
| Hosted credentials present in the environment (`PROD_DB_PASS`) | **REFUSED**, exit 2 — it cannot be pointed at a hosted project |
| Manifest outside `backups/` | **REFUSED**, exit 2 |
| One row count overstated by 1 in the manifest | **FAIL**, exit 1, naming `public.companies: manifest 5, restored 4` — and `0` structure deltas, so the failure is attributed correctly |

Two defects in the drill's own first implementation were found and fixed by using it, and are recorded
because they are the class of error this repository catalogues: counting constraint-backed indexes
(reported 84 restored against 47 — exactly the 28 primary keys and 9 unique constraints the backup
tool excludes), and installing `pgcrypto` into `public` (reported 104 public functions against 37 —
the extension's own 67). Both produced false FAILs; neither was a real restore defect.

### 4.4 What the RTO still is, after this

| Component of "4 hours from the decision to restore" | Measured? |
|---|---|
| Fetch the artefact and verify its digest | **Yes** — 3.6 s + 3.1 s (parallel record) |
| Replay + verify faithfully | **Yes** — 769 statements, 1.08 s (parallel record), 0 failures |
| **Provision a production-shaped database and load every row into it** | **Yes** — 26.9 s here, on Postgres 17.6 with the platform schemas |
| Creating the hosted Supabase project, its credentials and network access | **No** — not reproducible from this machine, and standing up a second home for production data is the owner's decision |
| Grants / ownership on the target, storage objects, extensions and role passwords | **Not exercised** — excluded from the dump by design; the 0/28-vs-60 figure above says measure it on the target |
| Repointing the application: Vercel environment variables, the Android build, DNS | **No** |
| Human decision time and the `docs/RECOVERY.md` §5 approval checklist | **No** — inherently not mechanical |

So the mechanical database path is **seconds, measured twice by two different methods on two different
engines**, and the 4-hour objective is dominated by the items above, none of which this drill touched.
**The figure is not validated, and no restore has been performed into any hosted target.**

---

## 5. Reproducing all of it

```bash
# item 1 — the deploy contract, and a build with the required set
npx vitest run tests/unit/vercelDeployScopes.test.ts
VITE_APP_ENV=production VITE_SUPABASE_URL=https://gkswcfljxlutkfdvvqng.supabase.co \
  VITE_SUPABASE_PROJECT_ID=gkswcfljxlutkfdvvqng VITE_SUPABASE_ANON_KEY=<key> VITE_OTP_DELIVERY=sms \
  npx vite build --mode production --outDir /tmp/gate-check --emptyOutDir

# item 2 — the scheduled cycle, when it lands
gh run list --workflow=backup-database.yml --event schedule --limit 1
gh run list --workflow=backup-watchdog.yml --event schedule --limit 1
GITHUB_REPOSITORY=<owner>/<repo> node scripts/check-backup-health.mjs --dry-run

# item 3 — the alert's recipient
npx vitest run tests/unit/backupHealthWatchdog.test.ts

# item 4 — the drill (drop the database afterwards unless --keep)
npm run rehearse:restore -- --manifest backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.manifest.json \
  --json backups/restore-drill-production-2026-10-16.json
```

## 6. Files changed

New: `scripts/dev/rehearse-restore-local-engine.mjs`, `tests/unit/vercelDeployScopes.test.ts`, this file.
Extended: `scripts/check-backup-health.mjs` (responsible recipient), `.github/workflows/backup-watchdog.yml`,
`tests/unit/backupHealthWatchdog.test.ts` (+4 tests), `package.json` (`rehearse:restore`),
`PHASE_1_PRODUCTION_SAFETY_GATES.md` §F3.1, `docs/RECOVERY.md` §9.

Gates: `npx tsc --noEmit` **0** · `npx vitest run tests/unit` **72 files, 913 tests, exit 0**.

## 7. Sources for §3.1

* Notifications for workflow runs (scheduled-run recipient) — <https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs>
* Managing GitHub Actions notifications (the failed-workflow setting) — <https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications>
* Configuring notifications (watching, Issues, delivery) — <https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications>
* About notifications (mentions, subscription reasons) — <https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications>
* GITHUB_TOKEN (no documented mention restriction) — <https://docs.github.com/en/actions/concepts/security/github_token>
