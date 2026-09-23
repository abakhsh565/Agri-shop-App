# RTL / Urdu Support — Developer Guide

## How It Works

The app supports English/LTR and Urdu/RTL via a single language toggle. The system is designed so **new components automatically get RTL support** without per-component RTL code.

### Architecture

1. **Language state** — stored in `useThemeStore` (persisted to localStorage)
2. **Document direction** — `document.documentElement.dir` is set to `rtl` or `ltr` by `applyDirection()`
3. **CSS auto-flip** — `index.css` flips directional Lucide icons (`chevron-*`, `arrow-*`, `send`, …) and declares `direction: rtl`. That is ALL it does for direction. The old block that flipped physical utilities (`[dir="rtl"] .absolute.left-4`, `[dir="rtl"] .pl-10`) has been deleted; position is decided in one place now — the screen, logically.
4. **Tailwind v4 logical properties** — every spacing, alignment and position in the app uses logical classes (`text-start`, `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`) or the inline-style equivalents (`insetInlineStart` / `insetInlineEnd`) instead of physical ones.
5. **Dir context** — `<Dir>` provider wraps the app, giving components `useDir()` for the few things that genuinely need to know the direction (mirroring a rotating chevron, choosing a mirror-image icon)
6. **i18n translations** — `useT()` hook provides translated strings for all UI text

---

## Rules for New Components

### Rule 1: Use Logical Tailwind Classes

**Always** use logical property classes. **Never** use physical direction classes.

| ❌ Don't use | ✅ Use instead | Why |
|---|---|---|
| `text-left` | `text-start` | Flips automatically in RTL |
| `text-right` | `text-end` | Flips automatically in RTL |
| `ml-4` | `ms-4` | `ms` = margin-inline-start |
| `mr-4` | `me-4` | `me` = margin-inline-end |
| `pl-4` | `ps-4` | `ps` = padding-inline-start |
| `pr-4` | `pe-4` | `pe` = padding-inline-end |
| `border-l` | `border-s` | `s` = start side |
| `border-r` | `border-e` | `e` = end side |
| `rounded-l` | `rounded-s` | Start-side rounding |
| `rounded-r` | `rounded-e` | End-side rounding |
| `left-4` | `start-4` | Logical positioning |
| `right-4` | `end-4` | Logical positioning |

**Exception:** `flex-row` children are automatically reversed by the browser in RTL, so no override needed.

**This rule is enforced, not just documented.** `tests/unit/importantShimGuard.test.ts` fails the build on a physical direction utility anywhere in `src/`, on a JavaScript `isRtl ? "left" : "right"` style toggle, and on any new `!important` compatibility shim appearing in `index.css`. `tests/e2e/logicalDirection.spec.ts` then measures the live DOM in both languages, because a class Tailwind never generated is invisible to a source scan.

### Rule 2: Translate All User-Visible Text

**Every** string the user sees must use `t("key")` from `useT()`.

```tsx
import { useT } from "@/lib/i18n";

function MyComponent() {
  const t = useT();
  return <p>{t("common.save")}</p>;
}
```

**Never** hardcode:
- Button labels ("Save", "Cancel", "Delete")
- Section headings ("CREDIT LIMIT", "REMINDERS")
- Status text ("On Time", "Delayed", "No reminders")
- Validation messages ("Name is required")
- Empty states ("No customers found")
- Action text ("Edit Customer", "Record Payment")

**Always** add both English and Urdu entries to `src/lib/i18n.ts`:

```ts
// English
"myComponent.someLabel": "Some Label",

// Urdu
"myComponent.someLabel": "کچھ لیبل",
```

### Rule 3: Icons Auto-Flip via CSS

Lucide directional icons (`ChevronRight`, `ArrowRight`, `ArrowLeft`, etc.) are **automatically flipped** by CSS rules in `index.css`. You do NOT need to add `scaleX(-1)` manually.

