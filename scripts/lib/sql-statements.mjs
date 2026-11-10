/**
 * sql-statements.mjs — split a migration file into its statements.
 *
 * WHY THIS EXISTS
 *   `supabase_migrations.schema_migrations.statements` is a `text[]`, one element per statement,
 *   and it is what the Supabase CLI writes for every file it applies. A ledger written by this
 *   repository has to be shippable to that table, so the file has to be split the way Postgres
 *   reads it: dollar-quoted plpgsql bodies full of semicolons, single-quoted strings, double-quoted
 *   identifiers and comments must not split a statement that Postgres considers one.
 *
 * WHY IT IS A COPY
 *   `scripts/restore-verify.mjs` already carries this algorithm privately, and it is accepted
 *   Phase 2A tooling: verified working, reviewed, and not to be touched while the restore path has
 *   no covering test of its own. Rather than edit it, the algorithm is copied here (it is a pure
 *   text function with no dependencies) and the two copies are kept honest by the ledger unit test,
 *   which splits a corpus that includes dollar-quoted bodies, escaped quotes and comments.
 *
 * The splitter is deliberately literal: it returns statement text with comments stripped only when
 * they are the line's whole content (a leading `--` comment stays attached to nothing, because a
 * comment is not a statement). `-- @phase:` markers are not interpreted here; nothing in this file
 * knows about the backup artifact's structure. `splitStatementsWithOffsets` additionally returns
 * each statement's start offset, which is the only way a caller can link a statement to a marker.
 *
 * TWO pg_dump SHAPES IT ALSO HANDLES (added 2026-11-10, Option A baseline fix)
 *   * `COPY ... FROM stdin` blocks: pg_dump writes rows as raw lines after the COPY header, up to
 *     a line that is exactly `\.`. Those rows are data, not SQL — quotes, semicolons and dollar
 *     tags inside them would corrupt the state machine for the rest of the file (measured
 *     2026-11-09: a pg_dump baseline split into 1149 statements with only 1 recognised as data,
 *     124 SQL failures, most of them fragments of data rows). So a COPY header and its data up to
 *     the `\.` terminator are ONE statement, which `isDataStatement` (leading `copy`) then
 *     counts and the baseline loader skips. `restore-verify.mjs` keeps its own private copy of
 *     this splitter WITHOUT these two shapes: it loads `backup-database.mjs` output (INSERT rows,
 *     no COPY, no psql meta-commands), so it needs neither — the copies diverge here, by design.
 *   * psql meta-command lines (`\restrict`, `\unrestrict`, ...): directives for psql, not SQL.
 *     A pg_dump starts with `\restrict` and ends with `\unrestrict`; between statements such a
 *     line is skipped to end-of-line, so it cannot glue onto the next statement (the first line
 *     has no `;`, so without this it merged into `SET statement_timeout = 0` and failed as
 *     syntax). Only lines between statements are skipped — a `\` inside an accumulated statement
 *     is left alone, so a real syntax error still fails.
 */

/**
 * @param {string} text
 * @returns {string[]} one entry per statement, in file order, trimmed, empty entries dropped
 */
export function splitStatements(text) {
  return splitStatementsWithOffsets(text).map((entry) => entry.text);
}

/**
 * The same split, with each statement's starting offset in the original text.
 *
 * The backup artifacts carry `-- @phase:` section markers, and a statement can only be attributed
 * to a marker by position (the comments are stripped out of the statement text).
 * `scripts/restore-verify.mjs` keeps this offset-tracking privately for the same reason; the
 * algorithm lives here so there is one implementation, and `splitStatements` above is now a view of
 * it — identical output, plus an offset that cannot drift out of sync.
 *
 * @param {string} text
 * @returns {{ text: string, offset: number }[]}
 */
