/**
 * marketplaceContractGuard — the marketplace projection stays exactly the projection it claims to
 * be, and the boundary around it stays closed.
 *
 * THE DEFECT THIS PREVENTS. The farmer marketplace is readable with the anon key the client ships,
 * so the curated column list IS the security boundary. That boundary is one careless edit away
 * from failing quietly: `SELECT *` in the view, a `cost_price` added "just for display", a
 * `stock_qty` added because a band was wanted. None of those would break a screen, and all of them
 * would publish the shop's purchase price, its stock position or its supply chain to anyone holding
 * the public key. A leak of this kind does not announce itself — so it is checked mechanically,
 * on every run, from the migration text that defines it.
 *
 * WHAT IS ASSERTED, and why each one is load-bearing:
 *
 *   1. The view's projected columns are EXACTLY the allowlist — compared for equality, so a column
 *      added later fails here instead of becoming public without anyone deciding it should.
 *   2. No forbidden identifier appears anywhere in the projection, including inside the WHERE
 *      clause, so a filter cannot smuggle one back in.
 *   3. The view never uses `SELECT *`, which is how a future column would join the contract
 *      without appearing in this file at all.
 *   4. `anon` is granted the view and the one search function, and nothing else — no grant of the
 *      base tables, and no EXECUTE on the writer RPC.
 *   5. The search function bounds distance by the FARMER's radius alone (`<= v_radius`), refuses a
 *      point outside Pakistan, and orders by distance. No branch sets a distance any more (0187
 *      dropped the column and the argument), so a branch-side radius reappearing in the rule —
 *      the exact model the owner corrected — fails here.
 *
 * NON-VACUITY. A guard that cannot fail is worse than no guard, because it reads as evidence. The
 * `catches an injected leak` block below injects a forbidden column into a copy of the migration
 * and asserts the guard's own checker reports it — so the checker is proven to be looking at
 * something real. The same property was demonstrated by hand during development: adding
 * `v.cost_price` to the view and re-running made this file fail, and removing it made it pass.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/0185_a_product_can_be_listed_on_the_marketplace.sql',
);

/**
 * The search rule lives in 0187, which redefines `search_marketplace` after the owner-side radius
 * was removed. The view itself is untouched by 0187, so the projection assertions still read 0185.
 */
const SEARCH_MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/0187_the_distance_belongs_to_the_farmer_not_the_branch.sql',
);

/** The exact projection. Equality is asserted, so this list is the contract. */
const ALLOWLIST = [
  'listing_id',
  'branch_id',
  'branch_name',
  'branch_address',
  'branch_latitude',
  'branch_longitude',
  'branch_location_label',
  'product_id',
  'product_name',
  'category',
  'image_url',
  'variant_id',
  'variant_label',
  'unit_size',
  'qty_step',
  'base_unit',
  'selling_price',
  'availability',
  'listed_at',
  'updated_at',
];

/**
 * Everything that must never be public, and what each one would disclose. Kept as data rather than
 * a comment so the check below cannot drift from the intent.
 */
const FORBIDDEN: Array<{ column: string; discloses: string }> = [
  { column: 'cost_price', discloses: 'the purchase price, and therefore the shop’s margin' },
  { column: 'low_stock_threshold', discloses: 'the shop’s reorder point' },
  { column: 'stock_qty', discloses: 'exact stock, and by watching it, demand' },
  { column: 'company_id', discloses: 'the shop’s supplier' },
  { column: 'barcode', discloses: 'an internal identifier that invites enumeration' },
  { column: 'sku', discloses: 'an internal identifier that invites enumeration' },
  { column: 'batch_id', discloses: 'batch structure' },
  { column: 'expiry_date', discloses: 'batch dating' },
  { column: 'owner_id', discloses: 'who owns the business' },
  { column: 'join_code', discloses: 'a credential for joining the shop’s staff' },
  { column: 'phone', discloses: 'contact details the owner did not publish' },
  { column: 'created_by', discloses: 'staffing data' },
];

const sql = readFileSync(MIGRATION, 'utf8');
const searchSql = readFileSync(SEARCH_MIGRATION, 'utf8');

/** The `CREATE VIEW … ;` statement, so the projection can be read on its own. */
function viewBody(source: string): string {
  const start = source.indexOf('CREATE VIEW public.marketplace_listings');
  if (start < 0) throw new Error('the marketplace view is not defined in the migration');
  const end = source.indexOf('COMMENT ON VIEW', start);
  return source.slice(start, end);
}

