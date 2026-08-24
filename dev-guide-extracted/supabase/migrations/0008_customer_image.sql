-- 0008_customer_image.sql
-- CR-014 — Customers: persistent profile image.
-- Adds an optional image_url to customers. Reads/writes go through the existing
-- customers RLS (authenticated read/insert/update). The image is non-financial,
-- so it is safe for both personas to read; the upload UI is admin-only.
alter table customers add column if not exists image_url text;
