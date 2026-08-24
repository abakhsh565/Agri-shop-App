# CR-010 — Sale flow — customer, product, variant and completion experience

**Status:** Proposed
**Priority:** High
**Type:** Mixed
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Improve the Sale flow by making customer and product information more useful, simplifying selection, keeping data synchronized, and providing a proper completion experience.

## Current behavior
Customer selection lists customers and allows creating one. Product selection shows product info. Variant selection is separate. Cart and payment work. After Complete Sale, the flow mainly shows a notification instead of a dedicated completion screen.

## Desired behavior
Show the customer's saved profile image, name and phone during selection (initial-based placeholder if no image). Show product image and improve type/unit presentation. Simplify variant selection where appropriate. Keep existing cart/payment behavior but lighten the overly dark cart styling. On Complete Sale, show a dedicated Success screen confirming the sale with relevant next actions (Download, Share, and any others appropriate to the sale context). Customer/product/user info and images stay linked to persistent DB/storage records and synced with stores so nothing goes stale between screens.

## Impact Map
- **Screens:** ♻️ SelectCustomer → BrowseProducts → VariantSelector → Cart → Review → Success
- **Flows:**
- **Data & stores:**
- **Content / i18n:**
- **Backend / DB & Security:**

### Details from your sheet
Flows: Sale. Data & stores: `cartStore`, `salesStore`, persisted customer/product/user profile records. Content: `sale.*`. Backend: DB/storage records remain source of truth for info + images; stores stay synchronized. UI/UX: customer cards, product cards, variant selection, cart styling, new success state/actions.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Keep existing working sale logic. Barcode flow is out of scope. Success-screen actions based on sale context, with Download and Share included.

## Open questions

## Implementation notes

## Verification
