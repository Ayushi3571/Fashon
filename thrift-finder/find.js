#!/usr/bin/env node
// Thrift Finder: describe an item (text or photo), search resale sites under a
// price cap, and rank what comes back by how well it matches.
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SITES, DEFAULT_SITES } from './src/sites.js';
import { runSearch } from './src/agent.js';
import { openInBrowser } from './src/platform.js';
import { renderReport } from './src/report.js';

const HELP = `
Usage:
  node find.js "levis denim jacket" --max 40
  node find.js --image photo.jpg --max 30 [--hint "levis"]

Options:
  -m, --max <dollars>     Price ceiling (required)
  -i, --image <file>      Photo of the item; the query is generated from it
      --hint <words>      Extra words to add to a photo query (brand, size...)
  -s, --sites <list>      Comma-separated: ${DEFAULT_SITES.join(',')} (default: all)
      --fb-city <slug>    Facebook Marketplace city as in its URL (default: nyc)
  -n, --top <n>           How many results to print (default: 15)
      --no-visual         Skip CLIP photo comparison (faster, text-only ranking)
      --show              Show the browser window instead of hiding it off-screen
      --no-open           Don't open the HTML results page
      --out <dir>         Where to write results (default: ./results)
`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    max: { type: 'string', short: 'm' },
    image: { type: 'string', short: 'i' },
    hint: { type: 'string', default: '' },
    sites: { type: 'string', short: 's', default: DEFAULT_SITES.join(',') },
    'fb-city': { type: 'string', default: process.env.FB_CITY || 'nyc' },
    top: { type: 'string', short: 'n', default: '15' },
    'no-visual': { type: 'boolean', default: false },
    show: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
    out: { type: 'string', default: 'results' },
    help: { type: 'boolean', short: 'h' },
  },
});

const maxPrice = Number(o.max);
if (o.help || !(maxPrice > 0) || (!positionals.length && !o.image)) {
  console.log(HELP);
  process.exit(o.help ? 0 : 1);
}
const sites = o.sites.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const unknown = sites.filter((s) => !SITES[s]);
if (unknown.length) {
  console.error(`Unknown site(s): ${unknown.join(', ')}. Choose from: ${DEFAULT_SITES.join(', ')}`);
  process.exit(1);
}

if (o.image) await fs.access(o.image).catch(() => { console.error(`Can't read image: ${o.image}`); process.exit(1); });
const visual = !o['no-visual'];

const result = await runSearch({
  query: positionals.join(' '),
  imagePath: o.image,
  hint: o.hint,
  maxPrice,
  sites,
  fbCity: o['fb-city'],
  visual,
  show: o.show,
  onEvent(e) {
    if (e.type === 'status') console.log(`… ${e.message}`);
    if (e.type === 'query' && e.via) console.log(`   → "${e.query}" (${e.via})`);
    if (e.type === 'site') console.log(`   ${e.label.padEnd(15)} ${e.error ? `failed: ${e.error}` : `${e.count} listings`}`);
    if (e.type === 'progress' && process.stdout.isTTY) process.stdout.write(`\r   ${e.done}/${e.total} photos`);
  },
});
if (visual && process.stdout.isTTY) process.stdout.write('\n');

const { query, via, items: ranked } = result;
if (!ranked.length) {
  console.log('\nNo listings found under that price. Try a broader query or a higher --max.');
  process.exit(0);
}

const top = ranked.slice(0, Number(o.top));
console.log(`\nTop ${top.length} of ${ranked.length}:\n`);
for (const [i, it] of top.entries()) {
  console.log(`${String(i + 1).padStart(2)}. $${it.price.toFixed(2).padStart(7)}  ${it.siteLabel.padEnd(14)} [${String(it.score).padStart(3)}] ${it.title.slice(0, 70)}`);
  console.log(`    ${it.url}`);
}

await fs.mkdir(o.out, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
const base = path.join(o.out, `${stamp}_${slug}`);
let imageDataUrl;
if (o.image) imageDataUrl = `data:image/*;base64,${(await fs.readFile(o.image)).toString('base64')}`;
await fs.writeFile(`${base}.html`, renderReport({ query, via, maxPrice, items: ranked, siteResults: result.sites, imageDataUrl }));
await fs.writeFile(`${base}.json`, JSON.stringify(result, null, 2));
console.log(`\n📄 Full results: ${base}.html`);
if (!o['no-open']) openInBrowser(path.resolve(`${base}.html`));
