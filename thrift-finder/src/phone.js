// Phone mode: the app listens on your Wi-Fi (and Tailscale, if you use it), but
// only devices that opened the secret link can use it. The link carries a key;
// opening it once stores the key in a cookie for a year.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const KEY_FILE = path.join(os.homedir(), '.thrift-finder', 'access-key');
const COOKIE = 'tf_key';

// Same key across restarts so links saved on the phone keep working.
export function loadAccessKey() {
  try {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (k.length >= 20) return k;
  } catch {}
  const k = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  return k;
}

export function resetAccessKey() {
  fs.rmSync(KEY_FILE, { force: true });
  return loadAccessKey();
}

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function cookieKey(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export const hasValidCookie = (req, key) => same(cookieKey(req) ?? '', key);
export const keyMatches = (candidate, key) => same(candidate ?? '', key);
export const setCookieHeader = (key) => `${COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;

// Addresses a phone could reach: home network, plus Tailscale (100.64.0.0/10).
export function reachableAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [p, q] = a.address.split('.').map(Number);
      if (p === 100 && q >= 64 && q <= 127) out.push({ kind: 'tailscale', address: a.address, name });
      else if (p === 10 || (p === 192 && q === 168) || (p === 172 && q >= 16 && q <= 31)) out.push({ kind: 'wifi', address: a.address, name });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'wifi' ? -1 : 1));
}

export function phoneLinks(port, key) {
  return reachableAddresses().map((a) => ({
    ...a,
    label: a.kind === 'wifi' ? 'Same Wi-Fi as this computer' : 'Anywhere (Tailscale)',
    url: `http://${a.address}:${port}/?key=${key}`,
  }));
}

export const qrTerminal = (url) => QRCode.toString(url, { type: 'terminal', small: true });
export const qrSvg = (url) => QRCode.toString(url, { type: 'svg', margin: 1 });
