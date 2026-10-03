# Farmer Marketplace — Owner-side integration contract

**Status.** The owner-side foundation is shipped and verified (migrations `0184`–`0187`;
tests 28 + 17 green). **The Farmer App itself is not built and is not part of this
repository.** This document is the contract a future Farmer App (or any other consumer) must
read instead of the base tables.

**One sentence.** An owner ticks *List on Farmer Marketplace* on a product and *List this
branch* on a branch; a farmer anywhere can then read a curated, anonymous, read-only
projection of exactly those listed packs at those listed branches, nearest branch first,
inside the search radius the farmer chose — the owner sets no distance at all (`0187`) — and
nothing else.

---

## 1. What is guaranteed, and what is deliberately absent

Guaranteed by design and by evidence:

- **The Owner App stays the single source of truth.** There is no second product, stock or
  inventory system, no copy of the data, and no job that could fall behind. The contract is a
  SQL view over the live `products` / `product_variants` / `shops` rows, so an archive, a price
  change, a stock change or a switch on the owner's side is reflected the next time the
  contract is read. No sync step exists because none is needed.
- **Product-level and branch-level listing are both required.** Ticking the product alone shows
  nothing; ticking the branch alone shows nothing. Each switch has its own UI and its own
  writer, and both are needed for a row to exist.
- **The public contract is strictly curated.** A fixed, equality-checked column allowlist. No
  cost price, no exact stock quantity, no low-stock threshold, no supplier, no barcode, no SKU,
  no expiry date, no `owner_id`, no join code, no phone number — see §4.
- **Anonymous read.** Discovery does not depend on a Farmer App login. The contract is readable
  with the anonymous key, and *only* the contract is: every base table is still blocked.
- **Distance, not just presence.** Every row carries a distance from the searched point, and
  prioritisation is nearest-first, deterministically tie-broken.

Absent on purpose (not "to do" — decisions):

- No ordering, cart, chat, credit, payment or field-visit machinery. The contract only
  answers *what is listed, where, at what price, and is it in stock*.
- No stock quantity in any form, not even banded ("low stock" band would leak threshold-derived
  operations data). Availability is exactly one word: `available`.
- No owner identity, staffing, or sales data of any kind.
- No anonymous writes of any kind. Nothing in the contract can be inserted, updated or deleted
  by a consumer.

---

## 2. How a listing becomes findable — the eligibility chain

A row appears in the contract only when **all** of these hold. Each one is enforced in the view
(`supabase/migrations/0185_a_product_can_be_listed_on_the_marketplace.sql`), not in the
consumer:

| # | Condition | Where the owner sets it |
|---|---|---|
| 1 | The branch is listed: `shops.marketplace_enabled = true` | Branch sheet → *Farmer Marketplace* → *List this branch* |
| 2 | The branch has a pinned location (`shops.latitude/longitude` not null) | Branch sheet → *Branch location* (map picker) |
| 3 | The product is listed: `products.marketplace_listed = true` | Add/Edit product → *List on Farmer Marketplace* |
| 4 | The product is live: `products.is_active = true` | Archive deletes it from the marketplace automatically (`is_active = false`) |
| 5 | The pack is live: `product_variants.is_active = true` | Pack management |
| 6 | The pack is in stock: `product_variants.stock_qty > 0` | Sales, purchases, stock adjustments |
| 7 | The pack has a price: `product_variants.selling_price > 0` | Pack editor (a price of 0 would read as free) |

Two independent writes, one shared rule: **unlisting is always allowed and always immediate**.
Turning either switch off removes the rows on the next read — no propagation delay, no cache to
wait on. Turning a branch's switch on is refused when the branch has no location (distance
cannot be measured from a place that was never picked) with
`VALIDATION: this branch has no location, so it cannot serve the marketplace`. Turning it off
is a decision like turning it on, and the switch is the owner's whole marketplace setting:
since `0187` there is no owner-set distance that could be kept or reset.

---

## 3. The public read contract

Two equivalent entry points. Both return the same eligible rows; neither can be used to reach
any other table.

### 3.1 `public.marketplace_listings` (view)

Anonymous `SELECT` grant. One row per **listed pack per listed branch**. A product carried by
two branches is two rows, each naming its own branch.

