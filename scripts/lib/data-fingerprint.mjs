/**
 * data-fingerprint.mjs — what a database holds, as one comparable number per table.
 *
 * WHY THIS EXISTS
 *   The production batch gate checks that the *files* are the verified files. It cannot see what those
 *   files do to *rows*. A migration that quietly updated a balance, deleted an orphaned sale or
 *   rewrote a customer would pass every hash and every SQL check, and the only thing that would notice
 *   is a customer. So the data gets its own fingerprint: a count and a digest of every row, taken
 *   before a batch and after it, and compared before anything is committed.
 *
 * WHY THE COLUMN LIST IS CAPTURED FROM THE "BEFORE" SIDE
 *   An additive migration (a new nullable column, a new column with a default) changes the text of
 *   `row_to_json` for every row without changing any user's data. Hashing the whole row would then
 *   cry wolf on every safe schema change. The digest is therefore computed over the columns that
 *   existed *before* the batch, in their original order, for both sides — so a new column is
 *   invisible, while an UPDATE, a DELETE or an INSERT is not.
 *
 * WHAT IT COVERS
 *   Accounts, memberships, customers, catalogues, stock, every transactional table, the derived
 *   columns those transactions update (`outstanding_balance`, `total_purchases`, `total_paid`,
 *   `stock_qty`, `outstanding_payable`), the configuration a shop depends on, and `storage.objects`
 *   — because an image is data too, and the object table is the only place an upload leaves a trace.
 *
 * WHAT IT IS NOT
 *   It is not a backup and it is not a checksum of the schema. Two different rows can share a digest
 *   only through a md5 collision; the count is carried separately so a swap of rows is visible even
 *   then. It is read-only: the CLI opens `BEGIN … READ ONLY` and the library never writes.
 */

/** Every table whose rows belong to a user or a shop, not to a migration. */
export const PROTECTED_TABLES = [
  'public.users',
  'public.shops',
  'public.branches',
  'public.memberships',
  'public.roles',
  'public.permissions',
  'public.role_permissions',
  'public.user_permissions',
  'public.customers',
  'public.customer_crops',
  'public.products',
  'public.product_variants',
  'public.companies',
  'public.sales',
  'public.sale_items',
  'public.returns',
  'public.return_items',
  'public.voids',
  'public.purchases',
  'public.purchase_items',
  'public.customer_payments',
  'public.supplier_payments',
  'public.inventory_movements',
  'public.stock_adjustments',
  'public.notifications',
  'public.audit_events',
  'public.sale_submissions',
  'public.shop_requests',
  'public.business_settings',
  'public.reminder_configs',
  'public.app_settings',
  'storage.objects',
];

/** A table name is used in SQL, so it must be exactly `schema.table` with identifier characters. */
export function parseTable(spec) {
  const match = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(String(spec ?? '').trim());
  if (!match) return null;
  return { schema: match[1], table: match[2] };
}

/** `public.customers` and `customers` both name the same table. */
export function normaliseTable(spec) {
  const raw = String(spec ?? '').trim();
  return raw.includes('.') ? raw : `public.${raw}`;
}

const quote = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Fingerprint one table.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<{rows: any[]}>} query
 * @param {string} spec                     `schema.table`
 * @param {string[]|null} onlyColumns       the before-side column list, when fingerprinting "after"
 * @returns {Promise<{table: string, count: number|null, columns: string[], digest: string|null}>}
 */
export async function fingerprintTable(query, spec, onlyColumns = null) {
  const parsed = parseTable(spec);
  if (!parsed) throw new Error(`not a table name: ${spec}`);
  const qualified = `${quote(parsed.schema)}.${quote(parsed.table)}`;

  const exists = await query(`select to_regclass($1) is not null as present`, [`${parsed.schema}.${parsed.table}`]);
  if (!exists.rows[0]?.present) return { table: spec, count: null, columns: [], digest: null };

  let columns = onlyColumns;
  if (!columns) {
    columns = (
      await query(
        `select column_name from information_schema.columns
          where table_schema = $1 and table_name = $2
          order by ordinal_position`,
        [parsed.schema, parsed.table],
      )
    ).rows.map((row) => row.column_name);
  }

  const counted = await query(`select count(*)::bigint as n from ${qualified}`);
  const count = Number(counted.rows[0]?.n ?? 0);

  if (!columns.length) return { table: spec, count, columns, digest: '' };

  const projection = columns.map(quote).join(', ');
  const hashed = await query(
    `select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by row_to_json(s)::text), '')) as h
       from (select ${projection} from ${qualified}) s`,
  );
  return { table: spec, count, columns, digest: hashed.rows[0]?.h ?? null };
}

/**
 * Fingerprint several tables in one pass. `previous` is the before-side result; when it is given, the
 * after-side digest is computed over the before-side columns so additive DDL stays invisible.
 */
export async function fingerprintDatabase(query, { tables = PROTECTED_TABLES, previous = null } = {}) {
  const out = {};
  for (const spec of tables) {
    const before = previous?.[spec] ?? previous?.[normaliseTable(spec)] ?? null;
    out[spec] = await fingerprintTable(query, spec, before?.columns ?? null);
  }
  return out;
}

/**
 * Compare two fingerprints.
 *
 * A table that gained or lost rows, or whose rows changed, is `changed`. A table present before and
 * absent after is `missing` (never benign). A named approval lets one table change and records it.
 * Everything else is `unexpected` — and that is the list the caller refuses on.
 */
export function diffFingerprints(before, after, approvedTables = []) {
  const approved = new Set(approvedTables.map(normaliseTable));
  const changed = [];
  const missing = [];
  const unexpected = [];
  const allowedChanges = [];
  const appeared = [];

  for (const [table, was] of Object.entries(before ?? {})) {
    const now = after?.[table];
    if (!now || now.count === null) {
      if (was.count !== null) {
        missing.push(table);
        unexpected.push(table);
      }
      continue;
    }
    if (was.count === null) {
      appeared.push(table);
      continue;
    }
    const differs = Number(was.count) !== Number(now.count) || was.digest !== now.digest;
    if (!differs) continue;
    changed.push(table);
    if (approved.has(table)) allowedChanges.push(table);
    else unexpected.push(table);
  }

  // A table that did not exist before is a creation, not a data change — but it is still recorded,
  // because "this batch added a table" is a fact the report should carry rather than hide.
  for (const table of Object.keys(after ?? {})) {
    if (!(table in (before ?? {}))) appeared.push(table);
  }

  return {
    changed,
    missing,
    appeared,
    allowedChanges,
    unexpected,
    ok: unexpected.length === 0,
  };
}

/** A one-line-per-table rendering, for the refusal message and the evidence report. */
export function describeFingerprints(before, after) {
  const lines = [];
  for (const [table, was] of Object.entries(before ?? {})) {
    const now = after?.[table];
    if (was.count === null) continue;
    const nowCount = now?.count ?? 'gone';
    const same = now && Number(now.count) === Number(was.count) && now.digest === was.digest;
    lines.push(
      `${same ? '=' : '≠'} ${table}: ${was.count} → ${nowCount}` +
        `${same ? '' : ` (digest ${String(was.digest).slice(0, 8)} → ${String(now?.digest).slice(0, 8)})`}`,
    );
  }
  return lines.join('\n');
}

/** Parse `--data-change customers,public.sales` into a canonical, de-duplicated list. */
export function parseApprovals(value) {
  const names = String(value ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map(normaliseTable);
  const unknown = names.filter((n) => !PROTECTED_TABLES.includes(n));
  if (unknown.length) return { names: [], unknown };
  return { names: [...new Set(names)], unknown: [] };
}
