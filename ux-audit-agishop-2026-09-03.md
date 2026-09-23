# UX Audit — Agrishop Inventory Management System

**Date:** 2026-09-03
**Version:** 3.0.2
**Platform:** Mobile web app (React + Vite, mobile-first)
**Audience:** Mixed — shop owners/managers (mainstream) and employees (mainstream-to-expert)
**Stakes:** Money (credit sales, payments, outstanding balances) — accuracy and clarity are critical
**Onchain:** No
**Evidence:** Live product via localhost dev server, source code inspection, contrast-check.py measurements

---

## Scope & Evidence Base

**Audited:**
- PIN Login screen
- Dashboard (home)
- Action Center (Action Needed + Follow-ups tabs, all sub-tabs)
- Customer Profile (Bilal Ahmed — real data)
- Product Detail (Karate Insecticide — real data)
- Bottom navigation
- Urdu/RTL mode

**Not audited:**
- Sales flow (New Sale, Sale Detail)
- Payment recording flow
- Purchase flow
- Employee management
- Settings/profile
- Inventory adjustment
- Mobile responsive at 320px
- Error states (network failure, Supabase downtime)
- Dark mode
- Offline behavior

---

## Executive Summary

Agrishop is a well-structured mobile-first business app with real Supabase data, clean information architecture, and a functional Action Center. The core business flows work correctly with real data. However, **four contrast failures across the primary brand colors make core text unreadable for users with moderate vision impairment** — this is the most urgent issue. A grammar error on the Dashboard ("1 actions need attention") undermines professionalism on the most-seen screen. The PIN login back arrow navigates to an undefined route instead of exiting.

---

## Quick Wins

| # | Fix | Impact | Effort |
|---|-----|--------|--------|
| 1 | Darken brand green from `#65a30d` to `#4d7c0f` (5.74:1 on white) | Fixes AA on every tab, button, and link in the app | S |
| 2 | Change secondary text from `#8A8A85` to `#6B7280` (5.04:1 on white) | Fixes AA for all descriptions, timestamps, helper text | S |
| 3 | Fix "1 actions need attention" → "1 action needs attention" | Grammar on the most-seen screen | S |
| 4 | Fix PIN screen back arrow to navigate to `/login` or exit app | Prevents broken navigation state | S |

---

## Findings by Dimension

### A11Y-01 — Brand green fails WCAG AA on white background
- **Severity:** High
- **Confidence:** Observed (computed via contrast-check.py)
- **Location:** Action Center tabs, sub-tab active states, "Create Group Reminder" button text, bottom nav active states, all green text throughout the app
- **Evidence:** `#65a30d` on `#FFFFFF` = **3.09:1**. WCAG AA requires 4.5:1 for normal text, 3:1 for large text. The brand green is used for 12px–14px text (tab labels, button text, link text) which is *not* large text.
- **Why it matters:** Users with moderate vision impairment (roughly 8% of males) cannot reliably read the active tab labels, button text, or any green-colored text. The primary navigation affordance is invisible to them.
- **Recommendation:** Darken `--brand-dark` to `#4d7c0f` (5.74:1) or `#3f6212` (7.08:1). Both pass AA. The brand light (`#d9f99d`) stays unchanged — only the text color needs to shift.
- **Effort:** S

### A11Y-02 — Brand green on brand-light background fails all contrast levels
- **Severity:** High
- **Confidence:** Observed (computed)
- **Location:** "Gentle" tone badge, "Ready to Send" badge, any green-on-light-green badge in Action Center and Follow-ups
- **Evidence:** `#65a30d` on `#d9f99d` = **2.65:1**. Fails AA, AAA, and even non-text requirements.
- **Why it matters:** The badge text communicating reminder tone and status is unreadable against its background.
- **Recommendation:** Use `#3f6212` (dark green) on `#d9f99d` = 8.16:1. Or invert: dark background with light text.
- **Effort:** S

### A11Y-03 — Secondary text gray fails AA on white
- **Severity:** High
- **Confidence:** Observed (computed)
- **Location:** All secondary text — "Enter your 4-digit PIN to continue", "Rs. 3,980 outstanding", "1 days before due date", timestamps, helper text, empty state subtitles
- **Evidence:** `#8A8A85` on `#FFFFFF` = **3.47:1**. Fails AA for normal text.
- **Why it matters:** Every description, timestamp, helper text, and secondary label in the entire app is below AA contrast. This affects a huge surface area.
- **Recommendation:** Change `--text-secondary` to `#6B7280` (5.04:1) or `#6B7280` (Tailwind gray-500). Passes AA.
- **Effort:** S

### A11Y-04 — Red status text fails AA on white
- **Severity:** Medium
- **Confidence:** Observed (computed)
- **Location:** "OUT OF STOCK" count (0), "OUTSTANDING" amount (Rs. 3,980), error states, red count numbers on Dashboard
- **Evidence:** `#EF4444` on `#FFFFFF` = **3.76:1**. Fails AA for normal text.
- **Why it matters:** Critical financial figures (outstanding balance) and stock warnings are below AA contrast.
- **Recommendation:** Use `#DC2626` (5.74:1) or `#B91C1C` (6.88:1) for red text on white.
- **Effort:** S

### A11Y-05 — "Delayed" badge text fails AA on amber background
- **Severity:** Medium
- **Confidence:** Observed (computed)
- **Location:** "Delayed" tag on Customer Profile, "High Risk" badges in Action Center
- **Evidence:** `#d97706` on `#fef3c7` = **4.51:1** — passes AA at the boundary, but `#dc2626` on `#fee2e2` = **3.95:1** fails. The red-on-pink badges ("Delayed", urgency indicators) fail AA.
- **Why it matters:** Status badges communicating payment risk are hard to read for visually impaired users.
- **Recommendation:** Use `#92400e` (dark amber) on `#fef3c7` = 7.12:1 for all amber badges. Use `#991b1b` on `#fee2e2` = 7.84:1 for red badges.
- **Effort:** S

