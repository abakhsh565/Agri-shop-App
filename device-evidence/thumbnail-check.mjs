/**
 * thumbnail-check.mjs — give one QA product a real image, then let the phone be judged on it.
 *
 * WHY THIS SHAPE
 *
 * Every product in QA carries `image_url = null`, so the list on the phone shows its initials
 * fallback and there is no thumbnail to test. This script puts a visible image in the bucket the
 * app reads (`product-images`) and points one fixture product at it, using the QA service-role
 * key from `.env.qa` — the same credentials the repository's own scripts use.
 *
 * It is deliberately reversible: `--cleanup` clears `image_url` and deletes the object, so the QA
 * baseline goes back to exactly what the declaration reviewed.
 *
 * Usage:
 *   node device-evidence/thumbnail-check.mjs             # upload + point the product at it
 *   node device-evidence/thumbnail-check.mjs --cleanup   # clear it and delete the object
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const CLEANUP = process.argv.includes('--cleanup');
const BUCKET = 'product-images';
const OBJECT = 'qa-device-check/thumbnail-probe.png';
const PRODUCT_ID = '30000000-0000-0000-0000-000000000001'; // QA Product A — a QA_IDS fixture

function env(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const E = env('.env.qa');

/** A solid-colour PNG, so the thumbnail is unmistakable by eye rather than 1 transparent pixel. */
function png(width, height, [r, g, b]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const db = new pg.Client({
  host: E.QA_DB_HOST,
  user: E.QA_DB_USER,
  password: E.QA_DB_PASS,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const storage = createClient(E.QA_SUPABASE_URL, E.QA_SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

if (CLEANUP) {
  await db.query('update products set image_url = null where id = $1', [PRODUCT_ID]);
  const { error } = await storage.storage.from(BUCKET).remove([OBJECT]);
  console.log(`cleared image_url and removed ${OBJECT}${error ? ` (remove said: ${error.message})` : ''}`);
  await db.end();
  process.exit(0);
}

const file = png(96, 96, [255, 122, 0]); // orange square
const { error: upErr } = await storage.storage
  .from(BUCKET)
  .upload(OBJECT, file, { contentType: 'image/png', upsert: true });
if (upErr) {
  console.error(`upload failed: ${upErr.message}`);
  await db.end();
  process.exit(1);
}

const { data } = storage.storage.from(BUCKET).getPublicUrl(OBJECT);
const url = data.publicUrl;
const head = await fetch(url);
console.log(`uploaded ${file.length} bytes -> ${url}`);
console.log(`public URL answers HTTP ${head.status} (${head.headers.get('content-type')})`);

await db.query('update products set image_url = $1, updated_at = now() where id = $2', [url, PRODUCT_ID]);
const row = await db.query('select name, image_url from products where id = $1', [PRODUCT_ID]);
console.log(`QA product now: ${row.rows[0].name} -> ${row.rows[0].image_url}`);
await db.end();
