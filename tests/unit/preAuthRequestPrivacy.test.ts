/**
 * The pre-login lookup returns what the screen shows — nothing else.
 *
 * THE DEFECT THIS PINS DOWN. `get_my_shop_request` answers the sign-in gate before any session
 * exists, so it is anon-callable by design (measured on the deployed catalogs: PUBLIC, `anon` and
 * `authenticated` all hold EXECUTE). It answered with `row_to_json(sr)` — the whole application row
 * — while the only pre-login consumer, RegisterStatusPage, renders five of its fields. So a caller
 * who knew a phone number also received the applicant's CNIC front/back and business-licence URLs,
 * the shop's exact coordinates, the registry number, and which admin reviewed it.
 * `0200_the_pre_login_lookup_returns_only_what_the_screen_shows.sql` projects the answer; this file
 * runs both bodies against a real Postgres engine (PGlite, no environment contacted) and holds the
 * new one to the exact key set.
 *
 * THE NON-VACUITY CONTROL IS THE OLD BODY. It is applied first, with the same fixture, and asserted
 * to leak — a copy of the captured deployed definition (`backups/def-get_my_shop_request.sql`), kept
 * here because that capture lives in gitignored `backups/`. If the projection check would pass on
 * the old body too, the first block fails.
 *
 * The table is declared with the deployed column list, measured read-only on the deployed schema
 * (23 columns, `backups/shop-requests-privacy-2026-10-13.log`) and asserted below, so the fixture
 * cannot drift away from the schema this is about. The second half does the same for the
 * production-shaped table, because 0200 is also the file that would CREATE this function on
 * production, and its body therefore has to run on a schema that is narrower than this one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitStatements } from '../../scripts/lib/sql-statements.mjs';

const MIGRATION = 'supabase/migrations/0200_the_pre_login_lookup_returns_only_what_the_screen_shows.sql';
const ACCOUNT_MIGRATION =
  'supabase/migrations/0201_the_pre_login_lookup_answers_for_the_number_only.sql';
const REQUEST_ID = 'e2000000-0000-4000-8000-000000000001';
const KNOWN_PHONE = '923009200001';
const UNKNOWN_PHONE = '923009200099';

/** The deployed answer, before this change: the whole row, as captured from the live schema. */
const CAPTURED_WHOLE_ROW_BODY = `
CREATE OR REPLACE FUNCTION public.get_my_shop_request(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT row_to_json(sr) INTO result FROM shop_requests sr WHERE sr.owner_phone = p_phone OR sr.phone = p_phone;
  IF result IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object('found', true, 'request', result);
END;
$function$
`;

/** What the pre-login screens render (and the two fields the client type requires). */
const REQUIRED_KEYS = [
  'created_at',
  'id',
  'owner_name',
  'owner_phone',
  'rejection_reason',
  'shop_name',
  'shop_type',
  'status',
  'updated_at',
];

/** Fields no pre-login screen renders, several of them sensitive: the leak this file is about. */
const FORBIDDEN_KEYS = [
  'cnic_front_url',
  'cnic_back_url',
  'business_license_url',
  'logo_url',
  'latitude',
  'longitude',
  'location_label',
  'location_source',
  'business_registration_number',
  'shop_address',
  'shop_city',
  'reviewed_by',
  'reviewed_at',
];

const db = new PGlite();

/** The account the `lookup_user_by_phone` half of this file is about. */
const ACCOUNT_ID = 'e2100000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT_ID = 'e2100000-0000-4000-8000-000000000002';
const CLOSED_ACCOUNT_ID = 'e2100000-0000-4000-8000-000000000003';
const ACCOUNT_PHONE = '923009300001';
const CLOSED_ACCOUNT_PHONE = '923009300003';
const TENANT_ID = 'e2100000-0000-4000-8000-0000000000a1';
const SHOP_ID = 'e2100000-0000-4000-8000-0000000000c1';
const MEMBERSHIP_ID = 'e2100000-0000-4000-8000-0000000000b1';

/**
 * The deployed body, before 0201: the whole account row plus its membership context.
 *
 * A copy of the capture in `backups/def-lookup_user_by_phone.sql` (gitignored), kept here for the
 * same reason as the shop-request capture: the control has to be the real pre-fix body, not a
 * paraphrase of it.
 */
