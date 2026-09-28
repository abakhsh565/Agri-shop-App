/**
 * Patch the AndroidManifest that Capacitor generates.
 *
 * WHY THIS FILE EXISTS AND WHY THE MANIFEST IS NOT EDITED DIRECTLY
 *
 * `android/` is gitignored and the APK workflow starts with:
 *
 *     rm -rf android/
 *     npx cap add android
 *
 * so the manifest is REGENERATED on every build. Editing `android/app/src/main/
 * AndroidManifest.xml` in a checkout changes nothing about the shipped APK — the file is a
 * build artifact, and a fresh template replaces it before Gradle ever runs. Anything the app
 * needs in that manifest has to be injected here, after `cap sync` and before Gradle runs,
 * which is what this script is for. (That early exit is also why the previous version could
 * not be extended in place: it returned as soon as CAMERA was present, so any second injection
 * added after it would have been silently skipped.)
 *
 * WHAT IT INJECTS
 *
 * 1. CAMERA — unchanged, and still optional for the hardware.
 *
 * 2. The app's own scheme, `agrishop://login?phone=…&shop=…`. This is what makes an
 *    invitation link open the app rather than a browser, and it needs no domain, no hosting
 *    and no verification. It is the only link that can reach the app on a phone today.
 *
 * 3. An https App Link for APP_LINK_HOST, when that is set. Deliberately gated: an https
 *    filter with `autoVerify` only does anything once the domain publishes
 *    /.well-known/assetlinks.json whose sha256_cert_fingerprints contains THIS build's signing
 *    certificate. An unverified `autoVerify` filter is not harmless-but-inert — Android
 *    resolves it to the browser, which is the behaviour we are trying to remove — so it is
 *    only added when the host is configured, and the fingerprints come from the same place.
 *
 *    These APKs are `assembleRelease`, signed with the stable release key from repository
 *    secrets (see .github/inject-signing.cjs), so the fingerprint is the same on every build
 *    and an App Link CAN verify against it. scripts/android-assetlinks.mjs reads that
 *    fingerprint back out of the signed APK and writes the assetlinks.json to publish — so
 *    the key and the published file cannot drift apart. What is still missing is the domain:
 *    until one serves /.well-known/assetlinks.json, this filter is not injected and
 *    `agrishop://` is the only link that reaches the app.
 *
 * Usage: node .github/inject-permissions.cjs   (APP_LINK_HOST optional)
 */
const fs = require('fs');

const path = 'android/app/src/main/AndroidManifest.xml';
const SCHEME = 'agrishop';

if (!fs.existsSync(path)) {
  console.log('AndroidManifest.xml not found — has `npx cap add android` run?');
  process.exit(1);
}

let xml = fs.readFileSync(path, 'utf8');
const inPlace = xml;

/** The generated launcher filter, used as the anchor to add siblings after. */
const LAUNCHER_FILTER =
  /(<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN"\s*\/>\s*<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>\s*<\/intent-filter>)/;

if (!LAUNCHER_FILTER.test(xml)) {
  // Capacitor's activity template changed shape. Say so instead of writing a manifest that
  // silently lacks the deep-link filters and ships an invitation link that opens a browser.
  console.error('MainActivity launcher intent-filter not found — cannot place deep-link filters.');
  process.exit(1);
}

// ── 1. Camera, optional ────────────────────────────────────────────────────────
if (xml.includes('android.permission.CAMERA')) {
  console.log('Camera permission already present');
} else {
  const perm = [
    '    <uses-permission android:name="android.permission.CAMERA" />',
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
  ].join('\n');
  xml = xml.replace(/(<manifest[^>]*>)/, '$1\n' + perm + '\n');
  console.log('Camera permission injected');
}

// ── 2. The app's own scheme ────────────────────────────────────────────────────
if (xml.includes(`android:scheme="${SCHEME}"`)) {
  console.log(`${SCHEME}:// intent-filter already present`);
} else {
  const filter = [
    '            <intent-filter>',
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    `                <data android:scheme="${SCHEME}" />`,
    '            </intent-filter>',
  ].join('\n');
  xml = xml.replace(LAUNCHER_FILTER, `$1\n${filter}`);
  console.log(`${SCHEME}:// intent-filter injected`);
}

// ── 3. https App Link, only when a verified domain is actually available ───────
const host = (process.env.APP_LINK_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

if (!host) {
  console.log('APP_LINK_HOST not set — https App Link filter skipped (deep links still work via the app scheme)');
} else if (xml.includes(`android:host="${host}"`)) {
  console.log(`App Link for ${host} already present`);
} else {
  const filter = [
    '            <!-- Verified https App Link. Android only routes these to this app when the',
    `                 domain publishes /.well-known/assetlinks.json, so the filter is added`,
    '                 only for a host that is expected to serve one. -->',
    '            <intent-filter android:autoVerify="true">',
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    `                <data android:scheme="https" android:host="${host}" />`,
    '            </intent-filter>',
  ].join('\n');
  xml = xml.replace(LAUNCHER_FILTER, `$1\n${filter}`);
  console.log(`App Link intent-filter injected for ${host}`);
}

if (xml === inPlace) {
  console.log('AndroidManifest.xml unchanged');
} else {
  fs.writeFileSync(path, xml);
  console.log('AndroidManifest.xml updated');
}
