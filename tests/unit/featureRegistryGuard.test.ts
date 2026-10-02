/**
 * Permanent feature-registry guard.
 *
 * WHY THIS EXISTS
 *   `FEATURE-MAP.md` + `feature-registry.json` are the Engineering OS answer to
 *   "what exists, what depends on it, what could a change affect, and what evidence
 *   proves the affected behaviour is still safe?". A registry that silently drifts
 *   from the code is worse than none: it sends the next agent to the wrong screens
 *   and the wrong tests with confidence. So the records are checked mechanically
 *   against the authorities that already exist in this repository:
 *
 *     * screens      → src/router/index.tsx (the route authority)
 *     * permissions  → the requires="..." keys in that same router
 *     * tests        → the files on disk
 *     * tables/RPCs  → dependency_graph.json and supabase/migrations/
 *     * deps         → the registry itself, symmetric both ways
 *
 *   This guard does NOT judge product behaviour; the browser lanes and integration
 *   suites do that. It fails only when the map stops matching the territory.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

type Evidence = { status: string; proves: string; where: string };
type Feature = {
  id: string;
  name: string;
  domain: string;
  status: string;
  screens: string[];
  components: string[];
  state: string[];
  libs: string[];
  tables: string[];
  rpcs: string[];
  permissions: string[];
  rules: string[];
  dependsOn: string[];
  dependedBy: string[];
  tests: string[];
  evidence: Evidence[];
  lastVerified: string;
  risks: string[];
};

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'feature-registry.json'), 'utf8')) as {
  version: number;
  updatedAt: string;
  evidenceStatuses: string[];
  features: Feature[];
};
const features: Feature[] = registry.features;
const byId = new Map(features.map((f) => [f.id, f]));

const REQUIRED_STATUSES = [
  'VALID',
  'INVALIDATED',
  'REPLACED',
  'FIXED + REVERIFIED',
  'NOT APPLICABLE',
  'BLOCKED',
];
const FEATURE_STATUSES = ['LIVE', 'PARTIAL', 'PLANNED', 'BLOCKED'];
const REQUIRED_FIELDS: (keyof Feature)[] = [
  'id', 'name', 'domain', 'status', 'screens', 'components', 'state', 'libs',
  'tables', 'rpcs', 'permissions', 'rules', 'dependsOn', 'dependedBy',
  'tests', 'evidence', 'lastVerified', 'risks',
];

const router = fs.readFileSync(path.join(ROOT, 'src/router/index.tsx'), 'utf8');
const routePaths = new Set([...router.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]));
const permissionKeys = new Set([...router.matchAll(/requires="([^"]+)"/g)].map((m) => m[1]));

const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'dependency_graph.json'), 'utf8')) as {
  tables: Record<string, unknown>;
  rpcs: Record<string, unknown>;
};
const graphTables = new Set(Object.keys(graph.tables ?? {}));
const graphRpcs = new Set(Object.keys(graph.rpcs ?? {}));

const migrationsDir = path.join(ROOT, 'supabase/migrations');
const migrationsText = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n')
  .toLowerCase();

function exists(rel: string): boolean {
  const clean = rel.replace(/\/\*\*$/, '');
  return fs.existsSync(path.join(ROOT, clean));
}

function tableKnown(name: string): boolean {
  if (graphTables.has(name)) return true;
  // Migrations write both `create table public.x` and unqualified `create table if not exists x`.
  const re = new RegExp(`create table (if not exists )?(public\\.)?${name.toLowerCase()}\\b`);
  return re.test(migrationsText);
}

function rpcKnown(name: string): boolean {
  return graphRpcs.has(name) || migrationsText.includes(`function public.${name.toLowerCase()}`);
}

describe('feature registry', () => {
  it('is non-vacuous: enough meaningful capabilities, every domain populated', () => {
    expect(features.length).toBeGreaterThanOrEqual(20);
    const domains = new Set(features.map((f) => f.domain));
    expect(domains.size).toBeGreaterThanOrEqual(10);
    const testRefs = features.reduce((n, f) => n + f.tests.length, 0);
    expect(testRefs).toBeGreaterThanOrEqual(40);
  });

  it('declares the permanent evidence vocabulary exactly once', () => {
    expect(registry.evidenceStatuses).toEqual(REQUIRED_STATUSES);
    expect(registry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('every feature record is complete, with a unique id', () => {
    const ids = new Set<string>();
    for (const f of features) {
      for (const field of REQUIRED_FIELDS) {
        expect(f[field], `${f.id ?? '?'} is missing "${field}"`).toBeDefined();
      }
      expect(ids.has(f.id), `duplicate feature id ${f.id}`).toBe(false);
      ids.add(f.id);
      expect(FEATURE_STATUSES, `${f.id} has unknown status ${f.status}`).toContain(f.status);
      expect(f.name.length, `${f.id} needs a name`).toBeGreaterThan(2);
      expect(f.domain.length, `${f.id} needs a domain`).toBeGreaterThan(1);
      expect(f.rules.length, `${f.id} needs at least one business rule`).toBeGreaterThan(0);
      expect(f.risks.length, `${f.id} must state risks (empty array when none)`).toBeGreaterThanOrEqual(0);
      expect(f.lastVerified, `${f.id} needs lastVerified`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every screen exists in the router (the route authority)', () => {
    for (const f of features) {
      for (const s of f.screens) {
        expect(routePaths.has(s), `${f.id} names route "${s}" which is not in src/router/index.tsx`).toBe(true);
      }
    }
  });

  it('every permission key exists in the router', () => {
    for (const f of features) {
      for (const p of f.permissions) {
        expect(permissionKeys.has(p), `${f.id} names permission "${p}" which no route requires`).toBe(true);
      }
    }
  });

  it('every implementation path and test file exists on disk', () => {
    for (const f of features) {
      for (const rel of [...f.components, ...f.state, ...f.libs]) {
        expect(exists(rel), `${f.id} points at missing path ${rel}`).toBe(true);
      }
      for (const t of f.tests) {
        expect(exists(t), `${f.id} points at missing test ${t}`).toBe(true);
      }
    }
  });

  it('every table and RPC is known to the dependency graph or the migrations', () => {
    for (const f of features) {
      for (const t of f.tables) {
        expect(tableKnown(t), `${f.id} names table "${t}" absent from dependency_graph.json and migrations`).toBe(true);
      }
      for (const r of f.rpcs) {
        expect(rpcKnown(r), `${f.id} names RPC "${r}" absent from dependency_graph.json and migrations`).toBe(true);
      }
    }
  });

  it('dependency edges point at real features and reverse edges are symmetric', () => {
    for (const f of features) {
      for (const dep of f.dependsOn) {
        const target = byId.get(dep);
        expect(target, `${f.id} depends on unknown feature "${dep}"`).toBeDefined();
        expect(
          target!.dependedBy.includes(f.id),
          `${target!.id}.dependedBy is missing ${f.id} (reverse edge)`,
        ).toBe(true);
      }
      for (const rev of f.dependedBy) {
        const source = byId.get(rev);
        expect(source, `${f.id} is depended on by unknown feature "${rev}"`).toBeDefined();
        expect(
          source!.dependsOn.includes(f.id),
          `${source!.id}.dependsOn is missing ${f.id} (reverse edge)`,
        ).toBe(true);
      }
      expect(f.dependsOn.includes(f.id), `${f.id} cannot depend on itself`).toBe(false);
    }
  });

  it('every evidence entry uses the permanent vocabulary and says what it proves', () => {
    for (const f of features) {
      expect(f.evidence.length, `${f.id} has no evidence`).toBeGreaterThan(0);
      for (const e of f.evidence) {
        expect(REQUIRED_STATUSES, `${f.id} uses unknown evidence status "${e.status}"`).toContain(e.status);
        expect(e.proves.length, `${f.id} evidence must state what it proves`).toBeGreaterThan(10);
        expect(e.where.length, `${f.id} evidence must cite where it lives`).toBeGreaterThan(3);
      }
    }
  });
});

describe('FEATURE-MAP.md (the workflow document)', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'FEATURE-MAP.md'), 'utf8');

  it('contains the 13-step change-impact workflow, verbatim end to end', () => {
    for (let i = 1; i <= 13; i++) {
      expect(doc, `workflow step ${i} is missing`).toMatch(new RegExp(`\\n${i}\\. `));
    }
    expect(doc).toContain('Update the feature, dependency, and evidence records.');
    expect(doc).toContain('Update the feature, dependency, and evidence records.');
  });

  it('documents the six evidence statuses and the permanent rule', () => {
    for (const s of REQUIRED_STATUSES) expect(doc, `missing evidence status ${s}`).toContain(`**${s}**`);
    expect(doc).toContain('NO ACTUAL EVIDENCE = NO PASS = NO ADVANCEMENT');
  });

  it('documents reuse/invalidation triggers and the automatic entry rule', () => {
    expect(doc).toContain('Evidence reuse and invalidation');
    expect(doc).toContain('new or modified feature');
    expect(doc).toContain('EN + LTR');
    expect(doc).toContain('UR + RTL');
  });

  it('points at the authoritative sources instead of copying them', () => {
    for (const pointer of [
      'SCREEN-INDEX.md',
      'dependency_graph.json',
      'scripts/dev/lane-map.json',
      'PHASE_2_BROWSER_SAFETY.md',
      'ENGINEERING_OS_STATE.md',
      'AGENTS.md',
      'feature-registry.json',
    ]) {
      expect(doc, `missing pointer to ${pointer}`).toContain(pointer);
    }
  });

  it('keeps the MVP scope-protection rule documented', () => {
    expect(doc).toContain('MVP scope protection');
    expect(doc.toLowerCase()).toContain('no microservices');
  });
});
