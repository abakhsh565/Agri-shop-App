#!/usr/bin/env node
/**
 * A local, same-origin stand-in for Sentry's ingest, used to prove the real built bundle reports.
 *
 * It serves `dist/` (so the page and the DSN share an origin and no CORS preflight is involved) and
 * appends every envelope it receives to `sentry-envelopes.log`, one JSON entry per line:
 * `{ at, path, body }`.
 *
 * Usage: node device-evidence/tmp/sentry-sink.mjs [port]
 */
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 8787);
const root = join(process.cwd(), 'dist');
const logPath = join(process.cwd(), 'device-evidence', 'tmp', 'sentry-envelopes.log');

writeFileSync(logPath, '');

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      appendFileSync(
        logPath,
        `${JSON.stringify({ at: new Date().toISOString(), path: url.pathname, body })}\n`,
      );
      // Sentry answers with the envelope's event id; the SDK only needs a 2xx.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"ffffffffffffffffffffffffffffffff"}');
    });
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(root, requested));
  if (existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }

  // SPA fallback, exactly as vercel.json rewrites it.
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(join(root, 'index.html')));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`sink listening on http://127.0.0.1:${port} — log: ${logPath}`);
});