export function splitStatementsWithOffsets(text) {
  const out = [];
  let buf = '';
  let i = 0;
  let state = 'normal';
  let dollarTag = '';
  let stmtStart = -1;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === 'line-comment') {
      if (ch === '\n') {
        state = 'normal';
        buf += ch;
      }
      i++;
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        i += 2;
        state = 'normal';
        continue;
      }
      i++;
      continue;
    }
    if (state === 'single') {
      buf += ch;
      if (ch === "'") {
        if (next === "'") {
          buf += next;
          i += 2;
          continue;
        }
        state = 'normal';
      }
      i++;
      continue;
    }
    if (state === 'double') {
      buf += ch;
      if (ch === '"') {
        if (next === '"') {
          buf += next;
          i += 2;
          continue;
        }
        state = 'normal';
      }
      i++;
      continue;
    }
    if (state === 'dollar') {
      if (text.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        state = 'normal';
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (state === 'copy-data') {
      // Raw COPY rows: no state transitions inside them — a quote, a semicolon or a
      // dollar tag in the data must not flip the machine. Only a line that is exactly
      // `\.` ends the block (pg_dump escapes a literal backslash as `\\`, so a data
      // line can never be exactly `\.` unless it is the terminator).
      if (ch === '\n') {
        const term = text.slice(i + 1).match(/^\\\.(?:\r?\n|$)/);
        if (term) {
          buf += '\n\\.\n';
          if (buf.trim()) out.push({ text: buf.trim(), offset: stmtStart });
          buf = '';
          stmtStart = -1;
          state = 'normal';
          i += 1 + term[0].length;
          continue;
        }
      }
      buf += ch;
      i++;
      continue;
    }

    // psql meta-command lines (`\restrict`, `\unrestrict`, ...). Only between statements:
    // buf holds nothing but whitespace and nothing but whitespace precedes us on this line.
    // Inside an accumulated statement a `\` is left alone — a real syntax error there
    // still fails.
    if (ch === '\\' && !buf.trim() && /^\s*$/.test(text.slice(text.lastIndexOf('\n', i - 1) + 1, i))) {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '-' && next === '-') {
      state = 'line-comment';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block-comment';
      i += 2;
      continue;
    }
    // Comments are dropped above, so the first non-whitespace character that is not a comment is
    // where the statement begins. Recorded for phase attribution only.
    if (stmtStart === -1 && !/\s/.test(ch)) stmtStart = i;
    if (ch === "'") {
      state = 'single';
      buf += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      state = 'double';
      buf += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const match = text.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) {
        dollarTag = match[0];
        state = 'dollar';
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ';') {
      if (buf.trim()) {
        const header = buf.trim();
        // A COPY ... FROM stdin header is followed by raw data rows up to `\.`: keep the
        // header in the buffer and read the rows as part of the same statement (see the
        // `copy-data` state above). Every other statement ends here.
        if (/^copy\b/i.test(header) && /\bfrom\s+stdin\b/i.test(header)) {
          buf += ';';
          state = 'copy-data';
          i++;
          continue;
        }
        out.push({ text: header, offset: stmtStart });
      }
      buf = '';
      stmtStart = -1;
      i++;
      continue;
    }
    buf += ch;
    i++;
  }

  if (buf.trim()) out.push({ text: buf.trim(), offset: stmtStart });
  return out;
}

/**
 * Convert one `COPY ... FROM stdin` data statement into the equivalent multi-row INSERT.
 *
 * WHY THIS EXISTS (Option B, batch 1)
 *   PGlite cannot execute `COPY ... FROM stdin` (the copy protocol has no stdin channel in
 *   `exec`), so a COPY block that must actually load — the reference rows a later migration's
 *   foreign keys point at — has to be rewritten as INSERTs. The conversion is exact for the
 *   COPY text format pg_dump emits: tab-separated fields, `\N` for NULL, backslash escapes
 *   (`\\`, `\t`, `\n`, `\r`, `\b`, `\f`, `\v`), and a line that is exactly `\.` as the
 *   terminator. Values are emitted as quoted literals and coerce to the column types on
 *   INSERT (uuid, timestamptz, boolean `t`/`f`, enum text, text[] `{...}`), so no per-type
 *   logic lives here. An unknown escape is kept verbatim (backslash + char) rather than
 *   guessed at: silently changing a value would be worse than the INSERT failing loudly.
 *
 * Returns `{ table, columns, rows, insert }` — `table` is the schema-qualified name as
 * written (normalised to `schema.table`, schema defaulting to `public`), `columns` the
 * column list, `rows` the unescaped values (`null` for `\N`), and `insert` the multi-row
 * INSERT string, or `null` when the block carries no rows. Returns `null` when the
 * statement is not a `COPY ... FROM stdin` block at all (including `COPY ... TO stdout`).
 * Throws when the input IS such a block but is malformed — wrong arity, or no `\.`
 * terminator — because a reference table that loads partially would make FK validation
 * wrong in the silent direction. The caller refuses on that throw, never guesses.
 *
 * @param {string} statement one statement as split by splitStatementsWithOffsets
 * @returns {{ table: string, columns: string[], rows: Array<Array<string|null>>, insert: string|null } | null}
 */
