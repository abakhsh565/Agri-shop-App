# Farmer live sync — staging deployment and production migration plan

Scope: `0339_the_farmer_sees_the_branch_and_hears_it_live.sql`, the dealer app's two screen
changes, and the farmer app's realtime subscription. Everything below is prepared, not executed.

**State today.** Local Development has `0339` applied and proved. Staging's ledger holds 329 rows
and **`0339` is the only pending file** (`npm run migrate:status`). Production is at `0337` and
has not seen the farmer batch's `0338` either — see §4.

---

## 1. What ships

| Piece | Where | Depends on |
|---|---|---|
| `0339` — branch profile, one availability rule, broadcasts, immediate push | `supabase/migrations/` (dealer repo) | `0338`, `0336`, `0331`, `0329` |
| Dealer Messages list + thread subscribe to `shop:<id>` | `src/pages/admin/messages/*`, `src/stores/farmerMessagesStore.ts` | `0339` (the channel and its policy) |
| Farmer app subscribes to `realtime_topic` | `farmer app`: `src/shop/api/realtime.ts`, `types.ts`, `ShopApiProvider.tsx` | `0339` (`farmer_api_me.realtime_topic`) |

Order is not negotiable: the migration first, then the dealer app, then the farmer app. Each app
degrades to its poll without the migration, so a gap is slower, never broken — but the migration
must land before either release is claimed to be live.

---

## 2. Staging deployment

1. **Code first, on `dev`.** PR `dev` → `staging`; the PR carries `Gates (tsc · unit guards ·
   safety proofs · build)` and, on `staging`, `QA` plus `E2E lanes against QA`. A red or missing
   check is not an approval.
2. **Migration, by the environment's own workflow.** `Deploy staging — migrate, build, report URL`
   applies the pending file. Do not hand-apply `0339` with psql: the workflow is what records the
   ledger row and its hash.
3. **Then measure the broadcast path on staging** — the numbers in §5 were taken on the local
   stack; the staging figure needs the migration in place, which is exactly why this step follows
   the apply rather than preceding it.
4. **Farmer app:** merge `development` → `staging` in that repository and publish its staging
   channel. Its `VITE_SHOP_API_URL` must point at the dealer's staging project, not the local
   stack.

### Acceptance on staging (all with real records, none of them UI-only)

```bash
# the door answers a topic and the branch, not just a name
curl -s -X POST "$STAGING/rest/v1/rpc/farmer_api_me" … | jq '.realtime_topic'
# a dealer write reaches a subscribed farmer socket in under a second
node .tmp/staging-broadcast.mjs      # to be written against the staging records, not local ones
# a zero-price pack is absent from both the catalogue and discovery
# an unread count moves 0 → 1 → 0 through send / open
```

---

## 3. Rollback

`0339` is additive: two new helper functions, a trigger on three existing tables, one policy on
`realtime.messages`, one trigger on `push_deliveries`. To stop the behaviour without reverting the
migration (which history forbids):

```sql
-- stop broadcasting (screens fall back to their polls)
drop trigger if exists farmer_messages_broadcast on public.farmer_messages;
drop trigger if exists farmer_credit_requests_broadcast on public.farmer_credit_requests;
drop trigger if exists farmer_visit_requests_broadcast on public.farmer_visit_requests;
drop trigger if exists push_deliveries_dispatch_now on public.push_deliveries;
drop policy if exists farmer_shop_broadcast on realtime.messages;
```

The availability rule and the branch profile stay correct with those dropped; they are reads.

---

## 4. Production migration

Production's ledger is at `0337`. The farmer batch therefore needs **`0338` and `0339` together**,
in that order, as one gated batch:

```bash
npm run release:prepare -- --batch gap-0338-0339 \
  --files 0338_a_conversation_belongs_to_a_branch.sql \
          0339_the_farmer_sees_the_branch_and_hears_it_live.sql \
  --artifact <production backup artifact dir>
```

`release:prepare` refuses unless the checkout is `dev` and clean, replays the batch against the
recorded production baseline, and writes `verification.json`, `backup.manifest.json` and
`restore-verification.json` into `production-batches/gap-0338-0339/`. Then:

1. **Backup** — the nightly production backup, taken from `--ref dev` (the composite-type fix is
   not on `main`).
2. **Dry run** — `apply-production-migrations.yml` with `--ref dev`, `apply=false`.
3. **Apply** — the same workflow with `apply=true`. It writes both files in one transaction,
   records two ledger rows, and then runs `prod:gap --fail-on-gap`, so a release that leaves one
   of the app's own RPCs or tables missing fails instead of being reported as complete.
4. **Verify** — `farmer_api_me` on production must answer a `realtime_topic`; a bad credential
   must still be `NOT_AUTHORIZED`; `farmer_messages` must still have zero policies.
5. **Deploy the web app** through `deploy-production.yml`, dispatch-only, with the `main` SHA that
   carries the screen changes.

Realtime must be enabled on the production project for the channel to connect; that is a project
setting, not a migration, and is checked by opening one socket before the apps are released.

`docs/PRODUCTION_MIGRATION_PLAN.md` §5 carries both files' dispositions as they were added.

---

## 5. Measured so far

**Local Development, real rows, genuine signed-in dealer:**

| Check | Result |
|---|---|
| dealer → farmer topic | 102–125 ms |
| farmer → dealer channel | 11–169 ms |
| price change visible to the farmer | 15–35 ms |
| two-way text | PASS |
| unread 0 → 2 → 0, read receipt | PASS |
| photo, byte-for-byte through a signed URL | PASS (70 bytes, `image/png`) |
| voice row: duration 2400 ms, object retrievable | PASS |
| voice **decodes and plays** | **UNVERIFIED** — no encoder on this machine |
| reconnect recovers a message missed while offline | PASS (6 messages after the read) |
| conversation survives every channel torn down | PASS (6 rows, 6 messages) |
| stock-out shows unavailable and leaves discovery together | PASS |

**Staging, read path only (no broadcast until §2 step 2):**

| Call | Result |
|---|---|
| `search_marketplace` (20 calls) | min 352 ms, p50 610 ms, one 44 s outlier |
| `farmer_api_me` / `farmer_api_shops` / `farmer_api_products` | present, refusing a bad credential in 384–896 ms |

The 44 s outlier is a cold connection, not a query cost; it is reported rather than dropped, and
the staging measurement is repeated warm in §2 step 3.

---

## 6. What this plan does not claim

- No UI was clicked: the dealer screens and the farmer app were type-checked and their suites run,
  but neither was driven through a browser session for this change.
- Audio is verified as a stored object with the right metadata and a working signed URL — not as
  something that plays.
- No FCM delivery (no device, no service-account key in this environment).
