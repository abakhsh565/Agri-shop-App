# AgriShop Change Registry — a connected system for managing UX / content / IA / data changes

## Context
The user is about to drive **many** refinements across the app — UX flows, content/copy,
information architecture, user data, and screen context — and explicitly does **not** want to
handle them ad-hoc, screen by screen. They want a single **connected system** where every
change is: (1) captured in one place, (2) analyzed for dependencies and cross-app impact,
(3) reviewed → modified → approved → implemented **one at a time**, and (4) applied
consistently so related data, flows, content, and screens stay synchronized.

Today the repo's governance is a triad — `CHANGELOG.md` (what changed), `ADR-*.md` (why),
`ROADMAP.md` (what's planned) — with the git repo as source of truth (ADR-003). But there is
**no change-request / backlog / impact-tracking layer**, and nothing that maps a proposed
change to the screens, flows, stores, and data entities it touches. This plan adds exactly
that missing layer, built **on top of** existing conventions (not beside them).

Decisions already locked with the user:
- **One file per change** (CR-001, CR-002 …) plus a master index. (Chosen over a single
  running ledger and over GitHub Issues.)
- **Format: Markdown** with forgiving `**Label:** value` fields + fixed `##` headings — easy
  for a non-technical user to edit/save/send back, reliable for the agent to parse.

## The system — a new `changes/` directory (the single source of truth for changes)

```
changes/
  README.md          # master index + control panel + how-to + lifecycle
  _TEMPLATE.md        # blank change request to copy for each new change
  IMPACT_MAP.md       # stable "anchor" reference: routes ↔ flows ↔ stores ↔ entities ↔ i18n
  CR-001-<slug>.md    # one file per change
  CR-002-<slug>.md
  ...
```

### 1. `changes/IMPACT_MAP.md` — the dependency backbone (write once, maintain as app evolves)
A concise reference of the app's information architecture so every change points at **stable
anchor names** instead of vague descriptions. Populated from the IA survey:
- **Shells & screens**: admin shell + employee shell routes → page components
  (`src/router/index.tsx`), and the pages **shared by both shells** (entire sale flow,
  customers pages, products pages, ActivityLog) — flagged because a change there hits both
  personas.
- **Flows** (ordered screen sequences + terminal write): Sale, Returns (employee), Customer
  payment, Supplier payment (admin), Purchase (admin), Add-product / Add-employee /
  Add-company / Add-customer, Auth.
- **State/data**: the 11 Zustand stores (`src/stores/*`) and their domains; the `db.ts` RPC
  write layer (`rpcCreateSale`→`create_sale`, etc.) and read fetchers.
- **Data model**: entities + key fields (`src/types/index.ts`): User, Product/ProductVariant,
  Customer, Sale/SaleItem, CustomerPayment, Return, Company, Purchase, StockAdjustment.
- **Content/i18n**: centralized dictionary `src/lib/i18n.ts` (`en` + `ur`), namespaced keys;
  note where inline literals may still live.
- **Cross-cutting**: persona gating (`ProtectedRoute` + RLS), the `useShellBase` pattern,
  employee-safe reads (`product_variants_public`, role-filtered notifications), and the
  **Non-Negotiable Rules** from AGENTS.md that any change must not violate.

### 2. `changes/_TEMPLATE.md` — the change-request template
Header (forgiving labeled fields):
```
# CR-000 — <short title>

**Status:** Draft            <!-- Draft → Proposed → Approved → In Progress → Implemented → Verified → Done | Rejected | Deferred -->
**Priority:** Medium          <!-- High | Medium | Low -->
**Type:** UX                  <!-- UX | Content | IA | Data | Bugfix | Mixed -->
**Requested by:** <name>
**Created:** YYYY-MM-DD
**Depends on:** —             <!-- other CR ids, or — -->
**Blocks:** —
```
Body (fixed headings):
- `## Goal` — what outcome we want, in plain language.
- `## Current behavior` — how it works today.
- `## Desired behavior` — the target, screen by screen if needed.
- `## Impact Map` — checklist across the five dimensions, filled by the agent against
  `IMPACT_MAP.md` anchors: **Screens**, **Flows**, **Data & stores**, **Content / i18n**,
  **Backend / DB & Security**. Each line names the specific file/route/store/entity/key.
- `## Dependencies & conflicts` — related CRs, and any clash with PRD / Non-Negotiable Rules.
- `## Open questions` — anything needing a user decision before build.
- `## Implementation notes` — agent-filled: the concrete edit list.
- `## Verification` — how we confirm it end-to-end (typecheck/build + on-screen check).

### 3. `changes/README.md` — the control panel
- **Index table**: `ID | Title | Type | Priority | Status | Impacted areas` — one row per CR,
  the at-a-glance board the user reviews.
- **Lifecycle** definition (the status flow above) and **who does what** at each stage.
- **How to add a change** (copy `_TEMPLATE.md` → `CR-00N-slug.md`, fill Goal/Current/Desired,
  send back) and **how approval works** (user sets `**Status:** Approved`, or says so in chat).
- **How it ties into existing governance**: every `Done` CR appends a `CHANGELOG.md` entry;
  a CR that changes architecture/stack spawns an `ADR-*.md`; roadmap-scale CRs link to a
  `ROADMAP.md` phase. Source-of-truth order (AGENTS.md) still governs conflicts.

### 4. Hook into `AGENTS.md`
Add a short **"Change Management"** subsection under the governance rules pointing to
`changes/` as the workflow for all iterative UX/content/IA/data changes, so any tool/agent
onboarding via the repo discovers it (honors ADR-003 "repo is memory" + tool portability).

## Workflow (how we'll actually operate, one change at a time)
1. **Capture** — user or agent creates `CR-00N` from the template with Goal/Current/Desired.
2. **Analyze** — agent fills the **Impact Map** + **Dependencies/conflicts** against
   `IMPACT_MAP.md`, flags anything touching both shells, shared data, or a Non-Negotiable Rule,
   and raises Open questions.
3. **Review & approve** — user edits/refines the file (or asks in chat); approves by setting
   `**Status:** Approved`.
4. **Implement** — agent executes **one approved CR at a time**, updating *every* impacted
   screen, flow, content key, and data path together; sets `In Progress` → `Implemented`.
5. **Verify & close** — typecheck/build + the CR's Verification steps → `Verified`/`Done`;
   append `CHANGELOG.md`; update the index row; spawn an ADR if architectural.

## Seed content (so nothing already known is lost)
- Write `IMPACT_MAP.md` fully from the current app state (this plan's survey).
- Optionally pre-load the index with carried-over items as CRs or a backlog note: Supabase
  phone-auth config, exposed-token revocation, Argon2id PIN hashing (ROADMAP #2), live
  end-to-end verification, and APK handover — so they live in the system too.

## Files created / touched
- **New:** `changes/README.md`, `changes/_TEMPLATE.md`, `changes/IMPACT_MAP.md`, and an
  example `changes/CR-001-*.md` (seeded from the first real change or a sample).
- **Edited:** `AGENTS.md` (+ short "Change Management" subsection). No application/source code
  changes in this setup step — building the system is documentation only. Actual app edits
  happen later, per approved CR.

## Verification
- Setup: confirm `changes/` exists with README + template + IMPACT_MAP, the index table
  renders, and the template's fields/headings are internally consistent. `AGENTS.md` links to
  it. (No build needed — docs only.)
- Ongoing (per CR): each implemented CR verified by `npx tsc --noEmit` + `pnpm run build` when
  it touches code, plus the CR's own on-screen Verification steps; CHANGELOG updated.

---

# UPDATE — Approved implementation program (supersedes the setup plan above)

## Context
The Change Registry setup above is **done**. The user then (a) reported a concrete bug — the
status bar icons are invisible on light backgrounds — and (b) uploaded an edited registry sheet
(`src/imports/AgriShop-Change-Registry_-_Changes.csv`, admin-side) and declared **every CR marked
`Proposed` is approved**: implement them one by one, and after each, verify it fully works, is
synced with the relevant store/DB/backend, and has not broken existing functionality — then move
to the next. The user also asked to keep credit use low without compromising output.

This section defines the ordered program to satisfy that directive.

## Step 0 — Quick fix: status-bar icon contrast (do first; small, app-wide)
**Root cause:** `src/main.tsx:42` hardcodes `StatusBar.setStyle({ style: Style.Dark })` at startup
and never updates it. In Capacitor, `Style.Dark` = *light/white icons* (for a dark background), so
in light mode (white app background) the icons are invisible.

**Fix (single choke point, no per-screen work):**
- In `src/stores/themeStore.ts` → `applyTheme(theme)` (already the one function every theme change
  and startup runs through, via `App.tsx:10` effect + `setTheme`/`toggleTheme`), add native
  status-bar sync: `light` → `Style.Light` (dark icons), `dark` → `Style.Dark` (white icons).
  Guard with `Capacitor.isNativePlatform()` + dynamic `import("@capacitor/status-bar")` + `try/catch`,
  matching the existing pattern in `main.tsx`.
- In `src/main.tsx`, remove the hardcoded `setStyle({ style: Style.Dark })` (keep
  `setOverlaysWebView({ overlay: true })` + splash hide); style is now theme-driven once App mounts.
- Optional web/PWA parity: in `applyTheme`, also set the `<meta name="theme-color">` content to the
  current theme's background so the browser/PWA chrome matches the in-app toggle (the existing metas
  in `index.html` only follow the OS `prefers-color-scheme`).
- **Verify:** `npx tsc --noEmit` + `pnpm run build`; on device, toggle light/dark in Settings and
  confirm status-bar icons stay high-contrast in both. (No emulator needed for the code check.)

## Step 1 — Reconcile the uploaded registry into clean, unique CRs (prerequisite)
The uploaded sheet re-uses IDs that collide with the live registry, so it cannot be ingested as-is:
- its `CR-001` ("Hide bottom tab bar on nested screens") collides with the **Done** `CR-001`
  (tab-bar padding); its `CR-003` (OTP UX) collides with `CR-003` (revoke token); and **three rows**
  are all `CR-008`; one cell has a stray `7`.

**Action:** map each uploaded row onto the correct existing area CR where one exists, and mint fresh
unique IDs for genuinely new items. Proposed canonical mapping:
- "Admin Dashboard info & sales summary" + "Admin Dashboard info & whole info (IA)" → **merge into
  `CR-008` Admin dashboard** (the IA-ordering row is the superset; fold the sales-summary row in).
- "Owner profile image upload & persistence" → **new CR** (distinct from dashboard layout).
- "Sale flow…" → **`CR-010`**; "Sales list & detail…" → **`CR-011`**; "Inventory & Products…" →
  **`CR-013`**; "Customers & payments…" → **`CR-014`**; "Companies/Products/Purchases…" → **`CR-016`**.
- "Hide bottom tab bar on nested screens" → **new CR** (navigation depth; relates to `CR-024`).
- "Improve phone OTP input/verification" → **new CR**, `Depends on: CR-002`.
Then overwrite the placeholder `CR-*.md` bodies with the user's Goal/Current/Desired text, set
`Status: Proposed`, fix the `CR-002` `Created` typo (`a2026-…`), run `registry:build`. (Ingest via
the script where IDs are clean; hand-place the reconciled/renumbered rows.)

## Step 2 — Shared infrastructure: image persistence (unblocks several CRs)
CR-008(owner photo), CR-010, CR-013, CR-014, CR-016 all require **persisted images** (profile /
product / customer / company). Build this once before those CRs:
- A Supabase **Storage** bucket + RLS-scoped upload/read, and a small `uploadImage()` helper in
  `src/lib/` returning a public/persisted URL stored on the entity record (`photoUrl`/`imageUrl`/
  `logoUrl` already exist in `src/types/index.ts`). Employees must not gain any cost/financial access
  (AGENTS.md Non-Negotiable); image reads are non-financial and safe.

## Step 3 — Implement approved CRs one-by-one (each: Analyze → build → verify → Done → next)
Order by dependency/foundation, smallest-risk first:
1. **Status bar** (Step 0) and **navigation-depth tab-bar hide** (new CR) — pure UI chrome.
2. **CR-008 Admin dashboard** rework (greeting w/ saved name + date, single period filter row above
   a Total-Sales card of Total Sales / Gross Profit / Transactions, then Paid / Credit / Outstanding,
   Quick Actions, Quick Alerts, Employee Performance, Recent Sales). Gross profit uses cost vs.
   selling price — **admin-only**, must never reach employee bundles.
3. **Owner profile image** (needs Step 2).
4. **CR-013 Inventory & products** (floating Add Product, Edit/Delete w/ confirm + success + real
   persistence, product image persistence).
5. **CR-014 Customers** (floating Add Customer, profile layout cleanup, admin customer-image upload,
   remove duplicate Contact Info card + Payment-History label).
6. **CR-016 Companies/Products/Purchases** (floating actions, company image, Record Payment from
   Company Detail, Edit Product from detail, in-app selection dialogs).
7. **CR-010 Sale flow** (customer/product cards w/ images+placeholder, variant simplification, cart
   styling, dedicated Success screen w/ Download + Share).
8. **CR-011 Sales list & detail** (persona-correct ownership + "Sold by", persistent notes, header
   cleanup, download / export-to-Excel / WhatsApp share). Verify RLS: admin = business-wide,
   employee = own sales only.
9. **OTP UX** (new CR; keyboard-aware Send Code, auto-verify on full OTP, keep timer/resend/errors)
   — after `CR-002` phone-auth is live.

**Per-CR verification (the user's requirement):** for each CR — fill its Impact Map against
`IMPACT_MAP.md`; implement; `npx tsc --noEmit` + `pnpm run build`; confirm the store/DB/backend sync
(e.g. image actually persisted & re-read, notes persisted, RLS filtering correct, no negative stock,
no employee cost leak); regression-check the touched flows; then set `Status: Done`, append
`CHANGELOG.md`, update the registry index, and only then start the next CR.

## Notes / constraints carried in
- Non-Negotiable Rules (no employee cost/financials, no negative stock, no hard-delete of financial
  records — product "delete" must respect ADR-004: if a product has sales history, deactivate rather
  than hard-delete), enforced in DB not just UI.
- `CR-002/003/005/006` (phone-auth, token revoke, on-device verify, APK) remain Proposed but are
  ops/deploy-gated and sequenced around the code CRs above.

## Suggested first turn after approval (keeps credit low, ships value)
Do **Step 0 (status bar) + Step 1 (registry reconciliation)** together and verify — small, safe,
and it makes the approved queue canonical — then proceed down Step 3 one CR per turn.
