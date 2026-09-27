# Pipeline — work agreed but not done yet

Ordered by what it costs to leave undone. Each item carries enough design to start without
re-deciding it.

---

## 1. Offline entry at the PIN gate

**Why it's here:** opening the app with no connection cannot get past the PIN screen. The PIN is
verified by the database (migration 0148 — `verify_user_pin`), so offline the call fails and the
screen says "Your PIN could not be checked. Check the internet and try again." Everything *behind*
the door already works offline (cached rows, queued writes, sync-on-reconnect), so the door is the
only part that breaks. A shop in a dead zone that reopens the app cannot get back in.

**Why it isn't a 5-minute change:** this deliberately reverses half of an earlier security decision
(the PIN moved off the device because a local digest of a 4-digit secret was a lookup table away
from the PIN). Reversing it must be bounded, or it hands anyone holding the phone ten thousand
guesses.

**Design**

- **Device verifier.** On a successful `savePin`/server verify, store a verifier only:
  `PBKDF2(pin, perDeviceSalt, ≥ 150k iterations)` in `secureStorage`, keyed by user id, salt random
  per device. The PIN itself is never stored. A slow KDF is what makes 10⁴ guesses cost real time.
- **Entry rule.** If a session exists and the server check fails for a *transport* reason (network),
  allow entry when the device verifier matches — never when the server answered "wrong"/"locked".
  Offline entry shows its own state: "Offline — your PIN was checked on this device and will be
  confirmed when you reconnect."
- **Local attempt limit.** Mirror the server's five-try rule on the device (count stored alongside
  the verifier, cooldown on the fifth failure). Offline failures must be sent up on reconnect so the
  server's counter can't be evaded by pulling the cable.
- **Re-verification.** Re-check against the server on the next connection and on the next unlock. If
  the server says locked/wrong, drop to the code path — the same door as today's expired session.
- **Ordering with the offline queue.** Entry must happen before any queued write is replayed, and a
  membership that turns out suspended on reconnect must land on the no-shop/suspended notice, not in
  the shell with stale rows.
- **Cleanup.** Verifier removed when the PIN changes, is cleared, or the account signs out.

**Acceptance (to be proven when built):** cold start in airplane mode → PIN → shell with cached rows
and "Syncing…" banner; wrong PIN offline → identical message to online; five wrong offline →
cooldown; reconnect after a membership is suspended → explicit notice, not the app; PIN changed on
another device → offline entry refused.

---

## 2. Smaller, non-blocking

- **Stray QA rows** left in Default Shop by work outside this repo's passes: `companies` "Stngneta",
  `customers` "Khadim Hussain". Decide delete-or-keep before the next QA baseline count.
- **Earlier workstreams still uncommitted** in the tree (reminder/dashboard/store edits,
  `tests/e2e/results.json`). Commit or discard them so QA ≤ HEAD keeps meaning something.
