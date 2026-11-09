/**
 * production-batch-gate.mjs — the four preconditions that stand between a verified batch and
 * production, as a pure function.
 *
 * WHY THIS IS A LIBRARY AND NOT A FEW `if`s IN migrate.mjs
 *   `docs/PRODUCTION_MIGRATION_PLAN.md` §7(a) is the owner's decision: production may receive a
 *   *named, verified* batch, and the tool's blanket refusal stays for everything else. The shape of
 *   that decision is a set of preconditions — a named batch, a PASS verification report against
 *   production's own baseline, a restore-verified backup taken immediately before, and the ledger's
 *   own record of what has already run. Each one is a rule that a future edit could weaken, and each
 *   one has to be provable without touching production.
 *
 *   So the rules live here, take plain data, return a verdict, and open nothing: no socket, no file
 *   handle, no clock of their own (`now` is a parameter). `tests/unit/productionBatchGate.test.ts`
 *   runs every rule and its non-vacuity half against this function, and
 *   `scripts/migrate.mjs` is a thin caller that refuses with the problems this returns *before* it
 *   resolves credentials or opens a connection.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not decide whether production *should* receive a file — `SCHEMA_STRATEGY.md` and the
 *   plan's disposition table do that, per file. It checks that what is about to be applied is exactly
 *   what was verified, against the backup that was actually restored, with nothing edited in between.
 */

/** A verification report older than this is not evidence about the code as it stands now. */
export const FRESHNESS_WINDOW_MINUTES = 60;

/** Production's recorded position before this work: the plan's whole shape depends on it. */
const PRE_POSITION = '0017';

const isObject = (value) => value !== null && typeof value === 'object';
const iso = (value) => (value instanceof Date ? value.toISOString() : String(value));
const minutesBetween = (then, now) => (now - then) / 60000;

/**
 * Check the four preconditions and partition the batch.
 *
 * @param {object} input
 * @param {string[]} input.batch            filenames as the operator named them, in the order given
 * @param {Array<{version:string,filename:string,sha256:string,bytes:number,mtimeMs:number}>} input.entries
 *   (mtimeMs is carried but never consulted: a fresh checkout rewrites every mtime, so only the
 *   sha256 can say whether the bytes are the verified bytes)
 * @param {Array<{version:string,sha256:string|null}>|null} input.ledgerRows  null = not read yet (pre-connection pass)
 * @param {object|null} input.verification  the `verify:baseline` report for this batch
 * @param {object|null} input.backupManifest the manifest of the backup taken immediately before
 * @param {object|null} input.restoreReport  the `restore-verify` report for that same backup
 * @param {number|null} input.restoreReportMtimeMs
 * @param {number} input.now                epoch ms — a parameter so the tests can move the clock
 * @param {number} [input.windowMinutes]
 * @returns {{ ok: boolean, problems: string[], toApply: object[], alreadyRecorded: object[], context: object }}
 */
