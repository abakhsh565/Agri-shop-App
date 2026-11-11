/**
 * localTargetGuard — the local-stack target is a separate, strict target.
 *
 * WHY THIS FILE EXISTS
 *   `assertQaProject` cannot name the local stack: `extractProjectId`
 *   returns null for `http://127.0.0.1:54321`, so the staging guard throws
 *   before it can ever accept it. `assertLocalTarget` is therefore its own
 *   function with its own rules (loopback host, port 54321, plain http, no
 *   hosted key) — and a rule that lives only in a comment is a rule that
 *   gets relaxed by the next person in a hurry. Every refusal below has a
 *   case that feeds it the input it claims to catch, and the last test proves
 *   the two guards disagree by design: a local URL must NOT pass the QA
 *   guard, or "local" would silently become a second name for QA.
 */
import { describe, expect, test, afterEach } from 'vitest';

import {
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  assertLocalTarget,
  assertQaProject,
} from '../setup/env-guard';
import { directClientConfig } from '../setup/qa-client';

/** Same shape as vitest.config.ts's declaredAnonKey: a key that names its project. */
function declaredKey(ref: string): string {
  const payload = Buffer.from(JSON.stringify({ ref, role: 'anon', iss: 'supabase' }), 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('assertLocalTarget', () => {
  test('accepts the local stack on 127.0.0.1:54321 and on localhost:54321', () => {
    expect(assertLocalTarget('http://127.0.0.1:54321')).toBe('localdev');
    expect(assertLocalTarget('http://localhost:54321')).toBe('localdev');
  });

  test('refuses any hosted URL, even the staging project it resembles', () => {
    expect(() => assertLocalTarget(`https://${STAGING_PROJECT_ID}.supabase.co`)).toThrow(
      /local stack/,
    );
    expect(() => assertLocalTarget(`https://${PRODUCTION_PROJECT_ID}.supabase.co`)).toThrow(
      /local stack/,
    );
  });

  test('refuses https on loopback: the local stack serves plain http', () => {
    expect(() => assertLocalTarget('https://127.0.0.1:54321')).toThrow(/plain http/);
  });

  test('refuses the wrong port and a missing port: the API port is named, never guessed', () => {
    expect(() => assertLocalTarget('http://127.0.0.1:54322')).toThrow(/54321/);
    expect(() => assertLocalTarget('http://127.0.0.1')).toThrow(/54321/);
    // A trailing slash is still the root path, so it is accepted.
    expect(assertLocalTarget('http://127.0.0.1:54321/')).toBe('localdev');
    expect(() => assertLocalTarget('http://127.0.0.1:54321/rest/v1/')).toThrow(/bare local stack URL/);
  });

  test('refuses a non-loopback host, even a private-network one', () => {
    expect(() => assertLocalTarget('http://192.168.1.5:54321')).toThrow(/local stack/);
    expect(() => assertLocalTarget('http://10.0.0.2:54321')).toThrow(/local stack/);
  });

  test('refuses credentials, query, and hash on the URL', () => {
    expect(() => assertLocalTarget('http://user:pass@127.0.0.1:54321')).toThrow(
      /bare local stack URL/,
    );
    expect(() => assertLocalTarget('http://127.0.0.1:54321?apikey=x')).toThrow(
      /bare local stack URL/,
    );
  });

  test('refuses a hosted key used against a local URL', () => {
    expect(() =>
      assertLocalTarget('http://127.0.0.1:54321', declaredKey(STAGING_PROJECT_ID)),
    ).toThrow(/belongs to/);
    expect(() =>
      assertLocalTarget('http://127.0.0.1:54321', declaredKey(PRODUCTION_PROJECT_ID)),
    ).toThrow(/belongs to/);
  });

  test('accepts a key that names the local project, or one it cannot read', () => {
    expect(assertLocalTarget('http://127.0.0.1:54321', declaredKey('localdev'))).toBe('localdev');
    expect(assertLocalTarget('http://127.0.0.1:54321', 'not-a-key')).toBe('localdev');
  });

  test('the QA guard still refuses the local URL: the two guards disagree by design', () => {
    expect(() => assertQaProject('http://127.0.0.1:54321')).toThrow(/Cannot determine/);
  });
});

describe('directClientConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ['QA_TARGET', 'QA_DB_HOST', 'QA_DB_PORT'] as const) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test('the hosted default is port 5432 with TLS verification off', () => {
    delete process.env.QA_TARGET;
    delete process.env.QA_DB_PORT;
    process.env.QA_DB_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
    expect(directClientConfig()).toEqual({
      host: 'aws-0-ap-northeast-1.pooler.supabase.com',
      port: 5432,
      ssl: { rejectUnauthorized: false },
    });
  });

  test('the local target is port 54322 with no TLS', () => {
    process.env.QA_TARGET = 'local';
    process.env.QA_DB_HOST = '127.0.0.1';
    process.env.QA_DB_PORT = '54322';
    expect(directClientConfig()).toEqual({
      host: '127.0.0.1',
      port: 54322,
      ssl: undefined,
    });
  });

  test('a non-numeric port is refused, not defaulted', () => {
    process.env.QA_DB_PORT = 'not-a-port';
    expect(() => directClientConfig()).toThrow(/port number/);
  });
});
