# AgriShop — full system, process and flow documentation (owner + employee)

**What this is:** one place that explains what exists, how it works end to end, how the rules are enforced at each layer, what an owner sees when switching branches, and how the repo is meant to be worked on and verified.

**What it is not:** a replacement for the authorities. Where this doc and the code disagree, the code + tests + migrations are the source of truth, and the doc should be fixed rather than the other way around.

**Status of the work this doc talks about:** the code corrections in this patch are implemented and locally verified. The final live-QA gate that would promote them is **NOT PASSED** in this session — blocked by a dirty QA database and no authorised live write path, not by a code defect. That is stated plainly wherever it matters.

---

## 1. How to read this doc

- **For the product owner:** §3 (the app in one breath), §5 (what the owner sees when switching branches), §6 (who can do what), §9 (where the open items are).
- **For the engineer inheriting the branch:** §2 (the mindset and process), §4 (the machinery around the code), §7 (the migrations in this patch), §8 (the store/runtime wiring), §10 (how to re-verify).
- **For verification:** every claim here is either a local check you can rerun, a test in `tests/`, or a migration in `supabase/migrations/`. There is no "trust me" evidence.

The repo already has its own operating system for this: `AGENTS.md`, `ENGINEERING_OS_STATE.md`, `FEATURE-MAP.md`, `feature-registry.json`, `SCREEN-INDEX.md`, `dependency_graph.json`. This doc is the narrative layer on top — it points at those files rather than competing with them.

---

## 2. The mindset and process this repo uses

### 2.1 One principle above all

> **No actual evidence = no pass = no advancement.**

A rendered screen, a compiled build, a successful-looking run, or a doc sentence is not evidence that the behaviour is correct. Evidence is one of:

- a test that failed before and passes now,
- a guard that catches an injected failure,
- a database row observed through the real auth path,
- a browser run against QA with intercepted or live transport where the mismatch is named,
- or a migration that was replayed and read back.

If a check cannot produce that, it does not count.

### 2.2 The loop every task is supposed to follow

```
UNDERSTAND  →  CLASSIFY  →  IMPACT MAP  →  DECIDE WORKER COUNT  →  IMPLEMENT
            →  TARGETED VERIFY  →  REGRESSION  →  RELEASE CHECK
```

The point of the loop is to stop three forms of waste:

1. **Re-reading the whole repo every task.** We start from `ARCHITECTURE.md` + `FEATURE-MAP.md` + `feature-registry.json` + `SCREEN-INDEX.md` + `dependency_graph.json` + `scripts/dev/lane-map.json`, not from walking files.
2. **Blurring discovery with implementation.** You map the change first; you do not discover and edit at the same time.
3. **Running every check for every change.** The gate is sized by the change, not by habit. A one-line copy fix does not pay for a full Tier-2 E2E sweep; a money/path/RBAC/migration change does.

### 2.3 The lenses — roles on one worker, not a parallel agent runtime

This repo does **not** ship a sub-agent runtime. There is no `spawn_agent`, no agent board, no worker pool. The lenses below are a single worker switching attention deliberately. If the environment ever offers real parallelism, these lenses map onto it; until then they are just a checklist of what to think about.

| Lens | When it is used | What it asks |
|---|---|---|
| Discovery / Impact | Always first | What is touched, what depends on it, what could break |
| Builder | Every change | Implement, reuse existing primitives, stay on the impact map |
| DB / Security / Business Rules | Money, inventory, credit, RBAC, migrations, destructive actions, idempotency, history | Is the rule enforced at the correct layer? Any race, duplicate, orphan, bypass, tenant leak, destructive-action hazard? |
| UI / Design system / i18n | Any user-facing change | Reuse primitives and tokens; one font; logical properties; EN+LTR and UR+RTL; every empty/loading/error/success state; no hardcoded strings |
| QA / E2E | Behavior that matters to a human in a browser | Real browser, real DB; report PASS / FAIL / UNKNOWN — never convert UNKNOWN into PASS |
| Release / Verification | Before you call anything done | tsc, targeted tests, vitest, Playwright lanes, build, migration replay, QA cleanup with an independent row count, git state |

