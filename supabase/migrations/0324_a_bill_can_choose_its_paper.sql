-- 0324_a_bill_can_choose_its_paper.sql
--
-- WHY THIS EXISTS
--
-- 0319 gave an invoice a design so a reprint looks like the copy the shop handed over, and named
-- the three sheets that existed then. The owner has since asked for the invoice settings screen in
-- the reference: six more printed designs and four thermal (80 mm) receipts, chosen per shop and
-- stored with the bill it was printed on.
--
-- The column already holds the answer; only its CHECK constraint knows three names. This widens
-- the list to every design the app can render. No column, default, function, policy or row is
-- touched, existing bills keep the design they were written with, and a name outside the list is
-- still refused — the constraint keeps doing its job, it just knows the whole catalogue.
--
-- PRODUCTION. One constraint replaced on a table 0319 created; no data rewrite. Safe in the same
-- batch as 0323 — see docs/PRODUCTION_MIGRATION_PLAN.md §5.

alter table public.invoices
  drop constraint if exists invoices_design_check;

alter table public.invoices
  add constraint invoices_design_check
  check (
    design in (
      'atelier', 'royal', 'aurora',
      'classic', 'modern', 'elegant', 'minimal', 'corporate', 'bold',
      'receipt-simple', 'receipt-bordered', 'receipt-compact', 'receipt-bold'
    )
  );
