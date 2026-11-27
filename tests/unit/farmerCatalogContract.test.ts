/**
 * farmerCatalogContract — the two farmer doors stay read-only, credentialed and narrow.
 *
 * WHY THIS IS A GUARD AND NOT A COMMENT. `0335` adds the first farmer-side surface that returns
 * *business* data: a dealer's identity and its prices. Three ways it can go wrong are all silent:
 *
 *   1. the credential is optional or resolved after a read, so a caller without a token gets data;
 *   2. a field the shop never agreed to publish rides along — its staff code, its email, its
 *      licence, or its cost price — and nobody notices because the screen only renders names;
 *   3. the stock answer becomes an exact count, turning a farmer token into a way to read a
 *      competitor's shelves.
 *
 * None of those breaks a screen or a demo. So the properties are asserted against the migration
 * text on every run, and the answer shape the farmer app is written against is pinned with them.
 *
 * `0339` moved the branch field list into one helper (`farmer_shop_profile`) and the sellability
 * question into one function (`farmer_variant_is_available`). That is why the identity assertions
 * below read the helper: a single definition is the only way three doors cannot drift apart, and a
 * guard that looked at each door's copy would have hidden exactly the drift it exists to catch.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), 'supabase/migrations', file), 'utf8');

const ORIGINAL = read('0335_a_farmer_can_see_the_shops_and_what_they_sell.sql');
const CURRENT = read('0339_the_farmer_sees_the_branch_and_hears_it_live.sql');

/** The body of one function, up to its closing `$$;`. */
function bodyOf(sql: string, name: string): string {
  const start = sql.search(new RegExp(`FUNCTION public\\.${name}\\(`));
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${name} has no closing delimiter`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const SHOPS = bodyOf(CURRENT, 'farmer_api_shops');
const PRODUCTS = bodyOf(CURRENT, 'farmer_api_products');
const PROFILE = bodyOf(CURRENT, 'farmer_shop_profile');

describe('farmer_api_shops — the dealer directory', () => {
  it('resolves the credential before it reads a single shop', () => {
    expect(SHOPS).toMatch(/v_farmer\s+uuid\s*:=\s*public\.farmer_by_token\(p_token\)/);
    expect(SHOPS.indexOf('FROM public.shops')).toBeGreaterThan(SHOPS.indexOf('farmer_by_token'));
  });

  it('is a definer with a pinned search_path', () => {
    expect(SHOPS).toMatch(/SECURITY DEFINER/);
    expect(SHOPS).toMatch(/SET search_path = public/);
  });

  it('lists marketplace shops and the shops he is already linked to, and nothing else', () => {
    expect(SHOPS).toMatch(/WHERE s\.marketplace_enabled OR l\.farmer_id IS NOT NULL/);
  });

  it('answers one branch profile rather than its own copy of the field list', () => {
    expect(SHOPS).toContain('public.farmer_shop_profile(s)');
  });
});

describe('farmer_shop_profile — what a branch may tell a farmer', () => {
  it('carries the contact, the pin and the identity a farmer acts on', () => {
    for (const field of [
      'shop_id',
      'name',
      'city',
      'address',
      'phone',
      'whatsapp_phone',
      'shop_type',
      'logo_url',
      'latitude',
      'longitude',
      'location_label',
      'owner_name',
      'is_verified',
    ]) {
      expect(PROFILE, `the farmer app renders ${field}`).toContain(`'${field}'`);
    }
  });

  it('rounds the pin exactly as the public contract does', () => {
    expect(PROFILE).toMatch(/round\(p_shop\.latitude::numeric, 4\)/);
    expect(PROFILE).toMatch(/round\(p_shop\.longitude::numeric, 4\)/);
  });

  it('never projects a credential or a document', () => {
    for (const secret of ['join_code', 'email', 'licence_url', 'cnic_front_url', 'cnic_back_url']) {
      expect(PROFILE, `${secret} must never reach a farmer token`).not.toContain(secret);
    }
    // Used to resolve the owner's display name and the verified flag, never published as values.
    expect(PROFILE, 'the owner id must not be projected').not.toContain(`'owner_id'`);
    expect(PROFILE, 'the registration number must not be projected').not.toContain(`'registration_number'`);
  });

  it('is server-only: the doors call it, a client cannot', () => {
    expect(CURRENT).toContain(
      'REVOKE ALL ON FUNCTION public.farmer_shop_profile(public.shops) FROM PUBLIC, anon, authenticated;',
    );
  });
});

describe('farmer_api_products — the catalogue', () => {
  it('resolves the credential before it reads a single product', () => {
    expect(PRODUCTS).toMatch(/v_farmer\s+uuid\s*:=\s*public\.farmer_by_token\(p_token\)/);
    expect(PRODUCTS.indexOf('FROM public.products')).toBeGreaterThan(PRODUCTS.indexOf('farmer_by_token'));
  });

  it('only serves a shop that sells to farmers or one this farmer already buys from', () => {
    expect(PRODUCTS).toMatch(/NOT v_shop_row\.marketplace_enabled/);
    expect(PRODUCTS).toMatch(
      /FROM public\.marketplace_farmer_links l\s+WHERE l\.shop_id = p_shop_id AND l\.farmer_id = v_farmer/,
    );
  });

  it("falls back to the farmer's own shop when no shop is named", () => {
    expect(PRODUCTS).toMatch(/v_shop := public\.farmer_shop_scope\(v_farmer, NULL\)/);
  });

  it('bounds the page and refuses a nonsense limit instead of silently clamping it', () => {
    expect(PRODUCTS).toMatch(/RAISE EXCEPTION 'VALIDATION: p_limit must be between 1 and 100'/);
    expect(PRODUCTS).toMatch(/RAISE EXCEPTION 'VALIDATION: p_offset cannot be negative'/);
    expect(PRODUCTS).toMatch(/LIMIT v_limit OFFSET v_offset/);
  });

  it('answers a stock STATE, never an exact quantity or a cost price', () => {
    expect(PRODUCTS).toContain("'in_stock'");
    expect(PRODUCTS).toContain("'low_stock'");
    expect(PRODUCTS).toContain("'price_from'");
    expect(PRODUCTS).toContain("'price_to'");
    // `stock_qty` may be COMPARED; it must never be projected into the answer.
    expect(PRODUCTS).not.toMatch(/'stock_qty'/);
    expect(PRODUCTS).not.toContain('cost_price');
  });

  it('uses the marketplace eligibility rule instead of its own stock comparison', () => {
    expect(PRODUCTS).toContain('public.farmer_variant_is_available(');
    // The bug 0339 fixed: `v.stock_qty > 0` alone called a zero-price pack sellable.
    expect(PRODUCTS).not.toMatch(/'in_stock',\s*v\.stock_qty > 0/);
  });

  it('hides inactive rows on both sides of the join', () => {
    expect(PRODUCTS).toMatch(/AND p\.is_active/);
    expect(PRODUCTS).toMatch(/WHERE v\.product_id = p\.id AND v\.is_active/);
  });
});

describe('farmer_variant_is_available — one sellability rule', () => {
  const body = bodyOf(CURRENT, 'farmer_variant_is_available');

  it('requires active AND stock AND a positive price', () => {
    expect(body).toMatch(/COALESCE\(p_is_active, false\)/);
    expect(body).toMatch(/COALESCE\(p_stock_qty, 0\) > 0/);
    expect(body).toMatch(/COALESCE\(p_selling_price, 0\) > 0/);
  });

  it('is proved against the truth table by the migration itself', () => {
    for (const proof of [
      'a zero-price pack is still sellable',
      'an unpriced pack is still sellable',
      'an empty pack is still sellable',
      'an archived pack is still sellable',
      'a stocked, priced, active pack is not sellable',
    ]) {
      expect(CURRENT).toContain(proof);
    }
  });
});

describe('the ACL of the farmer doors', () => {
  it('is granted to anon and revoked from authenticated, in the literal form the ledger reads', () => {
    for (const sql of [ORIGINAL, CURRENT]) {
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.farmer_api_shops(text) FROM PUBLIC, authenticated;');
      expect(sql).toContain(
        'REVOKE ALL ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) FROM PUBLIC, authenticated;',
      );
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.farmer_api_shops(text) TO anon;');
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) TO anon;',
      );
    }
  });

  it('declares both in the server-only array, so the guard can compare it with the ledger', () => {
    expect(ORIGINAL).toMatch(/v_server_only constant text\[\] := array\[[\s\S]*?'farmer_api_products'[\s\S]*?'farmer_api_shops'[\s\S]*?\];/);
  });

  it('proves the result instead of asserting it in prose', () => {
    expect(ORIGINAL).toMatch(/RAISE EXCEPTION '0335: a signed-in shop session can call a farmer door'/);
    expect(ORIGINAL).toMatch(/RAISE EXCEPTION '0335: the shop directory answered without a credential'/);
    expect(ORIGINAL).toMatch(/RAISE EXCEPTION '0335: the catalogue answered without a credential'/);
  });
});
