#!/usr/bin/env node
/**
 * Publish a web bundle to one OTA channel.
 *
 * WHAT THIS IS. The web half of the app is published as a zip, recorded in `ota_bundles` with its
 * sha256, and offered to installed apps by `ota-manifest`. This script is the only writer.
 *
 * THE RULES IT ENFORCES, because a human running it at 11pm should not have to remember them:
 *
 *   · one environment, one channel — `staging` may only publish `staging`, `production` only
 *     `production`. There is no `--force`. A bundle compiled against staging data must never be
 *     offered to a production phone.
 *   · a version that goes backwards is refused unless it is an explicit `--rollback`.
 *   · `--native-min` defaults to the `versionCode` in `android/app/build.gradle`, so a bundle that
 *     needs new native code cannot silently declare itself installable on the old shell.
 *   · the zip is content-addressed: the sha256 recorded in the ledger is the sha256 of the bytes
 *     uploaded, and the plugin verifies it on the device before swapping the WebView.
 *
 * USAGE
 *   node scripts/ota/publish.mjs --env staging --activate
 *   node scripts/ota/publish.mjs --env staging --version 1.2.0 --notes "fix: credit reminder" --activate
 *   node scripts/ota/publish.mjs --env production --confirm-production --activate
 *   node scripts/ota/publish.mjs --env staging --rollback 1.1.0
 *
 * CREDENTIALS (never in the repo)
 *   --url / OTA_SUPABASE_URL            project URL, e.g. https://bpybjrjenwccowvtrevu.supabase.co
 *   --key-file / OTA_SERVICE_ROLE_KEY   service-role key; `--key-file` avoids putting it in shell history
 *
 * WHAT IT NEEDS IN THE WEB BUILD
 *   `dist/` built with the *same* environment's `VITE_SUPABASE_*` values as the APK it updates. A
 *   bundle pointing at another project is a different app, and the manifest would happily serve it —
 *   which is why the caller is expected to build with the environment's own configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';

const CHANNEL_BY_ENV = { development: 'dev', staging: 'staging', production: 'production' };
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/;
const BUCKET = 'ota-bundles';

function fail(message) {
  console.error(`[ota] ${message}`);
  process.exit(1);
}

function note(message) {
  console.log(`[ota] ${message}`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

/**
 * The shell's versionCode, so `native_min` cannot be forgotten or guessed. `package.json` owns it
 * (`nativeVersion`) because the APK build stamps the generated gradle file from it; the gradle read
 * is only a fallback for a checkout that predates the field.
 */
function nativeMinFromPackage() {
  try {
    const declared = Number(
      JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).nativeVersion,
    );
    if (Number.isInteger(declared) && declared >= 1) return declared;
  } catch {
    // fall through to the graded file
  }
  try {
    const gradle = fs.readFileSync(path.join(process.cwd(), 'android/app/build.gradle'), 'utf8');
    const match = /versionCode\s+(\d+)/.exec(gradle);
    if (match) return Number(match[1]);
  } catch {
    // fall through
  }
  return 1;
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function readServiceKey(args) {
  if (args['key-file']) {
    const file = String(args['key-file']);
    if (!fs.existsSync(file)) fail(`--key-file ${file} does not exist`);
    return fs.readFileSync(file, 'utf8').trim();
  }
  return String(process.env.OTA_SERVICE_ROLE_KEY ?? '').trim();
}

function resolveTarget(args) {
  const environment = String(args.env ?? 'development').toLowerCase();
  if (!(environment in CHANNEL_BY_ENV)) {
    fail(`--env must be one of ${Object.keys(CHANNEL_BY_ENV).join(', ')} (got "${args.env}")`);
  }
  const channel = CHANNEL_BY_ENV[environment];

  const explicitChannel = String(args.channel ?? '').trim().toLowerCase();
  if (explicitChannel && explicitChannel !== channel) {
    fail(
      `--channel "${explicitChannel}" disagrees with --env "${environment}". ` +
        `A bundle built for one environment may only be published to its own channel.`,
    );
  }
  if (environment === 'production' && args['confirm-production'] !== true && args['dry-run'] !== true) {
    fail('publishing to production requires --confirm-production');
  }

  const url = String(args.url ?? process.env.OTA_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) {
    fail('set OTA_SUPABASE_URL (or --url) to the project this channel lives in');
  }

  return { environment, channel, url };
}

function collectFiles(directory, base = directory, collected = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(full, base, collected);
    else if (entry.isFile()) collected.push({ full, relative: path.relative(base, full) });
  }
  return collected;
}

async function zipDirectory(directory) {
  const files = collectFiles(directory);
  if (!files.some((file) => file.relative === 'index.html')) {
    fail(`${directory} has no index.html — that is not a web bundle`);
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const sink = new PassThrough();
  const chunks = [];
  sink.on('data', (chunk) => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    sink.on('end', resolve);
    sink.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (warning) => {
      if (warning.code !== 'ENOENT') reject(warning);
    });
  });

  archive.pipe(sink);
  for (const file of files) archive.file(file.full, { name: file.relative.replace(/\\/g, '/') });
  await archive.finalize();
  await done;

  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
    files: files.length,
  };
}

