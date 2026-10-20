// Small cross-platform helpers (macOS, Windows, Linux).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

// Open a URL or file in the default browser. Never throws.
export function openInBrowser(target) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [target]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {}
}

// Is Google Chrome installed? (Playwright drives it; it gets past bot checks
// that block Playwright's bundled browser.)
export function hasChrome() {
  const candidates = {
    darwin: ['/Applications/Google Chrome.app', path.join(process.env.HOME || '', 'Applications/Google Chrome.app')],
    win32: [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  }[process.platform] || [];
  return candidates.some((p) => fs.existsSync(p));
}

export function npx(args) {
  // On Windows npx is npx.cmd, which needs a shell.
  execFileSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
}
