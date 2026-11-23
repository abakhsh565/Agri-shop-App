#!/usr/bin/env node
/**
 * Promote a published bundle to the next channel — the same bytes, not a rebuild.
 *
 * WHY THIS EXISTS SEPARATELY FROM publish.mjs. A rebuild is not a promotion: it is a second artifact
 * that happens to come from the same commit. Minifiers, dependency patches and lockfile drift all
 * produce a different zip, so "it passed on staging" would then be a claim about a file nobody ships.
 * This script copies the staged zip into the next environment's bucket and records the *same* sha256,
 * refusing if a single byte differs.
 *
 * The chain it serves:
 *
 *   dev  →  staging  →  production
 *   zip     zip         zip       (one artifact, three channels, each with its own ledger)
 *
 * USAGE
 *   node scripts/ota/promote.mjs --from-environment staging --to-environment production \
 *     --version 1.1.0 --confirm-production --activate
 *
 * CREDENTIALS (never in the repo)
 *   --from-url / OTA_FROM_URL, --from-key-file / OTA_FROM_SERVICE_ROLE_KEY
 *   --to-url   / OTA_TO_URL,   --to-key-file   / OTA_TO_SERVICE_ROLE_KEY
 *
 * WHAT IT REFUSES
 *   · a channel that disagrees with the environment it is being promoted to;
 *   · a bundle that does not exist on the source channel;
 *   · any byte-level difference between the source and destination upload;
 *   · a promotion to production without --confirm-production;
 *   · activating an older version on the target (that is `publish.mjs --rollback`).
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const CHANNEL_BY_ENV = { development: 'dev', staging: 'staging', production: 'production' };
const BUCKET = 'ota-bundles';

const fail = (message) => {
  console.error(`[ota:promote] ${message}`);
  process.exit(1);
};
const note = (message) => console.log(`[ota:promote] ${message}`);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function serviceKey(args, side) {
  const file = args[`${side}-key-file`];
  if (file) {
    if (!fs.existsSync(String(file))) fail(`--${side}-key-file ${file} does not exist`);
    return fs.readFileSync(String(file), 'utf8').trim();
  }
  return String(process.env[`OTA_${side.toUpperCase()}_SERVICE_ROLE_KEY`] ?? '').trim();
}

function side(args, name, sideName) {
  const environment = String(args[`${name}-environment`] ?? '').toLowerCase();
  const channel = CHANNEL_BY_ENV[environment];
  if (!channel) fail(`--${name}-environment must be one of ${Object.keys(CHANNEL_BY_ENV).join(', ')}`);
  const url = String(args[`${name}-url`] ?? process.env[`OTA_${name.toUpperCase()}_URL`] ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) fail(`set --${name}-url (or OTA_${name.toUpperCase()}_URL)`);
  const key = serviceKey(args, name);
  if (!key) fail(`set --${name}-key-file (or OTA_${name.toUpperCase()}_SERVICE_ROLE_KEY)`);
  return { label: name, environment, channel, url, key, sideName };
}

const auth = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

async function fetchRows(target, channel, version) {
  const response = await fetch(
    `${target.url}/rest/v1/ota_bundles?channel=eq.${channel}&version=eq.${encodeURIComponent(version)}&select=*`,
    { headers: auth(target.key) },
  );
  if (!response.ok) fail(`reading ${target.label} failed — HTTP ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  if (!rows.length) fail(`${version} is not published on ${target.channel} (${target.label})`);
  return rows[0];
}

async function activeVersion(target, channel) {
  const response = await fetch(
    `${target.url}/rest/v1/ota_bundles?channel=eq.${channel}&status=eq.active&select=version`,
    { headers: auth(target.key) },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0]?.version ?? null;
}

function newer(left, right) {
  const pa = String(left).split(/[.-]/).map(Number);
  const pb = String(right).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = side(args, 'from', 'from');
  const to = side(args, 'to', 'to');

  if (from.channel === to.channel) fail('the source and destination channels are the same');
  if (to.environment === 'production' && args['confirm-production'] !== true) {
    fail('promoting to production requires --confirm-production');
  }

  const version = String(args.version ?? '');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/.test(version)) {
    fail('--version is required and must be a version (major.minor.patch[-prerelease])');
  }

  const source = await fetchRows(from, from.channel, version);
  note(`source ${from.channel} ${version} — sha256 ${source.checksum.slice(0, 12)}… (${source.size_bytes} bytes)`);

  const download = await fetch(source.url);
  if (!download.ok) fail(`downloading the staged bundle failed — HTTP ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

  if (checksum !== source.checksum) {
    fail(`the staged artifact does not match the ledger (ledger ${source.checksum}, download ${checksum})`);
  }
  if (source.size_bytes && bytes.length !== Number(source.size_bytes)) {
    fail(`the staged artifact is ${bytes.length} bytes, the ledger says ${source.size_bytes}`);
  }

  const nativeMin = Number(args['native-min'] ?? source.native_min ?? 1);
  const objectPath = `${to.channel}/${version}.zip`;
  const publicUrl = `${to.url}/storage/v1/object/public/${BUCKET}/${objectPath}`;

  if (args['dry-run'] === true) {
    note(`dry run: would copy ${bytes.length} bytes to ${to.channel} as native_min ${nativeMin}`);
    return;
  }

  const upload = await fetch(`${to.url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'PUT',
    headers: {
      ...auth(to.key),
      'Content-Type': 'application/zip',
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!upload.ok) fail(`uploading to ${to.channel} failed — HTTP ${upload.status}: ${await upload.text()}`);

  const record = await fetch(`${to.url}/rest/v1/ota_bundles?on_conflict=channel,version`, {
    method: 'POST',
    headers: {
      ...auth(to.key),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([
      {
        channel: to.channel,
        version,
        native_min: nativeMin,
        url: publicUrl,
        checksum,
        size_bytes: bytes.length,
        notes: source.notes ?? `promoted from ${from.channel}`,
        status: 'candidate',
      },
    ]),
  });
  if (!record.ok) fail(`recording on ${to.channel} failed — HTTP ${record.status}: ${await record.text()}`);

  if (args.activate === true) {
    const current = await activeVersion(to, to.channel);
    if (current && current !== version && !newer(version, current)) {
      fail(`${to.channel} serves ${current}; ${version} is not newer. Use publish.mjs --rollback for a downgrade.`);
    }
    const now = new Date().toISOString();
    const supersede = await fetch(`${to.url}/rest/v1/ota_bundles?channel=eq.${to.channel}&status=eq.active`, {
      method: 'PATCH',
      headers: { ...auth(to.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'superseded', superseded_at: now }),
    });
    if (!supersede.ok) fail(`superseding ${to.channel} failed — HTTP ${supersede.status}`);

    const activate = await fetch(
      `${to.url}/rest/v1/ota_bundles?channel=eq.${to.channel}&version=eq.${encodeURIComponent(version)}`,
      {
        method: 'PATCH',
        headers: { ...auth(to.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', activated_at: now, superseded_at: null }),
      },
    );
    if (!activate.ok) fail(`activating ${version} on ${to.channel} failed — HTTP ${activate.status}`);
    note(`✓ ${to.channel} now serves ${version}`);
  } else {
    note(`recorded ${version} on ${to.channel} as a candidate`);
  }

  note(`checksum ${checksum} — identical bytes in ${from.channel} and ${to.channel}`);
}

main().catch((error) => fail(error?.stack || String(error)));