### 2.4 The gate is computed, not chosen

`scripts/dev/verify.mjs` classifies a change into a tier from the files touched, and it **refuses to lower** a computed tier.

| Tier | Trigger | Gate |
|---|---|---|
| 0 | documentation only | `tsc` + build |
| 1 | UI / component / copy / settings / education | `tsc` + unit guards + affected E2E lanes + build |
| 2 | money, RBAC/security, migrations, destructive actions, integration tests, release workflow | `tsc` + full vitest + canonical E2E lanes (never skipped) + affected lanes + build + independent QA row count |

A lane is skipped only when it was green **and** every file its `lane-map.json` globs cover is byte-identical. The `default` glob is `src/**`, so a new or unmapped lane can never be silently skipped.

This matters for you as an owner: when you switch branches and see a verify run, the tier tells you how much of the suite was actually required by the code that changed, and what was skipped and why.

### 2.5 Evidence has a vocabulary

- **VALID** — behaviour, context, dependencies unchanged since captured.
- **INVALIDATED** — something the evidence covers changed; rerun before promotion.
- **REPLACED** — superseded by a newer run/decision; keep the pointer, not the claim.
- **FIXED + REVERIFIED** — a real defect fixed and re-proven.
- **NOT APPLICABLE** — the check does not exercise this feature/environment.
- **BLOCKED** — cannot verify now; reason recorded. This is what live QA is in this session.

### 2.6 The mechanical tooling an engineer reaches for first

```
npm run resume          # checkpoint: branch, HEAD, server mode, lane greens, next command
npm run preflight       # 5s: git state, --mode qa server, DB reachable, fixtures, QA row count
npm run verify:plan     # computed tier + which lanes would run or be skipped
npm run verify          # smallest sufficient gate for the change
npm run verify:full     # force Tier 2, no lane caching
npm run qa:count        # independent row count
npm run qa:clean        # clean QA (only with authority — destructive)
npm run index:build     # regenerate SCREEN-INDEX.md from the router
```

`npm run verify` is the day-to-day gate. `npm run verify:full` is the escape hatch.

---

## 3. The app in one breath

AgriShop is a bilingual (EN/LTR + UR/RTL) React + Supabase inventory and retail system for a shop that has one or more physical branches.

**The shapes that matter:**

- **Person/employee** = `users` + `memberships`. The membership carries the role, status, branch scope, and role id.
- **Role** = a reusable permission template (`roles` + `role_permissions`). It does not carry a person's name.
- **Permission** = a code like `sales.create`, `customers.view`, `inventory.adjust`. 32 of them, each with an EN and UR label. The UI shows business language ("Customers · View, Create, Edit"), not codes.
- **Branch** = an operating unit (`branches` row with `tenant_id`, location, active flag). A shop/business can have several branches. Today, sales/purchases/returns/payments/inventory movements are branch-scoped; products/customers/companies are tenant-wide.
- **Tenant/shop** = the business. `shops` is the tenant. Tenant is resolved from membership, never passed in as a parameter.
- **Active branch** = the working context right now. One at a time.

**What the product does, at a glance:**

- Phone login with OTP, plus PIN/biometric re-entry on the device.
- Owner registration and shop requests (never self-approved).
- Employees, roles and permissions, with overrides and denials.
- Branch management and branch-scoped work.
- Products/variants/packs/barcodes, inventory movements, low-stock alerts.
- Purchases from suppliers, supplier payments, daily cash.
- Customers, credit limits and payments, overdue-credit rules.
- Sales with a cart, split payment (cash + credit), void, returns.
- Reminders and escalation, notifications, activity log.
- Dashboard, action center, reports, settings.
- Offline queue with ownership stamps.
- Farmer marketplace listing on the owner side (a compatibility boundary is documented, not hidden).

It is intentionally a small monolith: no microservices, no feature flags, no extra infrastructure. New machinery is only added when the MVP genuinely needs it.

---

