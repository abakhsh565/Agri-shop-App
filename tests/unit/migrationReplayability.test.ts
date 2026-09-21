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
});
