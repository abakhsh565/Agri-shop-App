#!/usr/bin/env node
/**
 * apk-metadata.mjs — read an APK's identity from the file itself, on a machine with no Android SDK.
 *
 * WHY THIS EXISTS
 *   "Which version is this, and which backend does it talk to?" is a release question, and the tools
 *   that answer it — `aapt2` / `apksigner` — exist on the CI runner but not on the laptop doing the
 *   review. `scripts/android-assetlinks.mjs` therefore cannot run there at all. `versionCode` is a
 *   binary-XML integer inside `AndroidManifest.xml`, so this reads the two chunks that matter —
 *   the string pool and each start element's attribute list — and prints the identity, plus how many
 *   packaged web assets carry a given stamp. No dependencies, no network, no Android tooling.
 *
 * WHAT IT DOES NOT DO
 *   It does not verify the signature (that needs `apksigner`, see `android-assetlinks.mjs`) and it
 *   does not unpack the whole archive: one entry is read, `AndroidManifest.xml`.
 *
 * USAGE
 *   node scripts/apk-metadata.mjs <path/to/app-release.apk>
 *   node scripts/apk-metadata.mjs app-release.apk --contains bpybjrjenwccowvtrevu   # count files
 *   node scripts/apk-metadata.mjs app-release.apk --json
 *
 * EXIT CODES
 *   0 = read, 1 = could not read it (the reason is printed), 2 = usage.
 */
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const asJson = argv.includes('--json');
// `--dump` prints every attribute of the manifest and uses-sdk elements with the resource id and
// the raw typed value. It exists because a wrong resource-map lookup silently returns the *neighbouring*
// attribute (versionName instead of versionCode), which looks plausible in the summary output.
const dump = argv.includes('--dump');
const needles = argv.reduce((acc, a, i) => (a === '--contains' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const apkPath = argv.find((a) => !a.startsWith('--') && a !== flag('--contains'));

if (!apkPath) {
  console.error('usage: node scripts/apk-metadata.mjs <path.apk> [--contains <needle>] [--json]');
  process.exit(2);
}
if (!existsSync(apkPath)) {
  console.error(`FAIL: no such file: ${apkPath}`);
  process.exit(1);
}

const buf = readFileSync(apkPath);

// ── 1. the zip: find AndroidManifest.xml through the central directory ─────────────────────────
function readEntry(name) {
  // End of central directory: signature 0x06054b50, searched from the end (comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory entry is malformed');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.push({ entryName, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (name) {
    const entry = files.find((f) => f.entryName === name);
    if (!entry) throw new Error(`${name} is not in the archive`);
    // Local header: field sizes differ from the central one, so read them from the local header.
    const lh = entry.localOffset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('local file header is malformed');
    const lNameLen = buf.readUInt16LE(lh + 26);
    const lExtraLen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + entry.compSize);
    return entry.method === 0 ? raw : inflateRawSync(raw);
  }
  return files;
}

// ── 2. Android binary XML ───────────────────────────────────────────────────────────────────────
const RES = { versionCode: 0x0101021b, versionName: 0x0101021c, minSdkVersion: 0x0101020c, targetSdkVersion: 0x01010270 };

