/**
 * pwaAssets — every file the production build asks for must exist.
 *
 * WHY THIS EXISTS
 *   `src/main.tsx` registers `/sw.js` and injects `<link rel="manifest" href="/manifest.json">` in
 *   every production web build, and for months neither file existed. On Vercel the SPA rewrite in
 *   `vercel.json` answered both with `index.html`, so `/sw.js` came back `200 text/html`, the browser
 *   refused it, and **every production page load** logged:
 *
 *     The script has an unsupported MIME type ('text/html').
 *
 *   No lane caught it because the registration runs only in a PROD build and the lanes do not build
 *   one — the paths are simply never requested in dev, where `main.tsx` deliberately unregisters
 *   workers instead. So the rule is asserted here, from the one file that names the paths.
 *
 * WHAT IT ASSERTS
 *   * every local path `main.tsx` asks for exists under `public/` — the directory Vite copies
 *     verbatim into the artifact, and the reason these paths are served at all;
 *   * the manifest is installable-shaped, and declares its icon at the icon's **true** size, because
 *     Chrome logs a warning when a declared size disagrees with the file — trading one console error
 *     for another is not a fix.
 *
 *   This is not a claim that the service worker is correct; it is the narrow claim that the thing the
 *   app requests is there to be served.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const mainSource = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8');

/** The public/ directory as a build resolves a root-relative path against it. */
function publicFile(path: string): string {
  return join(ROOT, 'public', path.replace(/^\//, ''));
}

function mustMatch(source: string, pattern: RegExp, what: string): string {
  const match = source.match(pattern);
  expect(match, `main.tsx no longer names ${what} — this guard is measuring nothing`).toBeTruthy();
  return match![1];
}

const serviceWorkerPath = mustMatch(
  mainSource,
  /serviceWorker\.register\(\s*["']([^"']+)["']/,
  'a service worker',
);
const manifestPath = mustMatch(mainSource, /link\.href\s*=\s*["']([^"']+)["']/, 'a manifest');

describe('the files the production build requests exist', () => {
  test('the registration is a production-build concern, which is why no lane saw it', () => {
    // If this ever stops being gated on PROD, the lanes start exercising it and this guard's
    // premise — "nothing builds this path today" — is no longer the reason it is needed.
    expect(mainSource).toContain('import.meta.env.PROD');
  });

  test('the service worker is in public/, where the artifact can serve it', () => {
    expect(serviceWorkerPath).toBe('/sw.js');
    expect(
      existsSync(publicFile(serviceWorkerPath)),
      `${serviceWorkerPath} is registered but missing from public/ — the SPA rewrite will answer it with index.html and the browser will refuse it, exactly as before`,
    ).toBe(true);
  });

  test('the manifest is in public/, where the artifact can serve it', () => {
    expect(manifestPath).toBe('/manifest.json');
    expect(
      existsSync(publicFile(manifestPath)),
      `${manifestPath} is injected by main.tsx but missing from public/`,
    ).toBe(true);
  });

  test('the manifest is installable-shaped', () => {
    const manifest = JSON.parse(readFileSync(publicFile(manifestPath), 'utf8')) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string }>;
    };
    for (const field of ['name', 'short_name', 'start_url', 'display'] as const) {
      expect(manifest[field], `the manifest has no "${field}"`).toBeTruthy();
    }
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
  });

  test('every declared icon exists and declares its real size', () => {
    const manifest = JSON.parse(readFileSync(publicFile(manifestPath), 'utf8')) as {
      icons: Array<{ src: string; sizes: string; type: string }>;
    };
    for (const icon of manifest.icons) {
      const file = publicFile(icon.src);
      expect(existsSync(file), `the manifest declares ${icon.src}, which does not exist`).toBe(true);

      // A PNG's size is in its IHDR chunk, readable without an image library. A non-PNG icon is not
      // checked rather than silently passed: the assertion below only runs where it can be made.
      const bytes = readFileSync(file);
      if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') continue;
      const real = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
      expect(icon.sizes, `the manifest says ${icon.sizes} but ${icon.src} is ${real}`).toBe(real);
    }
  });
});