const CAPTURED_ACCOUNT_BODY = `
CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user jsonb;
  v_membership jsonb;
  v_canonical text := public.canonical_phone(p_phone);
  v_user_id uuid;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'name', u.name,
    'phone', u.phone,
    'role', u.role,
    'is_original_owner', u.is_original_owner,
    'is_active', u.is_active,
    'employee_number', u.employee_number,
    'job_title', u.job_title,
    'first_login_at', u.first_login_at,
    'last_login_at', u.last_login_at,
    'deactivated_at', u.deactivated_at,
    'deactivated_by', u.deactivated_by,
    'created_by', u.created_by,
    'created_at', u.created_at,
    'photo_url', u.photo_url,
    'shop_id', u.shop_id
  ) INTO v_user
  FROM users u
  WHERE v_canonical IS NOT NULL
    AND public.canonical_phone(u.phone) = v_canonical
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  v_user_id := (v_user->>'id')::uuid;

  SELECT jsonb_build_object(
    'tenant_id', m.tenant_id,
    'membership_id', m.id,
    'membership_role', m.role,
    'membership_status', m.status,
    'branch_scope', m.branch_scope
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = v_user_id
  ORDER BY (m.tenant_id = public.resolve_active_shop(v_user_id)) DESC,
           (m.status = 'active') DESC,
           m.created_at ASC
  LIMIT 1;

  IF v_membership IS NOT NULL THEN
    v_user := v_user || v_membership;
  END IF;

  RETURN v_user;
END; $function$;
`;

/** The door answer the unauthenticated sign-in gate is allowed to receive. */
const DOOR_KEYS = ['is_active', 'role'];

/** The full account answer, for a caller authenticated AS the account being looked up. */
const ACCOUNT_KEYS = [
  'created_at',
  'created_by',
  'deactivated_at',
  'deactivated_by',
  'employee_number',
  'first_login_at',
  'id',
  'is_active',
  'is_original_owner',
  'job_title',
  'last_login_at',
  'membership_id',
  'membership_role',
  'membership_status',
  'name',
  'phone',
  'photo_url',
  'role',
  'shop_id',
  'tenant_id',
  'branch_scope',
].sort();

/** Employment, identification and tenant metadata no pre-session caller may receive. */
const FORBIDDEN_ACCOUNT_KEYS = [
  'photo_url',
  'employee_number',
  'job_title',
  'is_original_owner',
  'created_by',
  'deactivated_by',
  'deactivated_at',
  'first_login_at',
  'last_login_at',
  'created_at',
  'tenant_id',
  'membership_id',
  'membership_role',
  'membership_status',
  'branch_scope',
  'shop_id',
];

async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await run();
    await db.exec('RESET ROLE; COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

/** The shape the client parses: `{ found, request }` or `{ found: false }`. */
async function lookup(role: string, phone: string) {
  return asRole(role, async () => {
    const { rows } = await db.query<{ r: { found: boolean; request?: Record<string, unknown> } }>(
      'SELECT public.get_my_shop_request($1) AS r',
      [phone],
    );
    return rows[0].r;
  });
}

/**
 * The camelCase → snake_case translation the client performs, read from the store's own
 * `requestFromRow` so this scan cannot drift from the mapping it is checking.
 */
function storeFieldPairs(): Record<string, string> {
  const store = fs.readFileSync(path.resolve('src/stores/shopRequestsStore.ts'), 'utf8');
  const body = store.slice(store.indexOf('function requestFromRow'));
  const pairs: Record<string, string> = {};
  for (const match of body.matchAll(/(\w+):\s*r\.(\w+)/g)) pairs[match[1]] = match[2];
  return pairs;
}

/**
 * Every request field the pre-login surface reads, in the snake_case the RPC answers with.
 *
 * A camelCase name resolves through the store's mapping; a lower-case name is taken as the column
 * itself (`auth.ts` reads `request?.status` straight off the RPC answer); an unknown camelCase name
 * cannot fail silently — it is reported as itself, because nothing in the projection can cover it.
 */
function preLoginFieldsRead(sources: string[]): Set<string> {
  const pairs = storeFieldPairs();
  const fields = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:myRequest|request)(?:\?\.|\.)([a-zA-Z_]+)/g)) {
      const name = match[1];
      // Through the store's mapping when it knows the name; otherwise the name is taken as the
      // column itself (`auth.ts` reads `request?.status` straight off the RPC answer).
      fields.add(pairs[name] ?? name);
    }
  }
  return fields;
}