| Column | Type | Meaning |
|---|---|---|
| `listing_id` | uuid | The reference a consumer stores. It is the pack (variant) id. |
| `branch_id` | uuid | The branch this row can be collected from. |
| `branch_name` | text | Branch display name. |
| `branch_address` | text | The address shown for the branch (may be null). |
| `branch_latitude` | numeric | Pin, rounded to 4 decimal places (~11 m). |
| `branch_longitude` | numeric | Pin, rounded to 4 decimal places (~11 m). |
| `branch_location_label` | text | Short place name the owner accepted when pinning (may be null). |
| `product_id` | uuid | The product this pack belongs to. |
| `product_name` | text | Product name. |
| `category` | text | One of the product categories (`seed`, `fertilizer`, `pesticide`, `herbicide`, `equipment`, `other`, `spray`). |
| `image_url` | text | Product image (may be null). |
| `variant_id` | uuid | Same value as `listing_id`; carried so the owner side can resolve a listing back to its pack. |
| `variant_label` | text | Pack name (e.g. the size label). |
| `unit_size` | numeric | Pack size. |
| `qty_step` | numeric | How the pack may be incremented (e.g. 0.5 kg steps). |
| `base_unit` | text | Unit the product is measured in (kg, litre, piece …). |
| `selling_price` | numeric | Price a buyer pays for one pack. |
| `availability` | text | Exactly `available` today; the mapping still produces `out_of_stock`, which the filter makes unreachable. |
| `listed_at` | timestamptz | When the product was listed (may be null for rows listed before the column existed; a later re-list stamps it). |
| `updated_at` | timestamptz | The later of the product and pack modification times. |

### 3.2 `public.search_marketplace(...)` (function)

Anonymous `EXECUTE` grant. This is the entry point a consumer should use: it states the radius
rule in one place and orders the result.

```
search_marketplace(
  p_latitude   double precision,
  p_longitude  double precision,
  p_radius_km  numeric DEFAULT 25,   -- clamped to 1–200
  p_query      text    DEFAULT NULL, -- substring of the product name, case-insensitive
  p_category   text    DEFAULT NULL, -- must be a real category
  p_limit      int     DEFAULT 50,   -- clamped to 1–100
  p_offset     int     DEFAULT 0
) RETURNS TABLE ( … the 20 view columns above …, distance_km numeric )
```

Behaviour, all verified in `tests/integration/marketplaceContract.test.ts`:

- **Refuses a point outside Pakistan** (box 23.0–37.5 N, 60.0–78.0 E) with
  `VALIDATION: that point is not in Pakistan`. The same box the owner-side pin writer uses, so
  the function cannot be pointed at another country to probe it.
- **Clamps, rather than refuses, an out-of-range radius**: 5000 → 200, 0 → 1. `p_limit` is
  clamped to 1–100 and `p_offset` to ≥ 0.
- **Refuses an unknown category** with `VALIDATION: unknown category "…"` — answering "nothing
  found" would hide the typo and read as "no shop has it".
- **`distance_km`** is a great-circle (haversine) distance in kilometres, rounded to 2 decimal
  places, measured from the searched point to the branch pin.
- **Order:** `distance_km` ascending, then `selling_price` ascending, then `product_name`
  ascending. The last two break ties deterministically, so the same search does not reshuffle
  between calls.
- **One row per pack per branch.** The same product from two branches is two rows; the nearest
  branch is the first one a consumer sees. This is the whole of "nearest eligible branch gets
  priority" — there is no scoring model to interpret.

### 3.3 Radius semantics — the farmer's radius is the only one

How far to look is the **searcher's** decision. The owner's side contributes a pinned location
and a switch; `0187` dropped `shops.marketplace_radius_km`, so there is no branch-side coverage
for a search to combine with and nothing a branch can override:

- A search asking for 5 km does not reach a branch 40 km away, however eager the branch is.
- A search asking for 200 km reaches every listed, pinned branch within 200 km.
- `p_radius_km` is clamped at 200 km, so no search can roam the country. It is an input the
  consumer passes per call — never stored on a branch, never published in the contract.

### 3.4 Worked example

Two branches, both listed and pinned:

- **Branch A — Lahore** `31.5204, 74.3587`
- **Branch B — Multan** `30.1575, 71.5249`

The two pins are roughly 320 km apart. Consequences:

- A farmer searching from Multan at 25 km sees **only Branch B**; searching at 200 km still
  sees only Branch B, because the two are farther apart than the 200 km cap on any radius.
  Lahore and Multan can therefore never see each other's rows — correct, since neither could
  travel that far.
- A farmer searching from Lahore at 25 km sees **only Branch A**.
- A third branch **C — Sheikhupura** `31.7131, 73.9783`, about 42 km from Lahore: a Lahore
  search at 25 km does **not** show it (the farmer asked for 25 km); the same search at 60 km
  does. The branch does not negotiate this distance — it only has to be listed and pinned.
- A product listed **both** in Branch A and Branch C: a Lahore search at 60 km returns two
  rows for it, Branch A first because it is nearer.

A reference call:

```sql
select listing_id, branch_name, product_name, variant_label,
       selling_price, availability, distance_km
  from public.search_marketplace(31.5204, 74.3587, p_radius_km => 25, p_query => 'urea')
 order by distance_km;
```

