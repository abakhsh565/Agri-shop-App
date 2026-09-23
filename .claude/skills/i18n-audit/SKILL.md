---
name: i18n-audit
description: Verify a change is bilingual by construction — EN/UR parity, no hardcoded strings, natural Urdu, RTL layout, no overflow.
---

# /i18n-audit

**Purpose.** Urdu + RTL is a permanent requirement. A change is not done until both languages
work, and it must never require being asked for separately.

`LANGUAGE-SYSTEM.md` is the authority.

## Run the guards first — they are the cheap check

```bash
npx vitest run tests/unit/i18nCoverage.test.ts tests/unit/i18nParity.test.ts tests/unit/microcopy.test.ts
```

These fail on: a `t()` key missing from either map, a hardcoded English JSX text node or UI
attribute literal, and jargon or raw database text reaching the user in either language.

## Then check by hand what the guards cannot see

- New strings exist in **both** maps, in the same commit, with identical placeholders.
- The Urdu reads like a Pakistani shop owner talks — not literal, not textbook, not Hindi.
  English and Urdu carry the same intent in their own natural voice.
- No English leakage on an Urdu screen; no raw backend error text in either.
- Direction is `rtl` on the page root; layout uses logical properties; directional icons mirror,
  non-directional ones do not.
- Nothing clips or overflows at phone width in either direction; sheets, dialogs, menus and
  edge-positioned popovers sit correctly in RTL.

## Evidence

Render real screens in Urdu/RTL **and** English/LTR, read the copy in place, and confirm no
overflow and a clean console. Reading the dictionary is not evidence that the UI renders it.
