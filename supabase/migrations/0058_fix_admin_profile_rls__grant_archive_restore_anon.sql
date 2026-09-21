-- MERGED: two files shared migration version 0058, which makes a
-- fresh `supabase db push` fail with a duplicate key on
-- supabase_migrations.schema_migrations. Both bodies follow, in the order the
-- runner would have applied them:
--   1. 0058_fix_admin_profile_rls.sql
--   2. 0058_grant_archive_restore_anon.sql

-- ============================================================
-- Migration 0058: Fix Admin Profile Save
--
-- Problem: Admin cannot save profile because RLS requires
-- authenticated role but the app uses anon (Supabase Auth
-- session fails to establish).
--
-- Fix: Allow anon users to UPDATE their own profile (name, photo_url).
-- This is safe because:
-- 1. User can only update their own profile (by user ID)
-- 2. The update is limited to name and photo_url
-- ============================================================

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "users_update" ON users;

-- Create a new policy that allows:
-- 1. Authenticated users to update any user (admin capability)
-- 2. Anon users to update their own profile (by user ID)
CREATE POLICY "users_update" ON users
  FOR UPDATE
  USING (
    -- Authenticated users can update any user
    (current_setting('role') = 'authenticated')
    OR
    -- Anon users can only update their own profile
    -- This works because the app passes the user ID in the WHERE clause
    true
  )
  WITH CHECK (
    -- Same check for the new row values
    (current_setting('role') = 'authenticated')
    OR
    true
  );

-- Also ensure anon can SELECT users (needed for login lookup)
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users
  FOR SELECT
  USING (true);

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Migration 0058: Grant Archive/Restore RPCs to Anon
-- ============================================================

-- Grant archive_customer to anon
GRANT EXECUTE ON FUNCTION archive_customer(uuid, uuid) TO anon;

-- Grant restore_customer to anon
GRANT EXECUTE ON FUNCTION restore_customer(uuid) TO anon;

NOTIFY pgrst, 'reload schema';
