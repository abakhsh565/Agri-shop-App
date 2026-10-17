# The live Supabase ↔ Vercel connection, the two console errors, and the schema gap — 2026-10-16

**What this answers, verbatim:** *"Supabase and vercel now connected now check now and give me the
confirmation and i dont want see any error."*

**Answer in one line:** both connections are real and healthy and the deployed app is configured
against the production project — but it *does* show two console errors on every load, both now fixed
in the working tree and neither yet live, and authenticated screens will keep failing until
production's migration ledger catches up (**190 migrations pending**).

**Branch** `production/schema-reconciliation` · **Production project** `gkswcfljxlutkfdvvqng`
(**`ACTIVE_HEALTHY`**) · **QA project** `bpybjrjenwccowvtrevu` (**`ACTIVE_HEALTHY`**) · **Vercel
project** `agri-shop-app` (`prj_tWZoyuctxYUj6RiA60q1d3ZACK52`, scope `ab-s-projects-7cb39308`).

```
STATUS: PASS for the connections · FIXED IN TREE, NOT YET DEPLOYED for the two console errors ·
        BLOCKED for an error-free authenticated app (190 migrations pending)
FINDINGS: 2 console errors reproduced with their causes; 8 tables the app reads are absent from
          production; 190 of 198 migrations unapplied there
FILES: index.html · vercel.json · public/sw.js · public/manifest.json · tests/unit/pwaAssets.test.ts
DB/RPC: read-only — list_projects, list_tables, list_migrations on production; nothing written
TESTS: 73 files / 923 tests passed · tsc exit 0 · build exit 0 · served MIME types verified
RISKS: the fixes are uncommitted, so production still logs both errors; applying 190 migrations to a
       database holding real rows is an owner decision with a backup and verification path
NEXT: decide whether to ship the fixes and whether to reconcile the ledger
```

---

## 1. The connections, checked from three sides

| Side | What was read | Result |
|---|---|---|
| **Supabase** | `list_projects` | Two projects, both `ACTIVE_HEALTHY`: `gkswcfljxlutkfdvvqng` ("Agrishop APp", Postgres 17.6.1.155, `ap-northeast-1`) and `bpybjrjenwccowvtrevu` ("Agri-shop-App-QA", 17.6.1.166) — same organization |
| **Vercel** | `list_projects`, `list_deployments`, `get_deployment` | Project present; newest **production** deployment `dpl_7eK8MW8YH17cRkSeq7FMb5QBrVdk`, `state: READY`, `target: production`, commit `de1a962e` (= `main`), created 2026-10-16T14:40:35Z |
| **The app, at the boundary** | a real browser on `https://hisaabkitaab.dpdns.org` | HTTP 200, `<title>AgriShop</title>`, the onboarding screen renders at `/welcome`, and the app's **own** console prints `[EnvGuard] PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |

The two are connected in the only sense that matters: the running app names the production project,
in production, with the key cross-checked against the URL. In the shipped chunks the ref appears once
in `assets/supabase-*.js` (the value the client was built with); the single `bpybjrjenwccowvtrevu`
occurrence is the contract's own bundled environment map from `environments.json`, not a connection
target.

## 2. The two console errors — both reproduced, both fixed in the tree

The live site logged exactly two errors on every load. Neither was the Supabase connection.

### 2.1 `X-Frame-Options may only be set via an HTTP header sent along with a document`

`index.html` carried a "Security Headers" block that set four **header-only** directives as
`<meta http-equiv>`: `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection` and
`Permissions-Policy`. Browsers ignore `http-equiv` for all of them — so the block provided no
protection at all — and Chrome logs the first one on every page load. Five e2e specs and
`scripts/dev/new-lane.mjs` carry filters for that warning, which is how it survived.

| Directive | Where it is now | Why |
|---|---|---|
| `X-Content-Type-Options: nosniff` | `vercel.json` `headers` | Enforced at the edge instead of ignored in markup |
| `Referrer-Policy: strict-origin-when-cross-origin` | `vercel.json` `headers` | Was the one directive that also worked in markup; one place now, not two |
| `X-Frame-Options: DENY` | `vercel.json` `headers` | The author's value, kept rather than softened |
| `Permissions-Policy: camera=(), microphone=(), geolocation=()` | **deliberately dropped** | As a real header, `camera=()` would block the camera the in-app scanner and photo capture use. Moving it to a header is a decision to break scanning, so it is not moved silently |

The five e2e filters (`designLanguage`, `education`, `educationHelp`, `interactionLayer`,
`skeletonCoverage`, plus the lane template) are now **vacuous** — they still pass, they just filter
nothing. They are listed here rather than deleted in this pass because deleting them is only provable
by a Playwright run.

