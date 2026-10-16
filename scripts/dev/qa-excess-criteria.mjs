/**
 * qa-excess-criteria.mjs — the ONE definition of "this QA row is disposable test residue".
 *
 * WHY IT IS A MODULE AND NOT TWO COPIES
 *   `qa-excess.mjs` reports the rows above the reviewed declaration; `qa-prune-excess.mjs` removes the
 *   subset that is provably machine-generated. If each file carried its own patterns, a future edit
 *   could widen one of them and the report would bless rows the remover never decided on — the exact
 *   class of defect that turns a cleanup into an unlogged deletion.
 *
 *   So each rule is DATA (column / operator / value), and both the SQL the remover runs and the JS
 *   predicate `isExcessRow()` evaluates are DERIVED from that same data. A rule cannot be true in SQL
 *   and false in the predicate, because there is only one rule.
 *
 * THE EVIDENCE EACH CRITERION RESTS ON, measured 2026-10-14 against the QA database:
 *
 *   sales — the excess rows are recorded by the shared suite identity (`QA Admin`), against the
 *     permissions suite's own fixture customer (`QA Dup-safe Customer`), for an identical 1000.00
 *     amount, and every one of them is voided. The manual QA sessions produced five structurally
 *     identical rows, but on 2026-10-11/12; the excess burst is 2026-10-13 19:22–21:48. All four
 *     conditions are required — actor AND customer AND shape AND date — so a hand-entered sale that
 *     merely resembles them is not caught. `tests/unit/qaExcessCriteria.test.ts` asserts exactly that,
 *     row by row, including the five manual rows that must survive.
 *   voids / sale_items — children of those sales, identified through the parent, never by their own
 *     count.
 *   credit_limit_requests — rows against that same fixture customer created on 2026-10-13, in
 *     repeating runs of three (approved / pending / self-approve) inside one minute. The declaration
 *     accounts for the 2026-10-11/12 runs, which this bound preserves.
 *   supplier_payments — measured 2026-10-14: the ONE row in the table is 500.00 cash, against the
 *     SHARED supplier fixture, recorded by the suite identity at 2026-10-13T23:18Z — inside the burst
 *     that also produced the orphaned movements and notifications. `EXCESS_RULES.supplier_payments`
 *     requires all four conditions, and the declaration expects none.
 *   inventory_movements / notifications (ORPHAN_RULES) — the 3 + 4 rows measured 2026-10-14, written by
 *     a suite account in the same 2026-10-13 23:17–23:53 window, whose subject is a sale, void or
 *     payment that no longer exists. Distinct from the shaped rules above because the row's own shape
 *     says nothing: it is the dead reference (and, for notifications, the suite-only actor) that does.
 *
 * WHAT THIS MODULE MUST NEVER MATCH
 *   The four sign-in fixtures, the canonical baseline roles, the supplier company fixture, the five
 *   manual 2026-10-11/12 rows, the seven owner-recorded `SALE-xxxxx` sales, the two `PERM-SALE` rows,
 *   any movement/notification whose subject is still there, any row written before 2026-10-13, any row
 *   whose actor is not a suite fixture, and `audit_events` (system-written history). The unit test
 *   asserts each of them, row by row.
 */

/** The permissions/credit suites' fixture customer, and the customer the excess sales belong to. */
export const SUITE_SALE_CUSTOMER = 'c4000000-0000-0000-0000-0000000000c1';
export const SUITE_CREDIT_CUSTOMER = 'e1000000-0000-0000-0000-000000000010';

/** The shared suite identity that records those sales — by name where the column holds a name, by id
 * where it holds a uuid (`supplier_payments.recorded_by`). Both name the same account. */
export const SUITE_ACTOR_NAME = 'QA Admin';
export const SUITE_ACTOR_ID = '10000000-0000-0000-0000-000000000001';

/**
 * The four QA keep-list accounts, by id — the identities the lanes themselves act as.
 *
 * WHY THE ID AND NOT THE NAME. A name is free text a lane can write (`actor_name`, `employee_name`);
 * the id is the account the session belonged to. Both are used as criteria, but only the id is used
 * for ownership of a side-effect row, where a name would make a hand-entered row by a same-named
 * account match.
 */