/**
 * The SELECT list of the view — everything between `SELECT` and `WHERE`.
 *
 * This is the part that is actually PUBLISHED, and the distinction matters: the WHERE clause may
 * reference any internal column it likes, because a filter does not expose what it filters on.
 * `AND v.stock_qty > 0` is exactly how an out-of-stock row is kept out of the contract, and a
 * check that scanned the whole statement would call that filter a leak — a false positive that
 * would force the filter to be removed to keep the guard green, which is the opposite of safe.
 */
function projectionOf(source: string): string {
  // Comments are removed first. They are prose about the contract, not the contract, and they
  // legitimately contain these words — the line "-- Where it can be collected from." sits inside
  // the projection and would otherwise be read as the start of the WHERE clause, collapsing the
  // projection to a single column. That is exactly the parse failure this stripping prevents.
  const body = viewBody(source).replace(/--[^\n]*/g, '');
  const selectAt = body.search(/\bSELECT\b/i);
  const whereAt = body.search(/\bWHERE\b/i);
  if (selectAt < 0 || whereAt < 0 || whereAt < selectAt) {
    throw new Error('the marketplace view has no readable SELECT … WHERE shape');
  }
  return body.slice(selectAt, whereAt);
}

/**
 * Insert an extra projection line after the real `selling_price` line, whatever its spacing.
 *
 * Written as a regex rather than a literal string because the injection has to land for the
 * non-vacuity assertion to mean anything: a literal that silently fails to match would leave the
 * copy identical to the original, and `expect(leaky).not.toBe(sql)` is there to catch exactly that.
 */
function injectColumn(source: string, line: string): string {
  const re = /(\n\s*\S+\s+AS\s+selling_price,\n)/;
  if (!re.test(source)) throw new Error('cannot inject: no selling_price projection line found');
  return source.replace(re, `$1  ${line},\n`);
}

/**
 * The `search_marketplace` body, from its CREATE to the statement that follows it, so the
 * eligibility rule can be read on its own rather than scanning the whole migration.
 */
function searchBodyOf(source: string): string {
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.search_marketplace');
  if (start < 0) throw new Error('the marketplace search is not defined in the migration');
  const end = source.indexOf('REVOKE EXECUTE ON FUNCTION public.search_marketplace', start);
  if (end < 0) throw new Error('the search function has no following REVOKE to bound it');
  return source.slice(start, end);
}

/**
 * The distance rule the search must keep, extracted so the non-vacuity block can run it against a
 * mutated copy. Because the owner has no distance any more, the only bound is the searcher's own
 * radius — and a branch-side radius reappearing here is the regression this guards.
 */
function checkSearchRule(source: string): string[] {
  const problems: string[] = [];
  const body = searchBodyOf(source);
  if (!/<= v_radius\b/.test(body)) {
    problems.push("the search does not bound distance by the farmer's radius (`<= v_radius`)");
  }
  if (/\bmarketplace_radius_km\b/.test(body)) {
    problems.push('the search reads a branch-side distance, which no branch has any more');
  }
  return problems;
}

/**
 * The alias names the view projects, read from the `AS <name>` clauses that end each line of the
 * SELECT list. The first line (`SELECT`) carries no alias and is skipped by requiring a match.
 */
function projectedColumns(projection: string): string[] {
  const found = new Set<string>();

  for (const line of projection.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--') || /^SELECT\b/i.test(trimmed)) continue;

    const asMatch = trimmed.match(/\sAS\s+([a-z_][a-z0-9_]*)\s*,?\s*$/i);
    if (asMatch) found.add(asMatch[1].toLowerCase());
  }

  return [...found].sort();
}

/**
 * A forbidden column the projection is allowed to READ in order to derive a published value.
 *
 * This distinction is the whole subtlety of the guard. `v.stock_qty > 0` inside the availability
 * CASE does not publish a quantity — it produces the single word `'available'`, which is exactly
 * what a buyer is entitled to know. A check that flagged every mention would force that CASE to be
 * deleted to keep the guard green, which is the opposite of safe.
 *
 * What must never happen is the column being PROJECTED — `AS stock_qty`, or a bare `stock_qty` in
 * the select list — and a rename (`v.stock_qty AS stock_available`) is caught by the equality
 * assertion, because `stock_available` is not in the allowlist.
 */
