import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A migration file that cannot be replayed from scratch is not a migration.
 *
 * Migration 0012 shipped (in the very first commit) with an identifier split
 * across a line break:
 *
 *     UPDATE companies SET total_purchases = total_purchases + v_total,
 *       o
 *     utstanding_payable = outstanding_payable + v_payable WHERE id = v_company_id;
 *
 * Postgres reads that as `o utstanding_payable`, so applying the file to a fresh
 * database fails at `syntax error at or near "utstanding_payable"` (SQLSTATE
 * 42601). The live QA and production databases never hit it because the function
 * was later redefined by 0015 and 0027 — only a NEW database pays the price, which
 * is exactly what the Supabase Preview check does, and it failed on every commit
 * for weeks while the app itself looked fine.
 *
 * The shape is mechanically detectable and, across every migration in this repo,
 * it has produced exactly one hit and zero false positives: a line that is nothing
 * but one to four lower-case letters, followed by a line that starts lower-case.
 * SQL has no legitimate reason to look like that.
 */
describe('migrations are replayable', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations');

  it('no migration splits an identifier across a line break', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const file of files) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i++) {
        const current = lines[i].trim();
        const next = lines[i + 1].trim();
        if (!/^[a-z]{1,4}$/.test(current)) continue;
        if (!/^[a-z]/.test(next)) continue;
        offenders.push(`${file}:${i + 1} — a bare "${current}" ends the line, then "${next.slice(0, 40)}" continues it`);
      }
    }

    expect(
      offenders,
      'these migration lines split an identifier across a line break, so a fresh replay fails with a syntax error — join them back into one statement',
    ).toEqual([]);
  });

  /**
   * Two files may not share a version number.
   *
   * The runner records each applied file in
   * `supabase_migrations.schema_migrations` keyed by version, so the second file
   * of a shared version fails with
   * `duplicate key value violates unique constraint "schema_migrations_pkey"`
   * and a fresh database can never be provisioned. Ten versions collided here
   * (0014, 0028, 0029, 0042, 0047, 0056, 0057, 0058, 0091, 20260903) — the reason
   * the Supabase Preview check reported the failure at 0014.
   *
   * Fixing a collision by merging the two files into one keeps the statements in
   * their original order and introduces no version that an existing database
   * would treat as unapplied.
   */
  it('no two migrations share a version number', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const byVersion = new Map<string, string[]>();

    for (const file of files) {
      const version = file.split('_')[0];
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }

    const collisions = [...byVersion.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([version, list]) => `${version}: ${list.sort().join(', ')}`);

    expect(
      collisions,
      'two files share a migration version, so `supabase db push` fails on a fresh database with a duplicate key — merge them into one file for that version',
    ).toEqual([]);
  });

  /**
   * `CREATE OR REPLACE FUNCTION` matches an existing function by argument TYPES,
   * so redefining one with a renamed parameter raises
   * `42P13 cannot change name of input parameter` instead of replacing it. Where
   * the argument count differs it is a new overload and legal — only a same-count
   * rename fails.
   *
   * This caught three real ones: 0015 redefined create_sale, create_purchase and
   * process_return with `p_payload` where 0012/0014 had established `payload`, and
   * 0112 swapped the 2nd and 3rd parameters of reject_credit_limit_request. Each
   * now drops the old signature first, like 0025/0027/0028 already did.
   */
  it('no migration renames a parameter of a function it redefines', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const signatures = new Map<string, string[]>();
    const offenders: string[] = [];

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const dropped = new Set(
        [...sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z_][\w.]*)\s*\(/gi)].map((m) =>
          m[1].toLowerCase(),
        ),
      );

      for (const [, rawName, params] of sql.matchAll(
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][\w.]*)\s*\(([^)]*)\)/gi,
      )) {
        const name = rawName.toLowerCase();
        const declared = params
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            const named = p.match(/^(?:IN|OUT|INOUT)?\s*([a-z_]\w*)\s+/i);
            return (named ? named[1] : p).toLowerCase();
          });

        const previous = signatures.get(name);
        if (
          previous &&
          previous.length === declared.length &&
          previous.join(',') !== declared.join(',') &&
          !dropped.has(name)
        ) {
          offenders.push(
            `${file}: ${name} is redefined as (${declared.join(',')}) but is (${previous.join(',')}) — drop it first, or the replay fails with 42P13`,
          );
        }
        signatures.set(name, declared);
      }
    }

    expect(
      offenders,
      'these redefinitions rename a parameter, which `CREATE OR REPLACE FUNCTION` refuses — DROP the old signature in the same file first',
    ).toEqual([]);
  });

  /**
   * This directory is a PATCH SET, not a baseline, and that must stay explicit.
   *
   * No migration here creates the application's base tables — `users`,
   * `products`, `customers`, `shops`, `sales` appear in none of them. 0009 is
   * named `complete_schema`, but its first statements are
   * `ALTER TABLE users ADD COLUMN shop_id uuid REFERENCES shops(id)` and an
   * `INSERT INTO shops`: it assumes a provisioned database. Replaying the
   * directory onto an EMPTY database therefore fails immediately at 0009 with
   * `relation "users" does not exist` and cascades — 79 of 133 files fail.
   *
   * That is not a defect to fix file by file; it is what this directory IS, and
   * it is the reason a Supabase preview branch (a fork of the provisioned
   * project) replays 0012 onward on top of its own schema. Fresh provisioning
   * needs a baseline dumped from the real database.
   *
   * If someone ever adds a base-table definition here, the premise has changed
   * and this test fails so the team re-decides instead of silently inheriting a
   * half-baseline.
   */
  it('stays honest that it is a patch set and not a from-scratch baseline', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const baseTables = ['users', 'products', 'customers', 'shops', 'sales'];
    const creating: string[] = [];

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const table of baseTables) {
        if (new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(public\\.)?${table}\\b`, 'i').test(sql)) {
          creating.push(`${file} creates ${table}`);
        }
      }
    }

    expect(
      creating,
      'the directory now creates base tables, so it is no longer purely a patch set — a from-scratch baseline may now be possible, and the migration strategy should be re-decided rather than left implicit',
    ).toEqual([]);
  });
});
