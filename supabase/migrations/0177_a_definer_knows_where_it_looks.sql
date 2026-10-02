-- ============================================================
-- 0177 — pin search_path on the three remaining SECURITY DEFINER functions
-- ============================================================
-- FINDING (PRODUCTION_READINESS_AUDIT.md §C item 6, measured against QA on 2026-10-01): exactly
-- three SECURITY DEFINER functions in `public` had no pinned search_path (`proconfig` null):
--
--   public.get_authenticated_user_id()
--   public.get_my_shop_request(p_phone text)
--   public.process_reminders()
--
-- A SECURITY DEFINER function without a pinned search_path resolves unqualified names using the
-- CALLER's path. A caller who can create an object earlier in that path — a temp table, or any
-- schema they own — can shadow a name the function trusts, and the function then executes with the
-- owner's privileges against the caller's object. `get_authenticated_user_id()` is the identity gate
-- the RBAC chain reads, and `process_reminders()` is the reminder engine; neither should resolve a
-- name a caller can plant.
--
-- Each body was read before pinning (they are saved in backups/def-*.sql for the record): their
-- references are either unqualified objects that live in `public`, or fully qualified ones
-- (`auth.uid()`, `auth.users`), so `public` is the complete path they need and `public` is what the
-- repository's other definer functions already use.
--
-- The remaining 11 functions with no pin are NOT SECURITY DEFINER (trigger helpers and pure
-- utilities such as canonical_phone and barcode_normalize), so their search_path is the caller's own
-- by design — they cannot escalate anything.
alter function public.get_authenticated_user_id() set search_path = public;
alter function public.get_my_shop_request(text) set search_path = public;
alter function public.process_reminders() set search_path = public;
