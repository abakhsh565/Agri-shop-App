-- ============================================================
-- Migration 0059: Grant anon users table permissions
--
-- Problem: anon role has RLS policies but no table-level GRANT
-- The error is: "permission denied for table users"
-- 
-- Fix: Grant SELECT and UPDATE to anon on users table
-- ============================================================

-- Grant table-level permissions to anon role
GRANT SELECT, UPDATE ON users TO anon;

-- Also ensure authenticated has full access
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