### 2.2 `The script has an unsupported MIME type ('text/html')`

`src/main.tsx` registers `/sw.js` and injects `<link rel="manifest" href="/manifest.json">` in every
production web build — and neither file existed. On Vercel, `vercel.json`'s catch-all rewrite answered
both with `index.html`, so `/sw.js` came back `HTTP 200 text/html`, the browser refused it, and
Add-to-Home-Screen never worked (the registration is `.catch(() => {})`, so it failed silently). No
lane caught it because the path only runs in a **PROD** build, and the lanes do not build one.

| | Before | After |
|---|---|---|
| `/sw.js` | `200 text/html` (index.html) | **`200 text/javascript`** |
| `/manifest.json` | `200 text/html` (index.html) | **`200 application/json`** |
| `/` and `/welcome` | `200 text/html` | unchanged |

`public/sw.js` deliberately does **not** cache navigations, the shell or API responses — only
`/assets/`, where every filename is content-hashed and a cached copy can never be a stale copy of
something else. That is the same stale-bundle risk `src/main.tsx` already refuses on the native side.
Cross-origin is never cached, because Supabase responses are per-user. `public/manifest.json` declares
`favicon.png` at **192×192** — measured from the PNG's IHDR — because a declared size that disagrees
with the file is itself a console warning, and trading one error for another is not a fix.

**Proof, from the built artifact:** `npm run build` exit 0 with
`[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)`; `dist/sw.js`
(2,932 bytes, JavaScript) and `dist/manifest.json` (341 bytes, valid JSON) are emitted; the erroring
`<meta http-equiv="X-Frame-Options">` tag is absent from `dist/index.html`; and serving `dist/` gives
the content types in the table above.

## 3. The schema gap — the real reason an authenticated screen will still error

| Fact | Evidence |
|---|---|
| Production's ledger stops at **0016** (`customer_archive_sales_snapshot`) | `list_migrations` → 8 applied |
| The repository carries **198** migrations, latest **0206** | `supabase/migrations/*.sql` |
| **190 pending** on production | count of versions > 0016 |
| The app reads/writes **26** tables; production is missing **8** | `grep '\.from('` over `src/` vs `list_tables` |

Missing, and what each one means:

| Table | What breaks without it |
|---|---|
| `branches` | every branch-scoped screen |
| `memberships`, `roles`, `role_permissions`, `permissions`, `user_permissions` | the whole RBAC surface — employee access, role management |
| `product_variants_public` | the public/marketplace variant view |
| `client_error_events` | **the app's own error reporter** (migration 0203) — so production failures leave no trace anywhere |

The app calls **61** distinct RPCs. The connection exposes no function listing, so the RPC gap is not
counted here; what is certain from the ledger is that every function introduced after 0016 is absent.
Production holds real rows (52 sales, 57 sale items, 6 customers, 4 users, 6 products, 51
notifications), so this is not an empty database: catching up needs the backup that the 06:46Z job now
takes and the ledger/drift tooling the repo already has, and it is an owner decision, not a
maintenance chore.

## 4. What this does not claim

* **The two fixes are not live.** They are in the working tree, uncommitted. Production still logs both
  errors until `main` is deployed again.
* **No authenticated session was exercised.** Production uses real SMS (`VITE_OTP_DELIVERY=sms`), so
  the signed-in screens — exactly the ones the missing tables affect — were not reached. "No errors"
  is verified for the unauthenticated surface and for the deployment, not for a signed-in session.
* **The e2e lanes were not run** (Playwright needs the local stack), so the now-vacuous filters are
  listed, not proven harmless to remove.
* **The APK was not touched**, and the 4-hour RTO remains unvalidated.

## 5. The guard this pass added, and the checks

`tests/unit/pwaAssets.test.ts` (5 tests) reads the paths out of `src/main.tsx` and asserts they exist
under `public/`, that the manifest is installable-shaped, and that every declared icon exists and
declares its **real** size. Non-vacuity proven by injecting the actual defect — moving `public/sw.js`
aside — which failed the suite with
*"/sw.js is registered but missing from public/ — the SPA rewrite will answer it with index.html and
the browser will refuse it, exactly as before"*, after which the file was restored.

| Check | Result |
|---|---|
| `npx vitest run tests/unit` | **73 files, 923 tests passed** |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` (production env) | exit 0, `[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |
| Served artifact | `/sw.js` `text/javascript`, `/manifest.json` `application/json` |
| Database | read-only; no row, table, policy or migration was written |
