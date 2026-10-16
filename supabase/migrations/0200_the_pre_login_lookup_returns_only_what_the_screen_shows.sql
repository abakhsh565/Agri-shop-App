-- A pre-login lookup returns only what the screen shows.
--
-- WHY. `get_my_shop_request` answers the sign-in gate BEFORE any session exists, so it is
-- anon-callable by design — measured on the deployed catalogs: PUBLIC, `anon` and `authenticated`
-- all hold EXECUTE. It returned `row_to_json(sr)`: every column of the application row. The
-- pre-login screens read five of those fields ("status", "rejection_reason", "owner_name",
-- "owner_phone", "shop_name" — RegisterStatusPage is the only consumer, measured), and the client
-- type requires two more ("shop_type", "updated_at"). Everything else travelled with the answer:
--
--   * `cnic_front_url`, `cnic_back_url`, `business_license_url` — the applicant's identity
--     documents, stored as URLs in a public storage bucket;
--   * `latitude`, `longitude`, `location_label`, `location_source` — the shop's exact coordinates;
--   * `business_registration_number`, `shop_address`, `shop_city` — the premise and its registry;
--   * `reviewed_by`, `reviewed_at` — which admin reviewed it, and when.
--
-- None of those is rendered by any screen that runs before authentication, and a caller who merely
-- knows a phone number has no reason to receive them. Measured on the deployed row set when this
-- was written (aggregates only): 1 request, **0** carrying any document URL, **1** carrying
-- coordinates — so the document exposure was potential, the coordinate exposure actual.
--
-- WHAT THIS DOES NOT FIX, on purpose. The phone is still the only key: the lookup still answers for
-- a caller who has not proved the number, because the gate runs before a code is sent and the
-- applicant has no session yet. That is the flow's design, and narrowing the payload stops the
-- lookup from handing over documents, GPS and reviewer identity while the "should the pre-login
-- lookup answer at all, and should it be rate-limited?" decision is made. Nothing in this file
-- adds or changes a role's reach.
--
-- WHY THIS FILE IS SAFE ON EVERY ENVIRONMENT. `CREATE OR REPLACE`: it narrows the function where it
-- exists (staging/QA) and creates it where it does not (production, whose baseline has no
-- `public.get_my_shop_request(text)` — SCHEMA_STRATEGY.md §1 records the divergence). The
-- `SET search_path = public` pin is kept, because 0177 measures that every SECURITY DEFINER function
-- carries one. The body names no column that the narrower, production-shaped table lacks (see the
-- accessor note in the lookup below), and it was replayed onto both frozen baselines:
-- staging PASS, production PASS.

CREATE OR REPLACE FUNCTION public.get_my_shop_request(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.shop_requests;
BEGIN
  -- One request per number (`idx_shop_requests_phone` on `owner_phone`). `phone` is the second
  -- spelling of the same value and it agreed with `owner_phone` in every row measured, so this stays
  -- a single lookup that tries both.
  --
  -- `phone` is reached through `to_jsonb(sr)` instead of being named as a column, and that accessor
  -- is load-bearing rather than stylistic: `phone` is not part of every lineage. Measured column
  -- lists — the deployed/staging `shop_requests` has 23 columns including `phone`, `latitude` and
  -- `longitude`; production's has 18 and no `phone` at all (both baselines, SCHEMA_STRATEGY.md §1).
  -- This file narrows the function where it exists AND creates it on production, and a named column
  -- that is not there fails at the first call — which creation-time verification cannot see, because
  -- PL/pgSQL resolves column references at execution, not when the function is defined. The JSON
  -- accessor returns NULL for a key the row type does not have.
  SELECT * INTO v_request
    FROM public.shop_requests sr
   WHERE sr.owner_phone = p_phone
      OR to_jsonb(sr) ->> 'phone' = p_phone
   LIMIT 1;

  IF v_request.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'request', jsonb_build_object(
      -- The five fields the pre-login screens render, plus the two the client contract requires.
      -- Widening this list is a decision about what an unauthenticated caller may see: make it
      -- deliberately, and change `tests/unit/preAuthRequestPrivacy.test.ts` with it.
      'id',               v_request.id,
      'status',           v_request.status,
      'rejection_reason', v_request.rejection_reason,
      'owner_name',       v_request.owner_name,
      'owner_phone',      v_request.owner_phone,
      'shop_name',        v_request.shop_name,
      'shop_type',        v_request.shop_type,
      'created_at',       v_request.created_at,
      'updated_at',       v_request.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_shop_request(text) IS
  'Pre-login lookup of a shop application by phone. Callable before a session exists (anon), and returns only the fields the pre-login screens render: status, rejection_reason, owner_name, owner_phone, shop_name, shop_type, created_at, updated_at and the request id. Identity documents, coordinates, registry numbers and the reviewer are deliberately not part of the answer.';

-- The ACL the deployed catalogs already carry, recorded here so the ledger owns it: PUBLIC kept
-- EXECUTE when the function was created, and `anon` / `authenticated` hold it by name. Recording the
-- two named grants rather than revoking PUBLIC is deliberate — `service_role` reaches it through
-- PUBLIC today and nothing in this change gives a reason to take that away.
GRANT EXECUTE ON FUNCTION public.get_my_shop_request(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_shop_request(text) TO authenticated;
