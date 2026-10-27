-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0245: an employee can set the PIN that opens their own device
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE DEFECT (reproduced on development, 2026-10-26)
--   The sign-in flow ends at PINSetPage for a first sign-in or a new device, and
--   PINSetPage calls `set_user_pin`. `0242` added `guard_user_privileged_columns`
--   to stop a member editing their own authority, and it listed `pin_hash` among
--   the protected columns. Every non-admin update of `pin_hash` therefore raised
--
--       NOT_AUTHORIZED: those account fields belong to the owner
--
--   so an employee could verify their phone, reach the PIN screen, choose and
--   confirm a PIN — and be sent back to "Set PIN" with a generic storage error.
--   The PIN marker was never written and the account could not finish onboarding.
--   Measured with the invited employee used by the recovery check: `set_user_pin`
--   answered 400 / P0001, `pin_hash` stayed NULL, and the screen reset to step 1.
--
-- WHY THE FIX IS HERE AND NOT IN THE SCREEN
--   `pin_hash` is not an authority field like role, shop_id, is_original_owner or
--   is_active. It is a credential the account owns; `set_user_pin` is the one
--   authorized writer, it validates 4–6 digits, and it only ever updates the
--   caller's own row. The guard should keep refusing every other path to the
--   column, including a crafted direct update, which is why the function marks its
--   own write in a transaction-local setting and the trigger honours only that
--   marker. Removing `pin_hash` from the guard entirely would also let a direct
--   table update bypass the digit rule; this keeps both rules true.
--
-- SCOPE
--   Two function bodies, no table, no column, no grant change: `set_user_pin`
--   keeps its authenticated-only EXECUTE and `guard_user_privileged_columns`
--   remains a trigger. The marker is cleared immediately after the one UPDATE and
--   is transaction-local, so it cannot leak into a later statement.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_user_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  -- The rule is 4–6 digits. Anything else is refused here rather than trusted
  -- from the client, so a weak PIN cannot be written by a crafted request.
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- The guard below allows a `pin_hash` change only for the statement that
  -- carries this marker. It is set inside this SECURITY DEFINER function, not
  -- exposed as an RPC, and reset immediately after the write.
  PERFORM set_config('app.pin_write', 'on', true);

  UPDATE public.users
     SET pin_hash         = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_failed_count = 0,
         pin_locked_until = NULL,
         updated_at       = now()
   WHERE id = v_uid;

  PERFORM set_config('app.pin_write', '', true);

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_pin(text) TO authenticated;

COMMENT ON FUNCTION public.set_user_pin(text) IS
  'Writes the bcrypt PIN hash for the caller''s own account. The only path allowed to change users.pin_hash: the column guard accepts a pin_hash update only while app.pin_write is set inside this function.';

CREATE OR REPLACE FUNCTION public.guard_user_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
  'Rejects non-admin changes to authority/lifecycle columns and to users.pin_hash unless the write is marked by set_user_pin. An employee may set their own PIN; nobody may edit their own role, shop, ownership flag or active flag.';

NOTIFY pgrst, 'reload schema';
