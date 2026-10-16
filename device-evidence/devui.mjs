/**
 * devui.mjs — read and drive the app on the attached phone, in text.
 *
 * WHY THIS EXISTS
 *
 * A release build of the app is a Capacitor WebView: `uiautomator`'s dump exposes the rendered
 * nodes (text + bounds) but nothing else on the phone does. Reading that dump gives the phone's
 * real screen as text, and the bounds in it give exact tap targets — so a device pass can be
 * driven and judged from the terminal instead of by eye, and the evidence is a string a reader can
 * check rather than a screenshot someone has to trust.
 *
 * `uiautomator dump /sdcard/ui.xml` is mangled by Git Bash's path conversion (it rewrites
 * `/sdcard/...` into `C:/Program Files/Git/sdcard/...`), which is why every adb call here runs with
 * MSYS_NO_PATHCONV=1.
 *
 * Usage:
 *   node device-evidence/devui.mjs screen              # print the phone's nodes (text + centre)
 *   node device-evidence/devui.mjs tap <text>          # tap the node whose text/content-desc matches
 *   node device-evidence/devui.mjs tapxy <x> <y>       # tap raw device pixels
 *   node device-evidence/devui.mjs type <text>         # type into the focused field
 *   node device-evidence/devui.mjs key <back|home|enter>
 *   node device-evidence/devui.mjs shot <name>         # save device-evidence/<name>.png
 *   node device-evidence/devui.mjs app                 # bring the app to the front
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ADB = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const PACKAGE = 'com.agrishop.app';
const OUT_DIR = 'device-evidence';

const adb = (...args) =>
  execFileSync(ADB, args, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

const [command, ...rest] = process.argv.slice(2);

function nodes() {
  adb('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/ui.xml');
  const found = [];
  for (const tag of xml.split('<')) {
    if (!tag.startsWith('node ')) continue;
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? '';
    const desc = /content-desc="([^"]*)"/.exec(tag)?.[1] ?? '';
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (!bounds) continue;
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
    if (!text && !desc) continue;
    found.push({
      label: text || desc,
      from: text ? 'text' : 'content-desc',
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      w: x2 - x1,
      h: y2 - y1,
    });
  }
  return found;
}

function find(label) {
  const needle = label.toLowerCase();
  const all = nodes();
  const hit = all.find((n) => n.label.toLowerCase() === needle) ??
    all.find((n) => n.label.toLowerCase().includes(needle));
  if (!hit) {
    console.error(`no node matching "${label}". On screen:\n` +
      all.map((n) => `  "${n.label}" @ ${n.x},${n.y}`).join('\n'));
    process.exit(1);
  }
  return hit;
}

switch (command) {
  case 'screen': {
    const all = nodes();
    if (!all.length) console.log('(no text nodes — the screen may be empty or still loading)');
    for (const n of all) console.log(`"${n.label}" (${n.from}) @ ${n.x},${n.y}  ${n.w}x${n.h}`);
    break;
  }
  case 'tap': {
    const hit = find(rest.join(' '));
    adb('shell', 'input', 'tap', String(hit.x), String(hit.y));
    console.log(`tapped "${hit.label}" @ ${hit.x},${hit.y}`);
    break;
  }
  case 'tapxy':
    adb('shell', 'input', 'tap', rest[0], rest[1]);
    console.log(`tapped ${rest[0]},${rest[1]}`);
    break;
  case 'type':
    adb('shell', 'input', 'text', rest.join(' ').replace(/ /g, '%s'));
    console.log('typed');
    break;
  case 'key': {
    const key = { back: 'KEYCODE_BACK', home: 'KEYCODE_HOME', enter: 'KEYCODE_ENTER' }[rest[0]];
    adb('shell', 'input', 'keyevent', key);
    console.log(`pressed ${rest[0]}`);
    break;
  }
  case 'shot': {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${rest[0]}.png`);
    fs.writeFileSync(file, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 28 }));
    console.log(`${file} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
    break;
  }
  case 'app':
    adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
    console.log('app brought to front');
    break;
  default:
    console.error('usage: screen | tap <text> | tapxy <x> <y> | type <text> | key <back|home|enter> | shot <name> | app');
    process.exit(2);
}
