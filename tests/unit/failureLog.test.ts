/**
 * The failure log is only worth keeping if its entries can be trusted.
 *
 * This guard enforces the parts that are mechanically checkable: every entry carries all five
 * fields; the status is one of the four the log defines; a `confirmed` root cause names its
 * evidence; a `FIXED + REVERIFIED` entry cannot rest on an unconfirmed cause; the named regression
 * test file exists and really contains the named test; ids are unique; headings and recurrence
 * lines are well formed.
 *
 * What it deliberately does NOT enforce: that an older entry was not edited. Append-only is a
 * review rule, because proving it would mean diffing against every previous revision, and a check
 * that claimed to prove it while only comparing the working copy to itself would be a lie.
 *
 * The injected fixtures below are the non-vacuity proof: each validation has a failing case in this
 * file, so a future edit that deletes a rule fails here instead of silently accepting a bad entry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOG = 'docs/FAILURE-LOG.md';

const STATUSES = [
  'OPEN — root cause not confirmed',
  'OPEN — root cause confirmed, fix pending',
  'FIXED + REVERIFIED',
  'BLOCKED',
];

interface Entry {
  id: string;
  title: string;
  body: string;
}

function readRepoFile(relative: string): string | null {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

/** Split the log into entries, and report headings that do not name a failure id. */
function splitEntries(markdown: string): { entries: Entry[]; problems: string[] } {
  const problems: string[] = [];
  const lines = markdown.split('\n');
  const marker = lines.findIndex((line) => line.trim() === '## Entries');
  if (marker === -1) return { entries: [], problems: ['the log has no "## Entries" section'] };

  const entries: Entry[] = [];
  let current: { id: string; title: string; body: string[] } | null = null;

  for (const line of lines.slice(marker + 1)) {
    if (line.startsWith('## ')) {
      const heading = line.match(/^## (F-\d{4}) — (.+)$/);
      if (!heading) {
        problems.push(`"${line}" is not a failure heading — expected "## F-0000 — title"`);
        current = null;
        continue;
      }
      if (current) entries.push({ id: current.id, title: current.title, body: current.body.join('\n') });
      current = { id: heading[1], title: heading[2].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) entries.push({ id: current.id, title: current.title, body: current.body.join('\n') });
  return { entries, problems };
}

function field(body: string, label: string): string | null {
  const match = body.match(new RegExp(`^- \\*\\*${label}\\*\\*:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

/** How many lines claim this field. More than one means the entry says two things at once. */
function occurrences(body: string, label: string): number {
  return body.split('\n').filter((line) => new RegExp(`^- \\*\\*${label}\\*\\*:\\s*`).test(line)).length;
}

const REGRESSION = /^- \*\*Regression\*\*:\s*`([^`]+)`\s*>\s*`([^`]+)`\s*—\s*(PASS|FAIL|NOT RUN)\s*$/m;

function validateFailureLog(markdown: string, read: (relative: string) => string | null = readRepoFile): string[] {
  const { entries, problems } = splitEntries(markdown);
  if (!entries.length) problems.push('the log records no failures');

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: id is used more than once`);
    seen.add(entry.id);

    for (const label of ['Observed', 'Root cause', 'Prevention', 'Regression', 'Status']) {
      const count = occurrences(entry.body, label);
      if (count === 0) problems.push(`${entry.id}: missing "${label}"`);
      // A second line for the same field is not a formatting quirk: `field()` reads the first, so
      // an entry could carry a valid Status and a contradictory one that nothing ever checks.
      if (count > 1) problems.push(`${entry.id}: "${label}" appears ${count} times — one value per field`);
    }

    const rootCause = field(entry.body, 'Root cause');
    const confirmed = rootCause ? /^confirmed\b/.test(rootCause) : false;
    if (rootCause && !confirmed && !/^not yet confirmed\b/.test(rootCause)) {
      problems.push(`${entry.id}: root cause must start with "confirmed" or "not yet confirmed"`);
    }
    if (confirmed && !/evidence:/i.test(rootCause ?? '')) {
      problems.push(`${entry.id}: a confirmed root cause must name its evidence ("evidence: …")`);
    }

    const status = field(entry.body, 'Status');
    if (status && !STATUSES.includes(status)) {
      problems.push(`${entry.id}: unknown status "${status}" — allowed: ${STATUSES.join(' | ')}`);
    }
    if (status === 'FIXED + REVERIFIED' && rootCause && !confirmed) {
      problems.push(`${entry.id}: "FIXED + REVERIFIED" cannot rest on an unconfirmed root cause`);
    }
    if (status === 'OPEN — root cause not confirmed' && confirmed) {
      problems.push(`${entry.id}: status says the cause is unconfirmed but the entry calls it confirmed`);
    }
    if (status === 'OPEN — root cause confirmed, fix pending' && rootCause && !confirmed) {
      problems.push(`${entry.id}: status says the cause is confirmed but the entry calls it unconfirmed`);
    }

    const regression = entry.body.match(REGRESSION);
    if (field(entry.body, 'Regression') && !regression) {
      problems.push(`${entry.id}: Regression must read \`file\` > \`test\` — PASS|FAIL|NOT RUN`);
    }
    if (regression) {
      const [, file, testName, result] = regression;
      const source = read(file);
      if (source === null) problems.push(`${entry.id}: regression file ${file} does not exist`);
      else if (!source.includes(testName)) problems.push(`${entry.id}: "${testName}" was not found in ${file}`);
      if (status === 'FIXED + REVERIFIED' && result !== 'PASS') {
        problems.push(`${entry.id}: a regression recorded as ${result} does not prove the fix`);
      }
    }

    for (const line of entry.body.split('\n')) {
      // Any line that starts with the label counts, so a typo in the label cannot slip through as
      // ordinary prose: `- **Recurrences**:` and `- **Recurrence** 2026-…` both fail here.
      if (!line.startsWith('- **Recurrence')) continue;
      if (!/^- \*\*Recurrence\*\*:\s*\d{4}-\d{2}-\d{2}\s+—\s+\S/.test(line)) {
        problems.push(`${entry.id}: a recurrence line must read "- **Recurrence**: YYYY-MM-DD — what happened"`);
      }
    }
  }
  return problems;
}

/** A well-formed entry, so each injected defect is the only reason a fixture fails. */
function fixture(overrides: Record<string, string | null> = {}, extra = ''): string {
  const fields: Record<string, string | null> = {
    Observed: '`tests/unit/qaRunLock.test.ts` failed — fixture',
    'Root cause': 'confirmed — fixture cause (evidence: this test)',
    Prevention: 'a guard in `tests/unit/failureLog.test.ts`',
    Regression: '`tests/unit/qaRunLock.test.ts` > `takes the lock when nobody holds it` — PASS',
    Status: 'FIXED + REVERIFIED',
    ...overrides,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `- **${label}**: ${value}`);
  return ['# Failure log', '', '## Entries', '', '## F-9001 — fixture entry', '', ...lines, extra].join('\n');
}

const RECURRENCE = '\n- **Recurrence**: 2026-10-20 — the same query was sent again (run 123456)';

/**
 * The failure-summary step each workflow must carry, read structurally (the project has no YAML
 * parser). Returns one entry per job that has the step, with whether it is the job's last step and
 * whether it is non-blocking.
 */
function seedSteps(source: string) {
  const lines = source.split(/\r?\n/);
  const jobsStart = lines.findIndex((line) => line.trim() === 'jobs:');
  const jobs: Array<{ name: string; line: number }> = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    if (/^  [a-z0-9][a-z0-9-]*:$/.test(lines[i])) jobs.push({ name: lines[i].trim().slice(0, -1), line: i });
  }

  const found: Array<{ job: string; isLast: boolean; hasIf: boolean; hasContinue: boolean; hasRun: boolean; body: string }> = [];
  jobs.forEach((job, index) => {
    const end = jobs[index + 1]?.line ?? lines.length;
    const range = lines.slice(job.line + 1, end).filter((line) => line.trim() !== '');
    const steps = range.map((line, i) => ({ line, i })).filter(({ line }) => /^      - name:/.test(line));
    const at = steps.findIndex(({ line }) => line.includes('Failure record'));
    if (at === -1) return;

    const stepLines = range.slice(steps[at].i, at + 1 < steps.length ? steps[at + 1].i : range.length);
    const runIndex = stepLines.indexOf('        run: |');
    // The step's script is its indented block and nothing after it: a job-level comment that
    // follows the step is not part of the summary, and treating it as such made two identical
    // seeds compare as different (this guard caught its own extractor doing that).
    const body: string[] = [];
    if (runIndex !== -1) {
      for (const line of stepLines.slice(runIndex + 1)) {
        if (!line.startsWith('          ')) break;
        body.push(line.slice(10));
      }
    }
    found.push({
      job: job.name,
      isLast: at === steps.length - 1,
      hasIf: stepLines.includes('        if: failure()'),
      hasContinue: stepLines.includes('        continue-on-error: true'),
      hasRun: runIndex !== -1,
      body: body.join('\n'),
    });
  });
  return found;
}

describe('failure feedback — both workflows seed the record', () => {
  const ci = seedSteps(readRepoFile('.github/workflows/ci.yml') as string);
  const apk = seedSteps(readRepoFile('.github/workflows/build-apk.yml') as string);

  it('ci.yml covers its unit and integration jobs', () => {
    expect(ci.map((step) => step.job).sort()).toEqual(['gates', 'qa']);
  });

  it("build-apk.yml covers its own test job, which does not delegate to ci.yml", () => {
    expect(apk.map((step) => step.job)).toEqual(['test']);
  });

  it('every seeded step is last in its job, runs only on failure, and cannot block the run', () => {
    for (const step of [...ci, ...apk]) {
      expect(step.isLast, `${step.job}: the seed must be the last step so no failure runs past it`).toBe(true);
      expect(step.hasIf, `${step.job}: missing if: failure()`).toBe(true);
      expect(step.hasContinue, `${step.job}: missing continue-on-error`).toBe(true);
      expect(step.hasRun, `${step.job}: missing the run block`).toBe(true);
    }
  });

  it('all three seeds name the same fields — one feedback loop, two workflows', () => {
    expect(ci.length + apk.length).toBe(3);
    const bodies = [...ci, ...apk].map((step) => step.body.replace(/\s+/g, ' ').trim());
    expect(new Set(bodies).size, 'the seeded summaries have drifted apart').toBe(1);
    for (const field of ['commit:', 'run:', 'job:', 'observed:', 'root cause:', 'prevention:', 'regression:']) {
      expect(bodies[0]).toContain(field);
    }
    expect(bodies[0]).toContain('docs/FAILURE-LOG.md');
  });
});

describe('failure log — the real record', () => {
  it('is valid', () => {
    const markdown = readRepoFile(LOG);
    expect(markdown, `${LOG} is missing`).toBeTruthy();
    expect(validateFailureLog(markdown as string)).toEqual([]);
  });

  it('records the rehearsal identity-query bug with evidence and a live regression test', () => {
    const markdown = readRepoFile(LOG) as string;
    const entry = splitEntries(markdown).entries.find((candidate) => candidate.id === 'F-0001');
    expect(entry, 'F-0001 is missing').toBeTruthy();

    const body = (entry as Entry).body;
    expect(field(body, 'Status')).toBe('FIXED + REVERIFIED');
    expect(field(body, 'Root cause') ?? '', 'a confirmed cause must carry the fix commit as evidence').toMatch(/^confirmed/);
    expect(body).toContain('938ae2f');
  });
});

describe('failure log — the guard is not vacuous', () => {
  it('accepts a well-formed entry', () => {
    expect(validateFailureLog(fixture())).toEqual([]);
  });

  it('rejects a missing field', () => {
    expect(validateFailureLog(fixture({ Prevention: null }))).toContain('F-9001: missing "Prevention"');
  });

  it('rejects a status outside the vocabulary', () => {
    expect(validateFailureLog(fixture({ Status: 'DONE' })).some((problem) => /unknown status/.test(problem))).toBe(true);
  });

  it('rejects a confirmed root cause with no evidence', () => {
    const problems = validateFailureLog(fixture({ 'Root cause': 'confirmed — it was obvious' }));
    expect(problems.some((problem) => /must name its evidence/.test(problem))).toBe(true);
  });

  it('accepts an unconfirmed root cause while the entry is open', () => {
    expect(
      validateFailureLog(
        fixture({
          'Root cause': 'not yet confirmed — a hypothesis',
          Status: 'OPEN — root cause not confirmed',
          Regression: '`tests/unit/qaRunLock.test.ts` > `takes the lock when nobody holds it` — NOT RUN',
        }),
      ),
    ).toEqual([]);
  });

  it('rejects "FIXED + REVERIFIED" resting on an unconfirmed cause', () => {
    const problems = validateFailureLog(fixture({ 'Root cause': 'not yet confirmed — a hypothesis' }));
    expect(problems.some((problem) => /cannot rest on an unconfirmed root cause/.test(problem))).toBe(true);
  });

  it('rejects a fixed entry whose regression did not pass', () => {
    const problems = validateFailureLog(
      fixture({ Regression: '`tests/unit/qaRunLock.test.ts` > `takes the lock when nobody holds it` — FAIL' }),
    );
    expect(problems.some((problem) => /does not prove the fix/.test(problem))).toBe(true);
  });

  it('rejects a regression file that does not exist', () => {
    const problems = validateFailureLog(fixture({ Regression: '`tests/unit/nope.test.ts` > `a test` — PASS' }));
    expect(problems.some((problem) => /does not exist/.test(problem))).toBe(true);
  });

  it('rejects a regression test name that is not in the named file', () => {
    const problems = validateFailureLog(
      fixture({ Regression: '`tests/unit/qaRunLock.test.ts` > `a test that is not there` — PASS' }),
    );
    expect(problems.some((problem) => /was not found in/.test(problem))).toBe(true);
  });

  it('rejects a malformed regression line', () => {
    const problems = validateFailureLog(fixture({ Regression: 'it passed, honestly' }));
    expect(problems.some((problem) => /must read/.test(problem))).toBe(true);
  });

  it('rejects a field that appears twice', () => {
    const duplicateStatus = fixture() + '\n- **Status**: OPEN — root cause not confirmed';
    expect(validateFailureLog(duplicateStatus).some((problem) => /appears 2 times/.test(problem))).toBe(true);
  });

  it('rejects "OPEN — root cause confirmed" when the entry calls the cause unconfirmed', () => {
    const problems = validateFailureLog(
      fixture({ 'Root cause': 'not yet confirmed — a hypothesis', Status: 'OPEN — root cause confirmed, fix pending' }),
    );
    expect(problems.some((problem) => /status says the cause is confirmed/.test(problem))).toBe(true);
  });

  it('accepts an OPEN entry whose cause is confirmed and whose regression has not passed yet', () => {
    expect(
      validateFailureLog(
        fixture({
          'Root cause': 'confirmed — proven by the failing run (evidence: run 123456)',
          Status: 'OPEN — root cause confirmed, fix pending',
          Regression: '`tests/unit/qaRunLock.test.ts` > `takes the lock when nobody holds it` — FAIL',
        }),
      ),
    ).toEqual([]);
  });

  it('accepts a BLOCKED entry that is still open', () => {
    expect(
      validateFailureLog(
        fixture({
          'Root cause': 'not yet confirmed — the environment could not be reached',
          Status: 'BLOCKED',
          Regression: '`tests/unit/qaRunLock.test.ts` > `takes the lock when nobody holds it` — NOT RUN',
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a recurrence label with a typo', () => {
    const problems = validateFailureLog(fixture({}, '\n- **Recurrences**: 2026-10-20 — it happened again'));
    expect(problems.some((problem) => /recurrence line must read/.test(problem))).toBe(true);
  });

  it('rejects duplicate ids and malformed headings', () => {
    const duplicate = fixture() + '\n\n## F-9001 — second entry\n';
    expect(validateFailureLog(duplicate).some((problem) => /used more than once/.test(problem))).toBe(true);

    const badHeading = fixture().replace('## F-9001 — fixture entry', '## F-1 — fixture entry');
    expect(validateFailureLog(badHeading).some((problem) => /not a failure heading/.test(problem))).toBe(true);
  });

  it('rejects a recurrence line without a date, and accepts one with it', () => {
    const malformed = validateFailureLog(fixture({}, '\n- **Recurrence**: it happened again'));
    expect(malformed.some((problem) => /recurrence line must read/.test(problem))).toBe(true);

    expect(validateFailureLog(fixture({}, RECURRENCE))).toEqual([]);
  });
});
