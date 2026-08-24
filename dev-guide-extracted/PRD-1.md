# Product Requirements Document — Source Reference

The authoritative product requirements are the user-supplied file:
`Agri_Shop_Management_PRD_Final.pdf`

The structured, written-out baseline derived from that PDF lives in `PRD.md`.
Use `PRD.md` for day-to-day work; treat the PDF as the tiebreaker.

This repository copy is a structured reference, not a replacement for the original PDF.

## Locked Product Rules
- Company = Supplier = Manufacturer in the initial model.
- Initial categories: Spray and Seed.
- Sprays use pack-size variants.
- Seeds use fixed per-KG pricing.
- Inventory is tracked at sellable product/variant/measurement level.
- Admin manages products, prices, stock, suppliers, adjustments and financial reporting.
- Employees handle sales/customer operations but cannot access purchase cost, supplier financials, stock adjustments or profit.
- Customer credit and supplier payable are cumulative and historically traceable.
- Historical sales preserve their effective selling price.
- Existing stock purchase cost is not retroactively changed.
- Returns originate from original completed sales.
- Expired stock remains for reconciliation but is not sellable.
- Financial/inventory records are not hard-deleted.
- Batch-level expiry is future scope; architecture must remain extensible.
