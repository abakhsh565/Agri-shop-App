# LANGUAGE-SYSTEM.md

English + Urdu, LTR + RTL, is a **permanent product requirement**, not a translation step.
The architecture is built so a new feature is bilingual by construction:

```
Component  →  t("key")  →  translations.en / translations.ur  →  dir: ltr | rtl
```

Never this:

```
Component  →  English implementation  →  "now translate it into Urdu"
```

Everything lives in **`src/lib/i18n.ts`**.

---

## 1. The dictionary

```ts
translations = {
  en: { "nav.home": "Home", "dep.supplier.title": "No supplier yet", … },
  ur: { "nav.home": "ہوم", "dep.supplier.title": "ابھی کوئی سپلائر نہیں", … },
}
```

Two maps, one key set. `Lang = keyof typeof translations`, `I18nKey = keyof translations["en"]`.

## 2. Using it

```tsx
const t = useT();                 // inside a component
t("nav.sales")                    // → "Sales" / "فروخت"
t("cart.items_x", { x: 3 })       // → "'{x}' items" with {x} substituted
tNow("...")                       // outside React (lib/db.ts friendly(), engines)
```

`t()` is only for **user-facing** text. Domain data (a stored product name, a customer's
name) is not translated.

## 3. The guard chain — why a missing translation cannot ship

| Guard | What it makes impossible |
|---|---|
| `tests/unit/i18nCoverage.test.ts` | a `t("key")` whose key exists in neither map (the raw key would render); a hardcoded English JSX text node, UI attribute literal (`title=`, `placeholder=`), or ternary label literal. Baseline **0**, so there is no allowance to add one |
| `tests/unit/i18nParity.test.ts` | a key added to `en` but not `ur`, or vice versa; a placeholder that differs between the two |
| `tests/unit/microcopy.test.ts` | jargon words ("session", "override", "OTP", "RPC", "foreign key") and raw database errors reaching the user — **in either language** |
| `tests/e2e/rtlLtr.spec.ts`, `overlayRtl.spec.ts`, `adminMicrocopy.spec.ts` | RTL layout, overlay positioning, and real rendered copy in both languages |

Generated key families (`t(\`area.${code}\`)`, the payment-status table, the dependency graph's
key table) are additionally **typed against `I18nKey` at their source**, so a key that cannot
exist fails `tsc` where it is written. `t()`'s own parameter stays `string` on purpose: 26 call
sites compute their key legitimately, and narrowing it would only force casts that hide the
check.

## 4. Adding a new user-facing string — the only correct procedure

1. Add the key to **both** `en` and `ur` in `src/lib/i18n.ts`, in the same commit.
2. Use `t("your.key")` in the component.
3. Run `npx vitest run tests/unit/i18nCoverage.test.ts tests/unit/i18nParity.test.ts tests/unit/microcopy.test.ts`.

Step 3 fails if you skipped half of step 1, so the ordering cannot be forgotten.

### Copy rules — write like the user talks

The users are Pakistani shop owners; many finished primary or matric and are not comfortable
with technology. Copy must be short, direct, familiar, and action-oriented.

- **Never** expose technical wording: SQL, RPC, JWT, API, database, Postgres, foreign key,
  migration, "permission denied", "internal error", a stack trace.
- Say what happened **and what to do next**. Not "Something went wrong." when the system knows
  the actual reason.
- Urdu is **not** a literal translation. Write natural Pakistani Urdu in Urdu script — no
  textbook or literary Urdu, no Hindi/Devanagari, no machine-literal sentences. English and
  Urdu should carry the same intent, each in its own natural voice.
- One concept, one word, everywhere: employee, customer, supplier, active, pending,
  deactivated, paid, unpaid, outstanding, returned, voided.

## 5. RTL / LTR rules

- The page root sets `direction: isUrdu ? "rtl" : "ltr"`; `src/lib/dirContext.tsx` provides it.
- **Logical properties only** in new UI: `ps-*`/`pe-*` (not `pl-*`/`pr-*`), `ms-*`/`me-*` (not
  `ml-*`/`mr-*`), `start-*`/`end-*` (not `left-*`/`right-*`), `text-start`/`text-end` (not
  `text-left`/`text-right`).
- Directional icons mirror in RTL; non-directional ones do not.
- Test the same screen in both directions and in both themes. Nothing may overflow
  horizontally at phone width.

A legacy compatibility layer still remaps the old physical utilities for screens written before
this rule; its unreferenced rules have been deleted and `importantShimGuard` keeps it honest.
New code must not rely on it.

## 6. Verifying

```bash
npx vitest run tests/unit/i18nCoverage.test.ts tests/unit/i18nParity.test.ts \
               tests/unit/microcopy.test.ts
npx playwright test tests/e2e/rtlLtr.spec.ts tests/e2e/overlayRtl.spec.ts \
                     tests/e2e/adminMicrocopy.spec.ts
```

Then render real screens in Urdu/RTL at phone width, read the copy in place, and confirm no
English leakage, no clipping and no overflow. Dictionary inspection alone is not evidence.
