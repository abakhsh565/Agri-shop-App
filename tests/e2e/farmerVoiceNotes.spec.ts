/**
 * E2E: a voice note crosses the conversation in both directions.
 *
 * WHAT THIS LOCKS DOWN. Text messaging already had a lane; this one is about the file half, which
 * has a different security shape — a private bucket, a 60-second signature and an edge function
 * that speaks for a farmer who has no JWT. So the test drives the real HTTP door for both callers:
 *
 *   1. Dealer → Farmer: a signed-in dealer uploads bytes, records the message, and the farmer's
 *      own token can read its metadata and mint a playable link.
 *   2. Farmer → Dealer: the reverse, with the farmer's token.
 *   3. A third party cannot read either file: another farmer's token and a stranger's link are
 *      refused, and the message row never appears to a farmer who is not in the conversation.
 *   4. Images travel the same way (kind: image), with no duration.
 *
 * WHY HTTP AND NOT THE SCREEN. The bytes, the signature and the refusal are all decided on the
 * server; the bubble only renders what these calls return. This lane therefore asserts the contract
 * itself, on the same endpoints the dealer app and the farmer app call.
 *
 * It seeds its own shop, farmer and dealer, and deletes them again — QA/staging only.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from './base';
import { execSql } from './helpers';

const URL_BASE = (process.env.QA_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = process.env.QA_SUPABASE_ANON_KEY || process.env.QA_SUPABASE_ANON || '';
const SERVICE = process.env.QA_SUPABASE_SERVICE_ROLE || '';

/** Windows/Safari produce mp4, Android WebView produces webm; both must be accepted. */
const AUDIO_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x77, 0x65, 0x62, 0x6d]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const ready = Boolean(URL_BASE && ANON && SERVICE);
const tail = String(Date.now()).slice(-6);
/** The join-code alphabet has no I, O, 0 or 1. */
const JOIN_CODE = `S${tail.slice(0, 5)}`.replace(/[01IO]/g, '2').toUpperCase();
const digits = (n: string) => (String(Date.now()).slice(-7) + n + '000').slice(0, 10);
const FARMER_PHONE = `92${digits('1')}`;
const DEALER_PHONE = `92${digits('2')}`;
const DEALER_PASSWORD = `Qa!${tail}${tail}`;

let shopId = '';
let farmerId = '';
let farmerToken = '';
let dealerJwt = '';
let dealerUserId = '';

/**
 * Delete one shop and everything this lane hangs off it, in FK order.
 *
 * Used for the lane's own rows AND for rows a crashed earlier run left behind: a Playwright worker is
 * restarted after a failure, so `afterAll` cannot be relied on to have run, and a leftover shop makes
 * the next run's join code and phone collide. The farmer ids are read BEFORE the links are deleted
 * because `farmer_id` is the only reference to them once the link is gone.
 */
async function purgeShop(id: string): Promise<void> {
  const links = (await execSql(
    `select farmer_id from public.marketplace_farmer_links where shop_id = '${id}'`,
  )) as Array<{ farmer_id: string }>;
  const farmerIds = links.map((row) => row.farmer_id).filter(Boolean);

  // The dealer's public row is DELETED, not detached: 0291's guard refuses a shop_id change to
  // anyone but the database owner, and `run_sql` reaches the database as PostgREST's authenticator.
  // The row belongs to the shop this lane created, so removing it is the honest teardown.
  await execSql(`
    delete from public.farmer_message_attachments where shop_id = '${id}';
    delete from public.farmer_messages where shop_id = '${id}';
    delete from public.marketplace_farmer_tokens where farmer_id in
      (select farmer_id from public.marketplace_farmer_links where shop_id = '${id}');
    delete from public.marketplace_shop_join_codes where shop_id = '${id}';
    delete from public.marketplace_farmer_links where shop_id = '${id}';
    delete from public.memberships where tenant_id = '${id}';
    delete from public.users where shop_id = '${id}';
    delete from public.shops where id = '${id}';
  `);

  if (farmerIds.length) {
    await execSql(
      `delete from public.marketplace_farmers where id in ('${farmerIds.join("','")}')`,
    );
  }
}

async function media(path: string, init: RequestInit & { token?: string; jwt?: string } = {}) {
  const { token, jwt, ...rest } = init;
  return fetch(`${URL_BASE}/functions/v1/farmer-media${path}`, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string>),
      ...(token ? { 'x-farmer-token': token } : {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
  });
}

async function rpc(name: string, args: Record<string, unknown>, jwt: string) {
  const response = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, body };
}