/**
 * The fields `checkPhoneRegistration` reads off the account lookup, taken from its own body rather
 * than from a list kept by hand. It is the only consumer on the pre-session path.
 */
function preAuthAccountFieldsRead(): Set<string> {
  const source = fs.readFileSync(path.resolve('src/lib/auth.ts'), 'utf8');
  const start = source.indexOf('export async function checkPhoneRegistration');
  const next = source.indexOf('export async function', start + 10);
  const body = source.slice(start, next === -1 ? undefined : next);
  const fields = new Set<string>();
  for (const match of body.matchAll(/\brow\.([a-zA-Z_]+)/g)) fields.add(match[1]);
  return fields;
}

/** The screens and library code that run BEFORE a session exists. */
const PRE_LOGIN_SOURCES = [
  'src/pages/register/RegisterStatusPage.tsx',
  'src/pages/register/RegisterOTPPage.tsx',
  'src/pages/register/RegisterPhonePage.tsx',
  'src/lib/auth.ts',
];

async function executeStatementsOn(target: PGlite, file: string) {
  for (const statement of splitStatements(fs.readFileSync(path.resolve(file), 'utf8'))) {
    await target.exec(statement);
  }
}

async function executeStatements(file: string) {
  await executeStatementsOn(db, file);
}

beforeAll(async () => {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE public.shop_request_status AS ENUM ('pending','approved','hold','rejected');
    CREATE TABLE public.shop_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_name varchar(255) NOT NULL,
      owner_name varchar(255) NOT NULL,
      phone varchar(20) NOT NULL,
      status public.shop_request_status NOT NULL DEFAULT 'pending',
      reviewed_by uuid,
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      owner_phone varchar(20),
      shop_address text,
      shop_city varchar(100),
      shop_type varchar(50) DEFAULT 'retail',
      business_registration_number varchar(100),
      logo_url text,
      cnic_front_url text,
      cnic_back_url text,
      business_license_url text,
      rejection_reason text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      latitude double precision,
      longitude double precision,
      location_label text,
      location_source text
    );
  `);

  // The fixture carries every field the leak exposed, so its absence later is a fact about the
  // function rather than about the data.
  await db.query(
    `INSERT INTO public.shop_requests
       (id, shop_name, owner_name, phone, owner_phone, status, shop_address, shop_city, shop_type,
        business_registration_number, logo_url, cnic_front_url, cnic_back_url, business_license_url,
        rejection_reason, latitude, longitude, location_label, location_source)
     VALUES ($1,'QA Privacy Shop','QA Privacy Owner',$2,$2,'hold','Old Bazaar Road','Lahore','retail',
        'REG-0001','https://example.invalid/logo.png','https://example.invalid/cnic-front.jpg',
        'https://example.invalid/cnic-back.jpg','https://example.invalid/licence.pdf',
        'Documents were unreadable',31.5204,74.3587,'Old Bazaar Road','map')`,
    [REQUEST_ID, KNOWN_PHONE],
  );

  await db.exec(CAPTURED_WHOLE_ROW_BODY);

  // ── The account lookup's own fixture (`lookup_user_by_phone`, narrowed by 0201) ────────────────
  // The deployed lineage: `canonical_phone(text)`, `resolve_active_shop(uuid)` and a `memberships`
  // table all exist, which is why the deployed body could name them unguarded.
  await db.exec(`
    CREATE TABLE public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255),
      phone varchar(20),
      role text,
      is_original_owner boolean DEFAULT false,
      is_active boolean DEFAULT true,
      employee_number varchar(50),
      job_title varchar(100),
      photo_url text,
      shop_id uuid,
      first_login_at timestamptz,
      last_login_at timestamptz,
      deactivated_at timestamptz,
      deactivated_by uuid,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      tenant_id uuid NOT NULL,
      role text,
      status text,
      branch_scope text[],
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION public.canonical_phone(p text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(regexp_replace(coalesce(p,''), '[^0-9]', '', 'g'), '') $$;
    CREATE OR REPLACE FUNCTION public.resolve_active_shop(p_user uuid) RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT tenant_id FROM public.memberships WHERE user_id = p_user ORDER BY created_at LIMIT 1 $$;
    -- Verbatim from 0009, as 0126 hardened it: the JWT subject, which is users.id.
    CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
      $$;
  `);

  await db.query(
    `INSERT INTO public.users
       (id, name, phone, role, is_original_owner, is_active, employee_number, job_title, photo_url,
        shop_id, first_login_at, last_login_at, created_by)
     VALUES ($1,'QA Account Owner',$2,'admin',true,true,'EMP-0007','Shop Owner',
        'https://example.invalid/owner-photo.jpg','e2100000-0000-4000-8000-0000000000c1',
        '2026-01-01T00:00:00Z','2026-09-01T00:00:00Z','e2100000-0000-4000-8000-0000000000d1'),
            ($3,'QA Closed Account',$4,'employee',false,false,'EMP-0008','Salesman',NULL,NULL,NULL,NULL,NULL)`,
    [ACCOUNT_ID, ACCOUNT_PHONE, CLOSED_ACCOUNT_ID, CLOSED_ACCOUNT_PHONE],
  );

  await db.query(
    `INSERT INTO public.memberships (id, user_id, tenant_id, role, status, branch_scope)
     VALUES ($1,$2,$3,'owner','active','{"e2100000-0000-4000-8000-0000000000c1"}')`,
    [MEMBERSHIP_ID, ACCOUNT_ID, TENANT_ID],
  );
});

afterAll(async () => {
  await db.close();
});

describe('the answer this file is about', () => {
  it('is the deployed schema: 23 columns, documents and coordinates included', async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'shop_requests'`,
    );
    expect(rows[0].n).toBe(23);
  });

  it('can be seen to leak under the captured body — the check is not vacuous', async () => {
    const result = await lookup('anon', KNOWN_PHONE);

    expect(result.found).toBe(true);
    const keys = Object.keys(result.request ?? {});
    // The old body returned the whole row, so the fixture's documents and coordinates came with it.
    for (const key of ['cnic_front_url', 'cnic_back_url', 'business_license_url', 'latitude', 'reviewed_by']) {
      expect(keys, `the captured body should expose ${key}`).toContain(key);
    }
    expect(result.request?.cnic_front_url).toBe('https://example.invalid/cnic-front.jpg');
  });
});

