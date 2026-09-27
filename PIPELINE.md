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
| 7 | Code screen hint rewritten to *"Your verification code is 123456."* (the line under the bold heading; the bold heading itself left as it was) | **done** | this commit | see it on the code screen in demo mode |
| 8 | Code screen layout/copy: code lives 2 minutes; "Code expires in" sentence gone (timer + **Resend** on one row); Resend disabled for its 30s cooldown instead of a countdown sentence (and disabled from the moment the screen opens, since a code was just sent); "Change number?" on the same line as the number; the line printing the code removed | **done** | `c31b62e8` | see the row live: timer ticking, Resend greyed then usable at 30s; check the QA code with the QA fixture numbers |
| 9 | Code screen line under the heading rewritten to the instruction form: *"Enter the OTP verification code we just sent to your number {phone}."* with *"Change number?"* inline after the number (EN + UR; no key added or removed) | **done** | `a405c766` | see it on both code screens and the forgot-PIN code step, with the number shown and the link inline |
| 10 | Code screen action renamed **Resend** → *"Request a new code"* (EN + UR), same 30s disabled cooldown, same row as the timer | **done** | `f273062f` | see the row live: timer then "Request a new code", greyed for 30s then usable |
| 11 | Back button no longer closes the app on the signed-out screens: the handler + toast host are mounted on sign-in/sign-up/the introduction, leaving the app takes two presses there like the dashboard, and a press inside a signed-out flow steps back instead of exiting | **done** | `806418c1` | press back on `/login`, `/register`, `/welcome` and mid-sign-up on the phone: one press shows "Press back again to close the app.", a second within 2.5s closes it, and the step screens go back a step |
| 12 | Bottom-sheet legibility: a dedicated `--tone-sheet` surface (a step above the card on dark, unchanged on light) and a per-theme `--scrim`, so sheets stop merging into the page; chips on a sheet use the translucent `--sheet-chip` | **done** | `bdc39548` | open a sheet in dark theme and see the raised panel against the dimmed page |
| 13 | Close cross is now per sheet: single-tap pickers (shop switcher, field picker, welcome notice) have none; sheets collecting values, and content with no other exit (tutorial video, help), keep it | **done** | `bdc39548` | open each sheet and check the cross is present only where it earns its place |
| 14 | Sheet tone/cross applied to the reminder, business-settings and admin-settings sheets too — **left uncommitted**, because those three files carry another workstream's uncommitted edits and pushing them would push that work | **partial** | — | stage those hunks alone once that workstream lands |
| 15 | Dark-theme legibility: `--brand-dark` / `--brand-light` inverted for dark (brand text was 2.7:1), Badge and the alert icons switched to the tokens, payment toggles off white-on-green | **done** | `156cfbc8` | look at a badge, a brand link and a selected toggle in dark |
| 16 | Review & payment screen: totals panel off the light literal onto surface tokens, over-limit banner onto the error tokens | **done** | `156cfbc8` | open the cart in dark and read subtotal / total |
| 17 | Payment method (cash/bank) only asked once an amount is actually being received | **done** | `156cfbc8` | on a credit sale with no amount typed, the method row is absent; type one and it appears |
| 18 | Credit limit can be set from the sale screen when the customer has none, via permission-checked RPC `set_customer_credit_limit` (0154, applied to QA) | **done** | `156cfbc8` | set a limit mid-sale as owner, then see the same value on the customer profile |
| 19 | Crops in business settings can be renamed (added and deleted already existed) | **done** | `156cfbc8` | rename a crop in the sheet, save, reopen |
| 20 | Reset-PIN code screen: Verify button removed, the sixth digit submits (same rule as sign-in) | **done** | `76feaa53` | enter a code on the forgotten-PIN screen: it checks itself, spinner only |
| 21 | Customer detail page: Record Payment row is a normal ListRow again (its own tint and hardcoded green are gone); delete row uses the error token | **done** | `76feaa53` | open a customer in dark and compare the rows |
| 22 | Sale success screen rebuilt: one screen, no scrolling, content centred, status bar reserved (the tick no longer hides under it), receipt card with band / fields / perforation / amount, design-system `Button`s, **Print** added | **done** | `92ae98a1` | complete a sale on the phone and read the screen without scrolling |
| 23 | Review & payment: credit limit is a text action above the customer opening its own sheet (amount + Save, same RPC); amount sits under the payment choice, cash/bank after it | **done** | `92ae98a1` | open the cart: order is type → amount → method, and the credit-limit sheet saves and updates everywhere |
| 24 | QA data is no longer deleted by test runs — cleaning is opt-in (`QA_CLEAN_AFTER_RUN=1`), and every run says whether it deleted anything | **done** | `92ae98a1` | run any test file and confirm the log says QA data left untouched; rows you entered stay |
| 25 | Success screen trimmed to four actions (New Sale primary, Share + Print, quiet Home; Download dropped) at design-system sizes | **done** | `e3b7cc0f` | look at the action area: one primary, one secondary row, one quiet link |
| 26 | Confirmation feedback on success: confetti burst (no dependency, reduced-motion hides it, clears itself) and a synthesised two-note chime | **done** | `e3b7cc0f` | complete a sale: pieces fall over the card for ~2.5s and the chime plays once |
| 27 | Code screen fits one page at phone height and with the keyboard open (sign-in and sign-up) | **done** | `e3b7cc0f` | measured 390x780 and 390x430: no scroll, boxes + clock + Request a new code all visible |
| 28 | Success tick halo: two staggered rings breathing out behind the check (reduced-motion hides them) | **done** | `f5c28f7e` | seen live: rings expanding behind the tick |
| 29 | Removed the repeated "Rs. 11,200 received" line under *Sale Complete!* — the receipt shows the total below it | **done** | `f5c28f7e` | see the screen: heading stands alone |
| 30 | Chime lengthened to ~3.8s and made to settle: widening gaps, closing A5+E6 chord held 2.9s, 0.15 gain | **done** | `f5c28f7e` | complete a sale and listen |
| 31 | PIN screens are height-responsive: the keypad is measured from the live viewport height (44px minimum target, never smaller), the greeting avatar scales with it, the second greeting line drops under 560px, and the page's own padding gives before the keys do. At 360x640 the keys were ~93px and the screen scrolled; they are 67px and it does not | **done** | this commit | open `/login/pin`, `/login/pin-set` and the forgot-PIN steps at 360x640, 360x568, 320x568 and 390x430: no key below the fold, no scrolling |
| 32 | Code screen sized the same way: six boxes and their five gaps scale with the width (and the rhythm with the height), so the row fits a 320px phone and still clears a keyboard | **done** | this commit | measured 390x430 and 320x568: six boxes visible, zero page overflow, tab order unchanged |
| 33 | Customer detail hero card follows the reference: 60px avatar, one bold name, one meta line (`phone · town · crops`) instead of a phone line plus a row of crop chips, status pill under it in the row's own green/amber/red | **done** | this commit | open a customer that has crops: one line with two dots, one pill, no chip row |
| 34 | A red guard turned green: the receipt's hand-rolled, index-based hairline in `SaleSuccessPage` is now a written exception in `listPrimitiveGuard` (the receipt is a document — band, perforation, one large amount — not a grouped list), so the guard stops failing on `main` | **done** | this commit | `npx vitest run tests/unit/listPrimitiveGuard.test.ts` green, other offenders still fail it |
| 35 | The recommendation engine finally has tests (9 cases: crop required, in-season basket gap, bought-today silence, due-again after 30 days, out-of-season, no stock, cap of five, and both directions) — it is the feature whose output is invisible when it decides nothing, so its rules are now pinned | **done** | this commit | proven non-vacuous by injecting the bought-today case once and watching it fail |
| 36 | Credit limit is one control in one place: `Set limit` / `Change limit` sits beside the amount on the customer card and on the sale screen (it used to be a bare underlined "Credit Limit" floating above the customer, plus a field inside the edit form). The sheet has no close cross — one field, Cancel and the scrim are the exits | **done** | this commit | open a customer: the button names what it will do, and the sheet has one field and no cross |
| 37 | The edit form no longer writes `credit_limit` at all — the column has one owner, the audited RPC — which closes the write path that moved a limit with no audit row (B4) | **done** | this commit | edit a customer and save: `audit_events` gains nothing, and the limit is unchanged |
| 38 | Lowering a limit below what is owed is allowed, stated, and enforced at the database: the sheet warns with the exact overage, the profile shows "Rs. 1,600 over the limit", the debt is never recalculated, and `create_sale_unchecked` refuses new credit past the limit (owner/admin may override, and the override is logged) | **done** | this commit + migration `0155` | proved by calling the deployed RPC with an over-limit payload: `CREDIT_LIMIT_EXCEEDED`, and sales/items/stock/balance all unchanged afterwards |
| 39 | Money taken at the counter now counts as paid: `create_sale_unchecked` incremented purchases and outstanding but never `total_paid`, so a 7,200 sale with 600 down left the customer saying purchases 7,200 / paid 0 / owed 6,600. Migration `0155` fixes the function and backfills `paid = bought - owed` | **done** | this commit + migration `0155` | QA customer now reads 8,400 / 1,800 / 6,600 after a real 1,200 cash sale — the identity adds up exactly |
| 40 | The sale details screen is one screen again (the admin and employee copies were ~1000 lines and had drifted): sale number, date and state on the receipt, the customer, the lines with returned quantities, one profit block for the manager, returns, note, and four actions — with no per-line cost breakdown, no duplicate totals card, no "Status" label with nothing after it, and no voided sale still offering Return/Void | **done** | this commit | open SALE-62727 as the owner: one receipt, one customer row, one item, one profit block, then Record payment / Share / Process Return / Cancel Sale |
| 41 | The receipt itself is one component (`src/components/sales/SaleReceipt.tsx`) drawn by the success screen and the detail screen, and it says "1 item", not "1 items" | **done** | this commit | both screens render the same card from the same file |
| 42 | A dead session no longer accuses the owner of lacking permission: `PGRST301` (expired JWT) and generic `permission denied` were mapped to "You are not allowed to do this. Please ask the shop owner." Session errors are now checked first and say "sign in again" | **done** | this commit | the owner completed a real sale from the running app (SALE-38453) with no permission error |
| 44 | The sale details screen is a **record, not a receipt**: sale number, date, sold by, payment method and status; the customer with the standing the sale left them in; the items at the price they sold for with any returned quantity on the line; a payment summary; the shop's cost and profit for a manager only; returns; the note; and the actions still open. The receipt survives on the success screen and behind Share, where the customer's copy belongs | **done** | `fb2fbc26` | open SALE-62727 as the owner: no receipt card anywhere on the page, and every fact the sale holds is on it — screenshot read at 390×844 |
| 45 | The code screen's heading and number line sit centred with the boxes under them, as one column, instead of left-aligned above a centred row; both the sign-in and registration code screens | **done** | `dd8bc84e` | `/login/otp` at 390×844: heading, number and boxes share one centre line, and nothing moved vertically |
| 46 | Deleting your own account works. `delete_my_account()` had never run end to end; three hard errors stopped it — `customers.created_by` (a legacy `varchar`) compared against a `uuid[]`, a loop variable declared `int` casting a shop's uuid, and `users.shop_id` (NO ACTION) blocking the shop purge that has to run before the logins go. Migration `0156` fixes all three | **done** | `bba596d7` + migration `0156` | the real function run as the real actor for all four QA users (owner and employee paths) inside a subtransaction that always rolls back: zero errors, and shops/users/memberships unchanged afterwards |
| 47 | Recommendations are agronomic first and behavioural second, in both directions off one scoring pass. Eligibility is mandatory — crop, category the crop has a season for, season open now, stage when a planting date is recorded, stock on the shelf. Behaviour ranks: bought before and how often, recency, related purchases, usual brand and pack, recorded acreage, growers in the same town, thin stock demoted. Every row says **"Why recommended"**. Profit margin is not read, and no pest, disease or acreage is ever inferred — only what was recorded | **done** | `2da0c554` | 23 new engine tests (both rules proved non-vacuous by injecting the violation once: a cost-price term and an invented need each failed the suite), plus the live screen: Yaqoob reads "Why recommended: Cotton · missing from this season's basket" with "Cotton at growing stage · Bought Lambda before · 12 acres of Cotton", the same line on Targa's product page, and Lambda (bought today) suggests nobody |
| 48 | Settings is the screen for the phone and the person; the owner suite is the screen for the shop. Employees, Companies, Roles, Inventory and Crop configuration each had a row on **both** screens — the same tap twice, two copies free to disagree — so they now come from one catalogue (`ownerRows.ts`) and each screen renders a filter over it: one row per destination, impossible to duplicate and impossible to lose. A **Customize** panel on Settings moves any of them either way, remembered per account **and per shop**, on this device only, because which screen a shopkeeper reaches for is a habit rather than a correct answer | **done** | `9ea45f03` | `/admin/settings` and `/admin/more` at 390×844: the shipped suite is Inventory · Purchases · Stock Movements · Reorder · Barcodes · Crops under Stock and Customers · Companies · Employees · Roles under People, with Settings holding only Language, Dark mode, PIN, Alerts, Activity; Roles moved to Settings disappears from the suite and reappears there on move-back, the Crop row opens the same sheet from either screen, every `data-tour` anchor still resolves, and the 6-test `ownerRows` guard (proved non-vacuous: breaking the filter failed 4 of its cases) pins the partition over all 2^n arrangements |
| 49 | The number that decides when a shop is told about low stock was a hardcoded fallback in three different files (`variants[0]?.lowStockThreshold ?? 5`, `?? 5`, and a form default of `"5"`), and `app_settings.low_stock_threshold_default` — seeded since migration 0009 at 10 — was **read by nothing at all**. There is now one policy in one place: Settings → **Stock alerts** sets the shop's number and how often to repeat (only when it crosses / once a day / every few days), with a one-tap way to put that number on the products that predate it; the product form asks per pack, pre-filled with the shop's number and saying whose number it is. Three RPCs, no schema change | **done** | `768e1ea2` | applied to QA and driven through the real session as QA Admin: `get_stock_alert_settings` answered `{threshold:10, frequency:on_cross}` from the seeded row, the sheet's Save wrote `on_cross` back (read back from `app_settings`), and `apply_stock_threshold_to_all` reported `variants:2` with both audio rows landing in `audit_events`; the QA variants my stray click moved to 10 were restored to 5. 11 new `stockAlerts` tests, run against the boundary (±1 hour on both clocks) |
| 50 | Three ways the app contradicted itself about stock. The signal engine judged a product by `variants[0]`'s threshold while every other screen used the most demanding variant, so a product sold in 500ml and 1L could be called low by one screen and fine by another. The low-stock notice fired on **every** sale line, so ten packs in an afternoon produced ten identical alerts. And the Edit Product form offered an editable stock box that `update_product` refuses **by design** (0145 — stock is owned by the movement path), accepted the typing, discarded it and reported "Updated" | **done** | `768e1ea2` | `signalEngine` now calls the shared `productLowStockThreshold`; the caller's pre-sale level is threaded through so "only when it crosses" is the caller's observation rather than a guess; and the edit form shows stock read-only with the reason and a link to Adjust stock. `tsc`, build and 62 focused unit tests green |
| 51 | **Fingerprint login**, optional, per account and per phone. Enrolment sits in Settings directly under Change PIN; the PIN screen then asks for a finger on arrival, with the keypad untouched underneath and a button to retry. The assertion is **verified**, not trusted: challenge, origin, RP-ID hash, user-present and user-verified flags, sign counter, and the signature checked with WebCrypto after the DER-to-raw conversion. Android WebView has no `PublicKeyCredential` at all, so this is the browser/PWA path — the APK needs the native bridge, which is a drop-in for `src/lib/biometric.ts` and nothing else | **done** | `4dbce641` | driven end to end in the preview at `localhost:64299` against a signing stub: the app read its own record from secure storage, verified a genuine assertion and **landed on the dashboard without a PIN**; with one byte of the signature flipped it stayed on the PIN screen, said "That did not match. Your PIN still works." and left the keypad intact. The Settings row reads On / Off / Not available this phone. **Not verified: a real Windows Hello touch — UNKNOWN, not passed.** The test stub was removed and the seeded record deleted |
| 52 | The add-product form, rebuilt around one question: **what can be derived is not asked.** It was eleven inputs, four of them the database's own words for its columns (pack name, unit size, quantity step, base unit) under six lines of grey help text. The common case now shows **six inputs and two picks with no captions at all** — name, supplier, category, sell for, cost, you have (+ unit inline), warn at — because the one pack a product usually has is *built* (named after the unit it is sold in, size 1, step 1) rather than described, the unit sits beside the quantity instead of in a section, and barcode and multi-pack live behind **More options**. The warning is one sentence with the input inside it. Editing stock is no longer offered: `update_product` refuses it by design (0145), so the figure is read-only with a link to the action that does change it | **done** | `4dbce641` | `/admin/inventory/new` at 390×844 on a clean load: six inputs, no helper line under any field, `More options` closed, `Warn me when only [10] left` pre-filled from the shop's number. The fifty-line header comment on this file states the reasoning rather than leaving it to be re-derived |
| 43 | Full-service verification of everything above | **pending** | — | section C below |

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

### B4. The credit limit can still be written without an audit row

**Found:** on 2026-09-27 the QA customer `Yaqoob` moved from a limit of 50,000 (set through the
permission-checked, audited `set_customer_credit_limit` RPC at 14:17:44, audit row present) to
5,000 at 14:29:55 with **no audit row and no credit-limit request**. The only code path that can do
that is the customer-profile edit save, which writes `credit_limit` straight to the table
(`CustomerProfilePage` → `customers.update`). The database guard that exists for this
(`protect_customer_financials`, migration 0037) covers `outstanding_balance`, `total_purchases` and
`total_paid` — **not** `credit_limit`, so the column is writable by any client that holds the
session, and 0154's permission check plus audit trail can both be bypassed by not using the RPC.

**Also seen:** the open customer page showed the old 50,000 from the local cache while the database
already said 5,000 — the profile is rendered from a cache that a write through this path does not
refresh.

**State:** **closed** (rows 37/38): the edit form no longer writes the column, so the only way to
change a limit is the audited RPC. The value the shop has now (5,000) is left exactly as found —
restoring it to 50,000 is the owner's call, one tap on "Change limit".

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
