# RTL / Urdu Support — Developer Guide

## How It Works

The app supports English/LTR and Urdu/RTL via a single language toggle. The system is designed so **new components automatically get RTL support** without per-component RTL code.

### Architecture

1. **Language state** — stored in `useThemeStore` (persisted to localStorage)
2. **Document direction** — `document.documentElement.dir` is set to `rtl` or `ltr` by `applyDirection()`
3. **CSS auto-flip** — `index.css` has rules that flip Lucide icons, text alignment, and absolute positioning automatically when `dir="rtl"` is set
4. **Tailwind v4 logical properties** — all spacing/alignment uses logical classes (`text-start`, `ms-`, `me-`, `ps-`, `pe-`) instead of physical classes
5. **Dir context** — `<Dir>` provider wraps the app, giving all components access to `useDir()` for RTL state
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

### Rule 4: Use the `<Dir>` Context for Directional Logic

When you need to know the current direction in code (e.g., for conditional rendering or inline styles):

```tsx
import { useDir, useRtlStyle } from "@/lib/dirContext";

function MyComponent() {
  const { isRtl, start, end } = useDir();
  const rtlStyle = useRtlStyle();

  // Option A: className-based
  return <div className={isRtl ? "me-2" : "ms-2"}>...</div>;

  // Option B: style-based (for inline styles)
  return <div style={rtlStyle({ paddingLeft: 16 })}>...</div>;
}
```

### Rule 5: Use Reusable Components

Use the pre-built components from `src/components/ui/RTL.tsx` for common patterns:

```tsx
import { ActionRow, Chip, StatCard, SectionLabel, EmptyState } from "@/components/ui/RTL";

// Action row (menu items) — icon on start side, text in middle
<ActionRow icon={<Pencil />} label="Edit Customer" onClick={...} />

// Toggle chip — brand-colored when selected
<Chip selected={isCropSelected} onClick={toggle}>Cotton</Chip>

// Stat card — label top, value bottom
<StatCard label="OUTSTANDING" value="Rs. 3,330" />

// Section label — uppercase, start-aligned
<SectionLabel text="CREDIT LIMIT" />

// Empty state — centered icon + text
<EmptyState icon={<Bell />} title="No reminders" subtitle="Configure schedules..." />
```

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
2. **Use `useDir()`** if you need direction info in code
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
