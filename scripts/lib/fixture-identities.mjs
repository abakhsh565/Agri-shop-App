/**
 * fixture-identities.mjs — the identities that mean "this row is not a customer's row".
 *
 * WHY ONE FILE. There were two lists, and the drift between them is exactly how a production
 * database was declared clean on 2026-10-13 while it held a shop named `Default Shop`, four users
 * keyed by demo identities, two logins on fixture phone numbers and a user literally named
 * `Test QA User`. The guard knew the `10000000-…`/`20000000-…` families and the `923009999999`
 * phone; it did not know the demo (`00000000-…`) family, the two numbers migrations 0009/0018 seed,
 * or the demo names — so a demo-seeding migration sat in `supabase/migrations/` and the scan passed.
 * One definition, three consumers, no drift.
 *
 * Consumers:
 *   * `tests/unit/productionDataPolicy.test.ts` — rule 3 (a fixture identity may not appear on a
 *     surface that ships or configures) and rule 7 (no migration may SEED a row under one).
 *   * `scripts/audit-production-data.mjs` — reads a backup artifact and reports every identity it
 *     finds, so "production holds no test data" is measured from data instead of asserted.
 *
 * WHY LABELS ARE SPLIT. Two of these strings are legitimately visible outside a test database, and a
 * rule that fires on correct code gets deleted rather than fixed:
 *   * `923001234567` is the demo admin's number AND the canonical example in the phone-normalisation
 *     comments (`03001234567` and `923001234567` are the same number) — so a *mention* is fine, a
 *     row under it is not.
 *   * `Sales Employee` is a real system role name in the RBAC catalogue, not an account identity —
 *     so it is not listed at all; migration 0018's employee row is caught by its phone number.
 */

/** The demo tenant the seeding migrations created, and its name. */
export const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** Every identity, with the reason it can only be test data, and the surfaces it is meaningful on. */
export const FIXTURE_IDENTITIES = [
  {
    label: 'fixture-uuid-family',
    pattern: /[1-5]0000000-0000-0000-0000-0000000000/,
    why: 'the seeded fixture id families 10000000-…, 20000000-…, 30000000-…, 40000000-…, 50000000-…',
    // A fixture id is never a real row's key, anywhere.
    contexts: ['row', 'shipped'],
  },
  {
    label: 'demo-tenant',
    pattern: /00000000-0000-0000-0000-0000000000/,
    why: 'the 00000000-… demo identity family the seeding migrations created',
    // ONLY meaningful as a row's own key. Twenty migrations name the default tenant as plain scope,
    // which is why a mention of the bare id is not evidence of anything.
    contexts: ['row'],
  },
  {
    label: 'fixture-phone-qa',
    pattern: /923009999999|923008888888/,
    why: 'a phone number owned by the QA fixture path',
    contexts: ['row', 'shipped'],
  },
  {
    label: 'fixture-phone-demo',
    pattern: /923001234567|923001122334/,
    why: 'a phone number migration 0018 seeded a demo account with',
    // A mention is legitimate (the phone-normalisation comments), a row is not.
    contexts: ['row'],
  },
  {
    label: 'fixture-phone-token',
    pattern: /92300(PERM|DST|FIN|INV)/,
    why: 'a phone number the QA lanes mint for a single run',
    contexts: ['row', 'shipped'],
  },
  {
    label: 'demo-shop-name',
    pattern: /'Default Shop'/,
    why: 'the demo tenant name written by migrations 0009, 0018 and 0026',
    contexts: ['row', 'shipped'],
  },
  {
    label: 'demo-account-name',
    pattern: /'(Shop Owner|Test QA User)'/,
    why: 'a name the demo/fixture path gives an account',
    contexts: ['row', 'shipped'],
  },
  {
    label: 'fixture-record-name',
    pattern: /'(QA Supplier A|QA Product [AB]|QA Customer [ABC]|Test Product|Destruct Test)'/,
    why: 'a fixture record name',
    contexts: ['row', 'shipped'],
  },
];

/** Labels that are evidence even as a mention: shipped code and configuration must not name them. */
export const SHIPPED_SURFACE_LABELS = FIXTURE_IDENTITIES.filter((i) =>
  i.contexts.includes('shipped'),
).map((i) => i.label);

/** Labels that are evidence about a ROW: a value, a key, or a seeded account. */
export const ROW_IDENTITY_LABELS = FIXTURE_IDENTITIES.filter((i) =>
  i.contexts.includes('row'),
).map((i) => i.label);

/** The labels a human recognises on a row: a name or a phone number, never an id. */
export const NAMED_ROW_LABELS = [
  'fixture-phone-qa',
  'fixture-phone-demo',
  'fixture-phone-token',
  'demo-shop-name',
  'demo-account-name',
  'fixture-record-name',
];

const byLabel = new Map(FIXTURE_IDENTITIES.map((i) => [i.label, i]));

/**
 * The labels present in this text, restricted to the labels that are meaningful for `context`.
 * Empty means "nothing test-shaped here" — the only condition under which a surface may be clean.
 */
export function fixtureIdentitiesIn(text, labels = SHIPPED_SURFACE_LABELS) {
  const found = [];
  for (const label of labels) {
    const identity = byLabel.get(label);
    if (identity && identity.pattern.test(text)) found.push(label);
  }
  return found;
}

/** The reason text for a label, for a guard's failure message. */
export function reasonFor(label) {
  return byLabel.get(label)?.why ?? label;
}
