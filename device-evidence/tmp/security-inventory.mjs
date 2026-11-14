/**
 * security-inventory.mjs — what did the recorded run actually execute, per file?
 *
 * WHY. The security checklist's rows say things like "the per-role backend matrix was never run" and
 * "no live PostgREST bypass battery". Those statements were written before the suites that exist today,
 * and a claim about coverage has to be checked against the run rather than the prose. This prints the
 * inventory of a log so each control can be mapped to a named test, or marked genuinely uncovered.
 *
 * USAGE: node device-evidence/tmp/security-inventory.mjs <logfile> [fileFilterSubstring]
 */
import { readFileSync } from 'node:fs';

const [, , logPath, filter = ''] = process.argv;
// vitest's verbose reporter colourises its output, so a raw `test > name 123ms` line is really
// `[32m✓[39m file[2m > [22m…[33m 4788[2mms[22m`. Strip the escapes before parsing titles, or every
// pattern silently matches nothing — which is how the first version of this script reported 0 tests
// from a log holding 507 of them.
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
const log = stripAnsi(readFileSync(logPath, 'utf8'));

/** `✓ tests/integration/foo.test.ts > describe › test name 123ms` */
const LINE = /^\s*[✓✗×]\s+(tests[\\/]integration[\\/][A-Za-z0-9]+\.test\.ts)\s*>\s*(.*?)\s+\d+(?:\.\d+)?(?:ms|s)\s*$/;

const byFile = new Map();
for (const line of log.split(/\r?\n/)) {
  const m = line.match(LINE);
  if (!m) continue;
  const file = m[1].replace(/\\/g, '/').split('/').pop();
  if (filter && !file.includes(filter)) continue;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(m[2]);
}

const files = [...byFile.keys()].sort();
let total = 0;
for (const f of files) {
  const tests = byFile.get(f);
  total += tests.length;
  console.log(`\n${f}  (${tests.length})`);
  for (const t of tests) console.log(`    · ${t}`);
}
console.log(`\n── ${files.length} file(s), ${total} test(s) recorded green`);
