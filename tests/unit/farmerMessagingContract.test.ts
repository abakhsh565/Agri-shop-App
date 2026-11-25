/**
 * farmerMessagingContract — the farmer-side door stays the door it claims to be.
 *
 * WHY THIS IS A GUARD AND NOT A COMMENT. `0325` introduces the first surface in this product that
 * an UNAUTHENTICATED caller can reach with a farmer credential. The two ways it can go wrong are
 * both silent:
 *
 *   1. a token is stored or compared in a form that can be read back, so a database reader can
 *      impersonate any farmer; or
 *   2. an owner table becomes readable, so the "conversation" also publishes the shop's cost,
 *      supplier or owner identity to whoever holds the app's key.
 *
 * Neither breaks a screen, and both look fine in a demo. So the properties are asserted against
 * the migration text on every run — and the chat/credit/visit rules the owner asked for are pinned
 * too, because a later "simplification" that drops the WhatsApp mirror or lets an app send to a
 * farmer with no app would otherwise pass review quietly.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/0325_a_farmer_can_talk_to_the_shop_that_lists_for_him.sql',
);

const sql = readFileSync(MIGRATION, 'utf8');

const FARMER_TABLES = [
  'marketplace_farmers',
  'marketplace_farmer_links',
  'marketplace_farmer_tokens',
  'farmer_messages',
  'farmer_credit_requests',
  'farmer_visit_requests',
  'farmer_visit_events',
];

const FARMER_API_FUNCTIONS = [
  'farmer_api_me',
  'farmer_api_thread',
  'farmer_api_send_message',
  'farmer_api_create_credit_request',
  'farmer_api_answer_offer',
  'farmer_api_request_visit',
];

const OWNER_FUNCTIONS = [
  'list_farmer_threads',
  'get_farmer_thread',
  'send_farmer_message',
  'register_farmer',
  'issue_farmer_app_token',
  'revise_farmer_credit_request',
  'schedule_farmer_visit',
];

/** The body of one `CREATE OR REPLACE FUNCTION public.<name>` … `$$;` block. */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`${name} is not defined in the migration`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`${name} has no terminating $$;`);
  return sql.slice(start, end);
}

