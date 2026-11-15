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
 * WHY VOLATILE COLUMNS CAN BE NAMED (`--volatile-columns`)
 *   Some backfills write values that cannot be predicted twice: `0286` fills `users.agri_id` with
 *   `generate_agri_id()`, which draws from `random()`, and a column defaulted by `now()` is different
 *   in a rehearsal and in the committed apply by construction. The rehearsal and the apply then
 *   disagree on the digest while the rows are exactly as intended, and the gate reports a data
 *   integrity alarm that is really an unpredictable value. A volatile column is therefore declared by
 *   the operator, excluded from the digest on BOTH sides, and recorded in the report — the restore
 *   only covers what can be compared twice, and everything else stays strict.
 *
 * WHY THE PRIMARY-KEY SET IS COMPARED AS WELL
 *   Excluding a column must never become a way to hide rows moving. The digest is taken over the
 *   remaining columns, so an UPDATE is still visible; but the cheapest way to defeat a digest is to
 *   remove one row and add another with the same content. The key set is compared separately, so a
 *   swap, a delete or an insert is visible even when the digest of the rest happens to agree.
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
 * The columns a digest may cover: the before-side list minus the declared volatile ones.
 *
 * Excluding every column would leave nothing to compare, which is a silent pass — so it is refused
 * here rather than discovered as a green run that measured nothing.
 */
export function hashableColumns(columns, excluded = []) {
  const drop = new Set((excluded ?? []).map((c) => String(c)));
  const kept = columns.filter((column) => !drop.has(column));
  if (!kept.length) {
    throw new Error(
      `every column of this table would be excluded from the digest (${columns.join(', ')}); ` +
        'a fingerprint with no columns proves nothing.',
    );
  }
  return kept;
}

/** The digest query for a table, over exactly the columns it was given. */
export function digestQueryFor(qualified, columns) {
  const projection = columns.map(quote).join(', ');
  return (
    `select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by row_to_json(s)::text), '')) as h` +
    ` from (select ${projection} from ${qualified}) s`
  );
}

/** The primary-key members of a table, in key order. */
async function primaryKeyColumns(query, parsed) {
  const keys = await query(
    `select a.attname as name
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
      where n.nspname = $1 and c.relname = $2 and i.indisprimary
      order by array_position(i.indkey, a.attnum)`,
    [parsed.schema, parsed.table],
  );
  return keys.rows.map((row) => row.name).filter((name) => typeof name === 'string' && name);
}

/**
 * Fingerprint one table.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<{rows: any[]}>} query
 * @param {string} spec                     `schema.table`
 * @param {string[]|null} onlyColumns       the before-side column list, when fingerprinting "after"
 * @param {{excludeColumns?: string[]}} options
 * @returns {Promise<{table: string, count: number|null, columns: string[], excluded: string[],
 *   hashColumns: string[], primaryKey: string[], digest: string|null, keyDigest: string|null}>}
 */
export async function fingerprintTable(query, spec, onlyColumns = null, { excludeColumns = [] } = {}) {
  const parsed = parseTable(spec);
  if (!parsed) throw new Error(`not a table name: ${spec}`);
  const qualified = `${quote(parsed.schema)}.${quote(parsed.table)}`;

  const exists = await query(`select to_regclass($1) is not null as present`, [`${parsed.schema}.${parsed.table}`]);
  if (!exists.rows[0]?.present) {
    return {
      table: spec,
      count: null,
      columns: [],
      excluded: [],
      hashColumns: [],
      primaryKey: [],
      digest: null,
      keyDigest: null,
    };
  }

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

  const excluded = (excludeColumns ?? []).filter((column) => columns.includes(column));
  const hashColumns = hashableColumns(columns, excluded);
  const counted = await query(`select count(*)::bigint as n from ${qualified}`);
  const count = Number(counted.rows[0]?.n ?? 0);
  const primaryKey = await primaryKeyColumns(query, parsed);

  const hashed = await query(digestQueryFor(qualified, hashColumns));
  const keyDigest = primaryKey.length
    ? (
        await query(
          `select md5(coalesce(string_agg(k::text, '|' order by k::text), '')) as h
             from (select ${primaryKey.map(quote).join(', ')} from ${qualified}) k`,
        )
      ).rows[0]?.h ?? null
    : null;

  return {
    table: spec,
    count,
    columns,
    excluded,
    hashColumns,
    primaryKey,
    digest: hashed.rows[0]?.h ?? null,
    keyDigest,
  };
}

