-- Fix products.company_id to allow NULL (the RPC receives company name, not ID)
-- This is consistent with the original schema before a migration added NOT NULL
ALTER TABLE products ALTER COLUMN company_id DROP NOT NULL;