export const FIXTURE_ACTORS = [
  '10000000-0000-0000-0000-000000000001', // QA Admin — 923009999999
  '10000000-0000-0000-0000-000000000002', // QA Employee — 923008888888
  '10000000-0000-0000-0000-000000000003', // owner — 923001234567
  '10000000-0000-0000-0000-000000000004', // sales employee — 923001122334
];

/** Manual QA sessions ran 2026-10-11/12; the suite burst is 2026-10-13. */
export const SUITE_RUN_FROM = '2026-10-13';

/** The rules, as data. `op` is one of `=`, `>=`, `~`. */
export const EXCESS_RULES = {
  sales: [
    { column: 'employee_name', op: '=', value: SUITE_ACTOR_NAME },
    { column: 'customer_id', op: '=', value: SUITE_SALE_CUSTOMER },
    { column: 'total_amount', op: '=', value: 1000 },
    { column: 'is_voided', op: '=', value: true },
    { column: 'created_at', op: '>=', value: SUITE_RUN_FROM },
    { column: 'sale_number', op: '~', value: '^SALE-' },
  ],
  credit_limit_requests: [
    { column: 'customer_id', op: '=', value: SUITE_CREDIT_CUSTOMER },
    { column: 'created_at', op: '>=', value: SUITE_RUN_FROM },
  ],
  // The one supplier payment measured in QA on 2026-10-14: 500.00 cash against the SHARED supplier
  // fixture, recorded by the suite identity at 23:18 on 2026-10-13 — inside the same lane burst as the
  // orphaned movements and notifications above, and nothing else has written to this table since. The
  // declaration expects none, and a lane owns its payments, so this is residue; but a payment against
  // a shared fixture cannot be reached by ownership registration, which is why it needs a criterion.
  // All four conditions are required, so a hand-entered payment is not caught by its actor alone.
  supplier_payments: [
    { column: 'recorded_by', op: '=', value: SUITE_ACTOR_ID },
    { column: 'method', op: '=', value: 'cash' },
    { column: 'amount', op: '=', value: 500 },
    { column: 'created_at', op: '>=', value: SUITE_RUN_FROM },
  ],
};

/**
 * The two accounts ONLY an automated suite signs in as — the declaration calls them "the integration
 * suites'" and "the permission suites'" identities. A hand-run of the app signs in as the owner
 * fixture (`…0003`), which is why the notification rule below may rest on the actor at all.
 */
export const SUITE_ACTORS = [
  '10000000-0000-0000-0000-000000000001', // QA Admin — 923009999999
  '10000000-0000-0000-0000-000000000002', // QA Employee — 923008888888
];

/**
 * ORPHAN_RULES — the second residue class: a derived row left behind by a lane's own action.
 *
 * THE DEFECT THAT CLASS DESCRIBES. A lane registers the sale or payment it created; the RPC writes
 * `inventory_movements` and `notifications` beside it. `reference_id` and `entity_id` are polymorphic
 * columns with no foreign key, so when cleanup removed the parent the children stayed — 3 movements and
 * 4 notifications were still in QA on 2026-10-14, every one of them written by a suite account during
 * the 2026-10-13 lane window, and the declaration expects none of them. Nothing in the schema objects
 * to that, so the only thing that can find them is the rule below.
 *
 * THE PARENT TEST IS USED WHERE IT IS AVAILABLE, and the names of the two halves say why:
 *   · `inventory_movements` names its parent precisely (`reference_type` + `reference_id`), so parent
 *     absence is required — an orphan movement can never be a live row, whatever its actor;
 *   · a `payment` notification names the CUSTOMER in `entity_id` on the rows measured here (the
 *     payment id on other paths, which is why both are listed as candidates), and that customer is a
 *     fixture that still exists. The strongest evidence available for it is therefore the ACTOR — an
 *     account only a suite signs in as — plus the lane window. Requiring a missing parent there would
 *     have left exactly these rows in the database and reported them as unattributable.
 *
 * WHAT MAKES A ROW THIS RUN'S, in the order the clauses carry it:
 *   · the actor column names an account from that rule's list (suite-only for notifications, any
 *     fixture for movements) — a hand-entered row names its author;
 *   · it was written in the lane window (2026-10-13 or later). Rows older than that are the manual QA
 *     sessions the declaration protects, exactly as with the sales criterion;
 *   · the parent TYPE is one the rules model, and — where the link is precise — the parent is GONE.
 *     An `entity_type` nobody has measured is preserved: an unknown type must not be read as an
 *     absent parent.
 *
 * `link.parents` maps a type to its candidate parents; a type may map to several, and the row counts
 * as orphaned only when none of them holds it.
 */
