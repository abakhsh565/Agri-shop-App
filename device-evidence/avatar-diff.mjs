/**
 * avatar-diff.mjs — did the thumbnail actually render on the phone, judged from the pixels.
 *
 * WHY PIXELS
 *
 * The app is a WebView: `uiautomator` exposes the row's text and content-desc but NOT an image
 * node, so the accessibility tree can say "this row changed" and cannot say "an image is drawn
 * here". The screenshot is the only place that fact exists — and a screenshot is checkable without
 * eyes if it is decoded: the uploaded probe is a known solid orange, so the avatar region of that
 * one row must change to orange when `image_url` is set, and must not be orange when it is null.
 *
 * Node has no image decoder, so this carries a small PNG reader (inflate + the five filter types)
 * — enough for what `adb screencap` produces (8-bit truecolour / truecolour-alpha, no interlace).
 *
 * Usage: node device-evidence/avatar-diff.mjs <before.png> <after.png> [x1 y1 x2 y2]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: only 8-bit, non-interlaced PNGs`);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error(`${file}: unsupported colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

/** Mean RGB and the share of pixels close to the probe colour, for one rectangle. */
function region(img, [x1, y1, x2, y2]) {
  let r = 0, g = 0, b = 0, n = 0, orange = 0;
  for (let y = Math.max(0, y1); y < Math.min(img.height, y2); y++) {
    for (let x = Math.max(0, x1); x < Math.min(img.width, x2); x++) {
      const i = (y * img.width + x) * img.channels;
      const [pr, pg, pb] = [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
      r += pr; g += pg; b += pb; n++;
      if (Math.abs(pr - 255) < 60 && Math.abs(pg - 122) < 60 && Math.abs(pb - 0) < 60) orange++;
    }
  }
  return { mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], orangePct: +((orange / n) * 100).toFixed(1), pixels: n };
}

const [before, after, ...box] = process.argv.slice(2);
if (!before || !after) {
  console.error('usage: node device-evidence/avatar-diff.mjs <before.png> <after.png> [x1 y1 x2 y2]');
  process.exit(2);
}
const area = box.length === 4 ? box.map(Number) : [32, 900, 200, 1040]; // QA Product A's row avatar
const a = decodePng(before);
const b = decodePng(after);
console.log(`${before}: ${a.width}x${a.height}`);
console.log(`${after} : ${b.width}x${b.height}`);
console.log(`region x${area[0]}..${area[2]} y${area[1]}..${area[3]}`);
const ra = region(a, area);
const rb = region(b, area);
console.log(`before — mean rgb ${ra.mean.join(',')}  orange ${ra.orangePct}%  (${ra.pixels} px)`);
console.log(`after  — mean rgb ${rb.mean.join(',')}  orange ${rb.orangePct}%  (${rb.pixels} px)`);
