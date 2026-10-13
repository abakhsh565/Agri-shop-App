/**
 * stockLedgerAndDueDateGuard — a stock change leaves a movement, and a credit sale keeps its date.
 *
 * THE TWO DEFECTS THIS PREVENTS, both measured against the running app before they were fixed
 * (0198, and docs/LOCAL_DEVELOPMENT.md §7):
 *
 *   1. `sales.due_date` was never written. The cart requires a date for a credit sale, disables the
 *      confirm button until one is chosen, and sends `dueDate` in the payload — and the column came
 *      out NULL on every credit sale, on staging's own rows too (SALE-14273). Reminders and overdue
 *      credit read that column, so a shop with credit sales reported Rs. 0 overdue. A sale with no
 *      due date is not a smaller version of a credit sale; it is a credit sale the ledger forgets.
 *
 *   2. The stock ledger recorded three of its five writers. Measured in one session:
 *        create product with stock → row     buy (purchase) → row     void sale → row
 *        sale (create_sale)        → NO ROW  return          → NO ROW
 *      Stock moved in both silent cases. So the ledger said stock had never left for a sale and had
 *      never come back from a return, which is precisely the history a shopkeeper is asked to trust.
 *
 * WHY A GUARD AND NOT JUST THE FIX. Both writers are redefined WHOLE on the next migration that
 * touches them — that is how this directory works, and it is not a mistake. It does mean the gap
 * returns silently: `CREATE OR REPLACE FUNCTION create_sale_unchecked` that forgets the insert
 * applies cleanly, passes every existing test, and re-opens the hole. So this guard does not read
 * 0198. It finds the definition that is currently IN FORCE for each function across the whole
 * directory (`latestDefinition`), and checks the semantic properties that made the numbers wrong:
 *
 *   * `due_date` is bound to the payload in the sales INSERT — the position is matched, so a
 *     literal `NULL` slipped into that slot fails here.
 *   * `create_sale` still reaches `create_sale_unchecked` — the entry point and the writer must not
 *     drift apart, or the sale the app creates is not the sale the ledger records.
 *   * the sale's movement is written INSIDE the per-item loop and AFTER the stock UPDATE, so
 *     qty_before/qty_after are read from the row that was just changed, and it references the sale.
 *   * the return's movement is written INSIDE the `IF restock` branch — a return that does not put
 *     the goods back must not tell the ledger that stock came back.
 *
 * NON-VACUITY. A guard that cannot fail is worse than no guard, because it reads as evidence. The
 * last block mutates the real definition, injects each of the four failures, and asserts the
 * checker reports it — including moving the return's movement out of the `IF restock` branch
 * (still present in the file, still correct-looking, and exactly the regression nobody would see).
 *
 * The vocabulary is not invented here: `sale` and `return` are existing members of the
 * `movement_type` enum, the same two the void and the purchase already write.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = path.resolve(process.cwd(), 'supabase/migrations');

/** Every migration, in version order — filename order is version order (see the replayability guard). */
function migrationFiles(): Array<{ file: string; sql: string }> {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS, file), 'utf8') }));
}

/** The function statement starting at `startIndex`, from `CREATE` through its closing `$tag$`. */
function statementBody(sql: string, startIndex: number): string {
  const rest = sql.slice(startIndex);
  const open = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
  if (!open || open.index === undefined) {
    throw new Error('the function statement has no dollar-quoted body');
  }
  const tag = open[1];
  const from = open.index + open[0].length;
  const close = rest.indexOf(tag, from);
  if (close < 0) throw new Error(`the ${tag} body of this function is never closed`);
  return rest.slice(0, close + tag.length);
}

/**
 * The definition that is IN FORCE for `name`: the last migration in the directory that defines it.
 * Later files override earlier ones, so "last one wins" is the same rule the database follows.
 */
function latestDefinition(name: string): { file: string; body: string } {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,
    'i',
  );

  let found: { file: string; body: string } | null = null;
  for (const { file, sql } of migrationFiles()) {
    const match = re.exec(sql);
    if (!match) continue;
    found = { file, body: statementBody(sql, match.index) };
  }

  if (!found) throw new Error(`no migration in the directory defines ${name}`);
  return found;
}

/** Line comments are prose about the rule, not the rule. They are stripped before structure is read. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** Split on commas that are not inside parentheses or a string literal. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;

  for (const ch of text) {
    if (inString) {
      current += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  parts.push(current.trim());
  return parts.filter((p) => p.length > 0);
}

/** The `INSERT INTO sales (…) VALUES (…)` statement, with its columns paired to their values. */
function salesInsert(body: string): { columns: string[]; values: string[] } | null {
  const match = /INSERT\s+INTO\s+(?:public\.)?sales\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*RETURNING/i.exec(
    body,
  );
  if (!match) return null;
  return { columns: splitTopLevel(match[1]), values: splitTopLevel(match[2]) };
}

