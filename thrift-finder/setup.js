#!/usr/bin/env node
// One-time setup: checks requirements, makes sure there's a browser to search
// with, and downloads the image model so the first search is fast.
// Safe to run again.
import { hasChrome, npx } from './src/platform.js';

const ok = (m) => console.log(`  ✓ ${m}`);
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`  ✗ Node ${process.versions.node} is too old. Install Node 22 or newer from https://nodejs.org`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

if (hasChrome()) {
  ok('Google Chrome found');
} else {
  console.log('  … Google Chrome not found, downloading a browser to search with (~150 MB)');
  npx(['playwright', 'install', 'chromium']);
  ok('Browser installed. Tip: installing Google Chrome gets better results on eBay and ThredUp');
}

console.log('  … Downloading the image model (~150 MB, first time only)');
const { embedTexts } = await import('./src/vision.js');
await embedTexts(['a photo of a jacket']);
ok('Image model ready');
console.log('\n  All set! Start it with:  npm start\n');
