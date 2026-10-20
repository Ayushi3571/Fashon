import { embedImage, embedTexts, similarity } from './vision.js';

const tokens = (s) =>
  s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1);

// Fraction of query words that appear in the listing title.
function textScore(query, title) {
  const q = new Set(tokens(query));
  const t = new Set(tokens(title));
  if (!q.size) return 0;
  let hit = 0;
  for (const w of q) if (t.has(w) || [...t].some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
  return hit / q.size;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

/**
 * Scores every listing 0-100:
 *   text   - do the title words match the query?
 *   visual - does the listing photo look like the user's photo (or the query text)? via CLIP
 * With a photo, visual similarity dominates; with text only, they're blended.
 */
export async function rankListings(items, { query, imagePath, visual = true, perSite = 40, onProgress }) {
  for (const it of items) it.textScore = textScore(query, it.title);

  if (visual) {
    const target = imagePath ? await embedImage(imagePath) : (await embedTexts([`a photo of a ${query}`]))[0];
    // Only download/compare photos for each site's most promising listings, to keep
    // it quick. Per-site so sites with terse titles (ThredUp, Depop) still get a look.
    const candidates = Object.values(Object.groupBy(items.filter((it) => it.image), (it) => it.site))
      .flatMap((group) => group.sort((a, b) => b.textScore - a.textScore).slice(0, perSite));
    let done = 0;
    await mapLimit(candidates, 6, async (it) => {
      try {
        it.visualScore = similarity(target, await embedImage(it.image));
      } catch {
        /* image blocked or broken: rank on text alone */
      }
      onProgress?.(++done, candidates.length);
    });
    // CLIP cosine scores live in a narrow band; rescale to 0-1 across this result set.
    const vs = items.map((it) => it.visualScore).filter((v) => v != null);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    for (const it of items) if (it.visualScore != null) it.visualNorm = hi > lo ? (it.visualScore - lo) / (hi - lo) : 0.5;
  }

  const wVisual = imagePath ? 0.75 : 0.5;
  for (const it of items) {
    it.score = it.visualNorm != null
      ? Math.round(100 * ((1 - wVisual) * it.textScore + wVisual * it.visualNorm))
      : Math.round(100 * it.textScore * (visual ? 0.6 : 1)); // no photo compared: mild penalty
  }
  return items.sort((a, b) => b.score - a.score || a.price - b.price);
}
