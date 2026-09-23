# DESIGN-SYSTEM.md

**One system → many screens.** A screen composes primitives and reads tokens. It never
hand-writes a colour, a radius, a font size, a shadow or a list row. That rule is what makes
"make the headings smaller" or "make it more compact" a one-line change instead of a 77-file
sweep.

Everything below lives in **`src/index.css`** (tokens, `@theme inline`, `ds-*` classes) and
**`src/components/ui/`** (primitives).

---

## 1. Tokens

Declared in `:root`, re-derived in `.dark`. Dark is **not a second palette** — it is the same
tonal relationships inverted, so a step that got darker on light gets lighter on dark.

### Surfaces — separation by tone, never by border

```
--tone-page     page background
--tone-card     one step forward  (lists, cards, sheets)
--tone-sunken   one step back     (wells, inset areas)
--hairline      in-card separator
```

Aliases: `--background`, `--card`, `--muted`, `--surface` (= card), `--surface-2` / `--surface-3`
(= sunken). Resting surfaces carry **no border and no shadow**; they are separated by tone.

### Text — three greys, two weights

```
--text-primary  --text-secondary  --text-tertiary
--weight-body: 400      --weight-strong: 600
```

Two weights only. Emphasis is weight or colour, never a third weight or an italic.

### Borders — two tokens doing two different jobs

```
--divider         in-card hairline … near-invisible ON PURPOSE
--border-control  control outline   … a field must be findable on the page
```

These must never share a value. Against a field's own tone, `--divider` measured a 2/255
delta — a text field was drawn with no discernible edge. `--border-control` sits ~27/255 away
in light and ~35/255 in dark. Cards use `--divider`; inputs, selects, and pickers use
`--border-control`.

### Radius

```
--radius-sheet  40px   sheet top corners
--radius-card   18px   grouped cards
--radius-tile   11px   logo/avatar tiles
--radius-field  999px  fields are fully rounded
```

### Spacing

8pt scale plus the measured gutter: `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-6`
24, `--space-8` 32, `--gutter` 16.

### Type — the ramp is the single source of truth

Every size the product renders has a token, and `@theme inline` turns each into a utility:

```
:root            --fs-8 … --fs-34
@theme inline    --text-8: var(--fs-8);  …
consumed as      text-13   text-17   text-28
```

**A screen writes `text-13`. It never writes `text-[13px]`.** To change the app's type scale,
edit the `--fs-*` values and nothing else. The stylesheet's own `font-size` declarations read
the ramp too, so the system layer cannot drift from the screens.

### Icons

`--icon` 24, `--icon-sm` 18, `--icon-stroke` 1.5. Lucide only, thin stroke. No emoji, no
placeholder glyphs.

### Composite sizes

`--field-h` 48 (field height), `--row-h` 52 (list row height). Change these to change density
app-wide.

### Motion

`--dur-1` 120ms (press/colour), `--dur-2` 200ms (toast, dialog), `--dur-3` 280ms (sheet,
backdrop), `--ease-out`. Nothing longer than 280ms reads as polish at this size — it reads as
lag. Animate **transform and opacity only**, and honour `prefers-reduced-motion` (a block in
`index.css` collapses every duration). An animation must never block a tap: an exiting overlay
sets `pointer-events: none` via `src/hooks/usePresence.ts`.

## 2. Typography rules

- **One font: Inter.** Exactly one `font-family` request and one family in the stylesheet. A
  second family was once imported and never rendered — a whole extra webfont downloaded on
  first launch for no glyph. Stray class names from design exports are remapped so a second
  typeface cannot sneak in. `typeScaleGuard.test.ts` fails the build if a second family appears.
- Two weights. Sizes come from the ramp only.

## 3. Primitives (`src/components/ui/`)