## 4. The machinery around the code

### 4.1 Source of truth

| Question | Authority |
|---|---|
| What screens exist, where, and which lanes cover them | `SCREEN-INDEX.md` (generated from the router by `scripts/dev/index.mjs`) |
| What code depends on what | `dependency_graph.json` |
| Which E2E lane covers which files | `scripts/dev/lane-map.json` |
| What database object a table/RPC change impacts | migrations `0077`/`0078` impact functions |
| What was verified, on what, with which log | `PHASE_2_BROWSER_SAFETY.md` §17 and `backups/` logs |
| Current machine state, tiers, last green run | `ENGINEERING_OS_STATE.md` checkpoint block + `npm run resume` |
| The feature registry itself | `feature-registry.json` + `FEATURE-MAP.md` |

### 4.2 The feature registry

`feature-registry.json` is the machine-readable list of meaningful product capabilities. Each record has: name, domain, status, screens, components, state/stores, libs, DB tables, RPCs, permissions, business rules, direct dependencies, dependent features, tests, evidence, last verified date, risks.

There are 27 registered capabilities in this checkout. Most are `LIVE`. A few are deliberately different:

- **Offline queue** is `PARTIAL` — the offline-PIN decision is still open (tracked as `PIPELINE B1`).
- **Super-admin console** is registered as `LIVE` but its screen/page are intentionally absent from this checkout. The registry guard flags that absence explicitly instead of inventing a location.
- **Assistant console UI** is not committed yet; the recommendation/signal engines are tracked, the console references will land when that work does.

The registry guard (`tests/unit/featureRegistryGuard.test.ts`) fails when the registry drifts from the router, the tests, the dependency graph, or the workflow document. In this patch, the guard passes because the super-admin gap is made explicit, not suppressed.

### 4.3 Environments and why production is never touched here

Three environments exist in the repo's own vocabulary:

| Environment | Project ref | Used for |
|---|---|---|
| development | none yet | local dev (today it points at QA by necessity) |
| staging / QA | `bpybjrjenwccowvtrevu` | all local verification, E2E, this patch's work |
| production | `gkswcfljxlutkfdvvqng` | the live shop — **never used for verification** |

The build gate (`src/lib/environmentContract.ts` + `vite.config.ts`) refuses to build unless the environment is named and points at the right project. Production also refuses to build without real OTP (`sms`), so demo mode cannot slip into a production build.

### 4.4 Migrations, the ledger, and the baseline decision

Two decisions are frozen here:

1. **Every applied migration is now recorded.** `scripts/migrate.mjs` keeps a ledger (`supabase_migrations.schema_migrations` + `schema_migration_files`) so the database can say what was applied to it. Each file + its ledger rows commit in one transaction. The tool refuses production before it even connects.
2. **History is provenance, not a plan.** The migration directory is a patch set, not a baseline. Nobody replays the whole directory from an empty database as a deployment strategy. Each environment has a frozen baseline; forward changes are new files verified against that baseline first.

That is the `SCHEMA_STRATEGY.md` decision. It is why "can we replay everything from scratch" is the wrong question here, and "does the new file apply cleanly to the environment it targets" is the right one.

---

## 5. The owner-switching-branches flow, step by step

This is the direct answer to: *"If I am the owner and I switch branches, what do I get, what do I not get, and what is actually being enforced?"*

### 5.1 The model in one paragraph

- **Person** = WHO. A `users` row plus a `memberships` row (role, status, branch_scope, role_id).
- **Role + permissions** = WHAT. A `roles` template plus `role_permissions`, plus optional `user_permissions` overrides and denials. Owner is the only implicit "all access" identity.
- **Branch** = WHERE. An operating unit with a location. A business can have multiple branches. Operational records (sales, purchases, returns, payments, inventory movements) are branch-scoped. Products, customers and companies are tenant-wide today.
- **Active branch** = the working context. One at a time, changed through `set_active_branch`, which validates you are a member of that branch and records the choice.

### 5.2 What the owner does to switch branches

