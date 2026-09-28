import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * THE RULE THIS PROTECTS
 *
 *   The APK that ships is signed with ONE stable release key, and that key comes from
 *   GitHub secrets. It must never be possible for a build to quietly produce a debug-signed
 *   APK and still be published.
 *
 * WHY A DEBUG BUILD IS NOT SIMPLY "LESS GOOD"
 *
 *   GitHub's runner mints a fresh debug keystore on every run, so the certificate
 *   fingerprint changes from one build to the next. Android verifies an https App Link by
 *   fetching /.well-known/assetlinks.json and requiring that it name the certificate the
 *   INSTALLED app is signed with — so with a per-build key no published file could ever
 *   match, and Android falls back to opening the invite link in a browser. The symptom is
 *   "deep links just don't work", which points at the manifest, the parser, or the phone —
 *   never at the signing key that was silently regenerated. A stable key is also the only
 *   way a later build can install OVER an earlier one.
 *
 * WHY THE GUARD READS THE WORKFLOW RATHER THAN GRADLE
 *
 *   `android/` is gitignored and the workflow deletes and regenerates it (`rm -rf android/`
 *   → `npx cap add android`) before building, so `android/app/build.gradle` and
 *   `AndroidManifest.xml` in a checkout are not what gets built. The workflow file is the
 *   only tracked description of how the APK is produced.
 */

const root = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(root, '.github/workflows/build-apk.yml');
const injectorPath = path.join(root, '.github/inject-signing.cjs');

const workflow = readFileSync(workflowPath, 'utf8');
const injector = readFileSync(injectorPath, 'utf8');

