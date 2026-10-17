/**
 * The PIN surface is a pair: a function body and the columns it counts.
 *
 * `0208` re-issued `set_user_pin` and `verify_user_pin` with `0148`'s bodies. Those bodies read and
 * write `users.pin_failed_count` and `users.pin_locked_until`, but the columns were created only by
 * `0148`'s ALTERs, and production never received that file. PL/pgSQL resolves column names at
 * execution, so nothing failed at apply time: the first person to set a PIN got
 *
 *     42703: column "pin_failed_count" of relation "users" does not exist
 *
 * — measured on production on 2026-10-18, and fixed by `0231`. This test exists so the pair cannot be
 * split again: every `pin_*` identifier the re-issued functions reference must be created by a
 * migration, and the lockout columns must be defined with the types and defaults the functions
 * assume.
 *
 * The last test is the non-vacuity half: the scanner is shown an identifier nothing creates and must
 * report it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const PIN_FUNCTIONS_FILE = '0208_the_functions_the_app_calls_and_the_tables_they_read.sql';
const LOCKOUT_FILE = '0231_the_pin_functions_need_the_columns_they_count.sql';

const read = (file: string) => readFileSync(join(DIR, file), 'utf8');
const executable = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

/** Every `pin_*` column a migration declares on `users`, from its own ALTER statements. */
export function pinColumnsCreated(sql: string): string[] {
  const created: string[] = [];
  const re = /alter\s+table\s+(?:public\.)?users\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("?)(pin_[a-z_]+)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(executable(sql)))) created.push(match[2]);
  return created;
}

/** Every `pin_*` identifier a SQL file mentions — the columns its bodies depend on. */
export function pinIdentifiersUsed(sql: string): string[] {
  return [...new Set(executable(sql).match(/\bpin_[a-z_]+\b/g) ?? [])].sort();
}

/** Which referenced identifiers no migration creates. */
export function undefinedPinIdentifiers(sql: string, created: Set<string>): string[] {
  return pinIdentifiersUsed(sql).filter((name) => !created.has(name));
}

const createdByMigrations = new Set(FILES.flatMap((file) => pinColumnsCreated(read(file))));

describe('the PIN functions and the columns they count stay together', () => {
  test('every pin_* identifier 0208 uses is created by some migration', () => {
    const used = pinIdentifiersUsed(read(PIN_FUNCTIONS_FILE));
    expect(used).toEqual(['pin_failed_count', 'pin_hash', 'pin_locked_until']);
    expect(undefinedPinIdentifiers(read(PIN_FUNCTIONS_FILE), createdByMigrations)).toEqual([]);
  });

  test('the lockout columns keep the shape the functions assume', () => {
    const lockdown = executable(read(LOCKOUT_FILE));
    expect(lockdown).toMatch(/add column if not exists pin_failed_count int not null default 0/i);
    expect(lockdown).toMatch(/add column if not exists pin_locked_until timestamptz/i);
    expect(pinColumnsCreated(read(LOCKOUT_FILE)).sort()).toEqual(['pin_failed_count', 'pin_locked_until']);
    // The file asserts the shape it created rather than trusting the ALTER.
    expect(lockdown).toMatch(/raise exception '0231: pin_failed_count is/);
    expect(lockdown).toMatch(/raise exception '0231: pin_locked_until is/);
  });

  test('the original definition and the forward fix both exist', () => {
    // 0148 created them first; production's curated history excluded it, which is why 0231 re-states
    // the columns instead of depending on it.
    expect(pinColumnsCreated(read('0148_server_side_pin.sql')).sort()).toEqual([
      'pin_failed_count',
      'pin_locked_until',
    ]);
    expect(FILES.some((file) => file === LOCKOUT_FILE)).toBe(true);
  });

  test('no migration after the fix removes a pin column', () => {
    const later = FILES.filter((file) => file.slice(0, 4) > '0231');
    const offenders = later.filter((file) => /alter\s+table\s+(?:public\.)?users\s+drop\s+column[^;]*pin_/i.test(read(file)));
    expect(offenders).toEqual([]);
  });

  test('the scanner is not vacuous', () => {
    const created = new Set(['pin_hash']);
    const body = `update users set pin_hash = 'x', pin_attempts_remaining = 2 where id = 1;`;
    expect(undefinedPinIdentifiers(body, created)).toEqual(['pin_attempts_remaining']);
    // …and the real file passes the same scanner, so the failure above is the identifier, not the test.
    expect(undefinedPinIdentifiers(`update users set pin_hash = 'x';`, created)).toEqual([]);
  });
});