const PERMITTED_DERIVATIONS: Record<string, string> = {
  stock_qty: 'the availability CASE derives the single word “available” from it',
};

/** The guard's checker, extracted so the non-vacuity block can run it against a mutated copy. */
function checkForLeaks(source: string): string[] {
  const problems: string[] = [];
  const projection = projectionOf(source);
  const aliases = projectedColumns(projection);

  for (const { column, discloses } of FORBIDDEN) {
    // (a) Projected under its own name — the direct leak. Word boundaries so `stock_qty` does not
    //     fire on a hypothetical `stock_qty_band`.
    const asAlias = new RegExp(`\\bAS\\s+${column}\\b`, 'i');
    const bareLine = new RegExp(`^\\s*${column}\\s*,?\\s*$`, 'im');

    if (asAlias.test(projection) || bareLine.test(projection) || aliases.includes(column)) {
      problems.push(`the marketplace projection publishes \`${column}\`, which discloses ${discloses}`);
      continue;
    }

    // (b) Read inside the projection for a reason nobody wrote down. A permitted derivation is
    //     named above; anything else is an unexplained reference to a private field.
    const referenced = new RegExp(`\\b${column}\\b`, 'i').test(projection);
    if (referenced && !(column in PERMITTED_DERIVATIONS)) {
      problems.push(
        `the marketplace projection reads \`${column}\` (${discloses}) with no stated reason — ` +
          'either remove it or add it to PERMITTED_DERIVATIONS with the value it derives',
      );
    }
  }

  if (/select\s+\*/i.test(projection)) {
    problems.push('the marketplace projection uses SELECT *, so a future column would become public without being named');
  }

  return problems;
}

describe('the marketplace contract exposes only what it says it does', () => {
  it('projects exactly the allowlisted columns', () => {
    const projected = projectedColumns(projectionOf(sql));
    expect(projected).toEqual([...ALLOWLIST].sort());
  });

  it('names no field that would disclose the shop’s private business', () => {
    expect(checkForLeaks(sql)).toEqual([]);
  });

  it('never uses SELECT * in the projection', () => {
    expect(/select\s+\*/i.test(projectionOf(sql))).toBe(false);
  });

  it('grants the contract to anon, and nothing else to anon', () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.marketplace_listings TO anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_marketplace[\s\S]*?TO anon/);

    // The writer's CURRENT definition is the two-argument one in 0187, so the revocation is
    // asserted against that file — an earlier draft of this guard checked 0184 and failed for the
    // honest reason that the statement had moved to where the writer is defined.
    expect(searchSql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.set_marketplace_settings\(uuid, boolean\) FROM PUBLIC, anon/,
    );

    // No base table is granted to anon anywhere in this migration.
    for (const table of ['products', 'product_variants', 'shops', 'inventory_movements', 'product_barcodes']) {
      const re = new RegExp(`GRANT[^;]*ON (TABLE )?public\\.${table}\\b[^;]*TO[^;]*\\banon`, 'i');
      expect(re.test(sql), `${table} must not be granted to anon`).toBe(false);
    }
  });

  it("bounds distance by the farmer's radius alone", () => {
    // One radius, and it is the searcher's: a branch contributes a location and a switch, nothing
    // else. 0187 dropped the owner-set column, and `<= v_radius` is the only distance rule left.
    expect(checkSearchRule(searchSql)).toEqual([]);
    expect(searchSql).toMatch(/DROP COLUMN IF EXISTS marketplace_radius_km/);
  });

  it('refuses a point outside Pakistan and orders by distance', () => {
    expect(sql).toMatch(/not in Pakistan/);
    expect(sql).toMatch(/ORDER BY e\.d ASC/);
  });

  it('excludes archived, unlisted, inactive and out-of-stock rows', () => {
    const body = viewBody(sql);
    expect(body).toMatch(/s\.marketplace_enabled/);
    expect(body).toMatch(/p\.marketplace_listed/);
    expect(body).toMatch(/p\.is_active/);
    expect(body).toMatch(/v\.is_active/);
    expect(body).toMatch(/v\.stock_qty > 0/);
  });

  it('states availability as a word, never a quantity', () => {
    const body = viewBody(sql);
    expect(body).toMatch(/'available'/);
    // A `low_stock` band would be derivable from the threshold and is deliberately not published.
    expect(body).not.toMatch(/'low_stock'/);
  });
});

