/**
 * qa-provisioning-policy.mjs — the safety boundary for QA auth credential repair.
 *
 * WHY THIS FILE EXISTS. The provisioner used to select every `public.users` row with a phone
 * number. That is safe only on a database containing nothing but disposable fixtures. QA also
 * contains real app accounts, so a broad repair could reset a real person's email, password,
 * phone and email-verification state. This module makes the eligible identities explicit and
 * gives the script one place to enforce them.
 *
 * TARGET IDENTITY. The database endpoint is not a guess. The host and user below are the values
 * recorded in the repository's own QA configuration (`docs/BRANCH_FLOW_CORRECTIONS_VERIFICATION.md`
 * §3) and in the CI fix record that made "Verify QA Database Reachability" pass
 * (`ENGINEERING_OS_STATE.md`). Both are checked by exact equality.
 *
 * THE HOST ALONE DOES NOT IDENTIFY QA. Production uses the SAME pooler hostname
 * (`PHASE_2A_BACKUP_RESTORE.md` records that value as `PROD_DB_HOST`), and Supabase's pooler carries
 * the project ref in the USERNAME. QA is therefore pinned by the (host, user) pair:
 * `validateQaDbUser` requires exactly `postgres.<QA ref>` and rejects the production project's
 * user. Both checks run before a connection is opened.
 *
 * The four IDs are the stable CI-owned fixtures, copied from their two authoritative declarations:
 *   • tests/setup/qa-fixtures.ts  — QA Admin and QA Employee
 *   • scripts/dev/qa-tenant.mjs   — QA Isolation Owner and QA Isolation Employee
 * `tests/unit/qaProvisioningSafety.test.ts` cross-checks this list against both declarations so it
 * cannot silently drift.
 *
 * No function here prints or returns credentials. Callers must never log names, phone numbers,
 * email addresses, or raw auth errors.
 */

export const QA_PROJECT_REF = 'bpybjrjenwccowvtrevu';
export const QA_PROJECT_ORIGIN = `https://${QA_PROJECT_REF}.supabase.co`;

/**
 * The documented QA database endpoint, pinned rather than defaulted.
 *
 * Source of truth: `docs/BRANCH_FLOW_CORRECTIONS_VERIFICATION.md` §3 records
 * `QA_DB_HOST=aws-0-ap-northeast-1.pooler.supabase.com` and `QA_DB_USER=postgres.<QA ref>`;
 * `ENGINEERING_OS_STATE.md` records the same pooler host as the value that made the CI
 * "Verify QA Database Reachability" gate pass. `tests/unit/qaProvisioningSafety.test.ts` fails if
 * these constants stop matching that record.
 */
export const QA_DB_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
export const QA_DB_USER = `postgres.${QA_PROJECT_REF}`;

/**
 * The Supabase pooler presents a certificate chain Node's default trust store
 * does not accept (proven live: PR #13 CI run 42216515271 failed the provision
 * step with SELF_SIGNED_CERT_IN_CHAIN the moment this was `true`). So TLS
 * verification stays off here, exactly as in every other QA database script in
 * this repo (scripts/migrate.mjs, scripts/lib/qa-connection.mjs, all of
 * scripts/dev/*). The connection is still encrypted, and the compensating
 * control is the exact target pinning above: validateQaDbHost / validateQaDbUser
 * refuse any host or user that is not this pooler and this project, so the
 * script cannot be pointed at another database. Do not flip this back to `true`
 * without first proving a live connection from a GitHub runner.
 */
export const QA_DB_SSL = Object.freeze({ rejectUnauthorized: false });

