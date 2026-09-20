/**
 * Permanent microcopy guard.
 *
 * The shop owners using this app are not technical people. Two things kept
 * leaking jargon into their screens:
 *
 *   1. Copy in the translation file that says "session", "override", "OTP" and so
 *      on instead of words a shopkeeper uses.
 *   2. Database failures shown EXACTLY as the database phrased them — a real
 *      example was "insert or update on table \"sales\" violates foreign key
 *      constraint \"sales_customer_id_fkey\"", and another told the owner to run a
 *      SQL migration.
 *
 * This test fails when either comes back, in EITHER language.
 */
import { describe, expect, it } from 'vitest';
import { tNow, translations } from '../../src/lib/i18n';
import { friendlyForTest } from '../../src/lib/db';

/** Words a shop owner does not use. */
const JARGON = [
  'OTP', 'token', 'session', 'RBAC', 'permission', 'override', 'scope', 'tenant',
  'payload', 'provision', 're-provision', 'sync', 'endpoint', 'API', 'JSON', 'SQL',
  'database', 'RPC', 'UUID', 'idempotency', 'webhook', 'cron', 'localhost',
  'backend', 'migration', 'schema', 'boolean', 'null', 'undefined', 'parameter',
  'credential', 'authenticate', 'authentication', 'unauthorized', 'forbidden',
  'malformed', 'exception', 'timeout', 'regex', 'enum', 'HTTP', 'URL', 'instance',
  'deprecated', 'serialise', 'deserialise',
];

/** Keys where a term is a placeholder name rather than copy (never rendered). */
const PLACEHOLDER_ONLY = new Set(['{query}', '{count}', '{phone}', '{name}', '{code}', '{branch}', '{role}', '{amount}']);

function stripPlaceholders(value: string): string {
  return value.replace(/\{[^}]*\}/g, (m) => (PLACEHOLDER_ONLY.has(m) ? ' ' : ' '));
}

function jargonIn(value: string): string[] {
  const readable = stripPlaceholders(value);
  return JARGON.filter((term) => new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i').test(readable));
}

describe('microcopy — plain language for shop owners', () => {
  it('no user-facing string uses technical wording (EN and UR)', () => {
    const offenders: string[] = [];
    for (const [lang, dict] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(dict as Record<string, string>)) {
        const found = jargonIn(value);
        if (found.length) offenders.push(`${lang} ${key} [${found.join(', ')}]: ${value}`);
      }
    }
    expect(offenders, `technical wording in user-facing copy:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('database failures are never shown as the database phrased them', () => {
    // The messages below are the real strings Postgres/PostgREST hand back.
    const rawFailures = [
      'insert or update on table "sales" violates foreign key constraint "sales_customer_id_fkey"',
      'duplicate key value violates unique constraint "customers_phone_unique"',
      'permission denied for table users',
      'JWT expired',
      'PGRST301: JWSError JWSInvalidSignature',
      'null value in column "customer_id" of relation "sales" violates not-null constraint',
      'column "unit" of relation "products" does not exist',
      'Failed to fetch',
      'INSUFFICIENT_STOCK',
      'NEGATIVE_STOCK',
      'NOT_AUTHORIZED: product belongs to another tenant',
      'EXCESS_RETURN',
      'RETURN_WINDOW_EXPIRED',
      'DUPLICATE_SUBMISSION',
      'ACCOUNT_INACTIVE',
      'NOT_AUTHENTICATED',
      'VARIANT_NOT_FOUND',
    ];

    for (const raw of rawFailures) {
      const said = friendlyForTest(raw);
      expect(said, `raw database text reached the user for: ${raw}`).not.toBe(raw);
      expect(jargonIn(said), `technical wording shown for "${raw}": ${said}`).toEqual([]);
      expect(said.length).toBeGreaterThan(10);
    }
  });

  it('failure messages exist in both languages', () => {
    const en = translations.en as Record<string, string>;
    const ur = translations.ur as Record<string, string>;
    const errorKeys = Object.keys(en).filter((k) => k.startsWith('errors.'));
    expect(errorKeys.length, 'no failure messages are defined').toBeGreaterThan(5);
    for (const key of errorKeys) {
      expect(ur[key], `missing Urdu text for ${key}`).toBeTruthy();
    }
  });

  it('reports a failure in the language being read, not always English', () => {
    // tNow reads the same language store the UI writes.
    expect(tNow('errors.noStock')).toBeTruthy();
  });
});