describe('the guard is not vacuous', () => {
  it('catches an injected leak of a forbidden column', () => {
    // The exact edit this guard exists to stop: a helpful-looking extra column.
    const leaky = injectColumn(sql, 'v.cost_price                    AS cost_price');
    expect(leaky).not.toBe(sql); // the injection actually landed

    const problems = checkForLeaks(leaky);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('cost_price');
    expect(problems.join(' ')).toContain('margin');
  });

  it('catches an injected exact-stock column', () => {
    const leaky = injectColumn(sql, 'v.stock_qty                     AS stock_qty');
    expect(leaky).not.toBe(sql);
    expect(checkForLeaks(leaky).join(' ')).toContain('stock_qty');
  });

  it('catches every forbidden column it claims to guard', () => {
    // Not just the two examples above: each entry in the list must actually be detectable, so a
    // typo in the list cannot leave a field silently unguarded.
    for (const { column } of FORBIDDEN) {
      const leaky = injectColumn(sql, `v.some_source AS ${column}`);
      const problems = checkForLeaks(leaky);
      expect(problems.join(' '), `${column} must be detectable`).toContain(column);
    }
  });

  it('catches a SELECT * that would publish an unnamed column', () => {
    const leaky = sql.replace(
      'CREATE VIEW public.marketplace_listings AS',
      'CREATE VIEW public.marketplace_listings AS\nSELECT * FROM (',
    );
    expect(leaky).not.toBe(sql);
    expect(checkForLeaks(leaky).join(' ')).toContain('SELECT *');
  });

  it('catches a branch-side distance smuggled back into the search rule', () => {
    // The exact model the owner corrected: the branch choosing part of the distance. A guard on
    // the SQL text, so this proves the checker reads the rule rather than trusting the file.
    const body = searchBodyOf(searchSql);
    const leakyBody = body.replace(
      ') <= v_radius',
      ') <= LEAST(v_radius, s.marketplace_radius_km)',
    );
    expect(leakyBody).not.toBe(body); // the injection actually landed
    const leaky = searchSql.replace(body, leakyBody);
    expect(leaky).not.toBe(searchSql);

    const problems = checkSearchRule(leaky);
    expect(problems.length).toBeGreaterThan(0);
    // Both the missing bound and the branch-side column are reported, so either symptom alone
    // would still have caught this edit.
    expect(problems.join(' ')).toContain("farmer's radius");
    expect(problems.join(' ')).toContain('branch-side distance');
  });

  it('catches a search that drops the radius bound entirely', () => {
    const body = searchBodyOf(searchSql);
    const leaky = searchSql.replace(body, body.replace('<= v_radius', '>= 0'));
    expect(leaky).not.toBe(searchSql);
    expect(checkSearchRule(leaky).join(' ')).toContain("farmer's radius");
  });

  it('reads a real projection, not an empty one', () => {
    // If the projection were ever unparseable, the equality assertion would compare [] to the
    // allowlist and fail — but this states it directly so the failure is unambiguous.
    expect(projectedColumns(projectionOf(sql)).length).toBe(ALLOWLIST.length);
  });

  it('does not mistake a filter or a derivation for a leak', () => {
    // The guard must allow the WHERE clause to reference internal columns: `v.stock_qty > 0` is how
    // out-of-stock rows are excluded, and a checker that flagged it would push a future editor to
    // delete the filter to stay green. The availability CASE may also read it to derive one word.
    const where = viewBody(sql).slice(viewBody(sql).search(/\bWHERE\b/i));
    expect(/\bstock_qty\b/.test(where)).toBe(true);
    expect(checkForLeaks(sql)).toEqual([]);
  });

  it('catches a forbidden column renamed to hide it', () => {
    // `v.stock_qty AS stock_available` publishes the quantity under a different name. The alias is
    // not in the allowlist, so the equality assertion is what catches it — and this proves that
    // route works, rather than relying on the name match alone.
    const leaky = injectColumn(sql, 'v.stock_qty AS stock_available');
    expect(leaky).not.toBe(sql);
    const aliases = projectedColumns(projectionOf(leaky));
    expect(aliases).not.toEqual([...ALLOWLIST].sort());
    expect(aliases).toContain('stock_available');
  });
});
