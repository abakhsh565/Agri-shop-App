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
      if (buf.trim()) out.push({ text: buf.trim(), offset: stmtStart });
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