export function productionBatchGate({
  batch,
  entries,
  ledgerRows,
  verification,
  backupManifest,
  restoreReport,
  restoreReportMtimeMs = null,
  now,
  windowMinutes = FRESHNESS_WINDOW_MINUTES,
}) {
  const problems = [];
  const byName = new Map((entries ?? []).map((e) => [e.filename, e]));
  const batchList = Array.isArray(batch) ? batch.filter((f) => String(f ?? '').trim().length) : [];

  // ── 1. The batch is named, canonical, present, and in the order it was verified ──────────────
  if (!batchList.length) {
    problems.push(
      'no batch named. Production receives explicit files only (`--files a.sql,b.sql`), never ' +
        '"everything in the directory" — a directory replay is the failure mode the strategy exists to prevent.',
    );
  }
  const duplicates = batchList.filter((name, i) => batchList.indexOf(name) !== i);
  if (duplicates.length) {
    problems.push(`the batch names the same file twice: ${[...new Set(duplicates)].join(', ')}.`);
  }
  const unknown = batchList.filter((name) => !byName.has(name));
  if (unknown.length) {
    problems.push(`the batch names file(s) that are not in the migration directory: ${unknown.join(', ')}.`);
  }
  const nonCanonical = batchList.filter((name) => !/^\d{4}_[\w-]+\.sql$/.test(name));
  if (nonCanonical.length) {
    problems.push(`the batch names file(s) without a 4-digit version: ${nonCanonical.join(', ')}.`);
  }

  const known = batchList.filter((name) => byName.has(name));
  for (let i = 1; i < known.length; i += 1) {
    if (byName.get(known[i - 1]).version >= byName.get(known[i]).version) {
      problems.push(
        `the batch is not in ascending version order: ${known[i - 1]} sorts at or after ${known[i]}. ` +
          'The batch is applied in the order it is named, so the named order has to be the verified order.',
      );
      break;
    }
  }

  // ── 2. Nothing at or before production's recorded position is ever re-issued ─────────────────
  const beforePosition = known.filter((name) => byName.get(name).version < PRE_POSITION);
  if (beforePosition.length) {
    problems.push(
      `the batch contains file(s) before production's recorded position ${PRE_POSITION}: ` +
        `${beforePosition.join(', ')}. The intent of 0017-0176 is already realised in production's own ` +
        'schema by out-of-band work; re-issuing it would rewrite history rather than move forward.',
    );
  }

  // ── 3. The verification report is PASS, for THIS batch, against production's baseline, recently ─
  const context = { batch: known, windowMinutes };
  if (!isObject(verification)) {
    problems.push(
      'no verification report given (`--verification <report.json>`). Run ' +
        '`npm run verify:baseline -- --baseline production --files <batch> --json <report.json>` first: ' +
        'a batch applied without a PASS on production\'s own baseline is an untested batch.',
    );
  } else {
    const baseline = verification.baseline ?? {};
    const selection = verification.selection ?? {};
    context.verification = {
      status: verification.status ?? null,
      generatedAt: verification.generatedAt ?? null,
      environment: baseline.environment ?? null,
      sha256Verified: baseline.sha256Verified ?? null,
      resolved: selection.resolved ?? null,
    };

    if (verification.status !== 'PASS') {
      problems.push(
        `the verification report's status is ${JSON.stringify(verification.status ?? null)}, not PASS. ` +
          'FAIL and UNVERIFIABLE both mean "not applied" — an unchecked statement is not a pass.',
      );
    }
    if (verification.exitCode !== undefined && verification.exitCode !== 0) {
      problems.push(`the verification report exited ${verification.exitCode}, not 0.`);
    }
    if (baseline.environment !== 'production') {
      problems.push(
        `the verification report is against ${JSON.stringify(baseline.environment ?? null)}, not production. ` +
          "A file verified on another environment's baseline has not been verified for this one.",
      );
    }
    if (baseline.sha256Verified !== true) {
      problems.push(
        'the verification report did not verify its baseline artifact against the recorded sha256, so it ' +
          'cannot say what schema the files were replayed onto.',
      );
    }

    const resolved = Array.isArray(selection.resolved) ? [...selection.resolved].sort() : null;
    const wanted = [...known].sort();
    if (!resolved) {
      problems.push('the verification report records no resolved file list, so "the batch" cannot be shown to be what was verified.');
    } else if (resolved.length !== wanted.length || resolved.some((f, i) => f !== wanted[i])) {
      const extra = resolved.filter((f) => !wanted.includes(f));
      const missing = wanted.filter((f) => !resolved.includes(f));
      problems.push(
        'the batch and the verification report describe different files ' +
          `(report-only: ${extra.join(', ') || 'none'}; batch-only: ${missing.join(', ') || 'none'}). ` +
          'Verification is of a batch as a batch — a new file in it has not been verified.',
      );
    }

    const withFailures = (verification.files ?? []).filter((f) => (f.failures ?? []).length);
    if (withFailures.length) {
      problems.push(`the report lists SQL failures in ${withFailures.map((f) => f.filename).join(', ')}.`);
    }

    const generatedAt = Date.parse(String(verification.generatedAt ?? ''));
    if (!Number.isFinite(generatedAt)) {
      problems.push('the verification report carries no readable generatedAt, so its age cannot be established.');
    } else {
      const age = minutesBetween(generatedAt, now);
      context.verificationAgeMinutes = Number(age.toFixed(2));
      if (age < 0) problems.push('the verification report is dated in the future.');
      else if (age > windowMinutes) {
        problems.push(
          `the verification report is ${age.toFixed(0)} minutes old (limit ${windowMinutes}). ` +
            'Verification is of the files as they were; re-run it against the current bytes.',
        );
      }

      // A file whose bytes differ from what was verified is no longer the verified file — even
      // if its name matches. The comparison is by content hash, never by mtime: a fresh checkout
      // sets every file's mtime to the checkout time, which is always after generatedAt, so an
      // mtime comparison can never pass in the workflow (run 42706653163 refused a byte-identical
      // batch for exactly that reason). A report that records no hash for a file cannot prove the
      // bytes, so it refuses — fail closed, never pass.
      const reportedByName = new Map((verification.files ?? []).map((f) => [f.filename, f]));
      const unhashed = known.filter((name) => {
        const reported = reportedByName.get(name);
        return !reported || typeof reported.sha256 !== 'string' || !reported.sha256;
      });
      if (unhashed.length) {
        problems.push(
          `the verification report records no content hash for ${unhashed.join(', ')}, so the bytes on disk ` +
            'cannot be shown to be the bytes that were verified. Re-run verify:baseline with tooling that records hashes.',
        );
      }
      const changed = known.filter((name) => {
        const reported = reportedByName.get(name);
        return reported?.sha256 && reported.sha256 !== byName.get(name).sha256;
      });
      if (changed.length) {
        problems.push(
          `file(s) changed after the verification report was produced: ${changed.join(', ')}. ` +
            'The report describes bytes that are no longer on disk.',
        );
      }
    }
  }

  // ── 4. The backup exists, is production's, and is the one that was restore-verified, recently ─
  if (!isObject(backupManifest)) {
    problems.push(
      'no backup manifest given (`--backup <artifact>.manifest.json`). Every destructive or ' +
        'schema-changing step against production starts from a backup taken immediately before it.',
    );
  } else {
    context.backup = {
      artifact: backupManifest.artifact ?? null,
      environment: backupManifest.environment ?? null,
      generatedAt: backupManifest.generatedAt ?? null,
      sha256: backupManifest.sha256 ?? null,
      clusterId: backupManifest.identity?.clusterId ?? null,
    };
    if (backupManifest.environment !== 'production') {
      problems.push(`the backup manifest is for ${JSON.stringify(backupManifest.environment ?? null)}, not production.`);
    }
    if (!backupManifest.sha256) problems.push('the backup manifest records no sha256, so the artifact it describes cannot be identified.');
    const generatedAt = Date.parse(String(backupManifest.generatedAt ?? ''));
    if (!Number.isFinite(generatedAt)) {
      problems.push('the backup manifest carries no readable generatedAt, so its age cannot be established.');
    } else {
      const age = minutesBetween(generatedAt, now);
      context.backupAgeMinutes = Number(age.toFixed(2));
      if (age < 0) problems.push('the backup manifest is dated in the future.');
      else if (age > windowMinutes) {
        problems.push(
          `the backup is ${age.toFixed(0)} minutes old (limit ${windowMinutes}). Take a fresh one: ` +
            'the point of the precondition is that the undo exists from immediately before.',
        );
      }
    }
  }

  // ── 5. That backup was actually restored into a throwaway database, and passed ───────────────
  if (!isObject(restoreReport)) {
    problems.push(
      'no restore-verification report given (`--restored <report.json>`). A backup that has never been ' +
        'restored is not a backup, and this is the check that makes the difference.',
    );
  } else {
    const verdict = restoreReport.verdict ?? {};
    const failedChecks = Object.entries(verdict).filter(([, ok]) => ok !== true).map(([name]) => name);
    context.restore = {
      artifact: restoreReport.artifact ?? null,
      sha256: restoreReport.manifest?.sha256 ?? null,
      verdict: verdict,
    };
    if (!Object.keys(verdict).length) {
      problems.push('the restore-verification report carries no verdict, so it passes nothing.');
    }
    if (failedChecks.length) problems.push(`the restore verification did not pass: ${failedChecks.join(', ')}.`);
    if ((restoreReport.failures ?? []).length) {
      problems.push(`the restore verification recorded ${restoreReport.failures.length} failure(s).`);
    }
    const restoredSha = restoreReport.manifest?.sha256 ?? null;
    if (!restoredSha) {
      problems.push('the restore-verification report names no artifact sha256, so it cannot be tied to the backup being applied behind.');
    } else if (isObject(backupManifest) && backupManifest.sha256 && restoredSha !== backupManifest.sha256) {
      problems.push(
        'the restored artifact is not the backup named here ' +
          `(restored ${String(restoredSha).slice(0, 12)}…, backup ${String(backupManifest.sha256).slice(0, 12)}…). ` +
          'A verified backup of something else is not this backup verified.',
      );
    }
    if (restoreReportMtimeMs != null) {
      const age = minutesBetween(restoreReportMtimeMs, now);
      context.restoreAgeMinutes = Number(age.toFixed(2));
      if (age < 0) problems.push('the restore-verification report is dated in the future.');
      else if (age > windowMinutes) {
        problems.push(`the restore-verification report is ${age.toFixed(0)} minutes old (limit ${windowMinutes}).`);
      }
    }
  }

  // ── 6. Partition the batch against the ledger: apply what is new, skip only what matches ─────
  // The ledger is read over a connection, and the gate runs twice: once before that (so a bad batch
  // never reaches production at all) and once after, with the real rows. `null` means "not read yet",
  // which is why the partition is skipped rather than guessed.
  if (!Array.isArray(ledgerRows)) {
    context.ledger = 'not read yet — the partition is re-checked once the ledger is available';
    context.toApply = known.map((name) => `${byName.get(name).version} ${name}`);
    context.alreadyRecorded = [];
    return { ok: problems.length === 0, problems, toApply: known.map((name) => byName.get(name)), alreadyRecorded: [], context };
  }

  const ledgerByVersion = new Map(ledgerRows.map((r) => [String(r.version), r]));
  const toApply = [];
  const alreadyRecorded = [];
  for (const name of known) {
    const entry = byName.get(name);
    const row = ledgerByVersion.get(entry.version);
    if (!row) {
      toApply.push(entry);
      continue;
    }
    if (row.sha256 && row.sha256 !== entry.sha256) {
      problems.push(
        `${entry.filename} is already recorded with a different hash (recorded ${String(row.sha256).slice(0, 12)}…, ` +
          `on disk ${entry.sha256.slice(0, 12)}…). An applied file is never edited into a different meaning — ` +
          'write the change as a new migration.',
      );
      continue;
    }
    if (!row.sha256) {
      problems.push(
        `${entry.version} is recorded in the ledger without a hash, so "already applied" cannot be shown to be ` +
          'the same file. Resolve the record before applying the batch.',
      );
      continue;
    }
    alreadyRecorded.push({ version: entry.version, filename: entry.filename });
  }

  context.toApply = toApply.map((e) => `${e.version} ${e.filename}`);
  context.alreadyRecorded = alreadyRecorded.map((e) => e.filename);

  return { ok: problems.length === 0, problems, toApply, alreadyRecorded, context };
}

