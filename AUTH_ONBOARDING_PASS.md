# Auth & onboarding pass — record

**Scope:** login, signup and onboarding state machine. QA project only (`bpybjrjenwccowvtrevu`).
**Branch:** `main` · **Commit:** `82db73c4` (pushed to origin).
**How to read this:** every state under "Proven" was walked in the running app during the pass, with the
rendered DOM read back and the database checked directly. This file is the record; it does not re-run
anything.

## Fixed — code

| area | file | change |
|---|---|---|
| sign-in gate | `src/lib/auth.ts` | `checkPhoneRegistration()` asks *before* a code is sent; pending/rejected applications are read through the `get_my_shop_request` RPC (the old direct table read could never work); the Supabase Auth session is only required by the branch that actually signs someone in, so brand-new numbers reach owner setup; membership mapping no longer fabricates `active`/`admin` when there is no membership row. |
| sign-in screen | `src/pages/auth/LoginPage.tsx` | unregistered → `/login/not-registered`, pending → `/login/under-review`, rejected → `/login/rejected`, inactive → `/login/deactivated`; a failed check says so instead of sending a code. |
| not-registered | `src/pages/auth/NotRegisteredPage.tsx` | primary **Create Account** (was a dead end with only "Go back"). |
| signup phone | `src/pages/register/RegisterPhonePage.tsx` | accepts `0…` and `92…`; refuses a duplicate owner number and an employee number with the right explanation; pending/rejected go to the status screen. |
| signup code | `src/pages/register/RegisterOTPPage.tsx` | a verified number that already has an account can no longer skip the PIN (offers Sign in instead); handles deactivated/rejected/pending/error. |
| owner setup | `src/pages/register/RegisterShopDetailsPage.tsx` | requires the verified phone — a direct URL no longer renders the form. |
| forgot PIN | `src/pages/auth/ForgotPINPage.tsx` | demo mode tells the truth about the code instead of claiming an SMS; session-setup failures show their own sentence. |
| PIN gate | `src/lib/pinLock.ts` | no live session → send the person through code verification instead of "check the internet". |
| shop context | `src/stores/shopStore.ts` | only a membership the database considers **active** can be the working shop; `loaded`/`ownerId` prevent a stale answer being read as the new account's. |
| switcher | `src/components/shop/ShopSwitcherSheet.tsx` | truthful empty state ("not part of a shop yet") instead of the false "could not load your shops"; a non-active membership is listed, labelled and not selectable. |
| no-shop state | `src/components/shop/ShopAccessNotice.tsx` (new) | "No shop on this account" with the role's next step; owners get Create shop, employees are told access comes from their owner. |
| shells | `AdminLayout.tsx`, `EmployeeLayout.tsx` | render that notice instead of an empty app; the employee shell now asks the server which shop it is in. |
| copy | `src/lib/i18n.ts` | EN + UR keys for all of the above. |

## Proven during the pass

- First install: cleared storage → `/welcome` (3 slides) → `/login`, intro flag written; second launch goes straight to `/login`.
- Registered owner: phone → code → PIN set + confirm → `/admin/dashboard` with "Default Shop".
- Returning user: cold load → `/login/pin` → correct PIN → dashboard with the server's shop.
- Unregistered number: refused before a code is sent, offered Create Account.
- Signup → owner setup → first shop: request row created; the same phone at sign-in shows `/login/under-review`.
- Employee number at `/register`: refused — "This number already belongs to a team. Your access comes from your shop owner."
- Duplicate owner number: "This number already has an account."
- Invalid format on both screens: "Write a correct phone number (like 03001234567)."
- Wrong OTP (unlimited tries, message escalates), expired OTP (boxes disabled, "This code is old now. Send a new one.", resend available), resend limit (30s countdown, releases and issues a fresh code).
- Wrong PIN, and the server lockout after 5 tries ("Too many wrong tries. Wait a minute, then try again.", `pin_locked_until` set).
- Forgot/reset PIN: code → new PIN + confirm → dashboard; the lock and failure counter are cleared by the reset.
- Account with no active shop: explicit notice instead of an empty shop; Create shop provisions a shop and the app comes alive.
- Employee without valid membership (suspended): employee-worded notice, Sign Out only.
- Multiple shops: switcher lists all four, switching changes the header and the tenant context, switching back restores it.
- Logout → other account: token, `agri_auth` and cached rows all cleared; the new session's JWT belongs to the new user.
- Session expiry: PIN with no live session now routes to code verification with the phone kept.
- Network failure: sign-in says it could not check the number; the PIN gate says it could not check the PIN; both recover once the connection returns.
- Cancelled/incomplete signup: abandoning the owner form writes nothing; the URL bypass is closed.

## QA database at hand-off

Migrations `0149`–`0152` committed; QA state: shops 4, branches 5, memberships 7, users 4, roles 16,
`user_active_shops` 1 (QA Admin → Default Shop), `shop_requests` 0, `audit_events` 0. QA Admin's PIN was
restored to its original `4321` (verified server-side). Two business rows **not** created by this pass
remain untouched in Default Shop: `companies` "Stngneta", `customers` "Khadim Hussain".

## Pending

1. `tests/integration/rbacInvariants.test.ts` — 2 failures: `user_active_shops` is RLS-enabled with zero
   policies, and `create_shop_internal` carries no authorization guard. Planned fix: migration `0153`
   adding a SELECT policy for the caller's own row, and an explicit owner/admin-or-trusted guard in the
   internal helper. Not written.
2. Reminder/dashboard/store edits from earlier workstreams plus `tests/e2e/results.json` remain
   uncommitted, and the `.freebuff` scratch/log artifacts are still untracked.

## Verification run at the end of the pass

`npx tsc --noEmit` clean; focused guard set (i18n coverage/parity, microcopy, typeScale, listPrimitive,
importantShim, shopSwitchReset, qaFixtureKeepList, reentrancyGuard) 46/46; full `npx vitest run` 508/510
(the two failures in item 1).