/** The environment the workflow must hand to the injector and to Gradle. */
const SIGNING_ENV = [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

/** Of those, the three whose VALUE is a GitHub secret (the path is a decoded workspace file). */
const SECRET_BACKED = [
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

describe('the shipped APK is release-signed with a stable key', () => {
  it('never builds a debug APK — assembleRelease only', () => {
    expect(
      /assembleDebug/.test(workflow),
      'the APK workflow asks Gradle for assembleDebug. A debug-signed APK has a per-runner ' +
        'certificate, so Android can never match it against a published assetlinks.json and ' +
        'invite links silently open in a browser instead of the app.',
    ).toBe(false);

    expect(
      workflow,
      'the APK workflow no longer builds a release variant — how is the APK signed?',
    ).toContain('assembleRelease');
  });

  it('publishes the artifact the release build actually produces', () => {
    expect(
      workflow.includes('app-debug.apk'),
      'the release step still names app-debug.apk, which assembleRelease does not produce — ' +
        'the release would ship nothing.',
    ).toBe(false);

    expect(workflow).toContain('app-release.apk');
  });

  it('injects the signing config after android/ is generated, not before', () => {
    const regenerate = workflow.indexOf('npx cap add android');
    const inject = workflow.indexOf('inject-signing.cjs');

    expect(regenerate, '`npx cap add android` not found in the APK workflow').toBeGreaterThan(-1);
    expect(inject, 'the APK workflow never runs .github/inject-signing.cjs').toBeGreaterThan(-1);
    expect(
      inject > regenerate,
      'the signing config is injected before android/ is regenerated, so `npx cap add android` ' +
        'would overwrite it with a template that is not release-signed.',
    ).toBe(true);
  });

  it('supplies every secret the injector requires — secrets, never literals', () => {
    for (const name of SIGNING_ENV) {
      expect(
        workflow,
        `${name} is required by .github/inject-signing.cjs but the workflow never passes it. ` +
          'The injector exits non-zero rather than debug-sign, so the APK job would fail.',
      ).toContain(`${name}:`);
    }

    for (const name of SECRET_BACKED) {
      expect(
        workflow,
        `${name} must come from a GitHub secret — a password committed into the workflow is a ` +
          'published password.',
      ).toContain(`secrets.${name}`);
    }

    // The keystore blob is decoded to a workspace file before Gradle runs; the file's path is
    // derived, not secret, but the blob itself must be.
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_BASE64');
    expect(workflow).toMatch(/ANDROID_KEYSTORE_PATH:\s*\$\{\{ github\.workspace \}\}/);

    // No password may be committed to the workflow in place of a secret reference.
    expect(
      /(storePassword|keyPassword)\s*[=:]\s*["'][^"'$]/.test(workflow),
      'the workflow carries a literal password instead of a secret reference',
    ).toBe(false);
  });

  it('writes no secret into the Gradle file — it is read from the environment', () => {
    for (const name of SIGNING_ENV) {
      expect(
        injector.includes(`System.getenv("${name}")`),
        `.github/inject-signing.cjs no longer reads ${name} from the environment, so its value ` +
          'must be reaching build.gradle some other way — a file that can end up in build ' +
          'output, a cache, or an artifact.',
      ).toBe(true);
    }

    // Gradle must be told to look at the release signing config, or the key is unused.
    expect(injector).toContain('signingConfig signingConfigs.release');
  });

  it('refuses to produce an APK rather than fall back to a debug signature', () => {
    const gradlePath = path.join(root, 'android/app/build.gradle');
    const before = existsSync(gradlePath) ? readFileSync(gradlePath, 'utf8') : null;

    // Scrubbed environment: none of the four values present. This is the exact shape of a
    // repository where the secrets have not been created yet.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of SIGNING_ENV) delete env[name];

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['.github/inject-signing.cjs'], {
        cwd: root,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      exitCode = failure.status ?? -1;
      stderr = failure.stderr ?? '';
    }

    expect(
      exitCode,
      'without the signing secrets the injector must exit non-zero. An exit of 0 means it ' +
        'produced a buildable — and therefore debug-signed — APK, which is the silent failure ' +
        'this whole change exists to remove.',
    ).not.toBe(0);

    expect(stderr, 'the failure must name the missing secrets so the fix is obvious').toMatch(
      /ANDROID_KEYSTORE_PATH|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_ALIAS|ANDROID_KEY_PASSWORD/,
    );

    // It must bail before touching the generated Gradle file.
    const after = existsSync(gradlePath) ? readFileSync(gradlePath, 'utf8') : null;
    expect(after, 'the injector modified android/app/build.gradle while refusing to run').toBe(before);
  });

  // The instructions for creating the key tell you to run `keytool` in the repository, which
  // puts a real signing key on disk next to the source. A `git add -A` from there would publish
  // the app's identity — hence the ignore rules, and hence this check that they still work.
  it.skipIf(!existsSync(path.join(root, '.git')))(
    'the release keystore cannot be committed',
    () => {
      const candidates = ['release.jks', 'keystore/release.jks', 'android/app/release.jks'];

      for (const candidate of candidates) {
        let ignored = true;
        try {
          execFileSync('git', ['check-ignore', '-q', candidate], { cwd: root, stdio: 'ignore' });
        } catch {
          ignored = false;
        }
        expect(
          ignored,
          `${candidate} is not gitignored. A committed release keystore lets anyone publish an ` +
            'APK that Android accepts as an update to the installed app.',
        ).toBe(true);
      }

      // And none may be tracked already, whatever the ignore rules say.
      const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((file) => /\.(jks|keystore|p12)$/i.test(file));
      expect(tracked, 'a signing key is already tracked by git').toEqual([]);
    },
  );

  it('names the package the app is actually installed as', () => {
    // assetlinks.json is checked against the installed package name and the certificate.
    // A mismatch here fails the same silent way: the link opens in a browser.
    const assetlinks = readFileSync(path.join(root, 'scripts/android-assetlinks.mjs'), 'utf8');
    const appId = readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8').match(
      /appId:\s*'([^']+)'/,
    );
    expect(appId, 'capacitor.config.ts no longer declares appId').toBeTruthy();

    expect(
      assetlinks,
      `scripts/android-assetlinks.mjs does not name ${appId?.[1]} — assetlinks.json would ` +
        'associate App Links with a package that is not the one being installed.',
    ).toContain(appId![1]);
  });
});
