# ARCHITECTURE.md — Agri Shop / Freebuff project map

**Purpose.** This is the shared discovery layer. An agent (or a human) starting work here
should not have to re-read the codebase to find out which screens exist, what the entities
depend on, where the design tokens live, or how to run the tests. Read this first; only open
the code for the part you are changing.

**Keep it current.** Update this file when architecture changes in a way another task would
have to rediscover: a new route group, a new entity or dependency, a new store, a new guard,
a new build step. Do not log routine edits here — that is what git is for.

---

## 1. Stack

| Layer | Choice |
|---|---|
| UI | React 19 + TypeScript, Vite 8 |
| Styling | Tailwind v4 (`@theme inline`) + the token layer in `src/index.css` |
| Icons | `lucide-react`, thin stroke — no emoji anywhere in shipped UI |
| State | Zustand stores in `src/stores/` |
| Backend | Supabase — Postgres, RLS, SECURITY DEFINER RPCs, PostgREST |
| Shipping | Capacitor Android (`android/`), APK via `.github/workflows/build-apk.yml` |
| Unit tests | Vitest (`tests/unit`, `tests/integration`) |
| Browser tests | Playwright (`tests/e2e`, 28 specs) |

**Feature registry, dependency map and change-impact workflow:** `FEATURE-MAP.md`
(records in `feature-registry.json`, enforced by `tests/unit/featureRegistryGuard.test.ts`).
Read it before changing a feature; it points at `SCREEN-INDEX.md`, `dependency_graph.json`,
`scripts/dev/lane-map.json` and the evidence matrix instead of duplicating them.

## 2. Route shape

The route table lives in `src/App.tsx`. Two authenticated shells:

- `src/components/layout/AdminLayout.tsx` — the owner/admin shell
- `src/components/layout/EmployeeLayout.tsx` — the employee shell

Pages are grouped by shell and domain:

```
src/pages/admin/     alerts companies dashboard employees inventory more
                     notifications payments purchases reports returns sales settings
src/pages/employee/  activity customers dashboard more notifications products
                     returns sale sales search settings
src/pages/           auth onboarding register super-admin
```

**A route is both a screen and a permission boundary.** Shell base comes from
`src/lib/useShellBase.ts`; the required permission is declared with the route and checked by
the guard. When offering the user a link to another screen, check the route exists **and** the
caller holds its permission — a link the guard bounces is a dead end wearing a button. This is
implemented once in `src/lib/dependencyGraph.ts`.

## 3. Entities and their real dependencies

Derived from the routers and validators, not assumed. Only these are **blocking**:

| Task | Needs | Where it is enforced |
|---|---|---|
| Make a sale | a customer | `pages/employee/sale/SelectCustomerPage` (step 1) |
| Make a sale | a product | `pages/employee/sale/BrowseProductsPage` |
| Add a product | a supplier/company | `pages/admin/inventory/AddProductPage` save guard |
| Record a purchase | a supplier/company **and** a product | `pages/admin/purchases/RecordPurchasePage` |

Everything else (returns, payments, reminders, groups, credit requests) hangs off a record
that must already exist, so it has no missing-dependency state. Do not add contextual create
actions to entities that are not on this list.

`src/lib/dependencyGraph.ts` is the single source of truth for this table: entity → copy key,
create route, required permission, and the `returnTo` continuation. Both empty-state surfaces
(`EmptyState` and the picker sheets, via `emptyAction`) render from it.

## 4. Data layer

- `supabase/migrations/` — 174 migrations. History is authoritative; do not rewrite it.
- Business rules that carry money live in **RPCs**, not in the client: sale confirm is
  idempotent at the DB level, stock deducts once, COGS uses the cost recorded at the time of
  sale, overdue credit is computed from `credit − payments applied` against the due date.
- `src/lib/db.ts` — the client data access layer. `friendly()` maps database failures to
  owner-readable words in the active language; raw Postgres text must never reach a user.
- Tenant isolation and RBAC are enforced by RLS and RPC authorization, not by the UI. A UI
  check is a courtesy; the backend is the boundary.

## 5. State ownership

One owner per piece of state. Stores live in `src/stores/` (`authStore`, `cartStore`,
`productsStore`, `customersStore`, `salesStore`, `employeesStore`, `rolesStore`,
`permissionsStore`, `companiesStore`, `notificationStore`, `shopRequestsStore`, `themeStore`,
`uiStore`, plus `useBootstrapData`). If you find yourself writing a relevant piece of state
into a screen, you are in the wrong layer.

## 6. Design system

Tokens and primitives are documented in **`DESIGN-SYSTEM.md`**. Read it before writing any UI.
The short version: screens compose primitives (`ListCard`/`ListRow`, `Sheet`, `Button`,
`Input`, `EmptyState`, `SearchBar`, `Skeleton`, `Toast`, `ConfirmDialog`, `SelectorField`,
`SelectSheet`) and never hand-style a surface, a font size, or a list row.

## 7. Language system

English + Urdu, LTR + RTL, is a permanent requirement, documented in
**`LANGUAGE-SYSTEM.md`**. Every user-facing string goes through `t()` from `src/lib/i18n.ts`;
screens use logical CSS properties; both languages are verified by guards that fail the build.

## 8. Critical workflows and destructive actions

Workflows that must not regress: sign-in/OTP → onboarding → dashboard; add product → purchase
→ sale → COGS/profit; customer credit → payment → overdue; reminder generation and escalation;
invitation → pending employee → active employee → access editing.

Destructive or consequential actions — deactivate/reactivate employee, cancel invitation,
archive/delete customer, product, supplier, remove image, delete role, void sale, return — must
confirm, must be idempotent under repeated taps, and must be enforced in the database.

## 9. Test map

| Guard / lane | Protects |
|---|---|
| `tests/unit/typeScaleGuard.test.ts` | one type scale; one font |
| `tests/unit/listPrimitiveGuard.test.ts` | one list implementation; row owns the separator inset |
| `tests/unit/i18nCoverage.test.ts` | every `t()` key exists; no hardcoded English in JSX |
| `tests/unit/i18nParity.test.ts` | EN and UR carry identical keys and placeholders |
| `tests/unit/microcopy.test.ts` | no jargon, no raw database errors, both languages |
| `tests/unit/reentrancyGuard.test.ts` | repeated/double submission safety |
| `tests/unit/migrationReplayability.test.ts` | migration chain applies from zero |
| `tests/unit/qaFixtureKeepList.test.ts` | the QA fixture accounts survive a cleanup |
| `tests/unit/overdueCredit.test.ts`, `reminderEscalation.test.ts`, `signalEngine.test.ts` | locked business rules |
| `tests/e2e/rtlLtr`, `overlayRtl`, `designLanguage`, `interactionLayer`, `dependencyContinuity`, `accessUx`, `adminMicrocopy`, `dashboardScope`, `productOpeningStock` | the real surface, both languages |

## 10. Build, run, release

```bash
npx tsc --noEmit        # typecheck
npx vitest run          # full unit + integration suite
npx playwright test     # full browser suite (or: npm run test:e2e:lanes)
npm run build           # production build
npm run dev             # dev server (see .freebuff/run.md for the preview procedure)
```

Android: `npm run cap:sync` then the Gradle build; the release path is
`.github/workflows/build-apk.yml`. QA data is cleaned with `scripts/clean-test-data.mjs`;
verify emptiness with an independent query, never from the cleaner's own output.