export function copyDataToInsert(statement) {
  const text = String(statement);
  const lines = text.split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const header = lines[0]?.trim() ?? '';
  const headerMatch = header.match(
    /^copy\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)\s*\(([^)]*)\)\s+from\s+stdin\s*;?$/i,
  );
  if (!headerMatch) return null;
  if (lines.length < 2 || lines[lines.length - 1].trim() !== '\\.') {
    throw new Error(`COPY block for ${headerMatch[1]} has no \\. terminator; refusing to load partial reference data.`);
  }
  const table = normalizeTableName(headerMatch[1]);
  const columns = headerMatch[2]
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
  const rows = [];
  for (const line of lines.slice(1, -1)) {
    if (line === '') continue;
    const fields = line.split('\t').map(unescapeCopyField);
    if (fields.length !== columns.length) {
      throw new Error(
        `COPY block for ${table} has a row with ${fields.length} fields for ${columns.length} columns; refusing to load partial reference data.`,
      );
    }
    rows.push(fields);
  }
  if (!rows.length) return { table, columns, rows, insert: null };
  const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;
  const literal = (value) => (value === null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
  const qualified = table
    .split('.')
    .map(quoteIdent)
    .join('.');
  const insert =
    `INSERT INTO ${qualified} (${columns.map(quoteIdent).join(', ')}) VALUES ` +
    rows.map((row) => `(${row.map(literal).join(', ')})`).join(', ');
  return { table, columns, rows, insert };
}

/** A COPY text-format field: `\N` is NULL, backslash escapes are undone. */
function unescapeCopyField(field) {
  if (field === '\\N') return null;
  let out = '';
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = field[i + 1];
    switch (next) {
      case 'b': out += '\b'; i++; break;
      case 'f': out += '\f'; i++; break;
      case 'n': out += '\n'; i++; break;
      case 'r': out += '\r'; i++; break;
      case 't': out += '\t'; i++; break;
      case 'v': out += '\v'; i++; break;
      case '\\': out += '\\'; i++; break;
      default: out += ch; break;
    }
  }
  return out;
}

/** `permissions` → `public.permissions`; `"public"."permissions"` → `public.permissions`. */
function normalizeTableName(raw) {
  const parts = raw.split('.').map((p) => p.replace(/^"|"$/g, '').replace(/""/g, '"'));
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
}

/**
 * Normalise SQL text to "what it says", ignoring comments and whitespace.
 *
 * Used for exactly one decision: when `verify` reports `changed after it was applied`, is the file
 * on disk the same SQL as the one that was applied, or a different one? The first is a cosmetic
 * edit — a comment added for a reviewer, a line re-wrapped — and the second is a new migration that
 * happens to reuse a version. Only the first may be reconciled; the second must be refused.
 *
 * THE LIMITATION, STATED PLAINLY. Comments are removed even inside dollar-quoted bodies, where
 * Postgres would treat them as text, and string literals inside a body are not tracked while in that
 * state. So two bodies that differ only in a comment, or in a `--` inside a literal somewhere, can
 * normalise to the same string. This is therefore a guard on the operator's *claim* rather than a
 * proof of equivalence: a semantic edit that is not comment-shaped never normalises away, which is
 * the case that must be caught, and it is caught.
 */
export function normalizeSql(text) {
  let out = '';
  let i = 0;
  let state = 'normal';
  let dollarTag = '';
  // A comment can start inside a dollar-quoted body; when it ends, the body must resume, or every
  // later quote in that body would be read as SQL syntax.
  let returnState = 'normal';

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === 'line-comment') {
      if (ch === '\n') {
        state = returnState;
        out += ' ';
      }
      i++;
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        i += 2;
        state = returnState;
        out += ' ';
        continue;
      }
      i++;
      continue;
    }
    if (state === 'single') {
      out += ch;
      if (ch === "'") {
        if (next === "'") {
          out += next;
          i += 2;
          continue;
        }
        state = 'normal';
      }
      i++;
      continue;
    }
    if (state === 'double') {
      out += ch;
      if (ch === '"') {
        if (next === '"') {
          out += next;
          i += 2;
          continue;
        }
        state = 'normal';
      }
      i++;
      continue;
    }

    // Dollar-quoted bodies are copied through, but comments inside them are still dropped — see the
    // limitation note above.
    if (state === 'dollar') {
      if (text.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        state = 'normal';
        continue;
      }
      if (ch === '-' && next === '-') {
        returnState = 'dollar';
        state = 'line-comment';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        returnState = 'dollar';
        state = 'block-comment';
        i += 2;
        continue;
      }
    }

    if (ch === '-' && next === '-') {
      returnState = 'normal';
      state = 'line-comment';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      returnState = 'normal';
      state = 'block-comment';
      i += 2;
      continue;
    }
    if (ch === "'" && state === 'normal') {
      state = 'single';
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' && state === 'normal') {
      state = 'double';
      out += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const match = text.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) {
        dollarTag = match[0];
        state = 'dollar';
        out += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    out += ch;
    i++;
  }

  return out.replace(/\s+/g, ' ').trim();
}