/** The complete set of app users whose QA auth credentials may ever be repaired. */
export const QA_PROVISIONING_FIXTURES = Object.freeze([
  Object.freeze({ id: '10000000-0000-0000-0000-000000000001', phone: '923009999999' }),
  Object.freeze({ id: '10000000-0000-0000-0000-000000000002', phone: '923008888888' }),
  Object.freeze({ id: '90000000-0000-0000-0000-0000000000a1', phone: '923007700001' }),
  Object.freeze({ id: '90000000-0000-0000-0000-0000000000a2', phone: '923007700002' }),
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same normalization as src/lib/auth.ts: local PK numbers become 92XXXXXXXXXX. */
export function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0')) return '92' + digits.slice(1);
  if (digits.startsWith('92')) return digits;
  return '92' + digits;
}

/**
 * Reject an absent, empty, duplicate, or malformed allowlist before any database or auth call.
 * Returns the allowlist so callers can use it directly.
 */
export function assertNonEmptyAllowlist(fixtures = QA_PROVISIONING_FIXTURES) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('Refusing to provision: the QA fixture allowlist is empty.');
  }
  const ids = new Set();
  for (const fixture of fixtures) {
    if (!fixture || !UUID_RE.test(String(fixture.id)) || !fixture.phone) {
      throw new Error('Refusing to provision: the QA fixture allowlist is malformed.');
    }
    if (ids.has(fixture.id)) {
      throw new Error('Refusing to provision: the QA fixture allowlist contains a duplicate id.');
    }
    ids.add(fixture.id);
  }
  return fixtures;
}

/**
 * Require the exact QA Supabase origin, HTTPS, root path, and no credentials/query/hash.
 * A substring match would accept an attacker-controlled URL that merely mentions the ref.
 */
export function validateQaProjectUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('Refusing to run: QA_SUPABASE_URL is not a valid URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== QA_PROJECT_ORIGIN ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Refusing to run: QA_SUPABASE_URL is not the exact QA Supabase project URL.');
  }
  return QA_PROJECT_ORIGIN;
}

/**
 * Require exactly the documented QA pooler hostname.
 *
 * Exact equality, not a suffix or substring test: `.includes(...)` would accept
 * `<host>.evil.example`, and pg would then resolve an attacker-controlled name. The comparison is
 * case-insensitive only because DNS is; the empty string and whitespace fail closed. Ports, paths,
 * connection URLs and a trailing root dot are all rejected here because none of them equals the
 * documented host.
 */
export function validateQaDbHost(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) {
    throw new Error('Refusing to run: QA_DB_HOST is missing.');
  }
  if (value !== QA_DB_HOST) {
    throw new Error('Refusing to run: QA_DB_HOST is not the documented QA database host.');
  }
  return QA_DB_HOST;
}

/**
 * Require exactly the documented QA database user, `postgres.<QA ref>`.
 *
 * This is the check that excludes production, which shares the pooler hostname: the pooler routes
 * on the project ref in the username, so a different project's user cannot reach QA. The message
 * never echoes the rejected value.
 */
export function validateQaDbUser(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error('Refusing to run: QA_DB_USER is missing.');
  }
  if (value !== QA_DB_USER) {
    throw new Error('Refusing to run: QA_DB_USER is not the documented QA database user.');
  }
  return QA_DB_USER;
}

/**
 * Reject any query result that is not exactly an allowlisted fixture.
 * This is a second, independent check after the SQL itself is scoped by id.
 */
export function assertUsersAllowed(users, fixtures = QA_PROVISIONING_FIXTURES) {
  const allowlist = assertNonEmptyAllowlist(fixtures);
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('Refusing to provision: no allowlisted QA fixture users were found.');
  }

  const expected = new Map(allowlist.map((fixture) => [fixture.id, normalizePhone(fixture.phone)]));
  const unexpected = users.filter((user) => !expected.has(String(user?.id)));
  if (unexpected.length) {
    throw new Error('Refusing to provision: an unexpected user is outside the QA fixture allowlist.');
  }

  const mismatched = users.filter(
    (user) => !user.phone || normalizePhone(user.phone) !== expected.get(String(user.id)),
  );
  if (mismatched.length) {
    throw new Error('Refusing to provision: an allowlisted fixture has an unexpected phone number.');
  }

  return users;
}