/** Render a gate result and the context behind it, so a refusal is legible without the source. */
export function describeGate(result, { log = console.log } = {}) {
  const c = result.context ?? {};
  log(`\n  Gate — production batch "${c.batch?.length ? c.batch.join(', ') : '(none)'}"`);
  if (c.verification) {
    log(
      `    verification:  ${c.verification.status} · baseline ${c.verification.environment}` +
        ` · sha256 ${c.verification.sha256Verified ? 'verified' : 'NOT verified'}` +
        (c.verificationAgeMinutes != null ? ` · ${c.verificationAgeMinutes} min old` : ''),
    );
  }
  if (c.backup) {
    log(
      `    backup:        ${c.backup.artifact ?? '(unnamed)'}` +
        (c.backupAgeMinutes != null ? ` · ${c.backupAgeMinutes} min old` : ''),
    );
  }
  if (c.restore) {
    const failed = Object.entries(c.restore.verdict ?? {}).filter(([, ok]) => ok !== true).length;
    log(`    restore:       ${failed ? `${failed} check(s) FAILED` : 'all checks PASS'}`);
  }
  log(`    to apply:      ${(c.toApply ?? []).join(', ') || '(nothing new)'}`);
  if ((c.alreadyRecorded ?? []).length) log(`    already recorded (skipped): ${c.alreadyRecorded.join(', ')}`);
  for (const problem of result.problems) log(`    ✗ ${problem}`);
  return result.ok;
}