describe('the ledger\'s projection', () => {
  beforeAll(async () => {
    await executeStatements(MIGRATION);
  });

  it('returns exactly the fields the pre-login screens render, and none of the ones they do not', async () => {
    const result = await lookup('anon', KNOWN_PHONE);

    expect(result.found).toBe(true);
    expect(Object.keys(result.request ?? {}).sort()).toEqual(REQUIRED_KEYS);

    for (const key of FORBIDDEN_KEYS) {
      expect(Object.keys(result.request ?? {})).not.toContain(key);
    }

    // The values the status screen actually renders, still delivered.
    expect(result.request?.created_at).toBeTruthy();
    expect(new Date(String(result.request?.created_at)).toString()).not.toBe('Invalid Date');
    expect(result.request?.status).toBe('hold');
    expect(result.request?.rejection_reason).toBe('Documents were unreadable');
    expect(result.request?.owner_name).toBe('QA Privacy Owner');
    expect(result.request?.owner_phone).toBe(KNOWN_PHONE);
    expect(result.request?.shop_name).toBe('QA Privacy Shop');
  });

  it('still answers the gate for a number with no application', async () => {
    expect(await lookup('anon', UNKNOWN_PHONE)).toEqual({ found: false });
  });

  it('keeps the ACL the deployed catalogs carry: anon and authenticated by name, service_role via PUBLIC', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query<{ ok: boolean }>(
        `SELECT has_function_privilege($1, 'public.get_my_shop_request(text)', 'EXECUTE') AS ok`,
        [role],
      );
      expect(rows[0].ok, `${role} must be able to execute the pre-login lookup`).toBe(true);
    }
  });

  it('keeps the search_path pinned and no whole-row dump anywhere in the executable body', async () => {
    const { rows } = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.get_my_shop_request(text)'::regprocedure) AS def`,
    );
    const def = rows[0].def;
    expect(def).toContain('SET search_path TO');

    // The comment above the lookup explains the lineage problem and therefore names the columns
    // that only one lineage has; `pg_get_functiondef` returns the body with its comments, so the
    // behavioural check runs on the code with comments removed.
    const code = def
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    expect(code).not.toContain('row_to_json');
    for (const key of ['cnic_front_url', 'cnic_back_url', 'business_license_url', 'latitude', 'longitude', 'reviewed_by']) {
      expect(code, `the executable body must not mention ${key}`).not.toContain(key);
    }
    // …and the accessor that makes the body portable is a column reference, not prose: it has to be
    // in the code, or the production shape would break at the first call.
    expect(code).toContain("to_jsonb(sr) ->> 'phone'");
  });
});

