# Pipeline — every agreed change, its state, and how it gets verified at the end

**How this file works.** Every change asked for lands here the moment it is agreed, with its state
and the commit it went out in. Nothing is considered finished until the verification pass at the
bottom has run over the whole list. Verification is **bulk at the end, not per item** — with one
deliberate exception: database migrations are applied and inspected immediately, because a broken
migration poisons everything built on top of it and cannot be caught later by a test.

---

## A. Requested changes — state

| # | change | state | commit | proof it will get in the final pass |
|---|---|---|---|---|
| 1 | Login/signup/onboarding pass: dead ends, bypasses, false errors, no-shop state (16 states) | **done** | `82db73c4` | auth state walk re-run in one sitting |
| 2 | Record of the pass written down | **done** | `a8b04525` | — (documentation) |
| 3 | `user_active_shops` policy + `create_shop_internal` guard | **done** | `64b76c65` | `rbacInvariants` must go green (expected 510/510) |
| 4 | Login hint rewritten — final copy: *"Enter your registered number to get a verification code."* (EN + UR, demo and live variants) | **done** | `98e639a8` | restored in the copy guard + seen on the live screen |
| 5 | Phone fields take digits only — sign-in, signup and forgot-PIN ignore anything that is not a number | **done** | `c474e999` | type into each phone field live: letters do nothing, a number goes in |
| 6 | Code screen: heading rewritten to *"Type the 6-digit code to continue."*, and the running "N more to write" line removed (its e2e expectation updated to match) | **done** | `3b26d575` | see the screen live with a partial code: the sixth digit submits, nothing narrates the count |
| 7 | Full-service verification of everything above | **pending** | — | section C below |

## B. Open items

### B1. Offline entry at the PIN gate

**Why:** opening the app with no connection cannot get past the PIN screen. The PIN is verified by
the database (migration 0148), so offline the call fails and the screen says "Your PIN could not be
checked. Check the internet and try again." Everything *behind* the door already works offline
(cached rows, queued writes, sync on reconnect), so the door is the only part that breaks.

**Why it wasn't rushed:** this reverses half of an earlier security decision (the PIN left the device
because a local digest of a 4-digit secret was a lookup table away from the PIN). Reversing it must
be bounded, or it hands anyone holding the phone ten thousand guesses.

**Design**

- **Device verifier.** On a successful `savePin`/server verify, store a verifier only:
  `PBKDF2(pin, perDeviceSalt, ≥ 150k iterations)` in `secureStorage`, keyed by user id, salt random
  per device. The PIN itself is never stored.
- **Entry rule.** A session exists and the server check fails for a *transport* reason → allow entry
  when the device verifier matches, never when the server answered wrong/locked. Offline entry shows
  its own state: "Offline — your PIN was checked on this device and will be confirmed when you
  reconnect."
- **Local attempt limit.** Mirror the server's five-try rule on the device; send offline failures up
  on reconnect so the server counter cannot be evaded by pulling the cable.
- **Re-verification.** Re-check on the next connection and the next unlock. Server says wrong/locked
  → drop to the code path, the same door as today's expired session.
- **Ordering.** Entry happens before any queued write replays; a membership that turns out suspended
  on reconnect lands on the no-shop/suspended notice, not in the shell with stale rows.
- **Cleanup.** Verifier removed when the PIN changes, is cleared, or the account signs out.

**Acceptance:** cold start in airplane mode → PIN → shell with cached rows and "Syncing…" banner;
wrong PIN offline → identical message to online; five wrong offline → cooldown; reconnect with a
suspended membership → explicit notice; PIN changed on another device → offline entry refused.

**State:** pending · touches security → during implementation it gets DB-level inspection per step,
then joins the bulk pass.

### B2. Stray QA rows
`companies` "Stngneta" and `customers` "Khadim Hussain" in Default Shop, created outside these
passes. Decide delete or keep before the next baseline count. **State:** pending decision.

### B3. Earlier workstreams still uncommitted
Reminder/dashboard/store edits and `tests/e2e/results.json` are in the tree but not ours to commit
unseen. Commit or discard so "QA ≤ HEAD" keeps meaning something. **State:** pending decision.

---

## C. The final pass — run once, over everything above

Order matters: cheapest and most structural first, so a break is found before the slow lanes hide it.

1. `npx tsc --noEmit` — nothing that does not compile goes further.
2. Focused guards: `i18nCoverage`, `i18nParity`, `microcopy` (the copy changes), `typeScaleGuard`,
   `listPrimitiveGuard`, `importantShimGuard`, `shopSwitchReset`, `qaFixtureKeepList`,
   `reentrancyGuard`.
3. `rbacInvariants` — must show 510/510 with migration 0153 in place.
4. Auth state walk in one sitting, against the running app: first install → intro → login; registered
   owner → code → PIN → shop; returning user → PIN; unregistered → Create Account; employee refusal;
   duplicate and invalid numbers; wrong/expired OTP; resend limit; wrong PIN; logout → other account;
   no-shop owner; suspended employee; multi-shop switch. Each state read back from the DOM, no
   screenshots.
5. Full `npx vitest run` — expect 510/510.
6. QA database: baseline counts, active shop = Default Shop for QA Admin, QA Admin PIN `4321`
   (server-verified), fixtures created for the walk deleted again.
7. Push the result; update this table so every row reads done with its commit.

If any item in B lands before the pass, it joins step 4 with its own acceptance checks above.
