-- ═══════════════════════════════════════════════════════════════════════════════
-- 0174 — A location can be taken back
--
-- THE BUG THIS FIXES, found by exercising the branch-edit picker in a browser. The picker has a
--   clear control, and the branch sheet saves the name and the pin with one button. Pressing clear
--   and then Save told the person the branch was saved, closed the sheet, and left the pin exactly
--   where it was: the sheet's save path only called `set_place` when a place was present (`if
--   (place)`), so an emptied field wrote nothing at all. Reopening the sheet then showed the pin
--   again — it had never gone — and the screen had said otherwise in between. "Saved" must mean
--   the row now says what the screen says.
--
-- WHY THE WRITER, NOT A SECOND RPC. `set_place` is the one place that knows a location is a point
--   inside Pakistan, on a row the caller may edit. Removing a location is the same decision in the
--   other direction, so it belongs behind the same lock: the whitelist, the permission and the
--   ownership check are unchanged, and no new write path is created to get around them.
--
-- WHAT "CLEAR" MEANS. Both coordinates explicitly NULL. One coordinate without the other is still
--   refused, exactly as before — half a point is worse than none, because it reads as a location
--   on screen and cannot be drawn. A caller that simply omits the arguments still gets the same
--   `VALIDATION: that point is not in Pakistan` refusal it always did, because "I forgot to send a
--   point" and "remove the point" must not be the same message for the caller to guess between.
--
-- WHAT IS CLEARED, AND WHAT IS NOT. The four columns that ARE the place: `latitude`, `longitude`,
--   `location_label`, `location_source`. NOT `address`. An address predates the pin — it is a
--   column that existed before this feature, and on `customers` it feeds the recommendation and
--   signal engines, which read it as the customer's own words. Clearing a pin must not silently
--   rewrite a value the pin did not write; a screen that wants the row's address gone says so
--   itself.
--
-- VERIFIED BY: tests/integration/placeLocation.test.ts — clearing empties the four columns, leaves
--   the address, refuses half a point, and still refuses a row that is not the caller's.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_place(
  p_table    text,
  p_id       uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_label    text DEFAULT NULL,
  p_address  text DEFAULT NULL,
  p_source   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_table  text := lower(trim(COALESCE(p_table, '')));
  v_home   uuid;
  v_updated int := 0;
  -- Both coordinates absent means "forget the place"; the caller reaches that on purpose, through
  -- the picker's clear control, and it is written rather than ignored.
  v_clearing boolean := (p_latitude IS NULL AND p_longitude IS NULL);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- A whitelist, not a table name taken from the caller: `set_place` writes coordinates, and the
  -- only way to be sure it never writes them somewhere unexpected is to name what it may touch.
  IF v_table NOT IN ('customers', 'branches', 'shops') THEN
    RAISE EXCEPTION 'VALIDATION: a location cannot be stored on %', COALESCE(NULLIF(p_table, ''), '(nothing)');
  END IF;

  -- A point means a point, and half of one is not a place to be. This is also why "no point
  -- supplied" cannot quietly mean "clear": the two are different intentions and only one of them
  -- is expressed by sending nothing.
  IF NOT v_clearing AND (
       p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude < 23.0 OR p_latitude > 37.5
       OR p_longitude < 60.0 OR p_longitude > 78.0) THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;

  SELECT u.shop_id INTO v_home FROM users u WHERE u.id = v_actor;

  -- Authority: the same permission the table's own edits require. A customer location is a
  -- customer edit; a shop or branch location is a setting.
  IF v_table = 'customers' THEN
    PERFORM authorize_business_action('customers.edit');
    EXECUTE 'UPDATE customers SET latitude = $1, longitude = $2, location_label = NULLIF($3, ''''),
                    address = COALESCE(NULLIF($4, ''''), address), location_source = NULLIF($5, ''''),
                    updated_at = now()
              WHERE id = $6 AND shop_id = $7'
      USING p_latitude, p_longitude, p_label, p_address, p_source, p_id, v_home;
  ELSE
    PERFORM authorize_business_action('settings.edit');
    -- A branch row lives in the tenant it names, and the caller must be a member of THAT tenant
    -- — an owner of one shop cannot pin a branch of another by guessing an id.
    IF v_table = 'branches' THEN
      EXECUTE 'UPDATE branches SET latitude = $1, longitude = $2, location_label = NULLIF($3, ''''),
                      address = COALESCE(NULLIF($4, ''''), address), location_source = NULLIF($5, '''')
                WHERE id = $6 AND tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = $7 AND status = ''active'')'
        USING p_latitude, p_longitude, p_label, p_address, p_source, p_id, v_actor;
    ELSE
      EXECUTE 'UPDATE shops SET latitude = $1, longitude = $2, location_label = NULLIF($3, ''''),
                      address = COALESCE(NULLIF($4, ''''), address), location_source = NULLIF($5, '''')
                WHERE id = $6 AND id IN (SELECT tenant_id FROM memberships WHERE user_id = $7 AND status = ''active'')'
        USING p_latitude, p_longitude, p_label, p_address, p_source, p_id, v_actor;
    END IF;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  -- Nothing written is reported, never swallowed: a location that did not save must not look
  -- like one that did.
  IF v_updated = 0 THEN RAISE EXCEPTION 'NOT_FOUND: nothing of yours matches that row'; END IF;

  RETURN jsonb_build_object('ok', true, 'table', v_table, 'id', p_id, 'cleared', v_clearing);
END;
$$;

-- The signature is unchanged, so the grants made in 0172 survive; re-issued anyway so this file is
-- the whole truth about who may call it.
REVOKE EXECUTE ON FUNCTION public.set_place(text, uuid, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_place(text, uuid, double precision, double precision, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.set_place(text, uuid, double precision, double precision, text, text, text) IS
  'Stores a location picked on a map onto one customer, branch or shop the caller may edit, and '
  'clears it when both coordinates are sent as NULL. Refuses half a point, a point outside '
  'Pakistan, and a row that is not theirs.';

NOTIFY pgrst, 'reload schema';
