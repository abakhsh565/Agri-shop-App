-- Migration 0087: Fix returns table schema
-- The returns table is missing columns that the deployed process_return RPC
-- and frontend queries depend on. This causes 400 errors on the dashboard
-- and sale detail pages when querying returns data.
--
-- Current columns: id, sale_id, customer_id, refund_amount, reason, processed_by,
--   processed_by_name, status, created_at, shop_id, updated_at, idempotency_key
--
-- Missing columns referenced by process_return RPC and frontend:
--   return_number, customer_name, total_refund, resolution, note

-- Add return_number (RPC generates 'RET-XXXXXXXX')
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_number text;

-- Add customer_name (denormalized from customers for display)
ALTER TABLE returns ADD COLUMN IF NOT EXISTS customer_name text;

-- Add total_refund (the RPC uses total_refund; refund_amount was the migration 0025 rename)
-- Both columns now exist — total_refund is the canonical name used by the RPC and frontend.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS total_refund numeric(14,4) DEFAULT 0;

-- Add resolution (refund_cash, exchange, store_credit)
ALTER TABLE returns ADD COLUMN IF NOT EXISTS resolution text DEFAULT 'refund_cash';

-- Add note (optional return note)
ALTER TABLE returns ADD COLUMN IF NOT EXISTS note text;

-- Migrate data from refund_amount → total_refund if total_refund is 0/NULL
UPDATE returns SET total_refund = refund_amount WHERE (total_refund IS NULL OR total_refund = 0) AND refund_amount > 0;
