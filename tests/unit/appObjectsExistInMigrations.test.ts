import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every table and RPC the app calls must exist — in the repository AND in production.
 *
 * WHY THIS EXISTS. A screen asked `supabase.from("payments")`, a name that is not how the schema
 * spells it (`customer_payments`). Nothing in the repository noticed: the query simply failed at
 * runtime, and the first thing to object was the production release gate — after the migration
 * batch had already been written. The local stack had a `payments` table that no environment
 * shared, so the screen "worked" for whoever ran it last.
 *
 * THE RULE, IN TWO PARTS. A literal `supabase.from("x")` / `supabase.rpc("y")` in `src/` passes
 * only when both hold:
 *   1. some schema file creates it — `supabase/migrations/*.sql`, or the frozen base setup
 *      (`COMPLETE_DATABASE_SETUP.sql`) for anything that predates the migration chain; and
 *   2. production has it — it appears in `supabase/baseline/production-relations.json`, which is
 *      read from a verified production backup — UNLESS a migration newer than the last one
 *      production applied creates it, because that object is legitimately still on its way.
 *
 * Part 2 is the one that would have caught `payments`: it existed in the repository (the frozen
 * base setup declared it) and nowhere in production, and no newer migration was going to create
 * it. `scripts/dev/production-gap.mjs` measures the same thing against a live database at release
 * time; this measures it from the committed record, before the release.
 *
 * WHAT IT CANNOT SEE. Names built at runtime are not resolved and are not guessed at. And the
 * production record is a snapshot: after a batch lands, refresh it from a fresh verified backup,
 * or the guard keeps allowing objects that production now already has (harmless, just less sharp).
 */

const root = process.cwd();
const SRC = path.join(root, 'src');
const MIGRATIONS = path.join(root, 'supabase/migrations');
/** The frozen base schema every migration is written on top of. */
const BASE_SETUP = path.join(root, 'COMPLETE_DATABASE_SETUP.sql');
const PRODUCTION_RECORD = path.join(root, 'supabase/baseline/production-relations.json');

interface ProductionRecord {
  capturedAt: string;
  latestAppliedMigration: string;
  relations: string[];
  functions: string[];
}

const production: ProductionRecord = JSON.parse(fs.readFileSync(PRODUCTION_RECORD, 'utf8'));

interface Call {
  name: string;
  file: string;
}

function filesUnder(dir: string, filter: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** A migration's version prefix (`0314_x.sql` → 314); the base setup counts as version 0. */
function versionOf(file: string): number {
  if (file === BASE_SETUP) return 0;
  const match = /^(\d{4})/.exec(path.basename(file));
  return match ? Number(match[1]) : 0;
}

/** name → the newest repository version that creates it. */
function repositoryDeclarations(): { relations: Map<string, number>; functions: Map<string, number> } {
  const relations = new Map<string, number>();
  const functions = new Map<string, number>();
  const name = '"?([a-z_][a-z0-9_]*)"?';
  const relationRe = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?(?:table|view|materialized\\s+view)\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${name}`,
    'gi',
  );
  const functionRe = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}`,
    'gi',
  );

  const schemaFiles = filesUnder(MIGRATIONS, (f) => f.endsWith('.sql'));
  if (fs.existsSync(BASE_SETUP)) schemaFiles.push(BASE_SETUP);

  for (const file of schemaFiles) {
    const version = versionOf(file);
    const sql = fs.readFileSync(file, 'utf8');
    for (const match of sql.matchAll(relationRe)) {
      const key = match[1].toLowerCase();
      relations.set(key, Math.max(relations.get(key) ?? 0, version));
    }
    for (const match of sql.matchAll(functionRe)) {
      const key = match[1].toLowerCase();
      functions.set(key, Math.max(functions.get(key) ?? 0, version));
    }
  }
  return { relations, functions };
}

/** Literal `supabase.from("…")` / `supabase.rpc("…")` calls the client makes, with their file. */
function clientCalls(): { relations: Call[]; functions: Call[] } {
  const relations: Call[] = [];
  const functions: Call[] = [];
  // `supabase.storage.from(...)` names a bucket; the negative lookahead keeps it out.
  const fromRe = /supabase\s*\.(?!\s*storage\s*\.)\s*from\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g;
  const rpcRe = /supabase\s*\.\s*rpc\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g;

  for (const file of filesUnder(SRC, (f) => /\.(ts|tsx)$/.test(f))) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file).replace(/\\/g, '/');
    for (const match of source.matchAll(fromRe)) relations.push({ name: match[1], file: relative });
    for (const match of source.matchAll(rpcRe)) functions.push({ name: match[1], file: relative });
  }
  return { relations, functions };
}

/**
 * The calls that nothing accounts for: not created by any schema file, or created only by a file
 * production has already applied while production does not have the object. A name created by a
 * file NEWER than production's last applied migration is simply on its way, and is not reported.
 */
function unexplained(
  calls: Call[],
  declared: Map<string, number>,
  deployed: string[],
  latestApplied: number,
): string[] {
  const has = new Set(deployed.map((name) => name.toLowerCase()));
  const found = calls
    .filter(({ name }) => {
      const key = name.toLowerCase();
      const version = declared.get(key);
      if (version === undefined) return true; // no schema file creates it at all
      return version <= latestApplied && !has.has(key); // production never got the file that does
    })
    .map(({ name, file }) => `${name} ← ${file}`);
  return [...new Set(found)];
}

const declared = repositoryDeclarations();
const called = clientCalls();
const latestApplied = Number(production.latestAppliedMigration);

describe('every object the app calls exists, in the repository and in production', () => {
  it('reads a meaningful record on every side (the guard is not vacuous)', () => {
    expect(declared.relations.size).toBeGreaterThan(20);
    expect(declared.functions.size).toBeGreaterThan(100);
    expect(production.relations.length).toBeGreaterThan(30);
    expect(production.functions.length).toBeGreaterThan(100);
    expect(called.relations.length).toBeGreaterThan(10);
    expect(called.functions.length).toBeGreaterThan(20);
  });

  it('pins the incident it was written for', () => {
    // `payments` is exactly the name the screen asked for, and exactly what production lacks.
    expect(production.relations).not.toContain('payments');
    expect(production.relations).toContain('customer_payments');
    // And the rule reports it, rather than merely the fixture knowing it.
    const declarations = new Map([['payments', 0]]);
    expect(unexplained([{ name: 'payments', file: 'x.tsx' }], declarations, production.relations, latestApplied))
      .toEqual(['payments ← x.tsx']);
    // A file newer than production's last applied migration is on its way, not a finding.
    expect(unexplained([{ name: 'brand_new', file: 'x.tsx' }], new Map([['brand_new', latestApplied + 1]]), [], latestApplied))
      .toEqual([]);
  });

  it('no screen asks for a relation production does not have', () => {
    expect(
      unexplained(called.relations, declared.relations, production.relations, latestApplied),
      'a relation the client reads is missing from the repository or from production — ' +
        'the screen will fail at runtime, and the release gate will refuse the batch',
    ).toEqual([]);
  });

  it('no screen calls an RPC production does not have', () => {
    expect(
      unexplained(called.functions, declared.functions, production.functions, latestApplied),
      'an RPC the client calls is missing from the repository or from production',
    ).toEqual([]);
  });
});