/**
 * THE SECOND LINEAGE, and the reason the lookup may not name `phone` as a column.
 *
 * 0200 does not only narrow the function on staging/QA — production has no
 * `public.get_my_shop_request(text)` at all (measured: 28 tables / 37 functions, none of them this),
 * so this file is what would CREATE it there. That turns the body's portability into a requirement:
 * production's `shop_requests` is 18 columns with no `phone` and no coordinates, read from
 * `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-01T11-21-48.sql`. A body that NAMES
 * `phone` — exactly what the captured deployed definition does — raises
 * `column "phone" does not exist` on that shape, at the first call. No creation-time check can see
 * it: PL/pgSQL resolves column references when the function runs, not when it is defined, which is
 * why the baseline replay of 0200 passes on production while the old body would still break there.
 * Both bodies are run against a production-shaped table here.
 */
describe('the production-shaped table (18 columns, no `phone`, no coordinates)', () => {
  const production = new PGlite();
  const PRODUCTION_PHONE = '923009200002';
  const PRODUCTION_ID = 'e2000000-0000-4000-8000-000000000002';

  /** Same call shape as above, against a different database handle. */
  async function lookupOn(target: PGlite, phone: string) {
    await target.exec('BEGIN');
    try {
      await target.exec('SET LOCAL ROLE anon');
      const { rows } = await target.query<{ r: { found: boolean; request?: Record<string, unknown> } }>(
        'SELECT public.get_my_shop_request($1) AS r',
        [phone],
      );
      await target.exec('RESET ROLE; COMMIT');
      return rows[0].r;
    } catch (error) {
      await target.exec('ROLLBACK');
      throw error;
    }
  }

  beforeAll(async () => {
    // Column list copied from the production baseline dump, types and enum included.
    await production.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TYPE public.shop_request_status AS ENUM ('pending','approved','hold','rejected');
      CREATE TABLE public.shop_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_name varchar(255) NOT NULL,
        owner_phone varchar(20) NOT NULL,
        shop_name varchar(255) NOT NULL,
        shop_address text,
        shop_city varchar(100),
        shop_type varchar(50) DEFAULT 'retail',
        business_registration_number varchar(100),
        logo_url text,
        cnic_front_url text,
        cnic_back_url text,
        business_license_url text,
        status public.shop_request_status NOT NULL DEFAULT 'pending',
        reviewed_by uuid,
        reviewed_at timestamptz,
        rejection_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await production.query(
      `INSERT INTO public.shop_requests
         (id, owner_name, owner_phone, shop_name, shop_type, status, rejection_reason,
          cnic_front_url, cnic_back_url, business_license_url)
       VALUES ($1,'Production Owner',$2,'Production Shop','retail','rejected','Licence expired',
          'https://example.invalid/p-front.jpg','https://example.invalid/p-back.jpg',
          'https://example.invalid/p-licence.pdf')`,
      [PRODUCTION_ID, PRODUCTION_PHONE],
    );
  });

  afterAll(async () => {
    await production.close();
  });

  it('is the narrower shape this half is about: 18 columns, no `phone`', async () => {
    const { rows } = await production.query<{ n: number; has_phone: boolean; has_lat: boolean }>(
      `SELECT count(*)::int AS n,
              bool_or(column_name = 'phone') AS has_phone,
              bool_or(column_name = 'latitude') AS has_lat
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'shop_requests'`,
    );
    expect(rows[0].n).toBe(18);
    expect(rows[0].has_phone).toBe(false);
    expect(rows[0].has_lat).toBe(false);
  });

  it('cannot run the captured deployed body there — it names a column production does not have', async () => {
    await production.exec(CAPTURED_WHOLE_ROW_BODY);
    await expect(lookupOn(production, PRODUCTION_PHONE)).rejects.toThrow(/phone/);
  });

  it('runs the ledger\'s body and answers with the same key set as on the deployed shape', async () => {
    await executeStatementsOn(production, MIGRATION);
    const result = await lookupOn(production, PRODUCTION_PHONE);

    expect(result.found).toBe(true);
    expect(Object.keys(result.request ?? {}).sort()).toEqual(REQUIRED_KEYS);
    // The values the status screen renders, still delivered on this shape.
    expect(new Date(String(result.request?.created_at)).toString()).not.toBe('Invalid Date');
    expect(result.request?.status).toBe('rejected');
    expect(result.request?.rejection_reason).toBe('Licence expired');
    expect(result.request?.owner_name).toBe('Production Owner');
    expect(result.request?.owner_phone).toBe(PRODUCTION_PHONE);
    expect(result.request?.shop_name).toBe('Production Shop');
  });
});

