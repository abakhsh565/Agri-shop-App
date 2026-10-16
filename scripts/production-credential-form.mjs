#!/usr/bin/env node
/**
 * production-credential-form.mjs — the last-resort intake channel: type the password into a form.
 *
 * WHY THIS EXISTS
 *   Three attempts to supply `PROD_DB_PASS` produced no write anywhere on this machine: the
 *   sanctioned file stayed byte-identical to its template, no other file carried the key, and the
 *   PowerShell history records no invocation of the helper. Every previous channel assumed the
 *   operator can successfully operate this machine's terminal or filesystem. This one does not: the
 *   form is rendered in the app's own Preview panel, and its POST lands on 127.0.0.1 in this
 *   process, which writes the sanctioned file. Nothing about the backup/verify path changes.
 *
 * SECURITY SHAPE (deliberately small)
 *   * Binds to 127.0.0.1 on an ephemeral port: not reachable from the network.
 *   * One-time token embedded in the served page; a POST without it is refused, so a random web
 *     page the operator visits cannot blind-write the file (it cannot read the token: same-origin
 *     policy blocks reading our page).
 *   * The password is never logged, never echoed back, never written to stdout/stderr. The only
 *     output is a receipt with a character count and a byte count.
 *   * Body capped at 4 KiB; a non-loopback remote address is refused.
 *   * The server exits after the FIRST successful write, or after --ttl seconds (default 900)
 *     without one. It never lingers as a credential endpoint.
 *   * It writes only the PROD_DB_PASS line of a file that must resolve OUTSIDE the repository —
 *     the same rule the CLI intake enforces, imported rather than reimplemented — and it validates
 *     the complete credential set (host, user naming production, non-empty password) before
 *     writing, using the shared guard.
 *
 * Usage:
 *   node scripts/production-credential-form.mjs                 # real intake: ~/.agrishop/production.env
 *   node scripts/production-credential-form.mjs --file <path>   # used by the verifier with a canary
 *   node scripts/production-credential-form.mjs --ttl 600
 * Exit codes: 0 written · 2 refused (nothing written) · 3 TTL reached (nothing written).
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, expectedProjectRefFor } from './lib/environments.mjs';
import {
  assertOutsideRepository,
  defaultCredentialsPath,
  parseCredentialsFile,
  validateProductionCredentials,
} from './lib/credentials-file.mjs';

function flag(name, fallback = null) {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const token = argv[i];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : argv[i + 1] ?? fallback;
}

const filePath = assertOutsideRepository(path.resolve(flag('file', defaultCredentialsPath())));
const ttlSeconds = Number(flag('ttl', '900'));
const TOKEN = crypto.randomBytes(24).toString('hex');
const PROJECT_REF = expectedProjectRefFor('production');

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Production credential intake</title>
<style>
 :root{color-scheme:light dark}
 body{font:15px/1.5 system-ui,Segoe UI,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1.25rem}
 h1{font-size:1.15rem;margin:0 0 .25rem}
 p{opacity:.85}
 code{background:rgba(127,127,127,.18);padding:.1rem .3rem;border-radius:.25rem}
 label{display:block;margin:1.25rem 0 .35rem;font-weight:600}
 input[type=password],input[type=text]{width:100%;padding:.6rem .7rem;font:inherit;box-sizing:border-box}
 button{margin-top:1rem;padding:.6rem 1.1rem;font:inherit;font-weight:600;cursor:pointer}
 .row{display:flex;gap:.6rem;align-items:center;margin-top:.5rem;font-weight:400}
 #out{margin-top:1.25rem;font-weight:600;white-space:pre-wrap}
 .bad{color:#c0392b}.ok{color:#1e874b}
 small{display:block;margin-top:1.5rem;opacity:.7}
</style></head><body>
<h1>Supply the production database password</h1>
<p>Project <code>${PROJECT_REF}</code> &middot; target file <code>${filePath}</code></p>
<p>Paste the password from Supabase &rarr; <em>Agrishop APp</em> &rarr; Settings &rarr; Database.
It is sent only to <code>127.0.0.1</code> on this machine, never logged, and never echoed back.</p>
<form id="f" autocomplete="off">
  <input type="hidden" name="token" value="${TOKEN}"/>
  <label for="p">PROD_DB_PASS</label>
  <input id="p" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off"/>
  <div class="row"><input id="s" type="checkbox"/><label for="s" style="margin:0;font-weight:400">show value while typing</label></div>
  <button type="submit">Save</button>
</form>
<div id="out"></div>
<small>This page is served by a local process that writes one line and then exits. Reloading after a
successful save will not work &mdash; the server is gone.</small>
<script>
 const out=document.getElementById('out'), field=document.getElementById('p'), show=document.getElementById('s');
 show.addEventListener('change',()=>{field.type=show.checked?'text':'password'});
 document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault(); out.className=''; out.textContent='Saving...';
  try{
   const r=await fetch('/save',{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({token:document.querySelector('[name=token]').value,password:field.value})});
   const j=await r.json();
   out.className=j.ok?'ok':'bad';
   out.textContent=j.ok
     ? 'Saved. '+j.message+'\\nThe value was not logged and is not shown anywhere. You can close this panel.'
     : 'Refused: '+j.message;
  }catch(err){out.className='bad';out.textContent='Save failed: '+err.message}
 });
</script></body></html>`;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}

function writeLine(target, value) {
  const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const lines = text.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    if (/^PROD_DB_PASS=/.test(line)) {
      replaced = true;
      return `PROD_DB_PASS=${value}`;
    }
    return line;
  });
  if (!replaced) out.push(`PROD_DB_PASS=${value}`);
  fs.writeFileSync(target, out.join('\n'), { mode: 0o600 });
  return replaced;
}

let closed = false;
function shutdown(server, code) {
  if (closed) return;
  closed = true;
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref();
}

const server = http.createServer((req, res) => {
  const remote = req.socket.remoteAddress ?? '';
  if (!/^(127\.|::1|::ffff:127\.)/.test(remote)) {
    return sendJson(res, 403, { ok: false, message: 'refused: not a loopback connection' });
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(PAGE);
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method !== 'POST' || req.url !== '/save') {
    return sendJson(res, 404, { ok: false, message: 'not found' });
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 4096) {
      sendJson(res, 413, { ok: false, message: 'refused: body too large' });
      req.destroy();
    }
  });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      return sendJson(res, 400, { ok: false, message: 'refused: unreadable request' });
    }
    if (parsed.token !== TOKEN) {
      return sendJson(res, 403, { ok: false, message: 'refused: stale or missing form token' });
    }
    const password = typeof parsed.password === 'string' ? parsed.password : '';
    if (!password) {
      return sendJson(res, 400, { ok: false, message: 'nothing entered — the file was not changed' });
    }

    try {
      const { values } = parseCredentialsFile(fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
      const complete = {
        PROD_DB_HOST: flag('host', values.PROD_DB_HOST ?? null) ?? '',
        PROD_DB_USER: values.PROD_DB_USER ?? '',
        PROD_DB_PASS: password,
      };
      const info = validateProductionCredentials(complete, { source: filePath });
      const replaced = writeLine(filePath, password);
      sendJson(res, 200, {
        ok: true,
        message:
          `PROD_DB_PASS holds ${password.length} characters; ${filePath} is now ${fs.statSync(filePath).size} bytes; ` +
          `PROD_DB_USER names production (${info.projectRef}); line replaced: ${replaced}.`,
      });
      console.error(`[FORM] credential written to ${filePath} (${password.length} chars, value never logged). Shutting down.`);
      shutdown(server, 0);
    } catch (error) {
      // The message names the file and the missing/incorrect key, never the value.
      sendJson(res, 400, { ok: false, message: String(error.message).split('\n')[0] });
    }
  });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`[FORM] http://127.0.0.1:${port}/`);
  console.log(`[FORM] target: ${filePath}`);
  console.log(`[FORM] one-time token issued; expires in ${ttlSeconds}s or after the first successful save`);
  console.log(`[FORM] pid: ${process.pid}`);
});

setTimeout(() => {
  console.error(`[FORM] TTL of ${ttlSeconds}s reached with no credential saved. Exiting; nothing was written.`);
  shutdown(server, 3);
}, Math.max(15, ttlSeconds) * 1000).unref();
