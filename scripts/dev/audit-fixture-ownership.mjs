/**
 * Fixture-ownership audit for the integration suites — static, no database.
 *
 * WHY THIS EXISTS. Three promotion runs in a row went red on the QA job for reasons that were not
 * product defects, and every one of them had the same shape: a file asserted against rows it did
 * not create.
 *
 *   * `branchScopeEnforcement` read `branches.rows[1]` from the seeded shop. The shop's second
 *     branch was deactivated upstream, so the row list came back with one entry and the file died at
 *     `expect(warehouseBranch).toBeTruthy()` — before a single branch assertion ran.
 *   * `rbacFoundation` read the same list and fell back to the main branch when it was short
 *     (`?? mainBranch`). The fallback silently turned a branch-denial assertion into a success
 *     assertion, and that success created a customer the file never removed. The NEXT run of the
 *     same file then failed with `DUPLICATE_CUSTOMER_PHONE`.
 *   * Both failures wore the product's clothes: `NOT_AUTHORIZED: tenant access denied` reads like an
 *     authorization bug, not like a fixture that moved.
 *
 * So the defect class is: **a suite that asserts against state it does not own.** This tool names
 * every file in that class in about a second, from the source, so the fix is a list rather than a
 * hunt after a 13-minute red run.
 *
 * WHAT IT FLAGS
 *   RISK  `branches.rows[N]` or a `?? <mainBranch>` fallback off a shared tenant's row list, or a
 *         read of the seeded baseline ids without seeding its own tenant. These are the shapes that
 *         fail on someone else's edit.
 *   WARN  names the shared demo tenant without creating its own rows — not necessarily wrong (some
 *         files only read reference data), but every one of them is coupled to QA's live state.
 *   OK    creates its own tenant/rows and asserts against those.
 *
 * Usage:
 *   node scripts/dev/audit-fixture-ownership.mjs            # report
 *   node scripts/dev/audit-fixture-ownership.mjs --strict   # exit 1 if anything is RISK
 */

import fs from "node:fs";
import path from "node:path";

const INTEGRATION = path.resolve(process.cwd(), "tests/integration");

/** The demo tenant every environment seeds: QA's live shop, and the thing suites keep borrowing. */
const SEEDED_TENANT = "00000000-0000-0000-0000-000000000001";
/** Baseline fixture identity prefixes (users, customers, products, variants, suppliers). */
const SEEDED_PREFIXES = ["10000000-", "20000000-", "30000000-", "40000000-", "50000000-"];

/** Comments describe the past ("it used to read rows[1]"); only code counts. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function classify(file) {
  const code = withoutComments(fs.readFileSync(file, "utf8"));
  const createsOwnRows = /INSERT\s+INTO\s+(shops|users|branches|customers|products|product_variants)/i.test(code);
  const namesSeededTenant = code.includes(SEEDED_TENANT);
  const seededIds = SEEDED_PREFIXES.filter((p) => code.includes(p));

  // The two shapes that actually failed: position into a shared row list, and the fallback that
  // hides a short list.
  const rowIndexRead = /\b\w*[Bb]ranches?\.rows\s*\[\s*[0-9]+\s*\]/.test(code);
  const fallbackToASharedRow = /\?\?\s*(mainBranch|branchMain|warehouseBranch)\b/.test(code);
  // Description-based cleanup is not ownership: a broad label such as "QA Test" can match rows
  // created by other suites (or retained telemetry), so only ids registered by this file are safe.
  const wildcardTaskDelete = /DELETE\s+FROM\s+agent_tasks\s+WHERE\s+description\s+LIKE/i.test(code);

  const risks = [];
  if (rowIndexRead) risks.push("reads branches by row position");
  if (fallbackToASharedRow) risks.push("falls back to a shared branch when the list is short");
  if (wildcardTaskDelete) risks.push("deletes agent tasks by description rather than ids owned by this file");
  if (namesSeededTenant && !createsOwnRows && seededIds.length)
    risks.push(`names the seeded tenant and its fixtures (${seededIds.length} prefixes) without seeding its own`);

  return {
    file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
    createsOwnRows,
    namesSeededTenant,
    seededIds,
    verdict: risks.length ? "RISK" : namesSeededTenant && !createsOwnRows ? "WARN" : "OK",
    risks,
  };
}

const rows = fs
  .readdirSync(INTEGRATION)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => classify(path.join(INTEGRATION, f)))
  .sort((a, b) => a.verdict.localeCompare(b.verdict) || a.file.localeCompare(b.file));

const counts = rows.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});

console.log("═══ fixture ownership — tests/integration");
console.log(`  files: ${rows.length}   OK: ${counts.OK ?? 0}   WARN: ${counts.WARN ?? 0}   RISK: ${counts.RISK ?? 0}`);
console.log("");

for (const verdict of ["RISK", "WARN"]) {
  const group = rows.filter((r) => r.verdict === verdict);
  if (!group.length) continue;
  console.log(` ${verdict} (${group.length})`);
  for (const r of group) {
    console.log(`   ${r.file}`);
    const why = r.risks.length ? r.risks : ["borrows QA's live tenant without owning rows"];
    for (const w of why) console.log(`      · ${w}`);
  }
  console.log("");
}

console.log(" OK files own what they assert:");
for (const r of rows.filter((x) => x.verdict === "OK")) console.log(`   ${r.file}`);

if (process.argv.includes("--strict") && counts.RISK) {
  console.error(`\nFAIL — ${counts.RISK} file(s) assert against rows they do not own.`);
  process.exit(1);
}