/**
 * The other half of the contract: the projection has to COVER what the pre-login surface reads.
 *
 * A security fix and the flow it protects pull in opposite directions. Narrowing the answer is the
 * point; a field dropped from it that some pre-session screen renders does not throw — it renders
 * blank, or `new Date(undefined)` renders "Invalid Date", which is how a privacy fix turns into a
 * silent onboarding bug. So the read set is derived from the consumers themselves rather than from a
 * hand-kept list, and a new pre-login field fails here instead of shipping as an empty row.
 */
describe('the projection covers what the pre-login surface reads', () => {
  const sourceTexts = PRE_LOGIN_SOURCES.map((file) => fs.readFileSync(path.resolve(file), 'utf8'));

  it('reads a real set of fields, and every one of them is in the projection', () => {
    const read = preLoginFieldsRead(sourceTexts);
    expect(read.size, 'the scan must find real field reads, not an empty match').toBeGreaterThan(4);

    const uncovered = [...read].filter((field) => !REQUIRED_KEYS.includes(field)).sort();
    expect(uncovered, 'read before sign-in, but missing from the projection').toEqual([]);
  });

  it('would catch a screen that starts rendering a field the projection drops — not vacuous', () => {
    const injected =
      'const city = myRequest.shopCity;\nconst lat = request.latitude;\nconst who = myRequest.reviewedBy;\n';
    const uncovered = [...preLoginFieldsRead([injected])]
      .filter((field) => !REQUIRED_KEYS.includes(field))
      .sort();

    expect(uncovered).toEqual(['latitude', 'reviewed_by', 'shop_city']);
  });

  it('resolves camelCase through the store\'s own mapping rather than guessing', () => {
    const pairs = storeFieldPairs();
    expect(pairs.createdAt).toBe('created_at');
    expect(pairs.reviewedBy).toBe('reviewed_by');
    expect([...preLoginFieldsRead(['x = myRequest.createdAt;'])]).toEqual(['created_at']);
  });
});

/**
 * The second pre-authentication lookup: `lookup_user_by_phone`.
 *
 * THE DEFECT THIS PINS DOWN. It is anon-callable by design — `checkPhoneRegistration` asks it before
 * a code is sent — and it answered with the whole account: 21 fields, including the employment
 * record (`employee_number`, `job_title`, `created_by`, `deactivated_by`), the lifecycle stamps, the
 * profile photo, and the tenant/membership context. `checkPhoneRegistration` reads **two** of them.
 * `0201_the_pre_login_lookup_answers_for_the_number_only.sql` scopes the answer to the identity the
 * caller has proved: an unauthenticated caller (or one authenticated as somebody else) gets the door
 * answer, and only the account's own authenticated session gets the full row.
 *
 * NON-VACUITY IS THE CAPTURED DEPLOYED BODY, applied first to the same fixture: it must be SEEN to
 * hand `photo_url`, `tenant_id` and the rest to an anonymous caller, or the assertions below prove
 * nothing.
 */
