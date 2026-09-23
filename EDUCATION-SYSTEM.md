# EDUCATION SYSTEM — NEW USER ONBOARDING, GUIDED TOUR, PRODUCT EDUCATION

**Status:** DESIGNED — NOT MERGED. This document is the blueprint for a separate workstream.
No screen, route, guard or string in `src/` has been changed by it.
**Scope guarded by:** `AGENTS.md` (lenses, evidence rule), `DESIGN-SYSTEM.md`, `LANGUAGE-SYSTEM.md`.

Read this together with `ARCHITECTURE.md`. Everything below was verified against the code, not assumed.

---

## 1. WHAT ALREADY EXISTS (recon)

| Area | Finding | Consequence |
|---|---|---|
| Onboarding / tour code | **None.** `grep` for `onboarding\|walkthrough\|tour\|joyride\|coachmark` in `src/` hits only two unrelated files (`lib/auth.ts`, `EmployeeDetailPage.tsx`). | Greenfield: one new subsystem, nothing to refactor around. |
| Video / media | **No `<video>`, `<iframe>`, YouTube/Vimeo anywhere.** Ships as a Capacitor APK. | Per the brief: no video, no media platform. The model keeps an unused `mediaKey?` slot so video can be added later without a redesign. |
| First-run signal | **Already exists and is server-side**: `src/lib/auth.ts:94` writes `first_login_at` on the first successful login; `touchLogin(row.id, isFirst)`; exposed as `AppUser.firstLoginAt` (`types/index.ts:214`). `users.first_login_at` is in the schema and the lookup RPCs. | A brand-new owner is identified by `firstLoginAt == null`. **Do not invent a flag for this.** |
| Post-auth landing | `PINSetPage.tsx:46` → `/admin/dashboard` for `admin\|co_admin`, else `/employee/dashboard`. | Onboarding attaches to the **landing screen**, not to a new redirect. The brief forbids a blind redirect to a new page. |
| Registration | `/register` → phone → OTP → shop details → status. Approval happens out-of-band (super-admin); owner then logs in. | Onboarding is a *first successful login* concern, not a registration-step concern. |
| Admin navigation | 5 tabs: `dashboard`, `sales`, `scan`, `inventory` (`/admin/products`), `more` (`AdminLayout.tsx:23-27`). More page holds 12 real rows (`MoreMenuPage.tsx:40-52`). | The Admin Suite tour walks the **real** tab bar and the **real** More rows. |
| Employee navigation | 4 tabs: home, sales, scan, products, customers (`EmployeeLayout.tsx:20-24`). | Permission awareness: a different, shorter tour — no owner-only targets. |
| Setup completion | `src/lib/setupStatus.ts`, graph-derived, already rendered on Home + Settings. | **Separate system.** Education reads nothing from it and never restates "what is missing". |
| Anchors for a tour | **Zero** `data-testid`/`data-tour` on `AdminLayout`, `AdminDashboardPage`, `MoreMenuPage`. | Real-UI anchoring needs stable ids *added* to those real elements (additive attributes only). This is the one app-side change the workstream requires, and it is unavoidable: anchoring to coordinates is explicitly rejected. |
| i18n | One dictionary, `src/lib/i18n.ts` (~2860 key lines), `I18nKey` union type, guarded by `i18nCoverage` / `i18nParity` / `microcopy`. | Education copy lives in the dictionary, so EN+UR parity is enforced by the existing guard — no new mechanism. |
| Design system | `ds-*` classes + tokens in `src/index.css` (`--text-row` 14px, `--icon-row` 18px @1.5, radius-card 18px), primitives `Sheet`, `Button`, `ListCard`/`ListRow`, `Skeleton`, `EmptyState`, `ConfirmDialog`. | The tour overlay is built from these tokens; no new visual language. |
| Local persistence pattern | Stores persist to `localStorage` (`business_settings`, sessions, owner id, …). | "Seen / completed" state follows the same pattern, keyed per account. |

---