```tsx
// This works correctly in both LTR and RTL automatically:
<ChevronRight size={14} />
```

**Exception:** If an icon has **meaning** (not just direction), don't flip it. Use the `.no-flip` class to prevent auto-flip.

### Rule 4: Only ask for the direction when you must branch on it

`useDir()` returns `{ isRtl, dir }` and nothing else. `start`/`end`/`psClass` and the
`rtlStyle()` helper were removed: they flipped positions and paddings in JavaScript, which is
the same mistake as the deleted `!important` layer — direction decided by whoever remembered
to ask, in a second place, on top of the logical property already doing the job.

```tsx
import { useDir } from "@/lib/dirContext";

function MyComponent() {
  const { isRtl } = useDir();
  // A rotation is not a position, so it genuinely needs the flag:
  return <ChevronRight style={{ transform: isRtl ? "rotate(180deg)" : undefined }} />;
}
```

Position, spacing, padding and text alignment never call it: write `ms-2`, `ps-4`,
`start-3`, `text-start`, or the inline-style equivalent `insetInlineStart`.

### Rule 5: Use the shared primitives

Directional behaviour should come from the components, not from a per-screen decision:

```tsx
<NavHeader title="…" />                       // back control pinned to the inline start
<ListCard><ListRow icon={Package} title="…" /></ListCard>   // inset hairline, row height, press state
<Sheet title="…" onClose={…}>…</Sheet>        // grabber, close at the inline start, action at the end
<SearchBar … />                                // search glyph and clear button, both logical
```

The older `src/components/ui/RTL.tsx` helpers were deleted along with the layer; those
patterns now live in the design-system primitives above.

### Rule 6: Bottom Sheets and Modals

Bottom sheets and modals slide from the **bottom** in both LTR and RTL — no direction change needed.

For **side drawers** (if ever built), they should slide from `start` (right in RTL, left in LTR).

### Rule 7: Date/Number Formatting

- Dates: Use `toLocaleDateString("en-PK", ...)` — the "en-PK" locale formats dates in a way that works for both English and Urdu speakers in Pakistan
- Currency: Always prefix with "Rs." — this is locale-independent
- Numbers: Use Western Arabic numerals (0-9) — this is standard in Pakistani business apps regardless of language

### Rule 8: Risk Labels and Status Text

For dynamic status text (risk labels, payment status), use the translation-aware functions:

```tsx
import { getPaymentStatusLabel } from "@/lib/reminderEngine";

// Pass isUrdu for translated labels
const label = getPaymentStatusLabel(status, isUrdu);
```

---

## How to Add a New Screen

1. **Use `useT()` for all text** — no hardcoded English
2. **Use logical Tailwind classes** — `text-start`, `ms-*`, `me-*`, `ps-*`, `pe-*`
3. **Import from `@/components/ui/RTL`** for common patterns
4. **Add translation keys** to `src/lib/i18n.ts` (both `en` and `ur` sections)
5. **Test in both languages** — switch language in Settings and verify

## How to Add a New Component

1. **Check if `RTL.tsx` has a reusable component** for your pattern
2. **Use `useDir()`** only to branch on direction (an icon, a rotation) — never for position
3. **Use logical CSS classes** throughout
4. **Never use `text-left`, `ml-*`, `pl-*`, `border-l`** — always logical equivalents

---

## Quick Checklist for New Features

- [ ] All text uses `t("key")` from `useT()`
- [ ] All translation keys exist in both `en` and `ur` in `i18n.ts`
- [ ] No `text-left` / `text-right` / `ml-*` / `mr-*` / `pl-*` / `pr-*` classes
- [ ] No hardcoded English strings in JSX
- [ ] Icons that point left/right auto-flip (verify with CSS rules)
- [ ] Tested by switching to Urdu in Settings → Language
- [ ] Bottom sheet / modal scrolls background correctly
- [ ] All clickable targets are in correct position after layout flip