describe('the account lookup carries the door answer and nothing else', () => {
  /** Call it as a role, optionally with a JWT subject — how an authenticated caller is simulated. */
  async function accountLookup(role: string, phone: string, sub?: string) {
    await db.exec('BEGIN');
    try {
      await db.exec(`SET LOCAL ROLE ${role}`);
      // Always a valid claims document, as Supabase always sends one: `{}` is an anonymous caller
      // (no `sub`), a `sub` is an authenticated one.
      await db.exec(
        `SELECT set_config('request.jwt.claims', '${sub ? `{"sub":"${sub}"}` : '{}'}', true)`,
      );
      const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
        'SELECT public.lookup_user_by_phone($1) AS r',
        [phone],
      );
      await db.exec('RESET ROLE; COMMIT');
      return rows[0].r;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  it('can be seen to hand the whole account to an anonymous caller — the check is not vacuous', async () => {
    // The deployed body first, on the same fixture, exactly as the shop-request control does.
    await db.exec(CAPTURED_ACCOUNT_BODY);
    const answer = await accountLookup('anon', ACCOUNT_PHONE);

    expect(answer).not.toBeNull();
    for (const key of ['photo_url', 'employee_number', 'job_title', 'tenant_id', 'membership_role', 'branch_scope']) {
      expect(Object.keys(answer ?? {}), `the captured body should expose ${key}`).toContain(key);
    }
    expect(answer?.photo_url).toBe('https://example.invalid/owner-photo.jpg');
    expect(answer?.job_title).toBe('Shop Owner');
  });

  describe('after 0201', () => {
    beforeAll(async () => {
      await executeStatements(ACCOUNT_MIGRATION);
    });

    it('gives an anonymous caller the door answer and only the door answer', async () => {
      const answer = await accountLookup('anon', ACCOUNT_PHONE);

      expect(Object.keys(answer ?? {}).sort()).toEqual(DOOR_KEYS);
      expect(answer?.is_active).toBe(true);
      expect(answer?.role).toBe('admin');
      for (const key of FORBIDDEN_ACCOUNT_KEYS) {
        expect(Object.keys(answer ?? {}), `an anonymous caller must not receive ${key}`).not.toContain(key);
      }
    });

    it('gives a DIFFERENT authenticated account the door answer too', async () => {
      const answer = await accountLookup('authenticated', ACCOUNT_PHONE, OTHER_ACCOUNT_ID);
      expect(Object.keys(answer ?? {}).sort()).toEqual(DOOR_KEYS);
    });

    it('gives the account itself the full row, which is what the sign-in flow builds its session from', async () => {
      const answer = await accountLookup('authenticated', ACCOUNT_PHONE, ACCOUNT_ID);

      expect(Object.keys(answer ?? {}).sort()).toEqual(ACCOUNT_KEYS);
      expect(answer?.id).toBe(ACCOUNT_ID);
      expect(answer?.photo_url).toBe('https://example.invalid/owner-photo.jpg');
      expect(answer?.tenant_id).toBe(TENANT_ID);
      expect(answer?.membership_id).toBe(MEMBERSHIP_ID);
      expect(answer?.branch_scope).toEqual([SHOP_ID]);
    });

    it('keeps the deactivated refusal, decided before any session exists', async () => {
      const answer = await accountLookup('anon', CLOSED_ACCOUNT_PHONE);
      expect(answer?.is_active).toBe(false);
      expect(answer?.role).toBe('employee');
      expect(Object.keys(answer ?? {}).sort()).toEqual(DOOR_KEYS);
    });

    it('still answers NULL for a number with no account — the client\'s not-registered signal', async () => {
      expect(await accountLookup('anon', '923009399999')).toBeNull();
    });

    it('keeps the search_path pin, names no forbidden field in its code, and guards what a lineage may lack', async () => {
      const { rows } = await db.query<{ def: string }>(
        `SELECT pg_get_functiondef('public.lookup_user_by_phone(text)'::regprocedure) AS def`,
      );
      const def = rows[0].def;
      expect(def).toContain('SET search_path TO');

      const code = def
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
      expect(code).not.toContain('row_to_json');
      // Each object only one lineage has sits behind its own guard: an unreached PL/pgSQL statement
      // is never compiled, which is why the older lineage cannot fail on a name it does not have.
      expect(code).toContain("to_regprocedure('public.canonical_phone(text)')");
      expect(code).toContain("to_regclass('public.memberships')");
      expect(code).toContain("to_regprocedure('public.resolve_active_shop(uuid)')");
      expect(code).toContain('public.app_current_user_id()');

      // The active-shop rule tests/integration/tenantResolverReplay.test.ts holds against the live
      // bodies, kept true here too: this function is on its RESOLVERS list, and a caller-scoped
      // "oldest membership" derivation has to consult the chain, not fall back to it. The chain is
      // read inside the ORDER BY itself, exactly as the deployed body read it.
      const chainFirst = code.indexOf('ORDER BY (m.tenant_id = public.resolve_active_shop(v_user_id))');
      const oldestRow = code.indexOf('m.created_at ASC');
      expect(chainFirst, 'the chain must be read in the ORDER BY itself').toBeGreaterThan(-1);
      expect(oldestRow, 'the oldest-membership tiebreak must still be there').toBeGreaterThan(chainFirst);
    });

    it('covers what the pre-session consumer reads, derived from its own source', async () => {
      const read = preAuthAccountFieldsRead();
      expect(read.size, 'the scan must find real field reads').toBeGreaterThan(1);
      expect([...read].filter((field) => !DOOR_KEYS.includes(field)).sort()).toEqual([]);

      // …and it would catch a consumer that starts reading a field the door answer no longer has.
      const uncovered = ['is_active', 'role', 'job_title', 'photo_url']
        .filter((field) => !DOOR_KEYS.includes(field))
        .sort();
      expect(uncovered).toEqual(['job_title', 'photo_url']);
    });
  });
});

/**
 * THE OLDER LINEAGE. Production has no `canonical_phone(text)`, no `resolve_active_shop(uuid)` and no
 * `memberships` table, and carries a 14-field body of this same function — so 0201 replaces a body
 * whose neighbours it cannot name. Naming one unguarded would raise `function public.canonical_phone(text)
 * does not exist` at the first call on production, which no create-time replay can detect. Both halves
 * are proved here against a production-shaped schema.
 */
describe('the older lineage (no canonical_phone, no memberships)', () => {
  const legacy = new PGlite();
  const LEGACY_ID = 'e2200000-0000-4000-8000-000000000001';
  const LEGACY_PHONE = '923009500001';

  async function legacyLookup(phone: string, sub?: string) {
    await legacy.exec('BEGIN');
    try {
      await legacy.exec('SET LOCAL ROLE anon');
      await legacy.exec(
        `SELECT set_config('request.jwt.claims', '${sub ? `{"sub":"${sub}"}` : '{}'}', true)`,
      );
      const { rows } = await legacy.query<{ r: Record<string, unknown> | null }>(
        'SELECT public.lookup_user_by_phone($1) AS r',
        [phone],
      );
      await legacy.exec('RESET ROLE; COMMIT');
      return rows[0].r;
    } catch (error) {
      await legacy.exec('ROLLBACK');
      throw error;
    }
  }

  beforeAll(async () => {
    // The 18 columns production's `users` actually has, and nothing else — no memberships table.
    await legacy.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE public.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255),
        phone varchar(20),
        role text,
        is_original_owner boolean DEFAULT false,
        is_active boolean DEFAULT true,
        pin_hash text,
        employee_number varchar(50),
        job_title varchar(100),
        photo_url text,
        shop_id uuid,
        first_login_at timestamptz,
        last_login_at timestamptz,
        deactivated_at timestamptz,
        deactivated_by uuid,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
          SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
        $$;
    `);
    await legacy.query(
      `INSERT INTO public.users (id, name, phone, role, is_active, employee_number, job_title, photo_url)
       VALUES ($1,'Legacy Owner',$2,'admin',true,'EMP-0001','Owner','https://example.invalid/legacy.jpg')`,
      [LEGACY_ID, LEGACY_PHONE],
    );
  });

  afterAll(async () => {
    await legacy.close();
  });

  it('cannot run the deployed body — it names canonical_phone, which this lineage does not have', async () => {
    await legacy.exec(CAPTURED_ACCOUNT_BODY);
    await expect(legacyLookup(LEGACY_PHONE)).rejects.toThrow(/canonical_phone/);
  });

  it('runs the ledger\'s body: door answer for an anonymous caller, full row for the account itself', async () => {
    await executeStatementsOn(legacy, ACCOUNT_MIGRATION);

    const anonymous = await legacyLookup(LEGACY_PHONE);
    expect(Object.keys(anonymous ?? {}).sort()).toEqual(DOOR_KEYS);
    expect(anonymous?.role).toBe('admin');

    const identity = await legacyLookup(LEGACY_PHONE, LEGACY_ID);
    expect(identity?.id).toBe(LEGACY_ID);
    expect(identity?.photo_url).toBe('https://example.invalid/legacy.jpg');
    // No memberships table here, so no membership keys — and no error from their absence.
    for (const key of ['tenant_id', 'membership_id', 'membership_role', 'branch_scope']) {
      expect(Object.keys(identity ?? {})).not.toContain(key);
    }
  });
});