## 2. ONE CONTENT MODEL (the authoritative education source)

One file, `src/education/model.ts` (name decided at implementation time), holding every word and every
target once. Onboarding, the tour, the walkthrough page and Features & Benefits all read from it — no
second copy of any sentence.

```ts
type EduStep = {
  id: string;               // stable; doubles as the anchor key
  titleKey: I18nKey;        // copy lives in src/lib/i18n.ts
  bodyKey: I18nKey;
  anchor: string;           // a real element carrying data-tour="<anchor>"
  route: string;            // where that element lives
  roles: MembershipRole[];  // permission awareness
  order: number;
  optional?: boolean;       // skipped safely if the target is absent
  mediaKey?: I18nKey;       // unused today (no video infra); reserved
};

type Feature = {
  id: string; titleKey: I18nKey; whatKey: I18nKey; whyKey: I18nKey;
  icon: LucideIcon; screen: string; roles: MembershipRole[];
};
```

Rules: no literal string ever appears in a component; a step whose `anchor` is missing from the DOM is
skipped, never rendered pointing at nothing (§3 of the brief).

---

## 3. THE FOUR EXPERIENCES, MAPPED TO REAL PLACES

```
register → approval → first login
   │
   ├─ A. WELCOME  … one Sheet on /admin/dashboard, only while firstLoginAt == null
   │                 "This is what the app does" · [Show me around] [I'll look myself]
   │
   ├─ B. GUIDED TOUR … overlay on the real UI, started from A or from Learn
   │
   ├─ C. LEARN (persistent) … More → "App guide" → Start tour / Features
   │
   └─ D. FEATURES & BENEFITS … the same model, rendered as ListCard rows, each opening the real screen
```

- **A** is one `Sheet` (existing primitive), three lines, two exits. It never blocks the product; both
  buttons dismiss it, and it is never shown again once dismissed or completed.
- **B** is an overlay with a highlight ring plus a card anchored to the highlighted element: `Next`,
  `Back` where meaningful, `1 / 10` progress, `Skip`, discoverable `X`, `Escape`, focus restored on close.
  Closing navigates nowhere, writes no business data, and cannot leave a dead overlay (state is committed
  on close, not on unmount).
- **C** is a row in the existing More menu opening a `LearnCard`-style page: the tour entry the owner can
  return to forever, plus the feature list. It does **not** depend on first-run state.
- **D** lists only capabilities that exist. One row each: icon, feature name, one line of "what it does",
  one line of "why it matters", tap → the real screen.

---

## 4. TOUR STEPS DERIVED FROM THE ACTUAL APP

Ten owner steps, because the app has that many real, teachable places — not because ten is a round number:

| # | Target (real element) | Anchor | Why it is in the tour |
|---|---|---|---|
| 1 | Home KPI area | `home.kpis` | What the numbers on the first screen mean |
| 2 | Home action row (New Sale · Record Payment · Purchases) | `home.actions` | The three things done daily |
| 3 | Sales tab | `tab.sales` | Where bills live, sale detail, returns |
| 4 | Inventory tab (`/admin/products`) | `tab.inventory` | Products, stock, barcodes |
| 5 | Scan tab | `tab.scan` | Sell by scanning a barcode |
| 6 | More → Customers | `more.customers` | Customers and their credit (khata) |
| 7 | More → Companies | `more.companies` | Suppliers behind every product |
| 8 | More → Purchases | `more.purchases` | Stock coming in, cost preserved |
| 9 | More → Payments | `more.payments` | Money in, daily cash |
| 10 | More → Reports | `more.reports` | Profit and history |

Employee tour: five steps — home, sales, scan, products, customers — using `roles: ['employee', …]`.
Owner-only targets are never shown to an employee (`roles` filter plus the anchor guard below).

---

## 5. STATE

| Question | Answer | Where |
|---|---|---|
| Is this a brand-new owner? | `firstLoginAt == null` | **Existing** `users.first_login_at` via the auth store |
| Has the welcome been seen / the tour completed? | per-account `localStorage` record written on close | New tiny store, following the app's existing store pattern |
| Can the tour be reopened? | Always | More → App guide (independent of first-run state) |