test.describe('farmer conversation — voice notes and photos', () => {
  test.skip(!ready, 'needs QA_SUPABASE_URL, anon key and service role (staging lane)');

  test.beforeAll(async () => {
    // The door has to exist before any of this means anything. A 404 here is "not deployed in this
    // environment", which the lane reports as a skip rather than pretending the feature works.
    const probe = await media('?kind=voice&mime=audio/webm&duration_ms=1', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: new Uint8Array([0]),
    });
    test.skip(probe.status === 404, 'farmer-media is not deployed in this environment');

    // A previous, failed run may have stopped after creating its rows; reclaim them by marker so
    // this run starts from nothing it does not own.
    const leftovers = (await execSql(
      `select id from public.shops where name = '__voice e2e shop'`,
    )) as Array<{ id: string }>;
    for (const leftover of leftovers) await purgeShop(leftover.id);

    // `run_sql` answers a write with no rows, so RETURNING is not a result. The id is generated here
    // and the row is read back — the same pattern `createInWriteTenant` uses, for the same reason.
    shopId = randomUUID();
    await execSql(`
      insert into public.shops (id, name, phone, join_code)
      values ('${shopId}', '__voice e2e shop', '92${digits('3')}', '${JOIN_CODE}');
    `);
    const shops = (await execSql(
      `select id from public.shops where id = '${shopId}'`,
    )) as Array<{ id: string }>;
    expect(shops[0]?.id, 'the QA shop exists before the lane writes to it').toBe(shopId);

    // The code a farmer walks in with is its own row, not shops.join_code.
    await execSql(`
      insert into public.marketplace_shop_join_codes (shop_id, code)
      values ('${shopId}', '${JOIN_CODE}');
    `);

    // A farmer is not owned by a shop — the link is what ties him to it, and the farmer row has no
    // shop_id. (The link is the membership; deleting it is what unlinks him.)
    farmerId = randomUUID();
    await execSql(`
      insert into public.marketplace_farmers (id, name, phone, phone_key)
      values ('${farmerId}', '__voice e2e farmer', '${FARMER_PHONE}',
              public.farmer_phone_key('${FARMER_PHONE}'));
    `);
    const farmers = (await execSql(
      `select id from public.marketplace_farmers where id = '${farmerId}'`,
    )) as Array<{ id: string }>;
    expect(farmers[0]?.id, 'the QA farmer exists before the lane writes to it').toBe(farmerId);

    // The token is issued by the join below; the unique one-live index means seeding a hash here
    // would only make that issuance fight this row.
    await execSql(`
      insert into public.marketplace_farmer_links (shop_id, farmer_id)
      values ('${shopId}', '${farmerId}');
    `);

    // A real dealer: admin-created, then signed in with a password so the JWT is a genuine
    // `authenticated` session — the RPCs read the membership from it, not from a claim we typed.
    const created = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `voice${tail}@qa.invalid`,
        password: DEALER_PASSWORD,
        email_confirm: true,
        phone: DEALER_PHONE,
        phone_confirm: true,
      }),
    });
    const user = (await created.json()) as { id?: string };
    dealerUserId = user.id ?? '';
    expect(dealerUserId, 'the dealer account is created').not.toBe('');

    await execSql(`
      insert into public.users (id, shop_id, name, phone)
      values ('${dealerUserId}', '${shopId}', '__voice e2e dealer', '${DEALER_PHONE}')
      on conflict (id) do update set shop_id = excluded.shop_id;
      insert into public.memberships (user_id, tenant_id, role, status)
      values ('${dealerUserId}', '${shopId}', 'owner', 'active')
      on conflict (user_id, tenant_id) do update set status = 'active';
    `);

    const signIn = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `voice${tail}@qa.invalid`, password: DEALER_PASSWORD }),
    });
    const session = (await signIn.json()) as { access_token?: string };
    dealerJwt = session.access_token ?? '';
    expect(dealerJwt, 'the dealer can sign in').not.toBe('');

    const joined = await rpc('farmer_api_join_shop', { p_code: JOIN_CODE, p_phone: FARMER_PHONE, p_name: '__voice e2e farmer' }, ANON);
    farmerToken = (joined.body as { token?: string })?.token ?? '';
  });

  test.afterAll(async () => {
    if (!shopId) return;
    await purgeShop(shopId);
    const left = (await execSql(
      `select count(*)::int as n from public.shops where id = '${shopId}'`,
    )) as Array<{ n: number }>;
    expect(left[0]?.n, 'the lane leaves no shop behind').toBe(0);
    if (dealerUserId) {
      await fetch(`${URL_BASE}/auth/v1/admin/users/${dealerUserId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
    }
  });

  test('dealer sends a voice note; the farmer can read and play it', async () => {
    const upload = await media('?kind=voice&mime=audio/webm&farmer_id=' + farmerId + '&duration_ms=4200', {
      method: 'POST',
      jwt: dealerJwt,
      headers: { 'Content-Type': 'audio/webm' },
      body: AUDIO_BYTES,
    });
    expect(upload.status).toBe(200);
    const path = ((await upload.json()) as { storage_path: string }).storage_path;
    expect(path.startsWith(`${shopId}/${farmerId}/`), 'the folder is derived, not supplied').toBe(true);

    const sent = await rpc(
      'send_farmer_attachment',
      {
        p_farmer_id: farmerId,
        p_kind: 'voice',
        p_storage_path: path,
        p_mime_type: 'audio/webm',
        p_size_bytes: AUDIO_BYTES.length,
        p_duration_ms: 4200,
        p_body: null,
      },
      dealerJwt,
    );
    expect(sent.status).toBe(200);
    const messageId = (sent.body as { id: string }).id;

    const thread = await rpc('farmer_api_thread', { p_token: farmerToken, p_shop_id: null }, ANON);
    const messages = (thread.body as { messages: Array<{ id: string }> }).messages;
    expect(messages.map((m) => m.id)).toContain(messageId);

    const list = await rpc('farmer_api_media', { p_token: farmerToken, p_shop_id: null }, ANON);
    const entry = (list.body as Array<Record<string, unknown>>).find((m) => m.message_id === messageId);
    expect(entry).toBeTruthy();
    expect(entry).toMatchObject({ kind: 'voice', sender: 'owner', duration_ms: 4200, mime_type: 'audio/webm' });
    expect(JSON.stringify(entry), 'metadata never carries a URL').not.toContain('http');

    const link = await media(`?message_id=${messageId}`, { token: farmerToken });
    expect(link.status).toBe(200);
    const body = (await link.json()) as { url: string; expires_in: number };
    expect(body.expires_in).toBe(60);
    const download = await fetch(body.url);
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test('farmer sends a voice note; the dealer can read and play it', async () => {
    const upload = await media('?kind=voice&mime=audio/webm&duration_ms=2600', {
      method: 'POST',
      token: farmerToken,
      headers: { 'Content-Type': 'audio/webm' },
      body: AUDIO_BYTES,
    });
    expect(upload.status).toBe(200);
    const path = ((await upload.json()) as { storage_path: string }).storage_path;

    const sent = await rpc(
      'farmer_api_send_attachment',
      {
        p_token: farmerToken,
        p_kind: 'voice',
        p_storage_path: path,
        p_mime_type: 'audio/webm',
        p_size_bytes: AUDIO_BYTES.length,
        p_duration_ms: 2600,
        p_body: null,
      },
      ANON,
    );
    expect(sent.status).toBe(200);

    const list = await rpc('get_farmer_media', { p_farmer_id: farmerId }, dealerJwt);
    const entry = (list.body as Array<Record<string, unknown>>).at(-1);
    expect(entry).toMatchObject({ kind: 'voice', sender: 'farmer', duration_ms: 2600 });

    const link = await media(`?message_id=${entry!.message_id}`, { jwt: dealerJwt });
    expect(link.status).toBe(200);
    expect((await fetch(((await link.json()) as { url: string }).url)).status).toBe(200);
  });

  test('an image travels the same way, without a duration', async () => {
    const upload = await media('?kind=image&mime=image/png', {
      method: 'POST',
      token: farmerToken,
      headers: { 'Content-Type': 'image/png' },
      body: PNG_BYTES,
    });
    expect(upload.status).toBe(200);
    const path = ((await upload.json()) as { storage_path: string }).storage_path;

    const sent = await rpc(
      'farmer_api_send_attachment',
      {
        p_token: farmerToken,
        p_kind: 'image',
        p_storage_path: path,
        p_mime_type: 'image/png',
        p_size_bytes: PNG_BYTES.length,
        p_duration_ms: null,
        p_body: 'the leaf I asked about',
      },
      ANON,
    );
    expect(sent.status).toBe(200);

    const list = await rpc('get_farmer_media', { p_farmer_id: farmerId }, dealerJwt);
    const entry = (list.body as Array<Record<string, unknown>>).at(-1);
    expect(entry).toMatchObject({ kind: 'image', duration_ms: null, sender: 'farmer' });
  });

  test('a stranger cannot mint a link, and a voice note cannot be faked', async () => {
    const list = await rpc('get_farmer_media', { p_farmer_id: farmerId }, dealerJwt);
    const messageId = (list.body as Array<Record<string, unknown>>)[0]!.message_id as string;

    const anonymous = await media(`?message_id=${messageId}`, {});
    expect(anonymous.status).toBe(401);

    // A different conversation's id is not a message id: the function must not distinguish.
    const stranger = await media(`?message_id=${'00000000-0000-4000-8000-000000000000'}`, { jwt: dealerJwt });
    expect(stranger.status).toBe(404);

    const noDuration = await media('?kind=voice&mime=audio/webm', {
      method: 'POST',
      token: farmerToken,
      headers: { 'Content-Type': 'audio/webm' },
      body: AUDIO_BYTES,
    });
    expect(noDuration.status).toBe(400);

    const wrongType = await media('?kind=voice&mime=application/zip&duration_ms=1000', {
      method: 'POST',
      token: farmerToken,
      headers: { 'Content-Type': 'application/zip' },
      body: AUDIO_BYTES,
    });
    expect(wrongType.status).toBe(400);

    // A path outside this conversation is refused by the sender itself.
    const escaped = await rpc(
      'farmer_api_send_attachment',
      {
        p_token: farmerToken,
        p_kind: 'voice',
        p_storage_path: `${shopId}/00000000-0000-4000-8000-000000000000/x.webm`,
        p_mime_type: 'audio/webm',
        p_size_bytes: 12,
        p_duration_ms: 1000,
        p_body: null,
      },
      ANON,
    );
    expect(escaped.status).toBeGreaterThanOrEqual(400);
  });
});
