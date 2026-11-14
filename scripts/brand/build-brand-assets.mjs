/**
 * Renders the brand SVGs into every raster the app ships.
 *
 * Why a script instead of hand-exported PNGs: `android/` is gitignored and the release
 * workflow regenerates it with `npx cap add android`, so the launcher icon and the native
 * splash only exist on a machine that re-runs generation. Keeping the sizes in one command
 * means the CI APK and the local APK cannot drift apart.
 *
 *   node scripts/brand/build-brand-assets.mjs
 *   npx capacitor-assets generate --android
 *
 * The sizes are the ones @capacitor/assets requires in custom mode (icon 1024, splash
 * 2732) plus the web-shell icons index.html and public/manifest.json point at.
 */
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RES = path.join(ROOT, "resources");
const PUBLIC = path.join(ROOT, "public");

const BRAND = "#84cc16";
const INK = "#0a0a0a";
const WHITE = "#ffffff";

const readSvg = (name) => readFile(path.join(RES, name), "utf8");
/** The mark with its fill swapped — the same geometry, drawn in the colour the context needs. */
const markIn = (svg, colour) => svg.replaceAll("#84CC16", colour);

async function png(svg, size, background) {
  let img = sharp(Buffer.from(svg), { density: 600 });
  if (background) img = img.flatten({ background });
  return img
    .resize(size, size, { fit: "contain", background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** A logo centred on a full-bleed canvas (icon-only, splash, maskable). */
async function canvas({ size, background, logo, logoWidth }) {
  const art = await sharp(Buffer.from(logo), { density: 600 })
    .resize({ width: logoWidth })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toBuffer();
}

const badge = await readSvg("logo-badge.svg");
const mark = await readSvg("logo-mark.svg");
// Owner's lockup (badge + wordmark), recoloured to the brand token: ink wordmark on light,
// white on the dark splash. Generated from `With text  logo.svg` by the command in README
// of this folder.
const lockup = await readSvg("logo-lockup.svg");
const lockupDark = await readSvg("logo-lockup-dark.svg");

await mkdir(RES, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

// ── @capacitor/assets, custom mode ────────────────────────────────────────────
// Icon: lime field, glyph in white (the owner's own treatment). Adaptive foreground keeps
// the mark inside the 66% safe circle so Android's mask crop never clips it.
await writeFile(path.join(RES, "icon-only.png"), await canvas({ size: 1024, background: BRAND, logo: markIn(mark, WHITE), logoWidth: 560 }));
await writeFile(path.join(RES, "icon-background.png"), await png(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${BRAND}"/></svg>`, 1024, BRAND));
await writeFile(path.join(RES, "icon-foreground.png"), await canvas({ size: 1024, background: { r: 0, g: 0, b: 0, alpha: 0 }, logo: markIn(mark, WHITE), logoWidth: 560 }));
await writeFile(path.join(RES, "splash.png"), await canvas({ size: 2732, background: WHITE, logo: lockup, logoWidth: 900 }));
await writeFile(path.join(RES, "splash-dark.png"), await canvas({ size: 2732, background: INK, logo: lockupDark, logoWidth: 900 }));

// ── Web shell: tab icon, apple-touch icon, PWA manifest ───────────────────────
await writeFile(path.join(PUBLIC, "favicon.png"), await png(badge, 192));
await writeFile(path.join(PUBLIC, "icon-192.png"), await png(badge, 192));
await writeFile(path.join(PUBLIC, "icon-512.png"), await png(badge, 512));
// Maskable: the OS crops to a circle/squircle, so the badge gets breathing room.
await writeFile(path.join(PUBLIC, "icon-maskable-512.png"), await canvas({ size: 512, background: BRAND, logo: markIn(mark, WHITE), logoWidth: 280 }));

console.log("brand assets written: resources/{icon-only,icon-background,icon-foreground,splash,splash-dark}.png, public/{favicon,icon-192,icon-512,icon-maskable-512}.png");