### NAV-01 — PIN screen back arrow leads to undefined route
- **Severity:** Medium
- **Confidence:** Observed (code + runtime)
- **Location:** PIN login screen, back arrow (top-left)
- **Evidence:** Clicking the back arrow on `/login/pin` navigates to an undefined route, showing a blank page or app crash. The back button should either exit the app or do nothing (there's no prior screen to go back to).
- **Why it matters:** A returning user who accidentally taps back on the PIN screen gets stranded outside the app flow.
- **Recommendation:** Remove the back arrow on the PIN screen, or make it navigate to the phone login screen (`/login`).
- **Effort:** S

### FORM-01 — "1 actions need attention" grammar error
- **Severity:** Low
- **Confidence:** Observed (rendered)
- **Location:** Dashboard summary card — Action Needed
- **Evidence:** The text reads "1 actions need attention". The count is a variable (`highRiskCount + creditLimitReached`), and the string is hardcoded without pluralization logic.
- **Why it matters:** Grammar errors on the most-seen screen undermine perceived quality. "1 actions" is immediately noticeable.
- **Recommendation:** Use conditional copy: `${count} ${count === 1 ? 'action' : 'actions'} need${count === 1 ? 's' : ''} attention` (or use the i18n system's plural support).
- **Effort:** S

### D7-01 — No loading skeleton on Dashboard data fetch
- **Severity:** Low
- **Confidence:** Observed (rendered)
- **Location:** Dashboard on initial load
- **Evidence:** The Dashboard renders immediately with data (Zustand store hydration), but there's no visible loading state if the store hasn't loaded yet. The page flashes content when data arrives.
- **Why it matters:** On slow connections, users may see partial or stale data briefly.
- **Recommendation:** Add a lightweight skeleton/shimmer state for the summary cards and quick alerts while the store loads.
- **Effort:** M

### D7-02 — Empty states lack illustrative icons
- **Severity:** Low
- **Confidence:** Observed (rendered)
- **Location:** Action Center "No urgent actions", "No groups yet", Follow-ups empty states
- **Evidence:** Empty states use a single muted icon + text. The icons are generic (exclamation mark, users icon). More context-specific illustrations would improve scannability.
- **Why it matters:** Minor — the empty states are functional and informative. This is polish, not a defect.
- **Recommendation:** Consider adding simple SVG illustrations for key empty states (e.g., a calendar for "no upcoming reminders", a checkmark for "all caught up").
- **Effort:** M

### D11-01 — "1 days before due date" grammar error
- **Severity:** Low
- **Confidence:** Observed (rendered)
- **Location:** Action Center → Follow-ups → Ready → Bilal Ahmed reminder card
- **Evidence:** The text reads "1 days before due date". The plural "days" is used for the singular case.
- **Why it matters:** Grammar error visible on the Follow-ups screen.
- **Recommendation:** Use conditional: `${days} day${days !== 1 ? 's' : ''} before ${trigger}`.
- **Effort:** S

---

## Prioritized Backlog

1. **A11Y-01** — Darken brand green (High, S) — affects every screen
2. **A11Y-03** — Darken secondary text (High, S) — affects every screen
3. **A11Y-02** — Fix green-on-green badge contrast (High, S)
4. **A11Y-04** — Fix red text contrast (Medium, S)
5. **A11Y-05** — Fix badge text contrast (Medium, S)
6. **NAV-01** — Fix PIN back arrow (Medium, S)
7. **FORM-01** — Fix "1 actions" grammar (Low, S)
8. **D11-01** — Fix "1 days" grammar (Low, S)
9. **D7-01** — Add loading skeleton (Low, M)
10. **D7-02** — Improve empty state illustrations (Low, M)

---

## What's Working

- **Real data everywhere** — Dashboard values, Action Center signals, Customer Profile, Product Detail, recommendation engine — all connected to Supabase with real business logic.
- **Clean information architecture** — Dashboard → Action Center → specific signal → Customer Profile. Navigation is intuitive and preserves context.
- **Action Center taxonomy** — Action Needed (Highly Urgent / Medium / Normal / Credit Approval) and Follow-ups (Ready / Upcoming / Recently Sent / Groups) are well-organized.
- **PIN authentication** — Returning user flow (PIN → Dashboard) works correctly after the earlier auth fix.
- **Urdu/RTL** — Full translation and layout mirroring. All labels, tabs, empty states translated.
- **Bottom navigation** — Clear, consistent, with active state indicator.
- **Credit limit governance** — Employee request-only, admin direct edit. Properly enforced.
- **Recommendation engine** — Real business logic (crop match + basket gap + season timing) connected to real Supabase data.
- **Mobile-first layout** — All screens designed for mobile viewport with appropriate touch targets.
- **Data display** — Consistent currency formatting, clear hierarchy in summary cards.

---

## Open Questions

1. **Does the brand green contrast issue extend to the Splash screen, login OTP, and onboarding flows?** — These screens were not audited in this pass.
2. **How does the app behave on slow 3G connections?** — No network throttling test was performed.
3. **Are there error states for failed Supabase queries?** — The code has try/catch blocks, but no runtime error states were observed.
4. **Does the bottom nav "More" screen contain any undiscovered UX issues?** — Not audited.
5. **What is the actual user drop-off rate on the PIN entry screen?** — No analytics data available.