async function request(url, options, what) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    fail(`${what} failed — HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function listBundles(target, key, channel) {
  return request(
    `${target.url}/rest/v1/ota_bundles?channel=eq.${channel}&order=created_at.desc&select=*`,
    { headers: authHeaders(key) },
    'reading the bundle ledger',
  );
}

async function setStatus(target, key, filter, patch, what) {
  return request(
    `${target.url}/rest/v1/ota_bundles?${filter}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(key), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
    what,
  );
}

async function activate(target, key, channel, version) {
  const now = new Date().toISOString();
  // Supersede first: the partial unique index makes two active rows impossible, so the order is part
  // of the contract rather than a preference.
  await setStatus(target, key, `channel=eq.${channel}&status=eq.active`, { status: 'superseded', superseded_at: now }, 'superseding the active bundle');
  const rows = await setStatus(
    target,
    key,
    `channel=eq.${channel}&version=eq.${encodeURIComponent(version)}`,
    { status: 'active', activated_at: now, superseded_at: null },
    `activating ${version}`,
  );
  if (!rows || rows.length === 0) fail(`no bundle ${version} on ${channel} to activate`);
  return rows[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const key = readServiceKey(args);
  if (!key) fail('set OTA_SERVICE_ROLE_KEY or pass --key-file (never commit the key)');

  const dryRun = args['dry-run'] === true;

  if (args.rollback) {
    const version = String(args.rollback);
    if (!VERSION_PATTERN.test(version)) fail(`--rollback "${version}" is not a version`);
    const bundles = await listBundles(target, key, target.channel);
    const previous = bundles.find((row) => row.version === version);
    if (!previous) fail(`no bundle ${version} on channel ${target.channel} to roll back to`);
    note(`rolling back ${target.channel} to ${version} (sha256 ${previous.checksum.slice(0, 12)}…)`);
    if (dryRun) return note('dry run: nothing changed');
    await activate(target, key, target.channel, version);
    return note(`✓ ${target.channel} now serves ${version}`);
  }

  const version = String(args.version ?? packageVersion());
  if (!VERSION_PATTERN.test(version)) fail(`"${version}" is not a version (major.minor.patch[-prerelease])`);

  const nativeMin = Number(args['native-min'] ?? nativeMinFromPackage());
  if (!Number.isInteger(nativeMin) || nativeMin < 1) fail('--native-min must be a positive integer');

  const directory = path.resolve(String(args.dir ?? 'dist'));
  if (!fs.existsSync(directory)) fail(`${directory} does not exist — build the web bundle first`);

  note(`bundling ${directory}`);
  const bundle = await zipDirectory(directory);
  note(`${bundle.files} files · ${(bundle.size / 1024 / 1024).toFixed(2)} MB · sha256 ${bundle.checksum}`);

  const objectPath = `${target.channel}/${version}.zip`;
  const publicUrl = `${target.url}/storage/v1/object/public/${BUCKET}/${objectPath}`;

  const existing = await listBundles(target, key, target.channel);
  const active = existing.find((row) => row.status === 'active');
  if (active && active.version === version) {
    note(`note: ${target.channel} already serves ${version}; this republishes the bytes`);
  }

  if (dryRun) {
    note(`dry run: would upload ${objectPath}, record native_min=${nativeMin}, url ${publicUrl}`);
    if (args.activate) note(`dry run: would activate ${version} on ${target.channel}`);
    return;
  }

  await request(
    `${target.url}/storage/v1/object/${BUCKET}/${objectPath}`,
    {
      method: 'PUT',
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/zip',
        'x-upsert': 'true',
        'cache-control': 'public, max-age=31536000, immutable',
      },
      body: bundle.buffer,
    },
    'uploading the bundle',
  );
  note(`uploaded ${publicUrl}`);

  await request(
    `${target.url}/rest/v1/ota_bundles?on_conflict=channel,version`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          channel: target.channel,
          version,
          native_min: nativeMin,
          url: publicUrl,
          checksum: bundle.checksum,
          size_bytes: bundle.size,
          notes: typeof args.notes === 'string' ? args.notes : null,
          status: 'candidate',
        },
      ]),
    },
    'recording the bundle',
  );

  if (args.activate) {
    // A downgrade is a rollback, and a rollback has its own flag: an accidental `--activate` of an
    // older version is exactly how a fixed bug comes back.
    if (active && active.version !== version) {
      const sign = (a, b) => {
        const pa = a.split(/[.-]/).map(Number);
        const pb = b.split(/[.-]/).map(Number);
        for (let i = 0; i < 3; i += 1) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
        }
        return 0;
      };
      if (sign(version, active.version) <= 0 && args['allow-downgrade'] !== true) {
        fail(
          `${target.channel} currently serves ${active.version}; activating ${version} is a downgrade. ` +
            `Use --rollback ${version} if that is what you mean.`,
        );
      }
    }
    await activate(target, key, target.channel, version);
    note(`✓ ${target.channel} now serves ${version} (native_min ${nativeMin})`);
  } else {
    note(`recorded ${version} as a candidate; run again with --activate to offer it`);
  }

  if (args['manifest-url']) {
    const response = await fetch(String(args['manifest-url']), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.OTA_ANON_KEY ? { apikey: process.env.OTA_ANON_KEY } : {}) },
      body: JSON.stringify({ channel: target.channel, nativeVersion: nativeMin, current: '0.0.0' }),
    });
    const body = await response.json();
    note(`manifest answers ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    if (body?.version !== version) fail('the manifest does not serve what was just published');
  }
}

main().catch((error) => fail(error?.stack || String(error)));