| Primitive | Owns |
|---|---|
| `ListCard` + `ListRow` | **the only list implementation.** Tone surface, no border, row height, padding, and the separator inset — published by the *row* (`--row-inset`) because only the row knows whether it has a leading tile or icon |
| `Sheet`, `SelectSheet`, `BusinessSettingsSheet`, `GroupReminderSheet`, `ReminderConfigSheet` | modal surfaces: grabber, centred title, circular leading close, trailing icon action |
| `SelectorField` | the selector row + the sheet that presents it (logo tile + name + qualifier + trailing state). Replaces every native `<select>` |
| `EmptyState` | empty and missing-dependency states, with an optional action |
| `SearchBar` | **the only search field.** There is exactly one implementation; a list page adopts it rather than building its own |
| `Button`, `Input` | actions and fields; hierarchy comes from intent, not uniformity |
| `Skeleton` | loading placeholders shaped like the row they become |
| `Toast`, `ConfirmDialog` | feedback and consequential-action confirmation |
| `LogoTile`, `Badge`, `QuantityCounter`, `ImageUpload`, `ScanButton`, `OTPInput`, `PINInput`, `PullToRefresh`, `StatusBar`, `NavHeader`, `BackButtonHandler` | the rest of the shared vocabulary |

`ds-*` classes in `index.css` back these (`ds-card`, `ds-btn-*`, `ds-row`, `ds-field`,
`ds-sheet`, `ds-listcard`, `ds-skeleton`, `ds-anim-*`, `ds-list-item`, `ds-stat`, `ds-tabs`,
`ds-chip`, `ds-badge`, `ds-avatar`, `ds-empty`, `ds-alert`, `ds-section`, `ds-divider`).

## 4. How a screen adopts the language

1. Compose primitives — a list is `ListCard`/`ListRow`, a modal is `Sheet`, a picker is
   `SelectorField`, a search is `SearchBar`, a loading state is `Skeleton`, an empty state is
   `EmptyState` (with an action when something is genuinely missing).
2. Use token-backed utilities: `text-13`, `p-4`, `rounded-[var(--radius-card)]`, tone surfaces.
3. Use logical properties — `ps-*`/`pe-*`, `ms-*`/`me-*`, `start-*`/`end-*`, `text-start`/
   `text-end` — so RTL needs no special case.
4. Write copy through `t()` (see `LANGUAGE-SYSTEM.md`).

## 5. How to change the UI globally

| Request | Change |
|---|---|
| "Make headings smaller" | the relevant `--fs-*` values in `:root` |
| "Make icons smaller" | `--icon` / `--icon-sm` |
| "Tighter spacing" / "more compact" | `--space-*`, `--gutter`, `--field-h`, `--row-h` |
| "Increase the corner radius" | `--radius-*` |
| "Change the visual tone" | the `--tone-*` ramp (+ the `.dark` counterparts, preserving the same relationships) |
| "Darker text" / contrast | `--text-primary` / `--text-secondary` / `--text-tertiary` |

One edit, every screen that uses the primitive or token follows.

**Known debt.** A legacy compatibility layer in `index.css` still carries `!important` shims
that remap old physical utilities (`[dir="rtl"] .pl-*`) and legacy literal colours
(`.dark .bg-white`) onto tokens. Only shims whose classes are referenced anywhere are kept —
the 22 unreferenced ones were deleted — and `importantShimGuard` prevents dead ones
accumulating. Retire a shim by migrating its remaining call sites to logical properties and
tokens, then deleting the rule.

## 6. Verifying compliance

```bash
npx vitest run tests/unit/typeScaleGuard.test.ts tests/unit/listPrimitiveGuard.test.ts
npx playwright test tests/e2e/designLanguage.spec.ts tests/e2e/interactionLayer.spec.ts
```

Before declaring a UI change done, confirm in the browser at a **phone viewport** (390×844):
cards measure the reference radius, rest with no border, fill with the tone, rows at the
reference height with a hairline inset at the row's own leading edge, nothing overflows
horizontally, and the console is clean. Empty-state-only rendering does not prove a conversion —
seed real data, render it, then remove the seed.
