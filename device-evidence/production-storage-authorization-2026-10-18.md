# Storage authorization locked down on production — 2026-10-18

**Target:** `gkswcfljxlutkfdvvqng` (production), named by the credential guard on every run.
**Change:** [0230](../supabase/migrations/0230_storage_images_are_read_publicly_and_written_by_no_one_anonymous.sql),
10 statements, applied through the production batch gate.
**Starting point:** [production-demo-identities-removed-2026-10-18.md](production-demo-identities-removed-2026-10-18.md)
§5 — the 71 demo images were deleted with nothing but the publishable key.

## 1. The defect, measured before the change

`storage.objects` carried twelve policies. Four were addressed to role `public`:

```
public_all_storage_delete  DELETE  USING (bucket_id = ANY(the four image buckets))
public_all_storage_insert  INSERT  CHECK (bucket_id = ANY(…))
public_all_storage_update  UPDATE  USING (bucket_id = ANY(…))
public_all_storage_select  SELECT  USING (bucket_id = ANY(…))
```

and four more addressed to `authenticated` were bucket-wide rather than owner-scoped (`images auth
delete`, `images auth update`, `Authenticated users can delete/update their uploads`). An
unauthenticated client holding the publishable key the browser bundle ships could therefore delete,
overwrite or upload any image in all four buckets — which is exactly how the 71 demo images were
removed.

## 2. What 0230 does — and why it is this small

| Now | Why |
|---|---|
| **No** INSERT/UPDATE/DELETE/ALL policy addressed to `public`/`anon` | the hole itself. Dropped by a **catalogue sweep** (`cmd in (INSERT, UPDATE, DELETE, ALL) and roles && array['public','anon']`), so an unknown older name cannot survive, not by a name list |
| **No** UPDATE/DELETE policy for any client role | `src/lib/storage.ts` only ever uploads a new random path with `upsert: false` and reads `getPublicUrl`; the app has no code path that updates or deletes an object. With no policy, RLS denies and only the service role can remove an object |
| **One** `SELECT` to `public`, restricted to the four image buckets | the buckets are `public: true` and every screen renders `getPublicUrl`; public read is intended |
| **One** `INSERT` to `authenticated`, restricted to the same four buckets | the upload screen is behind login; this is the only write the app performs |

**Ownership is deliberately not expressed as `owner_id = auth.uid()`.** The column exists
(`storage.objects.owner_id`, text; `owner` is uuid), but nothing in this deployment proves it is
populated for this app's uploads: the 71 demo rows carried an empty `owner_id` because they were
written while the anonymous INSERT policy was in force, and production has no signed-in account yet to
take a measurement from. A policy resting on an unverified column is worse than no write policy at
all, and the upload path cannot overwrite anything anyway — every upload is a fresh random name.

The file ends by raising if an anonymous write survives, if any UPDATE/DELETE policy survives for a
client role, or if either intended policy is missing — so a later replay fails instead of passing
quietly.

## 3. Verification

**On production's frozen baseline:** `verify:baseline --baseline production` → **PASS**, 10 statements,
0 SQL failures, 0 env-gaps.

**Rehearsed on production inside a rolled-back transaction — the test proves it can see the hole
before it proves the hole is closed:**

```
BEFORE  anon DELETE with the trigger's escape hatch open → 1 row(s)   ← the vulnerability, exercised
BEFORE  policies: 12 (4 public write, 4 authenticated write/delete, 2 read, 2 insert)
AFTER   policies: 2  →  images auth write | INSERT | {authenticated}
                        images public read | SELECT | {public}
AFTER   anon SELECT → 1 row (public read preserved)
AFTER   anon INSERT → denied (42501 row-level security)
AFTER   anon DELETE (escape hatch open) → 0 row(s)
AFTER   authenticated 11111111 DELETE → 0, UPDATE → 0
AFTER   authenticated 22222222 DELETE → 0, UPDATE → 0
AFTER   the object survived every client attempt: 1
ROLLED BACK
```

**Applied through the gate:** verification PASS (baseline production, sha256 verified), backup
`…19-41-44` restored and compared (replay/counts/structure/digests/auth all PASS), then
`migrate apply --apply`. Ledger now **43 rows, latest `0230`**; 222 files byte-verified, 0 drifted.

**After the apply, against the live project — real calls, not descriptions:**

```
policies (2):
  images auth write | INSERT | {authenticated}
  images public read | SELECT | {public}

anon Storage API upload → HTTP 400  {"statusCode":"403","error":"Unauthorized",
                                     "message":"new row violates row-level security policy"}
anon SELECT on a stored row → 1 (public read preserved)
authenticated <A> DELETE → 0, UPDATE → 0
authenticated <B> DELETE → 0, UPDATE → 0
the row survived every client attempt → 1
```

The two authenticated identities are two different `sub` claims, which is the cross-shop question
asked at the policy layer: neither can remove or modify an object, so no member of any shop can
reach another shop's images, and none can reach its own through the client API either. The row used
for that measurement was inserted inside a transaction that was rolled back — production holds 0
storage objects.

## 4. Regression guards

[tests/unit/storagePolicyLockdown.test.ts](../tests/unit/storagePolicyLockdown.test.ts) — 9 tests:

- 0230 drops public write by catalogue sweep (not a name list) and explicitly drops the four
  demo-mode names plus the four bucket-wide authenticated update/delete policies;
- the only policies it creates are `images public read` (SELECT/PUBLIC) and `images auth write`
  (INSERT/authenticated), both restricted to the four buckets;
- its assertions are still present;
- **no migration after 0230** creates a public write or any client UPDATE/DELETE on
  `storage.objects` — the rule is evaluated over the directory, so a future file fails it;
- non-vacuity: the scanner flags a synthetic PUBLIC DELETE, treats a missing `TO` clause as PUBLIC
  (the default 0022 relied on), flags an `authenticated` DELETE as a client mutation, and ignores
  commented-out SQL.

`scripts/dev/local-db.mjs` now verifies the final state (public read + authenticated upload) and
fails if any of the three public write policies comes back;
`tests/unit/localDevDatabaseOrdering.test.ts` was updated to assert that, in place of its old
"the four restored policies exist" check.

## 5. What remains

- The **live authenticated upload** has not been exercised end to end: production still has no
  account (`auth.users 0`), and the upload screen is behind login. The policy that permits it is
  verified structurally and against the DB role, not through a signed-in Storage API call. That
  measurement becomes possible the moment the owner signs in.
- Nothing was changed outside the storage policies: no table, RPC, grant or bucket was touched, and
  the four buckets keep their `public: true` flag.
- Production holds 0 storage objects, so there is no image whose readability had to be preserved
  during the change.
