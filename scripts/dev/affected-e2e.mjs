#!/usr/bin/env node
/**
 * affected-e2e.mjs — which Playwright specs a change can actually reach.
 *
 * WHY THIS EXISTS
 *   The E2E job is the longest thing in CI: run 39131593134 spent 28.8 minutes on 145 tests, and
 *   every one of them ran for a change that touched two files. `compile`/`test` cost nothing
 *   compared with a suite that boots the app once per test.
 *
 *   The mapping already exists: `scripts/dev/lane-map.json` says which source globs each lane
 *   covers, and a lane's name is its spec's basename (`accessUx` → `tests/e2e/accessUx.spec.ts`).
 *   `scripts/dev/verify.mjs` uses the same map locally. CI uses the union of lanes reached by source
 *   changes; a changed E2E spec selects itself. Shared fixtures/helpers, test infrastructure, and
 *   unmapped source keep the full-suite fallback.
 *
 * WHAT IT PRINTS
 *   A space-separated list of spec paths, or the word `ALL` when the safe answer is the whole suite.
 *   It prints `ALL` — never a partial list — in every case where the answer is not certain:
 *
 *     * no base commit is known (a repository with history it cannot read);
 *     * a changed file is not a lane spec but is a test/fixture/helper, Playwright config, migration
 *       or workflow file;
 *     * a source file matches no specific lane (the next lane it belongs to may not be written yet);
 *     * anything throws.
 *
 *   A changed `tests/e2e/<lane>.spec.ts` is itself the lane: it runs directly. A shared E2E helper or
 *   fixture still expands to the whole suite.
 *
 *   A skipped spec is a check that did not run. This script exists only to skip specs whose
 *   sources are unchanged relative to the candidate's prior green baseline; when isolation is not
 *   certain, the fallback is the whole suite, never an empty set.
 *
 * Usage:
 *   node scripts/dev/affected-e2e.mjs                 # diff against origin/main…HEAD + dirty files
 *   node scripts/dev/affected-e2e.mjs --base <sha>    # explicit base (CI: the PR's base commit)
 *   node scripts/dev/affected-e2e.mjs --files a b     # name the files to map (a measurement aid)
 *   node scripts/dev/affected-e2e.mjs --all           # force ALL
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return null;
  const token = args[i];
  if (token.includes('=')) return token.slice(token.indexOf('=') + 1);
  if (name === 'files') {
    const files = [];
    for (const arg of args.slice(i + 1)) {
      if (arg.startsWith('--')) break;
      files.push(arg);
    }
    return files;
  }
  return args[i + 1] ?? true;
};

const E2E_DIR = path.join(ROOT, 'tests/e2e');
const laneMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/dev/lane-map.json'), 'utf8'));
const lanes = laneMap.lanes ?? {};

const all = () => {
  const specs = fs
    .readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((name) => `tests/e2e/${name}`);
  console.log(specs.join(' '));
};

const git = (argv) => {
  const out = spawnSync('git', argv, { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) return null;
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

/** A glob as lane-map writes them: `**` spans directories, `*` does not, everything else is literal. */
const toRegExp = (glob) => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
};

const laneGlobs = Object.entries(lanes).map(([lane, globs]) => ({
  lane,
  globs: (globs ?? []).map(toRegExp),
}));

const main = () => {
  if (flag('all') === true) return all();

  const named = flag('files');
  if (Array.isArray(named) ? named.length : typeof named === 'string') {
    const files = Array.isArray(named) ? named : [named];
    return select(files.filter((file) => fs.existsSync(path.join(ROOT, file))));
  }

  const base = flag('base');
  let changed = null;
  if (base) {
    changed = git(['diff', '--name-only', `${base}...HEAD`]);
  } else {
    const ancestor = git(['merge-base', 'HEAD', 'origin/main']);
    changed = ancestor ? git(['diff', '--name-only', ...ancestor, 'HEAD']) : null;
  }
  if (!changed) return all();

  // Uncommitted work is part of "the candidate" locally; in CI this is empty.
  const dirty = git(['status', '--porcelain']);
  if (dirty === null) return all();
  changed.push(...dirty.map((line) => line.slice(3).trim()).filter(Boolean));

  const unique = [...new Set(changed)].filter((file) => fs.existsSync(path.join(ROOT, file)));
  if (!unique.length) return all();
  return select(unique);
};

const select = (files) => {
  const affected = new Set();
  const directSpecs = new Set();
  for (const file of files) {
    if (file.startsWith('tests/')) {
      // An individual E2E spec is its own lane. Shared helpers, setup, fixtures and integration or
      // unit tests can affect many specs, so keep those changes on the full-suite path.
      if (/^tests\/e2e\/[^/]+\.spec\.ts$/.test(file) && fs.existsSync(path.join(ROOT, file))) {
        directSpecs.add(file);
        continue;
      }
      return all();
    }
    // The Playwright config, migrations and workflows can alter any spec's behaviour.
    if (
      file.startsWith('supabase/migrations/') ||
      file.startsWith('.github/workflows/') ||
      file === 'playwright.config.ts'
    ) {
      return all();
    }
    const matched = laneGlobs.filter(({ globs }) => globs.some((re) => re.test(file)));
    // A source file with no reviewed lane is unmapped: its affected lane may not exist yet, so use
    // the full-suite fallback. Mapped files select the union of all lanes that name them.
    if (!matched.length) return all();
    for (const { lane } of matched) affected.add(lane);
  }

  const specs = [
    ...[...affected].map((lane) => `tests/e2e/${lane}.spec.ts`),
    ...directSpecs,
  ]
    .filter((spec, index, allSpecs) => allSpecs.indexOf(spec) === index)
    .filter((spec) => fs.existsSync(path.join(ROOT, spec)))
    .sort();
  // Nothing mapped does not mean nothing can break.
  if (!specs.length) return all();
  console.log(specs.join(' '));
};

try {
  main();
} catch {
  all();
}
