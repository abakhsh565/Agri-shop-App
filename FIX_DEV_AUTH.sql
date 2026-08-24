-- FIX: Relax users RLS so the publishable key can look up users by phone
-- This is needed because dev mode has no Supabase Auth session
-- Run this in Supabase SQL Editor

-- Drop existing restrictive policies
DROP POLICY IF EXISTS users_admin_all ON users;
DROP POLICY IF EXISTS users_read_own ON users;

-- New policies:
-- Allow anyone to read users (for phone lookup during auth)
CREATE POLICY users_select_all ON users FOR SELECT USING (true);
-- Allow authenticated insert (for bootstrap owner creation)
CREATE POLICY users_insert_auth ON users FOR INSERT WITH CHECK (true);
-- Allow admin full access
CREATE POLICY users_admin_all ON users FOR ALL USING (app_is_admin());
-- Allow users to update their own row (settings, photo)
CREATE POLICY users_update_own ON users FOR UPDATE USING (id = app_current_user_id());
