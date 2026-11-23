/**
 * farmerJoinContract — the second door into the conversation is the door it claims to be.
 *
 * WHY A GUARD. `farmer_api_join_shop` is the only anonymous WRITE in the farmer surface: a caller
 * with no session and nothing but a printed code can create a farmer row, a shop link and, in one
 * case, a credential. Three failures would all look like a working demo:
 *
 *   1. the shop's STAFF code (`shops.join_code`) being reused as the farmer code, so everyone who
 *      scans at the counter holds a staff credential;
 *   2. a join rotating an existing token, so knowing a phone number plus any shop's public code
 *      is enough to take over that farmer's whole conversation history;
 *   3. the join answering with owner data (owner id, staff code, stock, cost).
 *
 * The properties are asserted against the migration text, the same way `farmerMessagingContract`
 * pins `0325`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/0328_a_farmer_can_walk_in_with_the_shop_code.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`${name} is not defined in the migration`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`${name} has no terminating $$;`);
  return sql.slice(start, end);
}

describe('the shop code is a second, separate credential', () => {
  it('lives in its own table, not on shops.join_code', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.marketplace_shop_join_codes/);
    expect(sql).not.toMatch(/ADD COLUMN[^;]*join_code/i);
    expect(sql).not.toMatch(/FROM public\.shops[^;]*join_code/);
  });

  it('is server-owned: RLS on, every client grant revoked, no policy', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.marketplace_shop_join_codes FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('uses an alphabet without characters that are misread on paper', () => {
    expect(sql).toContain("'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'");
    expect(sql).not.toMatch(/\^\[A-Z0-9\]\{6\}/);
  });
});

describe('the anonymous door is exactly one function', () => {
  it('grants anon the join and nothing else', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.farmer_api_join_shop\(text, text, text, text\) TO anon/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.farmer_api_join_shop\(text, text, text, text\) FROM PUBLIC, authenticated/,
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.shop_farmer_join_code\(\) TO anon/);
  });

  it('keeps the shop-code reader on the owner session', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.shop_farmer_join_code\(\) TO authenticated/,
    );
    expect(sql).toMatch(/public\.owner_membership_for_farmers\(\)/);
  });
});

describe('a join can never take over an existing conversation', () => {
  it('mints a token only when the farmer has no live one', () => {
    const body = functionBody('farmer_api_join_shop');
    expect(body).toMatch(/revoked_at IS NULL/);
    expect(body).toMatch(/IF NOT v_has_token THEN/);
    // The mint must sit INSIDE that branch: a rotation outside it is the takeover.
    const mint = body.indexOf('encode(extensions.gen_random_bytes(32)');
    const branch = body.indexOf('IF NOT v_has_token THEN');
    expect(mint).toBeGreaterThan(branch);
    expect(body.slice(branch, mint)).not.toContain('END IF');
  });

  it('never sets revoked_at, so it cannot retire a live credential', () => {
    const body = functionBody('farmer_api_join_shop');
    expect(body).not.toMatch(/SET revoked_at/);
    expect(body).not.toMatch(/UPDATE public\.marketplace_farmer_tokens/);
  });

  it('says whether the caller was already connected', () => {
    expect(functionBody('farmer_api_join_shop')).toMatch(/'already_connected', v_has_token/);
  });
});

describe('the join publishes nothing the farmer is not owed', () => {
  const body = functionBody('farmer_api_join_shop');

  it('carries no owner, staff code, stock or cost', () => {
    for (const forbidden of [
      'owner_id',
      'cost_price',
      'supplier',
      'stock_qty',
      'low_stock_threshold',
      'barcode',
    ]) {
      expect(body, `farmer_api_join_shop must not expose ${forbidden}`).not.toContain(forbidden);
    }
    // `marketplace_shop_join_codes` contains the substring, so the staff column is matched as a
    // word and as a read of `shops`, not as any occurrence of the letters.
    expect(body).not.toMatch(/\bjoin_code\b/);
    expect(body).not.toMatch(/FROM public\.shops[^;]*join_code/);
    // `phone_key` is written (it is the farmer's identity) but must never be returned.
    expect(body).not.toMatch(/'phone_key'/);
  });

  it('returns the shop name, so the farmer knows who he joined', () => {
    expect(body).toMatch(/'shop_name'/);
  });

  it('normalises the phone into the one identity 0325 defines', () => {
    expect(body).toMatch(/public\.farmer_phone_key\(p_phone\)/);
    expect(sql).toMatch(/ON CONFLICT \(phone_key\) DO UPDATE/);
  });

  it('writes one join line, and only when the link is new', () => {
    expect(body).toMatch(/GET DIAGNOSTICS v_new_link = ROW_COUNT/);
    expect(body).toMatch(/IF v_new_link = 1 THEN/);
    expect(body).toMatch(/INSERT INTO public\.farmer_messages/);
  });

  it('writes no stock, money, customer or membership', () => {
    for (const forbidden of [
      'INSERT INTO public.sales',
      'INSERT INTO public.customers',
      'UPDATE public.product_variants',
      'INSERT INTO public.memberships',
    ]) {
      expect(body, `the join must not ${forbidden}`).not.toContain(forbidden);
    }
  });
});
