-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0148: The PIN becomes a server-verified credential
-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBLEM
--   The PIN — the everyday way back into the app — existed only on the device:
--   lib/pinLock.ts kept a SHA-256 digest of `userId:pin` in localStorage and the
--   server had no idea the PIN existed (users.pin_hash was unused since 0009, and
--   0129 recorded that as deliberate). Two consequences:
--     • a PIN proved nothing to the server, so it could not gate anything real;
--     • losing the device (or clearing its storage) lost the PIN with no
--       server-side copy, and a saltless SHA-256 of a 4-digit secret is a
--       lookup-table away from the PIN itself.
--
-- LOCKED PRODUCT RULE (owner, 2026)
--   OTP is for identity verification, onboarding and recovery — not something the
--   user enters every time they open the app.
--   PIN is the normal recurring app-access verification: 4–6 digits, verified
--   server-side, never stored as plain text.
--
-- WHAT THIS DOES
--   Reuses the column that was already there and already protected (users.pin_hash,
--   0009; excluded from public views and anon-readable paths by 0042), and adds two
--   functions that are the ONLY way it is written or read:
--     set_user_pin(p_pin)    → writes a bcrypt hash for the caller's own row
--     verify_user_pin(p_pin) → compares against that hash, for the caller's own row
--   Neither ever returns or exposes the hash. Both act strictly on auth.uid(), so
--   they cannot be used against another user.
--
-- SAFETY
--   • SECURITY DEFINER with a pinned search_path, EXECUTE revoked from PUBLIC/anon.
--   • A 4-digit secret verified over the network needs brute-force resistance, so
--     five wrong tries lock the account's PIN for a short window; a correct PIN
--     clears the counter. The lock is per user row, not per device, so it holds
--     even if someone tries from several phones.
--   • Nothing else in the schema moves; the migration is idempotent and replayable.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columns the lockout needs (pin_hash already exists since 0009) ─────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pin_failed_count') THEN
    ALTER TABLE users ADD COLUMN pin_failed_count int NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pin_locked_until') THEN
    ALTER TABLE users ADD COLUMN pin_locked_until timestamptz;
  END IF;
END $$;

-- ─── 2. Set / change the caller's own PIN ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := app_current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  -- The rule is 4–6 digits. Anything else is refused here rather than trusted
  -- from the client, so a weak PIN cannot be written by a crafted request.
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  UPDATE users
     SET pin_hash         = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_failed_count = 0,
         pin_locked_until = NULL,
         updated_at       = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object('status', 'ok');
END $$;

-- ─── 3. Verify the caller's own PIN ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_user_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := app_current_user_id();
  v_hash    text;
  v_failed  int;
  v_locked  timestamptz;
  v_max     constant int := 5;
  v_cooldown constant interval := interval '60 seconds';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  SELECT pin_hash, coalesce(pin_failed_count, 0), pin_locked_until
    INTO v_hash, v_failed, v_locked
    FROM users WHERE id = v_uid;

  -- No hash on file: the caller has never set a PIN (or it was cleared). The app
  -- turns this into the OTP path, which is the documented recovery route.
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('status', 'no_pin');
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object(
      'status', 'locked',
      'retryAfterSeconds', ceil(extract(epoch FROM (v_locked - now())))
    );
  END IF;

  IF p_pin IS NOT NULL AND v_hash = extensions.crypt(p_pin, v_hash) THEN
    UPDATE users SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = v_uid;
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  v_failed := v_failed + 1;
  UPDATE users
     SET pin_failed_count = v_failed,
         pin_locked_until = CASE WHEN v_failed >= v_max THEN now() + v_cooldown ELSE NULL END
   WHERE id = v_uid;

  RETURN jsonb_build_object('status', 'wrong', 'attemptsLeft', greatest(0, v_max - v_failed));
END $$;

-- ─── 4. Lock the doors: signed-in callers only ────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.set_user_pin(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_user_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_user_pin(text) TO authenticated;