/** Every `INSERT INTO inventory_movements … ;` in a body, with its offset so position can be judged. */
function movementInserts(body: string, type: string): Array<{ index: number; text: string }> {
  const all = [...body.matchAll(/INSERT\s+INTO\s+inventory_movements[\s\S]*?;/gi)].map((m) => ({
    index: m.index ?? 0,
    text: m[0],
  }));
  const typed = new RegExp(`movement_type[\\s\\S]*?'${type}'`, 'i');
  return all.filter((i) => typed.test(i.text));
}

/** The span of the `FOR v_item … LOOP … END LOOP` block in a body. */
function loopSpan(body: string): { start: number; end: number } | null {
  const start = body.search(/FOR\s+v_item\b[\s\S]*?\bLOOP\b/i);
  if (start < 0) return null;
  const end = body.indexOf('END LOOP', start);
  return { start, end: end < 0 ? body.length : end };
}

/**
 * The span of the `IF … THEN … END IF` block that starts at `from`, respecting nesting.
 * Used to answer "is this insert inside that branch?", which is the whole question for a return:
 * the row must be written only when the goods actually came back.
 */
function blockSpan(body: string, from: number): number {
  const tokens = /\bEND\s+IF\b|\bIF\b/gi;
  tokens.lastIndex = from;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = tokens.exec(body)) !== null) {
    if (/^END/i.test(match[0])) {
      depth--;
      if (depth === 0) return match.index + match[0].length;
    } else {
      depth++;
    }
  }

  throw new Error('an IF branch is never closed with END IF');
}

/** Is `due_date` bound to the payload it came with, rather than written as a literal NULL? */
function checkDueDateWritten(body: string): string[] {
  const problems: string[] = [];
  const insert = salesInsert(body);

  if (!insert) {
    problems.push('create_sale_unchecked no longer inserts a sales row, so there is no due date to write');
    return problems;
  }
  const paired = insert.columns.length === insert.values.length;
  if (!paired) {
    // Reported, not fatal: a column dropped from the list shifts every slot after it, which is a
    // failure in its own right AND the reason a missing `due_date` is worth naming separately.
    problems.push(
      `the sales INSERT names ${insert.columns.length} columns and supplies ${insert.values.length} values — the guard cannot pair a date to its slot`,
    );
  }

  const at = insert.columns.indexOf('due_date');
  if (at < 0) {
    problems.push(
      'the sales INSERT does not name due_date, so a credit sale is stored with no date to be overdue against',
    );
  } else if (paired) {
    const value = insert.values[at];
    if (/^\s*null\s*$/i.test(value)) {
      problems.push('due_date is written as a literal NULL, so the date the cart collected is dropped');
    } else if (!/dueDate|due_date/i.test(value)) {
      problems.push(
        `due_date is written from \`${value}\`, which is not the payload the cart sends (\`dueDate\`)`,
      );
    }
  }

  if (/UPDATE\s+(?:public\.)?sales\s+SET[\s\S]*?due_date\s*=\s*NULL/i.test(body)) {
    problems.push('this function clears due_date after writing it, so the date cannot survive the sale');
  }

  return problems;
}