export const ORPHAN_RULES = {
  inventory_movements: {
    actor: 'created_by',
    actors: FIXTURE_ACTORS,
    requireParentAbsent: true,
    link: {
      column: 'reference_id',
      typeColumn: 'reference_type',
      parents: [
        ['sale', 'sales'],
        ['void', 'voids'],
      ],
    },
  },
  notifications: {
    actor: 'actor_id',
    actors: SUITE_ACTORS,
    requireParentAbsent: false,
    link: {
      column: 'entity_id',
      typeColumn: 'entity_type',
      parents: [
        ['sale', 'sales'],
        ['payment', 'customer_payments'],
        ['payment', 'customers'],
      ],
    },
  },
};

export const ORPHAN_TABLES = Object.keys(ORPHAN_RULES);

/**
 * The parent candidates for one row's type. Exported so the SQL and the predicate cannot disagree
 * about them — and so a table with no rule throws with its own name rather than matching everything.
 */
export function parentTablesFor(table, type) {
  const rules = ORPHAN_RULES[table];
  if (!rules) {
    throw new Error(
      `qa-excess-criteria: "${table}" has no orphan rule. Only ${ORPHAN_TABLES.join(' and ')} may be ` +
        'removed as residue here — pointing this at users, roles or audit_events is a bug, not a cleanup.',
    );
  }
  return [...new Set(rules.link.parents.filter(([t]) => t === String(type)).map(([, p]) => p))];
}

function actorListSql(column, actors) {
  return `${column} in (${actors.map((a) => `'${a}'`).join(', ')})`;
}

/**
 * The expression for a table, optionally aliased: the type test (with parent absence where the rule
 * requires it), AND-ed with the actor and the lane window.
 *
 * The alias matters for the same reason it does in `excessWhere`: the plan joins to the parent so it
 * can PRINT what is missing, and an unqualified `id` would then be ambiguous.
 */
export function orphanWhere(table, alias) {
  const rules = ORPHAN_RULES[table];
  if (!rules) return parentTablesFor(table, null); // throws, with the table named
  const col = (c) => (alias ? `${alias}.${c}` : c);
  const types = [...new Set(rules.link.parents.map(([t]) => t))];
  const clauses = types.map((type) => {
    if (!rules.requireParentAbsent) return `(${col(rules.link.typeColumn)} = '${type}')`;
    const checks = parentTablesFor(table, type).map(
      (parent, i) => `not exists (select 1 from ${parent} t${i} where t${i}.id = ${col(rules.link.column)})`,
    );
    return `(${col(rules.link.typeColumn)} = '${type}' and ${checks.join('\n        and ')})`;
  });
  return [
    `(${clauses.join('\n     or ')})`,
    actorListSql(col(rules.actor), rules.actors),
    `${col('created_at')} >= '${SUITE_RUN_FROM}'`,
  ].join('\n    and ');
}

/**
 * The same decision in JS. `parentExists(table, id)` says whether a row still exists in `table`; the
 * caller supplies it (the tests supply a map, the tool supplies a query) so the decision can be driven
 * row by row without a database.
 *
 * It is REQUIRED, and has no permissive default: a predicate that silently assumed "no parent" would
 * report every live movement in QA as removable.
 */
export function isOrphanRow(table, row, parentExists) {
  const rules = ORPHAN_RULES[table];
  if (!rules) return parentTablesFor(table, null); // throws, with the table named
  if (typeof parentExists !== 'function') {
    throw new Error('isOrphanRow: parentExists(table, id) is required — it is what makes a row an orphan');
  }
  const actor = row[rules.actor];
  if (!actor || !rules.actors.includes(String(actor))) return false;
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? '');
  if (!createdAt || createdAt < SUITE_RUN_FROM) return false;
  const id = row[rules.link.column];
  if (id == null || String(id) === '') return false;
  const parents = parentTablesFor(table, row[rules.link.typeColumn]);
  if (!parents.length) return false; // an unmodelled type is preserved, never assumed absent
  if (!rules.requireParentAbsent) return true;
  return parents.every((parent) => !parentExists(parent, String(id)));
}

