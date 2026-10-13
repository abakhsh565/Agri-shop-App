/**
 * Monitoring guards — the rules that make error reporting safe to have in production.
 *
 * A monitoring path is the one place where a bug reports on itself, so the failure mode to fear is
 * the quiet one: a payload that quietly carries a customer's phone number, or a status that reports
 * "monitoring fine" while nothing is being recorded at all. Every check below therefore comes with a
 * second assertion that shows the check can fail — a guard that cannot detect its own failure mode
 * provides no evidence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ALLOWED_DETAIL_KEYS,
  buildErrorEvent,
  buildTestEvent,
  messageFrom,
  monitoringStatus,
  resolveEnvironment,
  scrubDetails,
  TEST_EVENT_CODE,
} from '../../src/lib/monitoring';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/0203_client_errors_are_write_only_and_environment_tagged.sql',
);

describe('an event cannot carry a customer', () => {
  test('only allow-listed primitives survive, and the input really did contain the rest', () => {
    const details = {
      route: '/admin/customers',
      component: 'RecordCustomerPaymentPage',
      // Everything below is data that must not leave the device in an error event.
      phone: '03001234567',
      email: 'owner@example.com',
      customer: 'QA Customer A',
      amount: 4200,
      balance: 19999,
      token: 'sb-access-token',
      notes: 'customer said they will pay Friday',
      nested: { customer_id: '20000000-0000-0000-0000-000000000001' },
    };

    // The premise: the payload above is the dangerous one. If this ever stops being true, the
    // assertion below would pass vacuously.
    expect(Object.keys(details)).toContain('phone');
    expect(Object.keys(details)).toContain('token');

    const scrubbed = scrubDetails(details);
    expect(Object.keys(scrubbed).sort()).toEqual(['component', 'route']);
    expect(JSON.stringify(scrubbed)).not.toContain('03001234567');
    expect(JSON.stringify(scrubbed)).not.toContain('example.com');
  });

  test('the scrubber is not merely accepting everything — a permissive one would leak', () => {
    const details = { route: '/a', phone: '03001234567' };
    // A scrubber that keeps every key is what this guard exists to catch. Demonstrate that the
    // assertion above discriminates: this one leaks, the real one does not.
    const permissive = (d: Record<string, unknown>) => ({ ...d });
    expect(Object.keys(permissive(details))).toContain('phone');
    expect(Object.keys(scrubDetails(details))).toEqual(['route']);
    expect(ALLOWED_DETAIL_KEYS).not.toContain('phone' as never);
  });

  test('a message is bounded, and a huge error object is not used as storage', () => {
    const huge = new Error('x'.repeat(5000));
    expect(messageFrom(huge).length).toBeLessThanOrEqual(500);
    expect(messageFrom(undefined)).toBe('unknown error');
    // Bounded, not emptied: a truncated message still identifies the failure.
    expect(messageFrom(huge).startsWith('xxxx')).toBe(true);
  });
});

describe('an event says which environment it happened in', () => {
  test('only the three real names are accepted', () => {
    expect(resolveEnvironment('production')).toBe('production');
    expect(resolveEnvironment('staging')).toBe('staging');
    expect(resolveEnvironment('development')).toBe('development');
    expect(resolveEnvironment('banana')).toBeNull();
    expect(resolveEnvironment(undefined)).toBeNull();
    expect(resolveEnvironment('PRODUCTION')).toBeNull();
  });

  test('a QA event and a production event are distinguishable, not merged', () => {
    const qa = buildTestEvent('staging');
    const prod = buildTestEvent('production');
    expect(qa.environment).toBe('staging');
    expect(prod.environment).toBe('production');
    expect(qa.environment).not.toBe(prod.environment);
    expect(qa.error_code).toBe(TEST_EVENT_CODE);
  });

  test('the row carries the caller-supplied identifiers only when given', () => {
    const bare = buildErrorEvent({ error: new Error('boom') }, 'production');
    expect(bare.user_id).toBeNull();
    expect(bare.shop_id).toBeNull();
    expect(bare.details.error_name).toBe('Error');

    const withContext = buildErrorEvent(
      { error: 'plain string failure', screen: '/sale/cart', userId: 'u1', shopId: 's1', details: { attempt: 2 } },
      'staging',
    );
    expect(withContext.screen).toBe('/sale/cart');
    expect(withContext.details).toEqual({ attempt: 2, error_name: 'string' });
  });
});

describe('missing configuration must not look like working monitoring', () => {
  test('no environment means not operational, and it says so', () => {
    const status = monitoringStatus({});
    expect(status.operational).toBe(false);
    expect(status.environment).toBeNull();
    expect(status.reason).toContain('NOT operational');
  });

  test('no endpoint means not operational even when the environment is known', () => {
    const status = monitoringStatus({ VITE_APP_ENV: 'production' });
    expect(status.operational).toBe(false);
    expect(status.reason).toContain('NOT operational');
  });

  test('and it is operational only when both facts are present', () => {
    const status = monitoringStatus({ VITE_APP_ENV: 'staging', VITE_SUPABASE_URL: 'https://example.invalid' });
    expect(status.operational).toBe(true);
    expect(status.environment).toBe('staging');
    // The negative case above is what makes this meaningful: the same function returns false for
    // each half missing, so `operational` is not a constant.
    expect(monitoringStatus({ VITE_SUPABASE_URL: 'https://example.invalid' }).operational).toBe(false);
  });
});

describe('the destination stays write-only and environment-tagged in the schema', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  test('the environment column is constrained to the three names', () => {
    expect(sql).toContain("CHECK (environment IN ('development', 'staging', 'production'))");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  test('no client role can read the rows, and no read policy exists to be widened later', () => {
    // The absence of a SELECT policy is the control. If someone adds one, this fails.
    expect(sql).not.toMatch(/FOR\s+SELECT/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT[^;]*TO\s+(anon|authenticated)/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+public\.client_error_events\s+TO\s+service_role/i);
    expect(sql).toMatch(/FOR\s+INSERT\s+TO\s+anon,\s*authenticated/i);
  });

  test('and the file the app writes to is the one the guards just described', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.client_error_events');
    // A rename would break the module silently at runtime; name it here so it breaks loudly instead.
    const module = readFileSync(join(process.cwd(), 'src/lib/monitoring.ts'), 'utf8');
    expect(module).toContain("from('client_error_events')");
  });
});
