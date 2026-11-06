/**
 * No two test files may claim the same fixture UUID.
 *
 * WHY THIS EXISTS. Every integration suite seeds its own users/products/roles in
 * the ONE shared QA database, and cleans them up by id or by phone. When two files
 * declare the same identifier, the suites silently become aliases of each other:
 * whichever cleans up first deletes the row the other is still using.
 *
 * That is exactly what happened to `c3000000-…-0001`. `returnIntegrityGuards`
 * declares it as an owner with phone 923009550001, `employeeAccessOverrides`
 * declared it as an owner with phone 923009670099, and because its upsert did not
 * refresh `phone`, the row kept the other suite's number — so this suite's cleanup
 * deleted the row by phone while the other was mid-run. The surviving suite then
 * answered `NOT_AUTHORIZED: tenant access denied` on create_employee for an owner
 * it had just authorized: a test-infrastructure race wearing the product's clothes,
 * intermittent (about 1 run in 4) and easy to misread as a real authorization bug.
 *
 * It reads the declarations out of the files rather than importing them, so it keeps
 * working if a suite is refactored — and a UUID reused deliberately must be moved
 * into a shared fixture module and referenced from there.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/** Every .ts under tests/, excluding this guard and generated output. */
function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures' || entry.name === 'results') continue;
      out.push(...testFiles(full));
    } else if (entry.name.endsWith('.ts') && entry.name !== 'fixtureIdCollision.test.ts') {
      out.push(full);
    }
  }
  return out;
}

/** `const X = 'uuid'` / `X: 'uuid'` declarations, which is how fixtures are named here. */
const DECLARATION = /(?:const\s+|let\s+|\b)([A-Z][A-Z0-9_]{2,})\s*[:=]\s*'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi;

/**
 * Values that are shared BY DESIGN, and why each one is safe. Anything not listed
 * here must belong to exactly one test file.
 */
const SHARED_ON_PURPOSE = new Map<string, string>([
  // The seeded QA tenant and baseline rows. tests/setup/fixtures.ts and
  // tests/e2e/helpers.ts declare the SAME baseline on purpose — Playwright seeds it
  // through one and vitest through the other, and both must mean the same rows.
  ['00000000-0000-0000-0000-000000000001', 'the QA tenant (seeded baseline)'],
  ['10000000-0000-0000-0000-000000000001', 'QA Admin (seeded baseline)'],
  ['10000000-0000-0000-0000-000000000002', 'QA Employee (seeded baseline)'],
  ['10000000-0000-0000-0000-000000000003', 'QA Owner (seeded baseline)'],
  ['20000000-0000-0000-0000-000000000001', 'QA Customer A (seeded baseline)'],
  ['20000000-0000-0000-0000-000000000002', 'QA Customer B (seeded baseline)'],
  ['20000000-0000-0000-0000-000000000003', 'QA Customer C (seeded baseline)'],
  ['30000000-0000-0000-0000-000000000001', 'QA Product A (seeded baseline)'],
  ['30000000-0000-0000-0000-000000000002', 'QA Product B (seeded baseline)'],
  ['40000000-0000-0000-0000-000000000001', 'QA Variant A (seeded baseline)'],
  ['40000000-0000-0000-0000-000000000002', 'QA Variant B (seeded baseline)'],
  ['50000000-0000-0000-0000-000000000001', 'QA Supplier A (seeded baseline)'],
  // System roles are seeded rows suites REFERENCE; none of them creates or deletes one.
  ['a0000000-0000-0000-0000-000000000001', 'system role: Sales Employee'],
  ['a0000000-0000-0000-0000-000000000003', 'system role: Store Manager'],
  // Not a row at all: the nil UUID is used as a placeholder value in payloads.
  ['00000000-0000-0000-0000-000000000000', 'nil UUID placeholder'],
]);

describe('Fixture identity', () => {
  it('never lets two test files declare the same UUID', () => {
    const owners = new Map<string, Set<string>>();

    for (const file of testFiles(path.resolve(process.cwd(), 'tests'))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(DECLARATION)) {
        const [, name, id] = match;
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id)!.add(`${rel}:${name}`);
      }
    }

    // Only ACROSS files: one file reusing an id for two of its own names is its
    // own business; two files owning one id is the defect.
    const collisions = [...owners.entries()]
      .filter(([id, where]) => {
        if (SHARED_ON_PURPOSE.has(id)) return false;
        return new Set([...where].map((w) => w.split(':')[0])).size > 1;
      })
      .map(([id, where]) => `${id} → ${[...where].join(', ')}`);

    expect(
      collisions,
      'two test files share a fixture UUID, so one suite\'s cleanup deletes the other\'s rows'
    ).toEqual([]);
  });

  /**
   * The same defect wears a second costume: two files declaring the same PHONE. `users.phone`
   * is unique, so the second file's insert dies on `users_phone_key` instead — and because
   * the suites insert with `ON CONFLICT (id) DO NOTHING`, the conflict arrives on a row the
   * file never names, which reads as an infrastructure error rather than a fixture collision.
   *
   * That is exactly what `tenantBoundarySweep` did on its first run: it reused
   * `923009790001`–`923009790003`, which `branchScopeEnforcement` already owns, and that suite
   * then failed as a whole file (11 tests skipped) while the new one passed. The UUID guard
   * could not see it. Numbers in the reserved QA ranges are literals, so they are checked the
   * same way.
   */
  it('never lets two test files declare the same fixture phone', () => {
    // A phone literal is 11–13 digits starting 92 (or 0 for the local form the app accepts).
    const PHONE = /(?<![0-9])(92[0-9]{9,11})(?![0-9])/g;
    const owners = new Map<string, Set<string>>();

    for (const file of testFiles(path.resolve(process.cwd(), 'tests'))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(PHONE)) {
        const phone = match[1];
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        if (!owners.has(phone)) owners.set(phone, new Set());
        owners.get(phone)!.add(rel);
      }
    }

    // The four seeded fixture accounts belong to the shared baseline by design; every other
    // number must be declared by exactly one file.
    const SHARED_PHONES = new Set([
      '923001234567', // the QA owner (seeded baseline)
      '923009999999', // QA Admin (seeded baseline)
      '923008888888', // QA Employee (seeded baseline)
      '923001122334', // Sales Employee (seeded baseline)
      // The three seeded QA customers. `helpers.ts` and `tests/setup/fixtures.ts` must mean the
      // same rows (Playwright seeds through one, vitest through the other), and the unit suites
      // that reason about signals/recommendations read the same fixtures rather than seeding
      // their own copies — the same reason the seeded UUIDs are listed above.
      '923001111111', // QA Customer A (seeded baseline)
      '923002222222', // QA Customer B (seeded baseline)
      '923003333333', // QA Customer C (seeded baseline)
    ]);

    const collisions = [...owners.entries()]
      .filter(([phone, files]) => !SHARED_PHONES.has(phone) && files.size > 1)
      .map(([phone, files]) => `${phone} → ${[...files].join(', ')}`)
      .sort();

    expect(
      collisions,
      'two test files share a fixture phone, so the second insert dies on users_phone_key'
    ).toEqual([]);
  });
});