/** The reviewed declaration's identities, restated so the guards can assert preservation. */
export const PRESERVED_SALE_PATTERNS = [/^SALE-/, /^PERM-SALE-/];

/** One rule as a SQL fragment, optionally aliased. */
function sqlFragment(rule, alias) {
  const column = alias ? `${alias}.${rule.column}` : rule.column;
  switch (rule.op) {
    case '=':
      if (typeof rule.value === 'boolean') return `${column} = ${rule.value}`;
      if (typeof rule.value === 'number') return `${column} = ${rule.value}`;
      return `${column} = '${rule.value}'`;
    case '>=':
      return `${column} >= '${rule.value}'`;
    case '~':
      return `${column} ~ '${rule.value}'`;
    default:
      throw new Error(`qa-excess-criteria: unsupported operator "${rule.op}"`);
  }
}

function rulesFor(table) {
  const rules = EXCESS_RULES[table];
  if (!rules) throw new Error(`qa-excess-criteria: no criteria defined for "${table}"`);
  return rules;
}

/**
 * The full expression for a table, optionally aliased.
 *
 * The alias matters: `sales` joins customers/shops, both of which also carry `created_at`, so an
 * unqualified criterion is ambiguous in exactly the query the plan needs.
 */
export function excessWhere(table, alias) {
  return rulesFor(table).map((rule) => sqlFragment(rule, alias)).join('\n    and ');
}

/** One rule evaluated in JS, with the same meaning the SQL gives it. */
function ruleMatches(rule, row) {
  const raw = row[rule.column];
  switch (rule.op) {
    case '=':
      if (typeof rule.value === 'boolean') return raw === true || raw === false ? raw === rule.value : false;
      if (typeof rule.value === 'number') return Number(raw) === rule.value;
      return raw != null && String(raw) === String(rule.value);
    case '>=':
      if (raw == null) return false;
      // ISO timestamps and date-only bounds compare correctly as strings; normalise a Date first.
      return (raw instanceof Date ? raw.toISOString() : String(raw)) >= String(rule.value);
    case '~':
      return typeof raw === 'string' && new RegExp(rule.value).test(raw);
    default:
      throw new Error(`qa-excess-criteria: unsupported operator "${rule.op}"`);
  }
}

/**
 * Would this row be removed? The same rules the remover sends as SQL, evaluated against a row object —
 * so the decision can be tested without a database, and a rule that widens fails a test rather than
 * deleting data.
 */
export function isExcessRow(table, row) {
  return rulesFor(table).every((rule) => ruleMatches(rule, row));
}

/**
 * The rows that must survive, as identities a human can check in the plan output. Exported so the
 * prune tool can PRINT what it is preserving rather than only what it is removing.
 */
export const PRESERVED_BY_CONSTRUCTION = [
  'the 4 sign-in fixture accounts (923001234567, 923001122334, 923009999999, 923008888888)',
  'the canonical baseline roles and their permission rows',
  'QA Supplier A (50000000-0000-0000-0000-000000000001) — FK-referenced by supplier_payments',
  'the 5 QA Admin sales and voids from the manual 2026-10-11/12 sessions',
  'the 7 owner-recorded SALE-xxxxx sales (2 of them in the Baba jaani shop)',
  'PERM-SALE-001 and PERM-SALE-002',
  'the 15 credit_limit_requests from the 2026-10-11/12 sessions',
  'audit_events — system-written history, reported and never bounded',
];

/**
 * What the orphan rule can never remove, so the plan output says it out loud next to the rows it does.
 * Every line is asserted in `tests/unit/qaExcessCriteria.test.ts`.
 */
export const ORPHAN_PRESERVED = [
  'any movement whose referenced sale or void still exists — a live row is never residue',
  'any row whose actor is not in that rule’s list (a hand-run signs in as the owner fixture, not as a suite account)',
  'any row written before 2026-10-13 (the manual QA sessions)',
  `any notification whose entity_type the rules do not model (${[...new Set(ORPHAN_RULES.notifications.link.parents.map(([t]) => t))].join(', ')} only)`,
  'audit_events, users, memberships, roles and every other table the rules do not name',
];