1. The owner is authenticated. The auth store holds `user.id`, role, tenant, membership role, membership status, `isOriginalOwner`, and so on.
2. The owner opens the branch switcher (the shop switcher sheet, the profile, or the branches list). The list is loaded from `get_my_branches()` — which, after this patch, returns **real branches**, not tenants.
3. Each branch row shows:
   - icon + name + kind label ("Main branch" / "Sub-branch"),
   - the **context line** from `branchContextLabel(...)` — honest counts or neutral "loading / not available" labels, never zero for unknown,
   - the marketplace state using the corrected state language ("This branch is listed" / "This branch is not listed"),
   - a delete/archive action where the owner is allowed (Main and the last branch cannot be archived; branches that still have staff cannot be archived).
4. The owner taps a branch. `shopStore.switchBranch(branchId)` calls the guarded `set_active_branch` RPC, which:
   - validates the caller is authenticated,
   - validates the branch exists, is active, and belongs to the caller's tenant,
   - validates the caller's membership allows that branch (owner → any; employee/admin → within `branch_scope`),
   - writes `user_active_shops.branch_id` and returns `tenant_id, branch_id, branch_name, membership_role`.
5. On success, the store **resets** before adopting the new branch: every shop-scoped store, the cart, the back stack, and the cache are cleared first. That order matters — it stops a late answer from the previous branch repopulating the new branch's store.
6. The new context becomes what the whole app reads: active tenant + active branch + role + permissions. The header shows the branch name; the activity log, sales list, reports, and so on now read against the new branch's scope.
7. The owner sees, in the new branch:
   - the branch name + kind + honest context line,
   - branch-scoped data: sales, purchases, returns, payments, inventory movements that belong to **this branch**,
   - tenant-wide masters: products, customers, companies (same across branches today),
   - notifications: shop-scoped, so tenant-level, not filtered to this branch — that is a known open item, not a bug,
   - this branch's marketplace listing state and the ability to change it if the owner/admin of this branch.

### 5.3 What the owner does **not** get, honestly

- **Per-branch product/customer stock/price.** Not representable today. `product_variants` has one `stock_qty`, one `cost_price`, one `selling_price` per tenant. The owner should not expect "Product X stock in Main vs Warehouse" — that dimension does not exist yet, and the product does not pretend it does.
- **Branch-owned masters.** Products, customers, companies are tenant-wide. A claim that a master "belongs to a branch" is currently unknown/zero, not fabricated.
- **Branch-filtered notifications.** Notifications are shop-scoped. Switching branches does not filter them. The owner sees tenant-level notification noise until a per-branch filter is built.
- **Counts that are permission-bounded.** If the owner does not have `employees.view` or `sales.view`, the corresponding count is `NULL` and the context line says "loading / not available" rather than 0. The rule is: **unknown is never rendered as if it were empty or zero.**

### 5.4 The "choose your working branch" path

If `get_my_branches()` returns no rows for the current user — they are in the business but have no active membership or no branch scope — the app shows:

- EN: `branchFlow.chooseWorking` = "Choose your working branch"
- EN: `branchFlow.noAccessTitle` = "You are in this business but not in a branch"
- EN: `branchFlow.noAccessBody` = "This account belongs to a business that has branches, but you have not been given access to one yet. Ask the business owner to set your working branch."

Urdu parity exists for all three. This is the flow for an employee who has been invited but not yet assigned a branch — they see the no-access notice, not a broken empty switcher.

### 5.5 Why the switcher used to lie, and what changed

Before this patch, `get_my_branches()` returned **tenants**, not branches. It joined memberships to `shops` and returned `tenant_id`, with tenant-wide sales/product/customer counts. So the branches widget was actually a list of businesses, the "branch id" it handed the app was a tenant id, and an owner looking at a multi-branch business saw one aggregate line, not real branches.

That is the live leak the RBAC/branch work was correcting. This patch:

- rewrites `get_my_branches()` to return real `branch_id`s with per-branch sales count/total scoped to that branch,
- makes `employee_count` appear only when the caller is allowed to see it,
- makes product/customer counts **NULL** because those masters are tenant-wide and exposing a tenant-wide count to a branch-limited reader would be the same kind of leak,
- makes the store carry both `activeShopId` (tenant) and `activeBranchId` (branch) and switch on branch ids, not tenant ids,
- makes the context label function handle nullable counts honestly.

So the owner now gets a real branch list, real per-branch context where it is provable, and honest "loading / not available" where it is not.

---

## 6. Who can do what — the role/permission model, aligned

### 6.1 The three-part model

- **WHO** = person/employee. `users` + `memberships`.
- **WHAT** = role + permissions. `roles` + `role_permissions` + optional `user_permissions` overrides/denials.
- **WHERE** = branch scope. `memberships.branch_scope` (uuid array). Owner → NULL means all branches (implicit). Employee/admin → explicit list, or NULL now means **empty effective scope**, not "all branches".

### 6.2 The core correction: admin is not all-access

There was a real risk that "admin" was treated as all-access, or that a NULL scope was treated as all-branches for employees/admins. This patch makes it explicit:

- **Owner** → all permissions (implicit). Only owner.
- **Admin/employee with a role** → that role's permissions + granted overrides − denied overrides.
- **Admin/employee without a role (role_id NULL)** → no permission template. This is a documented gap: `memberships.role` (legacy enum) vs `role_id` duality still needs one authority declared, then the other backfilled or dropped.
- **NULL branch_scope for a non-owner** → empty effective scope, not all-branches.

The specific enforceable bits:

- `get_effective_permissions(...)` is `SECURITY DEFINER`, STABLE. It refuses to inspect another user's access unless `app_is_admin()`. For an owner it returns every permission code. For anyone else it returns `role_permissions` UNION `user_permissions(is_override AND is_granted)` EXCEPT `user_permissions(is_override AND NOT is_granted)`.
- `authorize_business_action(permission, tenant_id, branch_id)` is the central gate: authenticated → tenant match → permission → branch-in-scope.
- `enforce_branch_scope` stamps `branch_id` on writes to the branch-scoped tables and refuses out-of-scope writes.
- Migration 0195 adds RESTRICTIVE RLS policies on 10 tables gated on `current_branch_id() IS NOT NULL AND has_effective_permission(...)`. Money-table INSERT/UPDATE/DELETE/TRUNCATE are revoked from `authenticated,anon` — operations go through the atomic RPCs. The UI is a convenience; the database is the boundary.

### 6.3 The two destructive account actions are kept separate by copy

These are **not** the same action, and they must never be blurred:

| Action | Who | What it erases | The honest copy |
|---|---|---|---|
| Delete account (owner) | owner | every tenant the actor owns/administers — stock, sales, customers, credit, payments | "Your stock, sales, customers, credit and payments are erased with it. This cannot be undone, and nothing can be recovered." |
| Delete account (employee/staff) | employee | only their own login + access; the shop's records stay | "Your login and your access to this shop are removed for good. The shop's own records stay with the shop. This cannot be undone, and nothing can be recovered." |
| Archive one branch | owner-only | one operating branch — sets `is_active = false`, preserves history, reassigns the active-shop fallback | Requires a reason; refuses Main, the last branch, and branches that still have staff. |

The UI uses different words for each, and the delete-target sheet and settings page do not share copy with each other.

### 6.4 The role matrix, what it means in practice

From the live discovery report (QA, measured):

- **Inventory Clerk** cannot sell — no `sales.*` at all.
- **Sales Manager** cannot restock — no `inventory.adjust`, no `products.create/edit`, no `purchases.*`.
- **Store Manager** holds the destructive actions: `products.delete`, `customers.delete`.
- **No role holds `employees.manage` or `settings.edit`** except the owner's implicit authority.
- **No role or permission for branches exists yet** — branch create/rename/archive are gated by other means.

That last point is the honest part: branches are operating units today, not a permissioned feature with its own role. The owner-only copy and the refusal rules are the current gate.

---

## 7. The migrations in this patch (0188–0195), what each one corrects

