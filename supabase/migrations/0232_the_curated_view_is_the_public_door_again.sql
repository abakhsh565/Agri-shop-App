-- ═══════════════════════════════════════════════════════════════════════════════
-- 0232 — The curated marketplace view is the public door, and 0223 closed it
--
-- THE DEFECT. `0223` narrowed `anon` to nothing across `public`: every permissive policy retargeted
-- to `authenticated`, and every table, view and sequence revoked from `anon`. Its header justified the
-- sweep with "nothing in `src/` reads a table before a session exists" — which is true of this app and
-- is not the whole contract. `marketplace_listings` is readable by `anon` ON PURPOSE:
--
--   * `0185` created it as the allowlisted projection of a listing (name, price, unit, stock state,
--     branch, distance) and granted `SELECT` to `anon, authenticated`;
--   * `0210` and `0214` re-issued that same grant as the ledger's own ACL — "applied after every
--     create", so the intended end state of the batch includes it;
--   * the owner's consent flag, not the caller's identity, is the boundary: a shop appears only if
--     `marketplace_enabled` is on, the product is listed and active, the variant is in stock, and the
--     branch has a location within the farmer's own radius (`0186`, `0187`).
--
-- The consumer is the Farmer App, which does not exist yet — which is exactly why the read contract
-- was built and tested first. `tests/integration/marketplaceContract.test.ts` reaches the view with
-- the anon key and asserts that it is the ONLY door: `anon` cannot read `products`,
-- `product_variants`, `shops` or `inventory_movements`. Measured after `0223`:
--
--   view read failed: permission denied for view marketplace_listings   (42501)
--
-- WHY A NEW FILE AND NOT AN EDIT. `0223` is applied, here and on production; correcting it in place
-- would make the recorded statements disagree with the file (the state `migrate verify` reports). The
-- rule this repository follows is that an applied change is corrected by a new file, and this is the
-- correction: one grant, restored, with the property re-asserted.
--
-- WHAT IT DOES NOT DO. It does not re-open anything else `0223` closed: every other relation in
-- `public` stays unreachable to `anon`, which the block below asserts, and no write is granted —
-- `SELECT` on one view is the whole of it. The view's own redaction is unchanged: the suite compares
-- its column set for equality, so a column added later fails there rather than becoming public.
-- ═══════════════════════════════════════════════════════════════════════════════

do $grant$
begin
  if to_regclass('public.marketplace_listings') is null then
    raise exception '0232: public.marketplace_listings does not exist, so there is no public door to restore';
  end if;
  execute 'grant select on public.marketplace_listings to anon';
end
$grant$;

-- The properties, asserted rather than assumed: the door is open, and it is the only one.
do $verify$
declare
  v_other text[];
begin
  if not has_table_privilege('anon', 'public.marketplace_listings', 'SELECT') then
    raise exception '0232: anon still cannot read the curated view';
  end if;

  select array_agg(c.relname order by c.relname)
    into v_other
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm')
     and c.relname <> 'marketplace_listings'
     and (
       has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE')
     );
  if v_other is not null then
    raise exception '0232: anon holds a privilege on something other than the curated view: %',
      array_to_string(v_other, ', ');
  end if;

  if has_table_privilege('anon', 'public.marketplace_listings', 'INSERT')
     or has_table_privilege('anon', 'public.marketplace_listings', 'UPDATE')
     or has_table_privilege('anon', 'public.marketplace_listings', 'DELETE') then
    raise exception '0232: the public door must be read-only';
  end if;

  raise notice '0232: anon reads public.marketplace_listings — and nothing else in public';
end
$verify$;
