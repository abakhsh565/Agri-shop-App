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
});