These are the uncommitted corrections on disk. Each is additive and reversible; none backfills or guesses historical ownership.

### 7.1 0188 — a branch is not its tenant

The core correction.

- Adds `branch_id` to `user_active_shops`.
- Rewrites `get_my_branches()` to return **real branches** with per-branch sales count/total scoped to that branch, `employee_count` only when the caller is allowed to see it, and product/customer counts NULL.
- Adds `allowed_branch_scope()` (owner → NULL/all; non-owner → explicit or empty), `current_branch_id()`, `current_branch_scope()`, `set_active_branch()` (validates membership + branch), `authorize_business_action()` (the central three-part gate), `enforce_branch_scope()` trigger (stamps branch_id, refuses cross-branch writes, protects OLD rows from definer updates).
- Enables RLS on the seven branch-scoped tables with restrictive branch-select policies.
- Rewrites the branches RLS policy to include the branch half of the boundary.
- Adds `validate_member_branch_scope()` trigger (explicit scopes required for non-owner; NULL intermediate denied; no retroactive invention for malformed history).

This is the migration that turns the switcher from a tenant list into a branch list and closes the cross-branch read leak at the source.

### 7.2 0189 — access changes keep the person and history

- Add/Move on a locked existing membership row; idempotent repeated assignments; no person/phone/role/history changes.
- `audit_events` gains tenant/branch/role-at-time/scope attribution.
- Session actor precedence — the real actor wins, not a supplied override.
- Normal `sale_created` audit.
- `activity.view` controls audit reads.
- Client TRUNCATE privilege removed.

### 7.3 0190 — invitation starts in the selected branch

- `create_employee_core` requires a role and explicit valid branch scope; omitted scope defaults to the selected branch, explicit NULL is refused.
- Existing `create_employee` wrapper and normal login/onboarding are retained.

This is the fix for the enrolment prefill that used to compare a branch id against a tenant id and therefore always fall back to "all branches".

### 7.4 0191 — operating branches preserve the business

Branches are operating units, not tenants — never delegate to a tenant purge.

- `create_operating_branch` (owner-only, requires `settings.edit`, name + Pakistan location, idempotency on duplicate name, audit event with before/after).
- `rename_branch` (branch-targeted, `settings.edit`, idempotent).
- `archive_operating_branch` (owner-only, requires reason, preserves history, refuses Main + last branch + branches with staff, reassigns fallback).
- Legacy `delete_branch` (the tenant-erasing one) is **revoked** — it is not a branch API.

### 7.5 0192 — consequential records guard before retry

Guards consequential records — the ones that would be duplicated or corrupted by a retry — before a retry lands. Idempotency plus pre-condition checks on money/state-changing operations.

### 7.6 0193 — activity reads the action history

`activity.view` / `get_branch_activity` reads the action history with the real actor/branch/role-at-time attribution that 0189 added, so the activity screen can show what actually happened, where, and by whom.

### 7.7 0194 — access edits do not widen the editor

Access edits (Add/Move/override grants/denials) cannot widen the editor's own authority: a manager cannot grant permissions above their own, cannot widen another member's branch scope beyond their own, cannot edit a membership they are not entitled to.

### 7.8 0195 — permissions are not just navigation

- `get_effective_permissions` (owner = all; non-owner = role + granted overrides − denied overrides; refuses non-admin inspection of others).
- RESTRICTIVE RLS policies on 10 tables (SELECT/INSERT/UPDATE) gated on `current_branch_id() AND has_effective_permission(...)`.
- Money tables revoke direct DML from authenticated/anon (force atomic RPCs); only `UPDATE(notes)` on sales is granted to authenticated.

This is the migration inspected on disk in this session and confirmed correct: admin without an override still gets only its role's permissions.

---

## 8. The store and runtime wiring the branch flow depends on

### 8.1 Shop store now carries two notions of "current"

- `activeShopId` = the tenant.
- `activeBranchId` = the branch the app is currently working in.

The switcher, profile, and branch controls use branch ids. Add Employee prefill uses `activeBranchId`. The employee access editor no longer writes a NULL all-branches grant.

