-- 0291 — The owner-fields guard must not refuse the database owner.
--
-- WHY THIS EXISTS. `guard_user_privileged_columns` (0242, revised 0245) is a BEFORE
-- UPDATE trigger on `users` that refuses any non-admin change to role, shop_id,
-- is_original_owner, is_active (and to pin_hash outside `set_user_pin`). It decides
-- "admin" with `app_is_admin()`, which reads the app session. The direct postgres
-- connection the test harness, the restore scripts and the migration runner use has
-- NO app session, so `app_is_admin()` is false for it — and every lifecycle write it
-- makes was refused with `NOT_AUTHORIZED: those account fields belong to the owner`:
-- reactivating an account after a test, restoring the Store Manager role fixture,
-- re-seeding an employee. Three CI suites fail on exactly this (destructiveSafety,
-- employeePermissions, employeeInviteLifecycle). The tests are right to make those
-- writes; the guard is wrong to refuse them.
--
-- WHAT THIS DOES. Restates the 0245 function body verbatim with ONE addition at the
-- top: a session exemption for the database owner (`session_user = 'postgres'` or
-- `postgres.<project-ref>`). The pin_hash marker rule, the authority-field refusals
-- and the admin pass-through are unchanged.
--
-- WHY IT IS SAFE TO APPLY. The postgres role can already disable any trigger, so
-- exempting its session changes nothing about the security posture — it only stops
-- the guard from refusing the one account that could already bypass it. The check
-- uses `session_user`, NOT `current_user`: this function is SECURITY DEFINER, so
-- `current_user` inside it is always the function owner. Every app path reaches the
-- database as `authenticator` (PostgREST) and is still guarded exactly as before.
-- The sibling `protect_*` triggers (0037) already exempt postgres the same way.

CREATE OR REPLACE FUNCTION public.guard_user_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The database owner writes as the maintenance account, not as an app user.
  -- Its session has no JWT, so app_is_admin() is false for it; without this the
  -- guard refuses every lifecycle write the harness and the restore scripts make.
  -- session_user, not current_user: SECURITY DEFINER makes current_user the
  -- function owner inside this body.
  IF session_user = 'postgres' OR session_user LIKE 'postgres.%' THEN
    RETURN NEW;
  END IF;

  IF public.app_is_admin() THEN RETURN NEW; END IF;

  -- Authority and lifecycle fields stay owner-only regardless of caller.
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
     OR NEW.is_original_owner IS DISTINCT FROM OLD.is_original_owner
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: those account fields belong to the owner';
  END IF;

  -- The PIN is the person's own credential, not their authority. It may change
  -- only through set_user_pin, which validates the digits and marks the write.
  IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash
     AND current_setting('app.pin_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: the PIN is set through set_user_pin';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_user_privileged_columns() IS
  'Rejects non-admin changes to authority/lifecycle columns and to users.pin_hash unless the write is marked by set_user_pin. An employee may set their own PIN; nobody may edit their own role, shop, ownership flag or active flag. The database owner session (postgres / postgres.<project-ref>) is exempt: it has no app session, and it can already disable any trigger.';

NOTIFY pgrst, 'reload schema';

-- Assertion: the exemption is present and the refusals survived the restatement.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guard_user_privileged_columns';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0291: guard_user_privileged_columns is missing';
  END IF;
  IF v_def NOT LIKE '%session_user = ''postgres''%' THEN
    RAISE EXCEPTION '0291: the postgres session exemption is missing from the guard';
  END IF;
  IF v_def NOT LIKE '%NOT_AUTHORIZED: those account fields belong to the owner%' THEN
    RAISE EXCEPTION '0291: the authority-field refusal was lost in the restatement';
  END IF;
  IF v_def NOT LIKE '%app.pin_write%' THEN
    RAISE EXCEPTION '0291: the set_user_pin marker rule was lost in the restatement';
  END IF;
END $$;
