---
name: ui-audit
description: Verify a screen is on the design system — primitives, tokens, one font, ramp sizes, no overflow, clean console, measured against the reference.
---

# /ui-audit

**Purpose.** Prove a screen composes the system rather than restating it.

`DESIGN-SYSTEM.md` is the authority. Do not re-derive the rules — read them.

## Check

- Lists use `ListCard`/`ListRow`. A second bordered row list, or a row that sets its own
  separator inset, is a defect.
- Modals use the shared `Sheet` family; pickers use `SelectorField`/`SelectSheet` instead of a
  native `<select>`; search uses the one `SearchBar`.
- Type sizes come from the ramp (`text-N`), never `text-[Npx]`. One font only.
- Colour, radius, spacing, elevation come from tokens — no literal hex, no hardcoded radius.
- Logical properties for anything directional.
- Loading states show a `Skeleton` shaped like the real row; empty states use `EmptyState`,
  with an action when something genuinely blocks the user.
- No emoji or placeholder glyphs in shipped UI.

## Measure, in the browser, at 390×844

Card radius and tone fill, zero border on resting surfaces, row height, hairline inset at the
row's own leading edge, no horizontal overflow, clean console — in **light and dark**.

## Rules that catch people out

- **Render with real seeded data.** A screen that has only ever shown its empty state is not
  proven. Seed, render, verify, then remove the seed.
- **Screenshots only count if you actually decoded them.** Confirm the pixels, or say plainly
  that the capture failed and fall back to computed-style evidence.
- Report the honest list of what is still off-system. Do not claim "no bespoke rows remain"
  without a repo-wide check backing it.
- Empty-state-only or measurement-only proof is not the final word — the product owner decides
  from real screenshots.
