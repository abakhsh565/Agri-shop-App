/**
 * Give the release build a stable signing key.
 *
 * WHY THIS IS INJECTED RATHER THAN COMMITTED
 *
 * `android/` is gitignored and the APK workflow begins with `rm -rf android/ && npx cap
 * android` — so `android/app/build.gradle` is a generated artifact, and a signing block
 * written into a checkout would be erased before Gradle ever reads it. It is applied here,
 * after generation, exactly like the manifest entries.
 *
 * WHY THE SECRETS COME FROM THE ENVIRONMENT
 *
 * Nothing is written into the Gradle file except variable names. The values are read by Gradle
 * from the process environment at configuration time, so no password reaches a file that could
 * end up in build output, a cache, or an artifact.
 *
 * WHY IT REFUSES TO RUN WITHOUT THEM
 *
 * A debug-signed APK is useless for App Links in a way that is invisible: GitHub's runner
 * generates a fresh debug keystore on every run, so the certificate fingerprint changes per
 * build and /.well-known/assetlinks.json can never match it. Android then silently falls back
 * to opening the link in a browser — the exact behaviour the deep links exist to remove. That
 * failure would look like "deep links just don't work" rather than "the build was unsigned",
 * so this exits non-zero instead of quietly producing another debug APK.
 *
 * Required environment:
 *   ANDROID_KEYSTORE_PATH      absolute path to the decoded .keystore / .jks
 *   ANDROID_KEYSTORE_PASSWORD  store password
 *   ANDROID_KEY_ALIAS          key alias inside the keystore
 *   ANDROID_KEY_PASSWORD       key password
 */
const fs = require('fs');

const gradlePath = 'android/app/build.gradle';

const required = [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

const missing = required.filter((name) => !(process.env[name] || '').trim());

if (missing.length) {
  console.error(
    [
      '',
      `Release signing is not configured: missing ${missing.join(', ')}.`,
      '',
      'The APK is deliberately NOT built instead of being built debug-signed, because a',
      'debug-signed APK cannot be verified by Android as the owner of the invite-link',
      'domain — the fingerprint changes on every runner — so App Links would silently',
      'fall back to the browser.',
      '',
      'Add these repository secrets, then re-run:',
      '  ANDROID_KEYSTORE_BASE64     base64 of the .jks release keystore',
      '  ANDROID_KEYSTORE_PASSWORD',
      '  ANDROID_KEY_ALIAS',
      '  ANDROID_KEY_PASSWORD',
      '',
      'Generate the keystore once, and keep it safe — losing it means shipping an update',
      'that Android refuses to install over the previous version:',
      '  keytool -genkeypair -v -keystore release.jks -alias agrishop \\',
      '    -keyalg RSA -keysize 2048 -validity 10000',
      '  base64 -w0 release.jks   # paste into ANDROID_KEYSTORE_BASE64',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// The path must resolve, or the failure surfaces later as an opaque Gradle error.
if (!fs.existsSync(process.env.ANDROID_KEYSTORE_PATH)) {
  console.error(
    `ANDROID_KEYSTORE_PATH does not point at a file: ${process.env.ANDROID_KEYSTORE_PATH}`,
  );
  process.exit(1);
}

if (!fs.existsSync(gradlePath)) {
  console.error(`${gradlePath} not found — has \`npx cap add android\` run?`);
  process.exit(1);
}

let gradle = fs.readFileSync(gradlePath, 'utf8');
const inPlace = gradle;

// ── The signingConfigs block, inserted before buildTypes ───────────────────────
const BUILD_TYPES_ANCHOR = /\n(    buildTypes \{)/;

const SIGNING_CONFIGS = `
    signingConfigs {
        release {
            // Values come from the environment (see .github/inject-signing.cjs): no password
            // is ever written into this file.
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
`;

if (gradle.includes('signingConfigs {')) {
  console.log('signingConfigs already present');
} else if (BUILD_TYPES_ANCHOR.test(gradle)) {
  gradle = gradle.replace(BUILD_TYPES_ANCHOR, `${SIGNING_CONFIGS}\n$1`);
  console.log('signingConfigs block injected');
} else {
  // Capacitor's Gradle template changed shape. Stop rather than produce an unsigned APK that
  // would look fine until someone tried an invite link.
  console.error('Could not find `buildTypes {` in app/build.gradle — cannot inject signingConfigs.');
  process.exit(1);
}

// ── Point the release buildType at it ──────────────────────────────────────────
// The indentation is taken from the FIRST PROPERTY inside `release {` rather than from
// `release {` itself, so the injected line lines up with its siblings. Reading it off the
// opening brace produced a line indented one level too little, which is cosmetic to Gradle
// and conspicuous to anyone reading the file.
const RELEASE_ANCHOR = /(buildTypes\s*\{\s*\n\s*release\s*\{\n)([ \t]*)(?=\S)/;

if (/release \{[\s\S]{0,200}?signingConfig signingConfigs\.release/.test(gradle)) {
  console.log('release buildType already uses the release signingConfig');
} else if (RELEASE_ANCHOR.test(gradle)) {
  // The lookahead consumes the next line's indentation, so it is re-emitted after the new
  // line — otherwise `minifyEnabled` loses its indent and lands against the left margin.
  gradle = gradle.replace(
    RELEASE_ANCHOR,
    (match, head, innerIndent) =>
      `${head}${innerIndent}signingConfig signingConfigs.release\n${innerIndent}`,
  );
  console.log('release buildType pointed at the release signingConfig');
} else {
  console.error('Could not find `buildTypes { release {` — cannot attach the signing config.');
  process.exit(1);
}

if (gradle === inPlace) {
  console.log('app/build.gradle unchanged');
} else {
  fs.writeFileSync(gradlePath, gradle);
  console.log('app/build.gradle updated for release signing');
}
