/**
 * qaClientLazy — the QA clients must not crash a run that never uses them.
 *
 * WHY THIS IS A GUARD. `createClient(url, '')` throws `supabaseKey is required`
 * at construction. Both QA clients used to be built at module load, so a run
 * without QA_SUPABASE_SERVICE_ROLE / QA_SUPABASE_ANON_KEY died while
 * *importing* the module — the whole gates job failed with one opaque line,
 * and two unit guards (e2eCleanupOwnership, signalEngine) could not even
 * load, although neither opens a connection. The clients are now created
 * lazily, on first use, and the first use names the missing variable.
 *
 * The "first use names the variable" cases run only when the key is absent
 * (locally); in CI the keys come from repository secrets and the same code
 * path creates the real client instead — asserting a throw there would be
 * asserting against the configured environment, not the code.
 */
import { describe, expect, it } from 'vitest';
import { qaAnonClient, qaServiceClient } from '../setup/qa-client';
import { execSql } from '../e2e/helpers';

const hasServiceKey = Boolean(process.env.QA_SUPABASE_SERVICE_ROLE);
const hasAnonKey = Boolean(process.env.QA_SUPABASE_ANON_KEY);

describe('QA clients are created lazily, on first use', () => {
  it('importing the modules does not throw without keys', () => {
    // This file itself imports both modules; reaching this test is the evidence.
    expect(typeof qaServiceClient).toBe('object');
    expect(typeof qaAnonClient).toBe('object');
  });

  it.skipIf(hasServiceKey)(
    'first use of the service client names the missing variable',
    () => {
      expect(() => qaServiceClient.rpc('run_sql', { sql_query: 'SELECT 1' })).toThrow(
        /QA_SUPABASE_SERVICE_ROLE is not set/,
      );
    },
  );

  it.skipIf(hasAnonKey)('first use of the anon client names the missing variable', () => {
    expect(() => qaAnonClient.from('users').select('id')).toThrow(
      /QA_SUPABASE_ANON_KEY is not set/,
    );
  });

  it.skipIf(hasServiceKey)(
    'the e2e execSql helper names the missing variable instead of crashing at import',
    async () => {
      await expect(execSql('SELECT 1')).rejects.toThrow(/QA_SUPABASE_SERVICE_ROLE is not set/);
    },
  );
});
