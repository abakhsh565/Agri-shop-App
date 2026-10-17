/**
 * data-rehearsal.mjs — run a batch, look at what it did to the rows, then undo it.
 *
 * This is the guarantee the production apply needs and the pure batch gate cannot give: the gate
 * checks files, this checks *rows*. The batch is applied inside a transaction that is always rolled
 * back, the protected tables are fingerprinted on both sides of it, and the caller refuses on
 * anything that moved without being named.
 *
 * Why not just apply and then check? Because "then" is too late: a balance already rewritten is a
 * customer-visible fact, and no ledger row makes it right. Here the write never commits.
 *
 * The function takes its database and its file reader as arguments so the same code is exercised by
 * the CLI against production, by the local-stack probe against real Postgres, and by a fake target in
 * the unit suite — there is no second implementation to drift.
 */
import { diffFingerprints, fingerprintDatabase } from './data-fingerprint.mjs';

/**
 * @param {object} input
 * @param {{ exec(sql: string): Promise<unknown>, query(sql: string, params?: unknown[]): Promise<{rows: any[]}> }} input.target
 * @param {Array<{version: string, filename: string}>} input.entries
 * @param {(entry: object) => string} input.readFile
 * @param {string[]} [input.approvedTables]
 * @param {typeof fingerprintDatabase} [input.fingerprint]
 * @param {typeof diffFingerprints} [input.diff]
 */
export async function rehearseBatchData({
  target,
  entries,
  readFile,
  approvedTables = [],
  fingerprint = fingerprintDatabase,
  diff = diffFingerprints,
}) {
  const query = (sql, params = []) => target.query(sql, params);
  let before = null;
  let after = null;
  let error = null;
  let comparison = null;

  await target.exec('begin');
  try {
    before = await fingerprint(query);
    for (const entry of entries) await target.exec(readFile(entry));
    after = await fingerprint(query, { previous: before });
    comparison = diff(before, after, approvedTables);
  } catch (caught) {
    error = caught.message.split('\n')[0];
  } finally {
    try {
      await target.exec('rollback');
    } catch {
      /* the rehearsal transaction is gone; the original error is the one that matters */
    }
  }

  return { before, after, diff: comparison, error, approvedTables };
}