/**
 * Fingerprint several tables in one pass. `previous` is the before-side result; when it is given, the
 * after-side digest is computed over the before-side columns (and the before-side exclusions) so an
 * additive DDL stays invisible and a declared volatile column is excluded on both sides alike.
 */
export async function fingerprintDatabase(
  query,
  { tables = PROTECTED_TABLES, previous = null, excludeByTable = {} } = {},
) {
  const out = {};
  for (const spec of tables) {
    const before = previous?.[spec] ?? previous?.[normaliseTable(spec)] ?? null;
    const declared = excludeByTable[spec] ?? excludeByTable[normaliseTable(spec)] ?? [];
    const excludeColumns = [...new Set([...(before?.excluded ?? []), ...declared])];
    out[spec] = await fingerprintTable(query, spec, before?.columns ?? null, { excludeColumns });
  }
  return out;
}

/**
 * Compare two fingerprints.
 *
 * A table that gained or lost rows, whose key set moved, or whose rows changed, is `changed`. A table
 * present before and absent after is `missing` (never benign). A named approval lets one table change
 * and records it. Everything else is `unexpected` — and that is the list the caller refuses on.
 */
export function diffFingerprints(before, after, approvedTables = []) {
  const approved = new Set(approvedTables.map(normaliseTable));
  const changed = [];
  const missing = [];
  const unexpected = [];
  const allowedChanges = [];
  const appeared = [];
  const reasons = [];

  for (const [table, was] of Object.entries(before ?? {})) {
    const now = after?.[table];
    if (!now || now.count === null) {
      if (was.count !== null) {
        missing.push(table);
        unexpected.push(table);
        reasons.push({ table, reason: 'missing' });
      }
      continue;
    }
    if (was.count === null) {
      appeared.push(table);
      continue;
    }
    const countMoved = Number(was.count) !== Number(now.count);
    const keyMoved = Boolean(was.keyDigest && now.keyDigest && was.keyDigest !== now.keyDigest);
    const digestMoved = was.digest !== now.digest;
    if (!countMoved && !keyMoved && !digestMoved) continue;

    changed.push(table);
    reasons.push({
      table,
      reason: countMoved ? 'row-count' : keyMoved ? 'key-set' : 'row-content',
      before: was.count,
      after: now.count,
    });
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
    reasons,
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
    const keyMoved = Boolean(was.keyDigest && now?.keyDigest && was.keyDigest !== now.keyDigest);
    const same =
      now && Number(now.count) === Number(was.count) && !keyMoved && now.digest === was.digest;
    const note = same
      ? ''
      : keyMoved
        ? ' (key set changed)'
        : ` (digest ${String(was.digest).slice(0, 8)} → ${String(now?.digest).slice(0, 8)})`;
    lines.push(`${same ? '=' : '≠'} ${table}: ${was.count} → ${nowCount}${note}`);
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

/**
 * Parse `--volatile-columns public.users.agri_id,public.memberships.updated_at`.
 *
 * The table must be one this tool protects (a typo must not silently exclude a column on a table the
 * gate is watching), and the shape must name a column — a table without a column is refused rather
 * than read as "exclude everything".
 */
export function parseVolatileColumns(value) {
  const specs = String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = [];
  const excludeByTable = {};
  for (const spec of specs) {
    const match = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(spec);
    if (!match) {
      unknown.push(spec);
      continue;
    }
    const table = `${match[1]}.${match[2]}`;
    if (!PROTECTED_TABLES.includes(table)) {
      unknown.push(spec);
      continue;
    }
    (excludeByTable[table] ??= []).push(match[3]);
  }
  return { excludeByTable, unknown };
}
