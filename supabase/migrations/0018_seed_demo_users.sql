-- Seed demo users for testing
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/gkswcfljxlutkfdvvqng/sql

-- First ensure default shop exists
INSERT INTO shops(id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Shop') 
ON CONFLICT(id) DO NOTHING;

-- Insert admin user
INSERT INTO users (id, name, phone, role, is_original_owner, is_active, employee_number, shop_id)
VALUES (
  gen_random_uuid(),
  'Shop Owner',
  '923001234567',
  'admin',
  true,
  true,
  'EMP-001',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (phone) DO NOTHING;

-- Insert employee user
INSERT INTO users (id, name, phone, role, is_original_owner, is_active, employee_number, shop_id)
VALUES (
  gen_random_uuid(),
  'Sales Employee',
  '923001122334',
  'employee',
  false,
  true,
  'EMP-002',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (phone) DO NOTHING;

-- Verify
SELECT name, phone, role, is_active FROM users;