No migration, no new table, no RLS change. Honest trade-off: "dismissed" is device-local, so the same
account on a second phone replays the welcome once. That is harmless, and the tour stays reachable anyway.
If the owner wants it enforced per account instead, the record moves into `business_settings` — a one-file
change, listed here so it is a choice rather than a surprise.

---

## 6. LANGUAGE AND DESIGN COMPLIANCE

- Every title, body, button, `1 / 10`, `Skip`, `X` label, feature line and `aria-label` is an `I18nKey`
  in `src/lib/i18n.ts`, authored in both languages — plain spoken Urdu for a shop owner, not literal
  translation. Parity is already enforced by `i18nCoverage` / `i18nParity`; a missing Urdu string fails.
- RTL comes from the existing `dir` plumbing: the highlight ring and the tour card position from the
  element's box, the card's own insets use logical properties, so `Next`/`Back` and the chevrons mirror
  with the rest of the app. No `left/right` utilities.
- Surfaces, radius, type and the thin 18px/1.5 row glyph come from existing tokens; nothing new.

---

## 7. GUARDS THIS WORKSTREAM ADDS

1. **`educationAnchorGuard`** (unit): every `anchor` in the model exists as `data-tour="<anchor>"` in
   `src/`. Non-vacuous proof: remove one anchor from a screen and watch it fail.
2. **`educationCoverage`** (unit): every `titleKey` / `bodyKey` / `whatKey` / `whyKey` resolves in **both**
   languages, and no education component contains a user-visible literal.
3. **`educationTour`** (Playwright): open → next through every step → back → close with `X` at a middle
   step → skip → reopen from More; EN/LTR and UR/RTL, dark, 390pt; asserts the highlighted element is the
   real one, no horizontal overflow, no console error, and the app is usable immediately after closing.

---

## 8. VERIFICATION MATRIX (from the brief, §16)

| # | Scenario | Evidence to capture |
|---|---|---|
| 1 | New owner (first login) | welcome present; dismissed → absent after reload |
| 2 | Complete the tour | each step highlights its real element; `1/10 → 10/10`; text matches the step |
| 3 | Close with `X` at step 3 and 7 | app navigable, no overlay residue, no data written |
| 4 | Skip | not shown again on that device |
| 5 | Reopen from More → App guide | tour restarts at step 1 |
| 6 | Features & benefits | every row maps to a screen that exists |
| 7 | Urdu | real Urdu, RTL, card and ring positioned correctly, no English leakage |
| 8 | Dark | same, dark tokens |
| 9 | 390pt | no overflow, targets on-screen, card stays inside the viewport near edges |
| 10 | Reload mid-tour | no broken overlay; state correct |

---

## 9. BUILD ORDER (when this is merged)

1. Anchors: additive `data-tour` attributes on the real tab bar, Home blocks and More rows. No behaviour change.
2. `model.ts` + dictionary keys (EN/UR) + `educationAnchorGuard`.
3. Welcome sheet on first landing (`firstLoginAt == null`).
4. Tour overlay + keyboard/Escape/focus handling.
5. More → App guide page (tour + features) and the Features & benefits rows.
6. Guards and the Playwright lane, then the standard gate: tsc · vitest + independent QA row count ·
   Playwright EN/UR lanes · production build · QA clean · push with `HEAD == origin/main`.

---

## 10. UNRESOLVED DECISIONS (isolated, not blocking)

1. **Welcome surface**: a `Sheet` (recommended — reuses the primitive, unmissable, dismissible) versus a
   full page. Reversible at step 3 either way.
2. **"Seen" persistence**: device-local (recommended now) versus server-side in `business_settings`.
3. **Naming** of the More row, in the product's own voice and in both languages — e.g. "App guide" /
   "ایپ سیکھیں". Follows the existing information architecture rather than inventing a new area.
