# Barcode Integration — Phase 8 (Immediately Post-MVP)

## Status
Committed next step after MVP (Phases 1–7 in `ROADMAP.md`). Not part of MVP itself — do not build until Phase 1–7 are complete and stable. Documented now so schema/architecture don't need rework when this phase starts.

## Goal
Let Employee or Admin scan a product's barcode during New Sale (and during Admin's Add/Edit Product and Stock-In flows) instead of relying only on manual search — faster checkout, fewer selection errors.

## Scope
1. **Barcode Sale Mode — a distinct, faster path** (this is the primary design, not just a "scan button on the search screen"). New Sale offers two entry points: **Manual Sale** (existing Customer → Product Search → Variant → Qty → Review → Payment flow) and **Barcode Sale** (new, scan-driven loop, described below). Both ultimately produce the same cart/sale data and go through the same backend (`create_sale_v1`) — only the data-entry path differs.
2. **Admin — Add/Edit Product** — assign a barcode to a product/variant by typing or scanning the physical package.
3. **Admin — Stock-In** — optional: scan to select product during purchase entry (same lookup mechanism, lower priority than New Sale).

## Barcode Sale Mode — Flow Detail
```
Select Customer (same as Manual Sale, credit balance shown in header)
   → Scan Loop screen (NEW)
        - Camera stays active / re-opens automatically after each successful scan
        - Scan detects barcode → matches directly to a specific product + variant
          (no separate variant-picker step needed — the barcode IS variant-specific,
          e.g. Janja Spray 500ml has its own barcode distinct from Janja Spray 1L)
        - Prompt: quantity (numeric entry, default 1, editable) for this scanned item
        - Confirm → item added to the running cart list, visible on the same screen
        - Screen stays in scan mode — employee/owner immediately scans the next item
        - Repeat until done
   → "Review & Pay" → existing Cart Review screen (same qty steppers, same
     customer-credit header, same remove-on-decrement-to-zero behavior as Manual Sale)
   → Payment Entry → Sale Confirmation (identical to Manual Sale from here on)
```
Key point: nothing new is needed on the backend for this — it's the same `create_sale_v1` call with the same cart structure at submit time. The only new screen is the Scan Loop screen; everything after "Review & Pay" reuses Manual Sale's existing screens exactly.

## Data Model Changes
- Add nullable `barcode` column (text, unique per `shop_id`) to `product_variant` (spray pack sizes) and optionally to `product` (for seed bags sold as fixed pre-packed units, not loose weight).
- Unique constraint: `(shop_id, barcode)` — prevents two products in the same shop claiming the same code, while still allowing the same manufacturer barcode to exist independently across different shops (different `shop_id`) if this app is ever sold to shop #2.
- For products without a manufacturer barcode: system generates an internal code (e.g. `INTERNAL-{shop_id_short}-{sequential_id}`) rendered as a scannable barcode/QR image the Admin can print on a sticker.

## Mobile Implementation
- Library: `expo-camera` (built-in barcode/QR detection) — no extra native modules, no paid SDK, works within Expo's managed workflow (matches ADR-006's no-install/low-friction goal).
- Supported formats: EAN-13/UPC-A (standard manufacturer barcodes) + QR (for internally generated codes) — cover both cases with one scanner.
- Permission handling: request camera permission only when the Scan button is tapped, not on app launch (better UX, and avoids unnecessary permission friction for staff).

## Lookup Logic
- Scan produces a barcode string → direct RLS-scoped read query against `product_variant`/`product` filtered by `shop_id` + `barcode`. This resolves the exact variant in one lookup — no ambiguity screen needed in the normal case, since variant-specific barcodes are the whole point.
- This is a **read**, not a business-logic write, so it does NOT need to go through an RPC function (per `API_CONTRACT.md`'s read/write distinction) — a scoped Supabase query is sufficient and fast, which matters here since the Scan Loop is meant to feel instant, scan after scan.
- Client-side stock check on each scan gives immediate feedback ("only 3 left") for UX speed, but this is advisory only — the authoritative stock/price/total validation still happens server-side inside `create_sale_v1` when the sale is finally submitted, same as Manual Sale. A quantity that looked available during scanning can still be rejected/adjusted at submit time if stock changed in the meantime (e.g. another device sold the last units) — this must surface as a clear error, not a silent failure.
- No match found for a scanned code → do not block the loop. Show "Not found — search manually or ask Admin to add this barcode," let the employee either add it via manual search into the same in-progress cart, or skip and keep scanning. Never a dead-end.
- Duplicate scan of an item already in the cart → increment its existing quantity rather than creating a second line for the same variant.

## Offline Behavior
Consistent with the offline-queue plan in `ROADMAP.md` Phase 7: barcode lookup should work against a locally cached product/variant list when offline (synced whenever last online), so scanning doesn't hard-fail without signal. The resulting sale still queues via the existing `idempotency_key` mechanism.

## Out of Scope for This Phase
- Physical dedicated barcode scanner hardware — phone camera only, unless a real operational need proves otherwise later.
- Barcode-based inventory counting/audit tools (future, separate from sales lookup).
- Printing infrastructure beyond "Admin can generate and print a sticker" — no integrated label-printer driver in MVP+1.

## Definition of Done (for this phase, when started)
- `barcode` columns added via migration, RLS policies extended (read-only lookup permitted for both roles, since this is just a product-identification lookup, not sensitive financial data).
- **Barcode Sale Mode** live as a distinct entry point from New Sale: Customer select → Scan Loop screen → Review & Pay (reusing existing cart/payment/confirmation screens) → Complete.
- Scan-to-cart loop tested for: normal match, duplicate scan (qty increments), no-match fallback, and a stock conflict caught at final submit (not just at scan time).
- Scan button also live in Admin's Add/Edit Product screen (assign barcode) and optionally Stock-In.
- Internal barcode/QR generation + printable view for products without a manufacturer code.
- Tested with at least one real printed barcode and one generated/internal code end-to-end.
- Any mistakes during implementation logged in `docs/LEARNINGS.md` per `AGENTS.md`'s self-learning protocol.
