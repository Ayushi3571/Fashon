// The whole pipeline: (photo | text) -> query -> search every site -> rank.
// Shared by the CLI (find.js) and the web app (server.js). Progress is reported
// through onEvent({ type, ... }) so each front end can show it its own way.
import { SITES, DEFAULT_SITES } from './sites.js';
import { openBrowser, searchSite } from './scrape.js';
import { imageToQuery } from './vision.js';
import { rankListings } from './rank.js';

export async function runSearch({
  query = '',
  imagePath,
  hint = '',
  maxPrice,
  sites = DEFAULT_SITES,
  fbCity = 'nyc',
  visual = true,
  show = false,
  onEvent = () => {},
}) {
  if (!(maxPrice > 0)) throw new Error('Set a max price above $0.');
  sites = sites.filter((s) => SITES[s]);
  if (!sites.length) throw new Error('Pick at least one site.');

  // 1. Work out what to search for.
  let via = '';
  query = query.trim();
  if (imagePath) {
    onEvent({ type: 'status', message: 'Looking at your photo…' });
    const described = await imageToQuery(imagePath);
    via = described.via;
    query = query || described.query;
  }
  query = [hint.trim(), query].filter(Boolean).join(' ');
  if (!query) throw new Error('Type what you’re looking for or add a photo.');
  onEvent({ type: 'query', query, via });

  // 2. Search every site in parallel.
  onEvent({ type: 'status', message: `Searching ${sites.length} sites for “${query}” under $${maxPrice}…` });
  const browser = await openBrowser({ show });
  let siteResults;
  try {
    siteResults = await Promise.all(
      sites.map(async (s) => {
        const r = await searchSite(browser, s, query, maxPrice, { fbCity });
        const summary = { site: s, label: SITES[s].label, searchUrl: r.searchUrl, count: r.items.length, error: r.error };
        onEvent({ type: 'site', ...summary });
        return { ...r, summary };
      }),
    );
  } finally {
    await browser.close();
  }

  // 3. Rank.
  const all = siteResults.flatMap((r) => r.items);
  if (all.length && visual) onEvent({ type: 'status', message: `Comparing listing photos${imagePath ? ' to yours' : ''}…` });
  const items = all.length
    ? await rankListings(all, {
        query,
        imagePath,
        visual,
        onProgress: (done, total) => onEvent({ type: 'progress', done, total }),
      })
    : [];

  return { query, via, maxPrice, sites: siteResults.map((r) => r.summary), items };
}
