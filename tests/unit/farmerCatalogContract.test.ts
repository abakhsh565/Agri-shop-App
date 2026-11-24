/**
 * farmerCatalogContract — the two new farmer doors stay read-only, credentialed and narrow.
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
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/0335_a_farmer_can_see_the_shops_and_what_they_sell.sql',
);

const sql = readFileSync(MIGRATION, 'utf8');

/** The body of one function, up to its closing `$$;`. */
function bodyOf(name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `${name} is not defined in 0335`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${name} has no closing delimiter`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const SHOPS = bodyOf('farmer_api_shops');
const PRODUCTS = bodyOf('farmer_api_products');

describe('farmer_api_shops — the dealer directory', () => {
  it('resolves the credential before it reads a single shop', () => {
    // `v_farmer uuid := public.farmer_by_token(p_token)` on the declare line means the raise happens
    // before any SELECT, so an unauthenticated caller cannot probe the directory through errors.
    expect(SHOPS).toMatch(/v_farmer\s+uuid\s*:=\s*public\.farmer_by_token\(p_token\)/);
    const tokenAt = SHOPS.indexOf('farmer_by_token');
    const firstReadAt = SHOPS.indexOf('FROM public.shops');
    expect(firstReadAt).toBeGreaterThan(tokenAt);
  });

  it('is a definer with a pinned search_path', () => {
    expect(SHOPS).toMatch(/SECURITY DEFINER/);
    expect(SHOPS).toMatch(/SET search_path = public/);
  });

  it('lists marketplace shops and the shops he is already linked to, and nothing else', () => {
    expect(SHOPS).toMatch(/WHERE s\.marketplace_enabled OR l\.farmer_id IS NOT NULL/);
  });

  it('publishes the public profile and withholds every credential-shaped column', () => {
    for (const field of ['shop_id', 'name', 'city', 'address', 'phone', 'shop_type', 'logo_url', 'is_linked']) {
      expect(SHOPS, `the farmer app renders ${field}`).toContain(`'${field}'`);
    }
    for (const secret of ['join_code', 'email', 'licence_url', 'cnic_front_url', 'cnic_back_url', 'owner_id', 'registration_number']) {
      expect(SHOPS, `${secret} must never reach a farmer token`).not.toContain(secret);
    }
  });
});

describe('farmer_api_products — the catalogue', () => {
  it('resolves the credential before it reads a single product', () => {
    expect(PRODUCTS).toMatch(/v_farmer\s+uuid\s*:=\s*public\.farmer_by_token\(p_token\)/);
    expect(PRODUCTS.indexOf('FROM public.products')).toBeGreaterThan(PRODUCTS.indexOf('farmer_by_token'));
  });

  it('only serves a shop that sells to farmers or one this farmer already buys from', () => {
    expect(PRODUCTS).toMatch(/NOT v_shop_row\.marketplace_enabled/);
    expect(PRODUCTS).toMatch(/FROM public\.marketplace_farmer_links l\s+WHERE l\.shop_id = p_shop_id AND l\.farmer_id = v_farmer/);
  });

  it('falls back to the farmer\'s own shop when no shop is named', () => {
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

  it('hides inactive rows on both sides of the join', () => {
    expect(PRODUCTS).toMatch(/AND p\.is_active/);
    expect(PRODUCTS).toMatch(/WHERE v\.product_id = p\.id AND v\.is_active/);
  });
});

describe('the ACL of both doors', () => {
  it('is granted to anon and revoked from authenticated, in the literal form the ledger reads', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.farmer_api_shops(text) FROM PUBLIC, authenticated;');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) FROM PUBLIC, authenticated;',
    );
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.farmer_api_shops(text) TO anon;');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) TO anon;',
    );
  });

  it('declares both in the server-only array, so the guard can compare it with the ledger', () => {
    expect(sql).toMatch(/v_server_only constant text\[\] := array\[[\s\S]*?'farmer_api_products'[\s\S]*?'farmer_api_shops'[\s\S]*?\];/);
  });

  it('proves the result instead of asserting it in prose', () => {
    expect(sql).toMatch(/RAISE EXCEPTION '0335: a signed-in shop session can call a farmer door'/);
    expect(sql).toMatch(/RAISE EXCEPTION '0335: the shop directory answered without a credential'/);
    expect(sql).toMatch(/RAISE EXCEPTION '0335: the catalogue answered without a credential'/);
  });
});
