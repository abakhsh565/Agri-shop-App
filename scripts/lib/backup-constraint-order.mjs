/**
 * backup-constraint-order.mjs — the order in which a canonical backup may re-add constraints.
 *
 * THE DEFECT THIS EXISTS FOR (measured 2026-11-13 and 2026-11-14, production backup runs 78 and 79):
 *
 * The backup wrote every non-primary constraint in one pass sorted by table name:
 *
 *     co_owner_authority_catalog ... FOREIGN KEY (permission_code) REFERENCES permissions(code)
 *     dashboard_widgets          ... FOREIGN KEY (default_permission) REFERENCES permissions(code)
 *     ...
 *     permissions                ... UNIQUE (code)          <-- needed by BOTH foreign keys above
 *
 * `co_owner_authority_catalog` and `dashboard_widgets` sort before `permissions`, so both foreign keys
 * were added while `permissions.code` had no unique constraint yet. Postgres rejects that with
 * SQLSTATE 42830 (`invalid_foreign_key`), the writer's `exception when duplicate_object then null`
 * did not catch it, and the restore continued without the two constraints. The backup looked
 * successful; only the restore VERIFIER noticed, as `structure: missing 2`.
 *
 * A backup that silently drops constraints is not a backup. So:
 *
 *   1. UNIQUE and CHECK constraints are added first — a foreign key needs its referenced pair to
 *      exist already, and those pairs are exactly what UNIQUE constraints create.
 *   2. FOREIGN KEY constraints are added after them.
 *   3. A failure is no longer swallowed: every statement raises a WARNING naming the constraint, so
 *      the next unexpected cause is visible in the restore log instead of only in the diff report.
 *
 * The order is computed here, in one place, so it can be proven by a unit guard without a database.
 */

/** @typedef {{ tbl: string, conname: string, def: string }} ConstraintRow */

function normaliseTable(tbl) {
  return String(tbl ?? "").replace(/^public\./, "");
}

/** Postgres renders foreign keys as `FOREIGN KEY (...) REFERENCES ...`. */
export function isForeignKey(row) {
  return /^\s*FOREIGN\s+KEY\b/i.test(String(row?.def ?? ""));
}

/**
 * Split the constraint rows into the two passes a logical restore needs.
 * Order inside each pass is preserved, so the output stays deterministic.
 *
 * @param {ConstraintRow[]} rows
 * @returns {{ structural: ConstraintRow[], foreignKeys: ConstraintRow[] }}
 */
export function splitConstraintPasses(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    structural: list.filter((row) => !isForeignKey(row)),
    foreignKeys: list.filter((row) => isForeignKey(row)),
  };
}

/** Every constraint, in the only order that can always be restored. */
export function orderConstraintRows(rows) {
  const { structural, foreignKeys } = splitConstraintPasses(rows);
  return [...structural, ...foreignKeys];
}

/**
 * One idempotent statement per constraint.
 *
 * `duplicate_object` stays silent (re-running a backup replay onto a database that already has the
 * constraint is not a failure), but every OTHER error is raised as a WARNING that names the
 * constraint — the reader of a restore log must never have to guess which one went missing.
 */
export function constraintStatement(row) {
  const table = normaliseTable(row.tbl);
  const name = String(row.conname);
  const def = String(row.def);
  return (
    `do $$ begin alter table public."${table.replace(/"/g, '""')}" ` +
    `add constraint "${name.replace(/"/g, '""')}" ${def}; ` +
    `exception when duplicate_object then null; ` +
    `when others then raise warning 'BACKUP CONSTRAINT NOT RESTORED: ${table}.${name}: %', sqlerrm; end $$;`
  );
}

/** The full restore section, as a list of lines, for the writer to emit verbatim. */
export function constraintSection(rows) {
  const { structural, foreignKeys } = splitConstraintPasses(rows);
  const lines = [];
  lines.push("-- ─── Uniques and checks (a foreign key needs the pair they create) ───");
  for (const row of structural) lines.push(constraintStatement(row));
  lines.push("-- ─── Foreign keys (only now, so every referenced pair exists) ───");
  for (const row of foreignKeys) lines.push(constraintStatement(row));
  return { lines, structural, foreignKeys };
}