---

## 4. The redaction boundary and how it is enforced

- **Base tables stay closed to anonymous callers.** `products`, `product_variants`, `shops`,
  `inventory_movements` and every other business table answer an anonymous read with
  `permission denied` (SQLSTATE 42501). Verified live, and asserted in the integration suite for
  all four.
- **The view is the whole public surface.** Its `SELECT` clause names every column explicitly —
  there is no `SELECT *` anywhere in `0185`, because a star is how a future column becomes public
  without anyone deciding it should be. The migration itself refuses to apply if a forbidden
  column name appears in the projection or if `anon` loses `SELECT` on the view.
- **Read-only, structurally.** `anon` holds `SELECT` on the view and `EXECUTE` on the search
  function — nothing else. An anonymous `INSERT` into the view fails with
  `cannot insert into view`; the settings writer is revoked from `anon` and fails with
  `permission denied for function`; every write path requires an owner/admin session.
- **The view carries its own filter rather than relying on RLS.** The view runs with its
  owner's rights, and `force_rls` is off — the same documented pattern as
  `product_variants_public` (`0179`). Its `WHERE` clause, not a row policy, is the enforcement;
  this is why the column allowlist and the eligibility chain live in one readable place.
- **Listing is an act, never a migration side effect.** Both switches default to off, so no
  existing product or branch became public because a migration ran.
- **Every change is audited** in `audit_events`: `marketplace_settings_changed` (with before and
  after), plus the product create/update audit the owner side already writes.

Authority is stated twice in `set_marketplace_settings` on purpose: the app-wide gate says an
owner/admin is acting, and the membership check names *that* branch — an owner of one branch
cannot flip another branch's switch. A non-owner employee is refused with `NOT_AUTHORIZED`, and
the switch's disabled state in the branch sheet only *prevents* the attempt; it does not
authorize it.

---

## 5. What a consumer must do — and what it need not do

A consumer (the future Farmer App) must:

1. Call `search_marketplace` with the farmer's current point and their chosen search radius
   (or read `marketplace_listings` and apply distance itself only if it deliberately wants a
   different ordering).
2. Page with `p_limit` / `p_offset` when it wants more than the first page (max 100 rows per
   call).
3. Treat `listing_id` as opaque and re-read the contract rather than caching price, availability
   or branch data — the owner side is live and changes need no notification.
4. Ask for the location permission it needs, and use the point it actually got.

A consumer need **not**:

- Build any eligibility check, radius comparison, or ordering — the contract already applied
  the search radius and ordered nearest-first.
- Authenticate. Anonymous read is the designed path.
- Know anything about products, variants, shops, stock or the owner's business — those table
  names never appear in the contract's output.
- Ask the owner for anything to make a listing appear. The owner's two switches are the whole
  publication step.

---

## 6. How this is verified

```bash
npx vitest run tests/integration/marketplaceContract.test.ts   # 28 tests, real QA database
npx vitest run tests/unit/marketplaceContractGuard.test.ts     # 17 tests, migration text
npm run migrate:verify -- --env staging                        # 179 files ↔ 179 rows
```

The integration suite covers, against the live QA database with real anonymous calls: an
anonymous read of the view; anonymous refusal on all four base tables; anonymous refusal to
call the settings writer; anonymous refusal to insert into the view; column-set **equality**
against the allowlist; forbidden-key absence; switch-off removes; per-branch switch-off removes
only that branch's rows; archive removes; zero stock removes; inactive pack removes; unpinned
branch absent; zero price absent; a far search sees neither branch; a branch outside the
farmer's radius absent even with stock; the farmer's radius enforced in both directions with
no owner-side setting touched; non-Pakistan point refused; unknown category refused;
nearest-first ordering exercised in both directions with one row per branch; distance reported;
owner can set the switch and nothing else; the Branches read carries the switch and no
distance; employee refused; the three-argument writer gone; listing a branch without a pin
refused, with the row's values compared before and after.

The guard is non-vacuous: injecting `v.cost_price AS cost_price` into the real migration makes
it fail with the discloses-margin message, and the migration ledger hash stays intact.

---

## 7. Change control

The column names, the ordering, the farmer-only radius rule and the redaction list are this
contract. Changing any of them is a contract change, not a refactor:

- `tests/unit/marketplaceContractGuard.test.ts` fails if a projected column is added, removed
  or renamed, if a forbidden source column is projected under any alias, or if `SELECT *`
  appears.
- The in-migration proof block fails the apply if a forbidden column name reaches the view or
  if `anon` loses `SELECT`.
- Any widening of the public surface — a new column, a new consumer capability — needs a
  deliberate decision with the reasoning written down, not a quiet edit to the projection.
