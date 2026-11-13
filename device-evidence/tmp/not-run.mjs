/**
 * Which tests exist in the suite but are absent from a given Playwright log?
 *
 * WHY. `backups/e2e-final-2.log` ends with "2 did not run" and names neither one. The count alone
 * cannot be turned into a task; this derives the names from the two authoritative sources instead of
 * guessing — the suite's own list (`npx playwright test --list`) and the log's executed/failed lines.
 *
 * WHY FILE+TITLE AND NOT LINE:NUMBER. The first version of this script keyed on
 * `file.spec.ts:line:col` and reported 14 "missing" tests, because line numbers legitimately move
 * when a spec is edited (`crossScreenSync` gained a header paragraph, `adminMicrocopy` was fixed).
 * A line number identifies a test only inside one revision of a file; `file + full title` identifies
 * it across revisions, which is the question actually being asked.
 *
 * USAGE: node device-evidence/tmp/not-run.mjs <logfile>
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const logPath = process.argv[2];
const log = readFileSync(logPath, 'utf8');

const KEY = /([A-Za-z0-9]+\.spec\.ts):\d+:\d+ › (.*)$/;

/** `file.spec.ts :: full › title`, with the trailing "(19.7s)" the log adds stripped. */
function keyOf(line) {
  const m = line.match(KEY);
  if (!m) return null;
  const title = m[2].replace(/\s+\(\d+(?:\.\d+)?(?:ms|s|m)\)\s*$/, '').trim();
  return `${m[1]} :: ${title}`;
}

const fromLines = (text) => {
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const k = keyOf(line);
    if (k) keys.push(k);
  }
  return [...new Set(keys)].sort();
};

const listRaw = execFileSync('npx', ['playwright', 'test', '--list'], {
  encoding: 'utf8',
  shell: true,
  maxBuffer: 64 * 1024 * 1024,
});

const inSuite = fromLines(listRaw);
const inLog = fromLines(log);
const missing = inSuite.filter((t) => !inLog.includes(t));

console.log(`suite tests listed : ${inSuite.length}`);
console.log(`present in the log : ${inLog.length}`);
console.log(`ABSENT from the log: ${missing.length}`);
for (const m of missing) console.log(`  · ${m}`);