describe('the farmer tables are server-owned', () => {
  it('turns RLS on for every table it creates', () => {
    expect(sql).toMatch(/FOREACH t IN ARRAY ARRAY\[/);
    for (const table of FARMER_TABLES) expect(sql).toContain(`'${table}'`);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('revokes every client grant, so a direct PostgREST read is refused', () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  });

  it('creates no permissive policy on any of them', () => {
    // No policy is the decision: access is the SECURITY DEFINER functions below, never a row
    // policy whose predicate someone could widen.
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});

describe('a farmer token can never be read back', () => {
  it('stores only a sha256 hash', () => {
    expect(sql).toMatch(/token_hash\s+text NOT NULL UNIQUE/);
    expect(sql).toMatch(/extensions\.digest\(/);
    // A column that could hold the plaintext would defeat the hash entirely.
    expect(sql).not.toMatch(/\btoken\s+text NOT NULL/);
  });

  it('returns the plaintext exactly once, from the issuing function', () => {
    const body = functionBody('issue_farmer_app_token');
    expect(body).toMatch(/RETURN v_token/);
    expect(body).toMatch(/encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
    // Rotation, not accumulation: the previous live token is retired in the same call.
    expect(body).toMatch(/SET revoked_at = now\(\)/);
  });

  it('resolves the farmer from the token, never from a parameter the caller supplies', () => {
    for (const fn of FARMER_API_FUNCTIONS) {
      const body = functionBody(fn);
      expect(body, `${fn} must resolve the farmer from the token`).toMatch(
        /public\.farmer_by_token\(p_token\)/,
      );
      expect(body, `${fn} must not accept a farmer id`).not.toMatch(/p_farmer_id/);
    }
  });

  it('keeps the resolver server-only', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.farmer_by_token\(text\) FROM PUBLIC, anon, authenticated/,
    );
  });
});

describe('the farmer API is the only anonymous surface, and it is read/write only for its own farmer', () => {
  it('grants anon exactly the farmer endpoints', () => {
    for (const fn of FARMER_API_FUNCTIONS) {
      const re = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon`);
      expect(re.test(sql), `${fn} must be executable by anon`).toBe(true);
    }
  });

  it('grants anon none of the owner functions', () => {
    for (const fn of OWNER_FUNCTIONS) {
      const re = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon`);
      expect(re.test(sql), `${fn} must not be executable by anon`).toBe(false);
    }
  });

  it('keeps the owner functions on the authenticated grant', () => {
    for (const fn of OWNER_FUNCTIONS) {
      const re = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`);
      expect(re.test(sql), `${fn} must be executable by the owner app`).toBe(true);
    }
  });

  it('never lets a token caller answer an offer that is not his', () => {
    const body = functionBody('farmer_api_answer_offer');
    expect(body).toMatch(/WHERE r\.id = p_request_id AND r\.farmer_id = v_farmer/);
  });
});

describe('the currency of the conversation matches what the owner asked for', () => {
  it('records a WhatsApp send in the thread and mirrors it when the farmer has the app', () => {
    const body = functionBody('send_farmer_message');
    expect(body).toMatch(/v_via NOT IN \('app', 'whatsapp'\)/);
    expect(body).toMatch(/v_via = 'app' AND NOT v_app_ready/);
    expect(body).toMatch(/CASE WHEN v_app_ready THEN now\(\) ELSE NULL END/);
    expect(body).toMatch(/delivered_to_app/);
  });

  it('stores how the message travelled', () => {
    expect(sql).toMatch(/channel\s+text NOT NULL CHECK \(channel IN \('app', 'whatsapp'\)\)/);
    expect(sql).toMatch(/direction\s+text NOT NULL CHECK \(direction IN \('owner', 'farmer'\)\)/);
  });

  it('moves a credit request through the states the owner described, and no others', () => {
    expect(sql).toMatch(
      /status IN \('submitted', 'offer_sent', 'accepted', 'declined', 'cancelled'\)/,
    );
    // The owner rewrites the terms and the farmer answers — that is the whole loop.
    expect(functionBody('revise_farmer_credit_request')).toMatch(/SET status = 'offer_sent'/);
    expect(functionBody('revise_farmer_credit_request')).toMatch(/revision = r\.revision \+ 1/);
    expect(functionBody('farmer_api_answer_offer')).toMatch(
      /CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END/,
    );
  });

  it('never writes stock, money, a customer or a membership from a farmer request', () => {
    for (const forbidden of [
      'INSERT INTO public.sales',
      'INSERT INTO public.customers',
      'INSERT INTO public.product_variants',
      'UPDATE public.product_variants',
      'INSERT INTO public.memberships',
    ]) {
      expect(sql, `0325 must not ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('assigns a visit only to an active member of the same shop', () => {
    const body = functionBody('schedule_farmer_visit');
    expect(body).toMatch(/m\.tenant_id = v_member\.tenant_id/);
    expect(body).toMatch(/m\.status = 'active'/);
  });

  it('lets an officer move only his own visit', () => {
    const body = functionBody('advance_farmer_visit');
    expect(body).toMatch(/v_visit\.assigned_to = v_member\.user_id/);
    expect(body).toMatch(/NOT_AUTHORIZED: only the owner or the assigned officer moves a visit/);
  });

  it('appends a timeline entry for every visit move', () => {
    const schedule = functionBody('schedule_farmer_visit');
    const advance = functionBody('advance_farmer_visit');
    expect(schedule).toMatch(/INSERT INTO public\.farmer_visit_events/);
    expect(advance).toMatch(/INSERT INTO public\.farmer_visit_events/);
    expect(sql).toMatch(/actor IN \('farmer', 'owner', 'officer'\)/);
  });
});

describe('the farmer API publishes nothing the farmer is not owed', () => {
  const farmerApiSource = FARMER_API_FUNCTIONS.map(functionBody).join('\n');

  it('carries no cost, supplier, stock count or owner identity', () => {
    for (const forbidden of [
      'cost_price',
      'supplier',
      'company_id',
      'stock_qty',
      'low_stock_threshold',
      'owner_id',
      'join_code',
      'barcode',
    ]) {
      expect(farmerApiSource, `the farmer API must not read ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('reads business tables only for money and names, never for a cost', () => {
    // The offer is the owner's own words and numbers; it is not a product join that could drag
    // the purchase price along with it.
    expect(sql).toMatch(/offer_lines\s+jsonb/);
    expect(sql).not.toMatch(/FROM public\.product_variants/);
  });

  it('normalises the phone into one identity', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.farmer_phone_key/);
    expect(sql).toMatch(/UNIQUE \(phone_key\)/);
  });
});