function decodeAxml(xml) {
  if (xml.readUInt16LE(0) !== 0x0003) throw new Error('not Android binary XML (no XML chunk)');
  let offset = 8;
  let strings = [];
  const elements = [];
  let resourceIds = [];

  while (offset < xml.length) {
    const type = xml.readUInt16LE(offset);
    const headerSize = xml.readUInt16LE(offset + 2);
    const size = xml.readUInt32LE(offset + 4);

    if (type === 0x0001) {
      const stringCount = xml.readUInt32LE(offset + 8);
      const flags = xml.readUInt32LE(offset + 16);
      const stringsStart = xml.readUInt32LE(offset + 20);
      const utf8 = (flags & 0x100) !== 0;
      const base = offset + stringsStart;
      const offsets = [];
      for (let i = 0; i < stringCount; i++) offsets.push(xml.readUInt32LE(offset + headerSize + i * 4));
      strings = offsets.map((o) => {
        const at = base + o;
        if (utf8) {
          let len = xml[at];
          let cursor = at + 1;
          if (len & 0x80) { len = ((len & 0x7f) << 8) | xml[cursor]; cursor += 1; }
          let skip = xml[cursor];
          cursor += 1;
          if (skip & 0x80) { skip = ((skip & 0x7f) << 8) | xml[cursor]; cursor += 1; }
          return xml.toString('utf8', cursor, cursor + len);
        }
        let len = xml.readUInt16LE(at);
        let cursor = at + 2;
        if (len & 0x8000) { len = ((len & 0x7fff) << 16) | xml.readUInt16LE(cursor); cursor += 2; }
        return xml.toString('utf16le', cursor, cursor + len * 2);
      });
    } else if (type === 0x0180) {
      const n = (size - headerSize) / 4;
      resourceIds = [];
      for (let i = 0; i < n; i++) resourceIds.push(xml.readUInt32LE(offset + headerSize + i * 4));
    } else if (type === 0x0102) {
      const nameIdx = xml.readUInt32LE(offset + 20);
      const attrStart = xml.readUInt16LE(offset + 24);
      const attrSize = xml.readUInt16LE(offset + 26);
      const attrCount = xml.readUInt16LE(offset + 28);
      const attrs = [];
      for (let i = 0; i < attrCount; i++) {
        const at = offset + 16 + attrStart + i * attrSize;
        const aName = xml.readUInt32LE(at + 4);
        const aRaw = xml.readUInt32LE(at + 8);
        const aType = xml[at + 15];
        const aData = xml.readUInt32LE(at + 16);
        const byString = strings[aName] ?? '';
        // The resource map is indexed by the attribute's *name string index* directly. Measured on the
        // CI APK: with `aName - 1` the map returned each name's neighbour (versionCode reported
        // 0x0101020c, which is canonical minSdkVersion, and versionName reported 0x0101021b, which is
        // canonical versionCode) — so the off-by-one reading is the one that produces plausible-looking
        // wrong numbers, and this file's map simply has no placeholder at index 0.
        const byId = resourceIds[aName];
        attrs.push({
          name: byString,
          resourceId: byId,
          rawValue: aRaw === 0xffffffff ? undefined : aRaw,
          stringValue: aType === 0x03 ? strings[aData] : undefined,
          intValue: aType === 0x10 || aType === 0x11 ? aData : undefined,
        });
      }
      elements.push({ name: strings[nameIdx] ?? '', attrs });
    }
    if (!size) break;
    offset += size;
  }
  return elements;
}

function attrValue(elements, elementName, key) {
  const el = elements.find((e) => e.name === elementName);
  if (!el) return undefined;
  // Name first, resource id second: the name is always in the string pool, while the resource map is
  // indexed leniently enough that a wrong index returns a neighbouring attribute instead of nothing.
  const a = el.attrs.find((x) => x.name === key) ?? el.attrs.find((x) => x.resourceId === RES[key]);
  if (!a) return undefined;
  return a.intValue !== undefined ? a.intValue : a.stringValue;
}

let manifest;
try {
  manifest = decodeAxml(readEntry('AndroidManifest.xml'));
} catch (error) {
  console.error(`FAIL: could not read AndroidManifest.xml — ${error.message}`);
  process.exit(1);
}

if (dump) {
  for (const el of manifest.filter((e) => e.name === 'manifest' || e.name === 'uses-sdk')) {
    console.log(`<${el.name}>`);
    for (const a of el.attrs) {
      console.log(
        `  ${a.name.padEnd(24)} id=0x${(a.resourceId ?? 0).toString(16).padStart(8, '0')} ` +
          `raw=${a.rawValue ?? '-'} value=${a.intValue !== undefined ? a.intValue : a.stringValue}`,
      );
    }
  }
}

const identity = {
  file: apkPath,
  bytes: buf.length,
  package: attrValue(manifest, 'manifest', 'package'),
  versionCode: attrValue(manifest, 'manifest', 'versionCode'),
  versionName: attrValue(manifest, 'manifest', 'versionName'),
  minSdkVersion: attrValue(manifest, 'uses-sdk', 'minSdkVersion'),
  targetSdkVersion: attrValue(manifest, 'uses-sdk', 'targetSdkVersion'),
};

const stamps = {};
if (needles.length) {
  const files = readEntry(null).filter((f) => /\.(js|html|json|css)$/.test(f.entryName));
  for (const needle of needles) {
    let hits = 0;
    const named = [];
    for (const f of files) {
      let text;
      try {
        text = readEntry(f.entryName).toString('utf8');
      } catch {
        continue;
      }
      const n = text.split(needle).length - 1;
      if (n > 0) { hits += n; named.push(`${f.entryName}(${n})`); }
    }
    stamps[needle] = { occurrences: hits, files: named.length, where: named.slice(0, 6) };
  }
}

if (asJson) {
  console.log(JSON.stringify({ ...identity, stamps }, null, 2));
  process.exit(0);
}

console.log(`file:        ${identity.file}`);
console.log(`bytes:       ${identity.bytes.toLocaleString('en-US')}`);
console.log(`package:     ${identity.package}`);
console.log(`versionName: ${identity.versionName}`);
console.log(`versionCode: ${identity.versionCode}`);
console.log(`sdk:         min ${identity.minSdkVersion} / target ${identity.targetSdkVersion}`);
for (const [needle, info] of Object.entries(stamps)) {
  console.log(`contains:    "${needle}" — ${info.occurrences} occurrence(s) in ${info.files} packaged file(s)`);
  for (const where of info.where) console.log(`               ${where}`);
}
process.exit(0);
