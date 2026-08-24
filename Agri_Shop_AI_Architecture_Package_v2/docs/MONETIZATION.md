# Monetization — Placeholder for Future Decision

## Status
**Not decided. Not built. No pricing logic exists anywhere in the codebase.** This file exists only so the *shape* of the decision isn't forgotten, and so the database/architecture doesn't accidentally block whichever model gets chosen later. Real limits get set only after real usage data exists from your own shop (Phase 1–6), not guessed in advance.

## Why This Waits
Freemium tier limits are only meaningful once you know:
- How many sales/month a real small shop actually generates.
- Which features an owner treats as "must-have day one" vs. "nice to have."
- What a shop owner would actually pay for, based on real conversations once you're selling to shop #2.

Guessing these now risks either giving away too much free (no upgrade pressure) or crippling the free tier (kills word-of-mouth, which matters more than revenue at this stage).

## Dimensions to Decide Later (not decisions — just the checklist for that future conversation)
When this is revisited, the decision needs to cover:

1. **Unit of billing** — per shop / per employee seat / per transaction volume?
2. **What's gated**, candidates to evaluate (not commitments):
   - Number of active products or transactions/month
   - Reports & analytics depth (e.g. basic dashboard free, gross-profit drill-down paid)
   - Number of employee accounts
   - Data export (Excel/PDF)
   - Multi-shop/franchise mode (likely a paid-tier feature by nature)
   - Historical data retention window
3. **Price point** — needs real conversations with other shop owners, not a guess from this side.
4. **Trial vs. permanent free tier** — time-limited trial is simpler to build than a permanent capped free tier; permanent free tier is better for word-of-mouth growth.
5. **Billing mechanism** — this is a real build cost (payment provider integration, subscription state, grace periods for failed payments) and should get its own ADR and roadmap phase when the time comes — not bundled quietly into another feature.

## Architecture Readiness (already true, no extra work needed)
- Every table already carries `shop_id` (ADR-006), so per-shop plan/tier tracking can be added later as a single new column (`shop.plan_tier`) without restructuring existing data.
- RPC functions (per API_CONTRACT.md) are the natural enforcement point for any future usage limit (e.g. `create_sale_v1` could check `shop.plan_tier` before allowing sale #501 in a month) — no architecture change required to add this later.

## Explicit Rule for AI Agents
Do not implement any tier gating, paywall, or usage limit based on this file. This file is a placeholder for a future product-owner decision, not a spec. Building against it without an explicit go-ahead is out of scope.
