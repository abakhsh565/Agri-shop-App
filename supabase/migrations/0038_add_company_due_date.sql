-- Migration 0038: Add due_date to companies for supplier payable due/overdue signals
-- The companies table tracks supplier payables (outstanding_payable) but has no
-- due-date field, so S10 (Supplier Payable) signals cannot distinguish between
-- "due today", "overdue", "not yet due", and "no due date" states.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS due_date date;

-- No default needed — NULL means "no due date set", which is a valid S10 state.
-- No NOT NULL constraint — existing companies have no due date.
