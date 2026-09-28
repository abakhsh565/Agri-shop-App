/**
 * Write /.well-known/assetlinks.json from the APK that is about to be released.
 *
 * WHY IT IS DERIVED RATHER THAN WRITTEN BY HAND
 *
 * Android verifies an https App Link by fetching
 * `https://<host>/.well-known/assetlinks.json` and requiring that its
 * `sha256_cert_fingerprints` contains the certificate the INSTALLED APK is signed with. The
 * file and the keystore are therefore two halves of one fact, and a hand-copied fingerprint is
 * a fact that rots the moment the key is rotated — silently, because the failure mode is
 * Android quietly opening the link in a browser instead of the app.
 *
 * So the fingerprint is read back out of the signed artifact itself. `apksigner verify` also
 * refuses an unsigned or broken APK, which means this step cannot report a fingerprint for a
 * build that was never signed.
 *
 * Usage: node scripts/android-assetlinks.mjs <path-to-signed.apk>
 *   APP_LINK_HOST       the domain the link will be served from (e.g. app.agrishop.pk)
 *   ANDROID_HOME        used to locate `apksigner` in build-tools
 *
 * Exits 0 and writes nothing when APP_LINK_HOST is unset — App Links are off, so there is
 * nothing for a domain to publish.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Must match `applicationId` in android/app/build.gradle and `appId` in capacitor.config.ts. */
const PACKAGE_NAME = 'com.agrishop.app';

const apkPath = process.argv[2];
const host = (process.env.APP_LINK_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

if (!host) {
  console.log('APP_LINK_HOST not set — App Links are not enabled, so no assetlinks.json is written.');
  console.log('The app\'s own scheme (agrishop://) still opens invitation links.');
  process.exit(0);
}

if (!apkPath || !fs.existsSync(apkPath)) {
  console.error(`Signed APK not found at: ${apkPath ?? '(no path given)'}`);
  process.exit(1);
}

/** Locate apksigner in whichever build-tools version the SDK has, newest first. */
function findApksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const buildTools = path.join(sdk, 'build-tools');
  if (!fs.existsSync(buildTools)) return null;

  const versions = fs
    .readdirSync(buildTools)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const [a1, a2, a3] = a.split('.').map(Number);
      const [b1, b2, b3] = b.split('.').map(Number);
      return b1 - a1 || b2 - a2 || b3 - a3;
    });

  for (const version of versions) {
    for (const name of ['apksigner', 'apksigner.bat']) {
      const candidate = path.join(buildTools, version, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const apksigner = findApksigner();
if (!apksigner) {
  console.error('Could not find `apksigner` — set ANDROID_HOME, or check that build-tools is installed.');
  process.exit(1);
}

let output;
try {
  // Throws on an unsigned or malformed APK, which is the point: no fingerprint for a build
  // that was never signed.
  output = execFileSync(apksigner, ['verify', '--print-certs', apkPath], { encoding: 'utf8' });
} catch (error) {
  console.error('apksigner could not verify the APK. It is probably not signed:');
  console.error(error.stdout || error.message);
  process.exit(1);
}

const match = output.match(/SHA-256 digest:\s*([0-9a-fA-F]{64})/);
if (!match) {
  console.error('No SHA-256 certificate digest in apksigner output:');
  console.error(output);
  process.exit(1);
}

// assetlinks.json wants colon-separated uppercase hex.
const fingerprint = (match[1].toUpperCase().match(/.{2}/g) ?? []).join(':');

const statements = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PACKAGE_NAME,
      sha256_cert_fingerprints: [fingerprint],
    },
  },
];

const outDir = path.join('dist', '.well-known');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'assetlinks.json');
fs.writeFileSync(outFile, `${JSON.stringify(statements, null, 2)}\n`);

console.log(`Signed APK verified: ${apkPath}`);
console.log(`package  : ${PACKAGE_NAME}`);
console.log(`sha256   : ${fingerprint}`);
console.log('');
console.log(`Wrote ${outFile} — publish it at https://${host}/.well-known/assetlinks.json`);
console.log('then set the APP_LINK_HOST repository variable and rebuild, so the https App Link');
console.log('filter is injected into the manifest as well.');