### 8.2 Context label is one function, used in two places

`branchContextLabel(t, branch)` in `src/lib/branchContext.ts` is the single sentence that says what is inside a branch. It is used on Home (when the account is working in a branch it added) and on the Branches screen (every row). The reason it is one function: two derivations of the same sentence is how screens end up disagreeing about the same branch.

It has two rules:

1. **Counts are said in the right number.** "1 employees" is the kind of thing that makes an app feel unfinished.
2. **Unknown is never zero.** Products and customers are business-wide in the current model, and restricted counts may be hidden. The label only says "empty" when the values actually prove emptiness; otherwise it states only known facts or stays neutral.

### 8.3 Notification scope stays shop-scoped

Notifications are `shop_id`-scoped, not branch-scoped. So the owner switching branches sees tenant-level notification noise, not branch-filtered notifications — unless a per-branch filter is built later. This is documented as a known open item, not a defect. The notification store honours the existing shop scope; it does not invent branch attribution the database does not assert.

### 8.4 Offline queue now stamps ownership and releases the sync lock in a finally

- Each queued operation records the tenant/userId/branchId it was created under.
- It is refused if the confirmed device context no longer matches.
- Legacy unowned rows are retained instead of guessed.
- Items queued while an earlier request is in flight are preserved.
- The sync lock is released in a `finally`, so an unexpected localStorage/network throw cannot wedge the queue.

Proven by the offline branch ownership and cache ownership unit tests.

---

## 9. The open items — honest list, not hidden

These are real gaps. They are **not** defects in the code corrections above; they are model/scope items that need live QA or further implementation.

1. **Per-branch product/customer stock/price** — not representable today. Reporting must stay honest. (Audit C8.)
2. **Notifications are shop-scoped, not branch-scoped** — owner switching branches sees tenant-level notification noise. A per-branch filter is a future feature. (Documented; not a defect.)
3. **Marketplace enablement is tenant-level storage** (`shops.marketplace_enabled`) even though the UI shows a per-branch-looking toggle beside one branch. The UI correction (state language + branch-targeted location writes) is partial until schema/backend catches up. (Audit item 8.)
4. **`memberships.role` (legacy enum) vs `role_id` duality** — a `role_id NULL` employee has no permission template. One authority must be declared, then the other backfilled or dropped. (Audit C9.)
5. **Super-admin console** — registered as an intended path whose screen/page are absent from this checkout. Any future addition must also add the router entry + page tree, or the registry guard red-shifts again. (Documented intentional gap, not a defect.)
6. **Cache owner across reload + in-flight late responses** — store reset alone cannot establish branch-aware cache protection; proof needed. (Audit item 10.)
7. **Live verification** — the corrections are locally proven (PGlite + mocked transport + intercepted browser); they still need live QA fixtures, real JWT/API + UI reads/writes, reload/refresh, independent baseline/cleanup, and the full role matrix on actual backend paths including direct API bypasses. (Final gate NOT PASSED.)
8. **Audit dimension completeness** — `audit_events` gains `branch_id` + `actor_role` attribution on the corrected paths; legacy historical rows with unknown attribution are not invented or backfilled. (Audit C4.)

---

## 10. How to re-verify these claims yourself

### 10.1 Local, no network, no database

```bash
npx tsc --noEmit                       # expect exit 0
npm run build                          # expect exit 0, dist/ emitted
node scripts/dev/verify.mjs --plan     # expect exit 0, Tier 2 plan (this patch touches migrations + workflows)
```

### 10.2 Local, the focused guards that cover the files touched in this patch

```bash
npx vitest run \
  tests/unit/i18nCoverage.test.ts \
  tests/unit/i18nParity.test.ts \
  tests/unit/microcopy.test.ts \
  tests/unit/branchIdentityBoundary.test.ts \
  tests/unit/branchLateResponse.test.ts \
  tests/unit/offlineBranchOwnership.test.ts \
  tests/unit/shopSwitchReset.test.ts \
  tests/unit/cacheOwnership.test.ts \
  tests/unit/notificationScope.test.ts \
  tests/unit/geo.test.ts \
  tests/unit/locationPicked.test.ts \
  tests/unit/featureRegistryGuard.test.ts
```