/** `create_sale` must still reach the function that writes the date and the ledger. */
function checkEntryReachesTheWriter(body: string): string[] {
  if (!/public\.create_sale_unchecked\s*\(/i.test(body)) {
    return [
      'create_sale no longer calls create_sale_unchecked, so the sale the app creates is not the sale the due date and the ledger are written for',
    ];
  }
  return [];
}

/** The sale's movement: inside the item loop, after the stock moved, pointing at the sale. */
function checkSaleMovementWritten(body: string): string[] {
  const problems: string[] = [];
  const inserts = movementInserts(body, 'sale');

  if (inserts.length === 0) {
    problems.push(
      'create_sale_unchecked moves stock out without writing an inventory_movements row (movement_type `sale`), so the ledger says the stock never left',
    );
    return problems;
  }

  const insert = inserts[0];
  const loop = loopSpan(body);
  if (loop && (insert.index < loop.start || insert.index > loop.end)) {
    problems.push('the sale movement is written outside the per-item loop, so it cannot describe the item it moved');
  }

  const stockUpdate = body.search(
    /UPDATE\s+(?:public\.)?product_variants\s+SET\s+stock_qty\s*=\s*stock_qty\s*-/i,
  );
  if (stockUpdate >= 0 && insert.index < stockUpdate) {
    problems.push(
      'the sale movement is written before the stock is moved, so qty_before/qty_after cannot be read from the row that changed',
    );
  }

  for (const [field, why] of [
    ['qty_before', 'the quantity before the sale is not recorded'],
    ['qty_after', 'the quantity after the sale is not recorded'],
    ['reference_type', 'the movement does not say what kind of event caused it'],
  ] as const) {
    if (!new RegExp(`\\b${field}\\b`, 'i').test(insert.text)) problems.push(why);
  }
  if (!/\bv_sale_id\b/.test(insert.text)) {
    problems.push('the sale movement does not reference the sale row it came from (reference_id)');
  }

  return problems;
}

/** The return's movement: inside `IF restock`, pointing at the return. */
function checkReturnMovementWritten(body: string): string[] {
  const problems: string[] = [];
  const restock = /IF\s+COALESCE\(\(v_item->>'restock'\)::boolean,\s*false\)\s+THEN/i.exec(body);

  if (!restock || restock.index === undefined) {
    problems.push(
      'process_return has no `IF restock` branch, so there is nowhere that knows whether goods came back',
    );
    return problems;
  }

  const span = { start: restock.index, end: blockSpan(body, restock.index) };
  const inserts = movementInserts(body, 'return');

  if (inserts.length === 0) {
    problems.push(
      'process_return puts stock back without writing an inventory_movements row (movement_type `return`), so the stock that came back is not in the ledger',
    );
    return problems;
  }

  for (const insert of inserts) {
    if (insert.index < span.start || insert.index > span.end) {
      problems.push(
        'the return movement is written outside the `IF restock` branch, so a return that does NOT put the goods back still claims the stock came back',
      );
    }
    for (const [field, why] of [
      ['qty_before', 'the quantity before the return is not recorded'],
      ['qty_after', 'the quantity after the return is not recorded'],
    ] as const) {
      if (!new RegExp(`\\b${field}\\b`, 'i').test(insert.text)) problems.push(why);
    }
    if (!/\bv_id\b/.test(insert.text)) {
      problems.push('the return movement does not reference the return row it came from (reference_id)');
    }
  }

  return problems;
}

const saleWriter = latestDefinition('create_sale_unchecked');
const saleEntry = latestDefinition('create_sale');
const returnWriter = latestDefinition('process_return');

describe('the definition in force still writes the due date and the ledger', () => {
  it('reads a real definition of each function, not an empty string', () => {
    // If any of these were unparseable, the checks below would silently pass on nothing at all.
    expect(saleWriter.body.length).toBeGreaterThan(500);
    expect(returnWriter.body.length).toBeGreaterThan(500);
    expect(saleWriter.body).toMatch(/create_sale_unchecked/i);
    expect(returnWriter.body).toMatch(/process_return/i);
    expect(saleWriter.body).toMatch(/\$function\$|\$\$/);
  });

  it('writes the due date a credit sale was given', () => {
    expect(checkDueDateWritten(stripComments(saleWriter.body))).toEqual([]);
  });

  it('reaches the writer through create_sale, so the app cannot create a sale the ledger misses', () => {
    expect(checkEntryReachesTheWriter(stripComments(saleEntry.body))).toEqual([]);
  });

  it('leaves a movement behind every sale, read from the row the stock change wrote', () => {
    expect(checkSaleMovementWritten(stripComments(saleWriter.body))).toEqual([]);
  });

  it('leaves a movement behind only a return that actually restocked', () => {
    expect(checkReturnMovementWritten(stripComments(returnWriter.body))).toEqual([]);
  });

  it('writes those movements with the enum members the void and the purchase already use', () => {
    // Not a new vocabulary: the same two words, so a report that groups movements by type does not
    // have to learn a synonym for `sale` or `return`.
    expect(movementInserts(stripComments(saleWriter.body), 'sale')).toHaveLength(1);
    expect(movementInserts(stripComments(returnWriter.body), 'return')).toHaveLength(1);
  });
});

describe('the guard is not vacuous', () => {
  const saleBody = stripComments(saleWriter.body);
  const returnBody = stripComments(returnWriter.body);

  it('catches the due date being dropped back to a literal NULL', () => {
    const mutated = saleBody.replace(
      /NULLIF\(COALESCE\(payload->>'dueDate',payload->>'due_date'\),''\)::date/,
      'NULL',
    );
    expect(mutated, 'the injection must actually land').not.toBe(saleBody);
    expect(checkDueDateWritten(mutated).join(' ')).toContain('literal NULL');
  });

  it('catches the due_date column being removed from the sales INSERT', () => {
    const mutated = saleBody.replace('amount_due,due_date,status', 'amount_due,status');
    expect(mutated).not.toBe(saleBody);
    expect(checkDueDateWritten(mutated).join(' ')).toContain('does not name due_date');
  });

  it('catches a due date that comes from somewhere other than the payload', () => {
    const mutated = saleBody.replace(
      /NULLIF\(COALESCE\(payload->>'dueDate',payload->>'due_date'\),''\)::date/,
      "now()::date",
    );
    expect(mutated).not.toBe(saleBody);
    expect(checkDueDateWritten(mutated).join(' ')).toContain('not the payload the cart sends');
  });

  it('catches a sale that moves stock without a movement', () => {
    const mutated = saleBody.replace(
      /INSERT\s+INTO\s+inventory_movements[\s\S]*?'sale',v_sale_id,v_actor\);/i,
      '',
    );
    expect(mutated).not.toBe(saleBody);
    expect(checkSaleMovementWritten(mutated).join(' ')).toContain('never left');
  });

  it('catches a sale movement written before the stock moves', () => {
    // The movement is moved to the top of the loop body: still inside the loop, still typed `sale`,
    // still referencing the sale — and now reading qty_before/qty_after from the row the UPDATE has
    // not touched yet.
    const insert = saleBody.match(/INSERT\s+INTO\s+inventory_movements[\s\S]*?'sale',v_sale_id,v_actor\);/i);
    expect(insert, 'the sale movement must be findable to move it').not.toBeNull();
    const withoutInsert = saleBody.replace(insert![0], '');
    // The marker is the statement itself, not `'sale',v_sale_id`: the credit-limit audit row also
    // reads `entity_type='sale', entity_id=v_sale_id`, so that pair is not unique to the ledger.
    expect(withoutInsert, 'the injection must actually remove it').not.toContain(
      'INSERT INTO inventory_movements',
    );

    const at = withoutInsert.indexOf('UPDATE product_variants SET stock_qty=stock_qty-');
    expect(at, 'the stock UPDATE must be findable to move the movement above it').toBeGreaterThan(-1);
    const updated = `${withoutInsert.slice(0, at)}${insert![0]}\n      ${withoutInsert.slice(at)}`;
    expect(updated).toContain(insert![0]);

    expect(checkSaleMovementWritten(updated).join(' ')).toContain('before the stock is moved');
  });

  it('catches the return movement moved out of the `IF restock` branch', () => {
    // The regression nobody would see: the row is still written, still typed `return`, still
    // references the return — and it now also fires for a return that never restocked.
    const insert = returnBody.match(
      /INSERT\s+INTO\s+inventory_movements \(product_id[\s\S]*?'return', v_id, v_processed_by\);/i,
    );
    expect(insert, 'the return movement must be findable to move it').not.toBeNull();
    const withoutInsert = returnBody.replace(insert![0], '');
    const mutated = withoutInsert.replace('  END LOOP;\n', `  ${insert![0]}\n  END LOOP;\n`);
    expect(mutated, 'the injection must actually land').not.toBe(returnBody);
    expect(checkReturnMovementWritten(mutated).join(' ')).toContain('outside the `IF restock` branch');
  });

  it('catches a return that restocks without a movement', () => {
    const mutated = returnBody.replace(
      /INSERT\s+INTO\s+inventory_movements \(product_id[\s\S]*?'return', v_id, v_processed_by\);/i,
      '',
    );
    expect(mutated).not.toBe(returnBody);
    expect(checkReturnMovementWritten(mutated).join(' ')).toContain('not in the ledger');
  });

  it('catches the return ledger losing its before/after quantities', () => {
    const mutated = returnBody.replace(
      /qty_before, qty_change, qty_after,\n\s*reference_type/,
      'qty_change,\n          reference_type',
    );
    expect(mutated).not.toBe(returnBody);
    expect(checkReturnMovementWritten(mutated).join(' ')).toContain('quantity before the return');
  });

  it('catches an entry point that no longer reaches the writer', () => {
    // `create_sale` reaches the writer on two paths — the null-key fast path and the claimed-key
    // path — so the injection replaces BOTH. Replacing one leaves the other, and the guard is
    // right to pass in that case; that is exactly why this asserts the removal landed first.
    const entryBody = stripComments(saleEntry.body);
    expect(entryBody.match(/public\.create_sale_unchecked\s*\(/g)?.length).toBe(2);
    const mutated = entryBody.replaceAll('public.create_sale_unchecked(payload)', 'NULL');
    expect(mutated).not.toContain('create_sale_unchecked(payload)');
    expect(checkEntryReachesTheWriter(mutated).join(' ')).toContain('not the sale the due date');
  });

  it('reads each function from the migration that defines it last', () => {
    // The whole point of `latestDefinition`: a later migration wins, so a redefined writer that
    // forgets the insert is checked instead of the historical one that had it.
    expect(saleWriter.file).toMatch(/^\d{4}_/);
    expect(returnWriter.file).toMatch(/^\d{4}_/);
    expect(saleWriter.file <= '0198_a_sale_keeps_its_due_date_and_leaves_a_movement.sql').toBe(true);
    expect(returnWriter.file <= '0198_a_sale_keeps_its_due_date_and_leaves_a_movement.sql').toBe(true);
  });
});
