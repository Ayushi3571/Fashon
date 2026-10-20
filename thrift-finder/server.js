#!/usr/bin/env node
// Local web app: http://localhost:4747.
// Default: only this computer can use it.
// --phone: also reachable from your phone over Wi-Fi/Tailscale, via a private link.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SITES, DEFAULT_SITES } from './src/sites.js';
import { runSearch } from './src/agent.js';
import * as phone from './src/phone.js';
import { openInBrowser } from './src/platform.js';

const PORT = Number(process.env.PORT) || 4747;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 20 * 1024 * 1024;
const PHONE = process.argv.includes('--phone');
const KEY = PHONE ? (process.argv.includes('--reset-key') ? phone.resetAccessKey() : phone.loadAccessKey()) : null;
let busy = false; // one search at a time: the Chrome profile can only be opened once

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error('That photo is too large.');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function saveDataUrl(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Couldn’t read that photo. Try a JPG or PNG.');
  const file = path.join(os.tmpdir(), `thrift-finder-${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
  await fs.writeFile(file, Buffer.from(m[2], 'base64'));
  return file;
}

async function handleSearch(req, res) {
  if (busy) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'A search is already running. Wait for it to finish.' }));
  }
  busy = true;
  let imagePath;
  // Stream newline-delimited JSON events so the page can show live progress.
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
  const send = (e) => res.write(JSON.stringify(e) + '\n');
  try {
    const body = await readJson(req);
    if (body.image) imagePath = await saveDataUrl(body.image);
    const result = await runSearch({
      query: imagePath ? '' : body.text || '',
      hint: imagePath ? body.text || '' : '',
      imagePath,
      maxPrice: Number(body.maxPrice),
      sites: Array.isArray(body.sites) ? body.sites : DEFAULT_SITES,
      fbCity: (body.fbCity || 'nyc').toLowerCase().replace(/[^a-z0-9-]/g, ''),
      visual: body.visual !== false,
      onEvent: send,
    });
    send({ type: 'done', result });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  } finally {
    busy = false;
    res.end();
    if (imagePath) fs.rm(imagePath, { force: true }).catch(() => {});
  }
}

const DENIED = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thrift Finder</title>
<body style="font:16px -apple-system,sans-serif;padding:32px;max-width:420px;margin:auto;line-height:1.5">
<h2>🔒 Private link needed</h2><p>On your computer, open Thrift Finder and click <b>Use on phone</b>, then scan the QR code with this phone's camera.</p></body>`;

function manifest(req) {
  // iPhone home-screen apps don't share Safari's cookies, so the installed app
  // starts from the private link itself.
  const authed = PHONE && phone.hasValidCookie(req, KEY);
  return JSON.stringify({
    name: 'Thrift Finder',
    short_name: 'Thrift Finder',
    start_url: authed ? `/?key=${KEY}` : '/',
    display: 'standalone',
    background_color: '#faf8f5',
    theme_color: '#2f6b4f',
    icons: [
      { src: '/icon-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // Icons and manifest are public so the phone can show them before signing in.
    if (req.method === 'GET' && /^\/icon-(180|512)\.png$/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
      return res.end(await fs.readFile(path.join(ROOT, 'public', url.pathname.slice(1))));
    }
    if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      return res.end(manifest(req));
    }

    if (!phone.isLocal(req)) {
      if (!PHONE) return res.writeHead(403).end('Forbidden');
      if (url.searchParams.has('key')) {
        if (!phone.keyMatches(url.searchParams.get('key'), KEY)) {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(DENIED);
        }
        res.writeHead(302, { 'Set-Cookie': phone.setCookieHeader(KEY), Location: '/' });
        return res.end();
      }
      if (!phone.hasValidCookie(req, KEY)) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(DENIED);
      }
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await fs.readFile(path.join(ROOT, 'public', 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/sites') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(DEFAULT_SITES.map((key) => ({ key, label: SITES[key].label }))));
    }
    // Only the computer running the app may see the private link.
    if (req.method === 'GET' && url.pathname === '/api/phone' && phone.isLocal(req)) {
      const links = PHONE ? await Promise.all(phone.phoneLinks(PORT, KEY).map(async (l) => ({ ...l, svg: await phone.qrSvg(l.url) }))) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ enabled: PHONE, links }));
    }
    if (req.method === 'POST' && url.pathname === '/api/search') return await handleSearch(req, res);
    res.writeHead(404).end('Not found');
  } catch (e) {
    if (!res.headersSent) res.writeHead(500).end(e.message);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Thrift Finder already seems to be running → http://localhost:${PORT}`);
    if (!process.argv.includes('--no-open')) openInBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }
  throw e;
});

// Phone mode listens on all addresses, which the OS may allow alongside a copy
// already listening on localhost, so check for one first.
const alreadyRunning = await fetch(`http://127.0.0.1:${PORT}/api/sites`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
if (alreadyRunning) server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));

server.listen(PORT, PHONE ? '0.0.0.0' : '127.0.0.1', async () => {
  console.log(`\n  Thrift Finder is running → http://localhost:${PORT}`);
  if (PHONE) {
    const links = phone.phoneLinks(PORT, KEY);
    if (!links.length) console.log('\n  ⚠ This computer isn\'t on a network the phone can reach. Connect to Wi-Fi and restart.');
    for (const l of links) {
      console.log(`\n  📱 ${l.label}: scan with your phone's camera\n`);
      console.log((await phone.qrTerminal(l.url)).replace(/^/gm, '     '));
      console.log(`     ${l.url}`);
    }
    console.log('\n  Keep this computer on and awake while you use it from your phone.');
  }
  console.log('  (Leave this window open. Press Ctrl+C to stop.)\n');
  if (!process.argv.includes('--no-open')) openInBrowser(`http://localhost:${PORT}`);
});