That is the 107/107 set that covers the actual files changed here: i18n parity/microcopy, branch identity boundary, branch late response, offline branch ownership, shop switch reset, cache ownership, notification scope, geo, location picked, and the feature registry guard.

### 10.3 What the browser lane would prove (when it can run)

`tests/e2e/branchFlowCorrections.spec.ts` intercepts every Supabase call and asserts the actual UI contract:

- Add/Move are explicit and confirmed, and carry branch not tenant,
- the create-branch flow uses `create_operating_branch` with a Pakistan location and no `p_role_ids`,
- the activity screen shows the real actor + branch,
- branch delete is refused until a reason is typed,
- the archive flow calls `archive_operating_branch` with a reason.

It runs in both EN and Urdu. This is UI-contract evidence only — it does not impersonate a live QA session or claim database enforcement. That requires the live connector.

### 10.4 What would need live QA

- Clean QA database (authorised write).
- Independent row count = 0.
- E2E lanes against clean QA (Playwright starts its own `--mode qa` server).
- Full vitest (unit + integration) to confirm no drift.
- RBAC live role-matrix verification on real backend paths, including direct API bypasses. This is the deepest remaining item — scoped in `RBAC_BRANCH_SCOPE_AUDIT.md` items C1–C10 and the T1–T11 test set.

---

## 11. How much time is left, honestly

**Code side:** nothing left to build or fix for the items this patch covers. TypeScript is clean, the focused guards are green, the build passes, the registry guard passes, and the 0195 admin semantics were inspected on disk and confirmed correct.

**Verification side:** what remains is the live-QA final gate, which is environmental, not a code task.

| Remaining item | What it needs | About how long, once the environment is ready |
|---|---|---|
| Clean QA database | Authorised write/cleanup | ~1 step + re-count |
| E2E lanes against clean QA | Playwright starts its own server; EN + Urdu | ~20–40 min for the affected lanes; the full lane set is longer |
| Full vitest (unit + integration) | Local | ~3–6 min |
| Independent QA row count after lanes | `qaRowCount()` via the repo's own path | < 1 min |
| RBAC live role-matrix verification (0149/0106/0175 semantics, full matrix on real backend paths including direct API bypasses) | Authorised connector to QA, read-only probes | ~1–2 h of careful probing |
| **Total, once environment is ready** | | **roughly 3–6 hours** for a complete pass, dominated by live QA probing + E2E lanes; only ~5–10 min of that is code/CI, the rest is live-QA environment + RBAC depth |

**In this session specifically:** the code is done. The only things that could be done without live QA access are already done. Passing the final gate needs either authorisation to clean QA and run the E2E lanes, or an authorised connector to probe the live role matrix — both outside this session's scope. So from the code side, no more time is required; the remaining time is entirely the live-QA gate, which is blocked by environment/authorisation, not by the work.

---

## 12. If you switch branches tomorrow, here is what you will land on

1. `npm run resume` will tell you the branch, the HEAD, whether the dev server is up and in QA mode, which lanes are green, and the last verify result.
2. `npm run verify:plan` will tell you the tier the current tree would pay for, which files triggered it, and which lanes would run or be skipped.
3. If the tree is byte-identical to the last green run, `npm run verify` exits immediately and says so — that is the restart saving in practice.
4. The checkpoint block in `ENGINEERING_OS_STATE.md` is the single source of project state; the narrative docs (`PHASE_*`, `FEATURE-MAP.md`, this file) are the explanation layered on top.

The repo is built so that the next person does not have to rediscover any of that by reading the tree.

---

*End of documentation.*

**Honest status again, at the end:** code corrections implemented and locally verified. Final live-QA gate **NOT PASSED** in this session — blocked by a dirty QA database and no authorised live write path, not by a code defect. Production was never touched.
