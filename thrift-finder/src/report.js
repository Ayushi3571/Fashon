const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderReport({ query, via, maxPrice, items, siteResults, imageDataUrl }) {
  const siteRows = siteResults
    .map((r) => `<a class="chip ${r.error ? 'err' : ''}" href="${esc(r.searchUrl)}" target="_blank" title="${esc(r.error || 'Open this search')}">${esc(r.label)} · ${r.error ? 'failed' : r.count}</a>`)
    .join('');
  const cards = items
    .map((it) => `
    <a class="card" href="${esc(it.url)}" target="_blank" rel="noopener">
      <div class="img">${it.image ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(it.image)}" alt="">` : ''}<span class="score" title="Match score">${it.score}</span></div>
      <div class="body">
        <div class="row"><span class="price">$${it.price.toFixed(2).replace(/\.00$/, '')}</span><span class="site">${esc(it.siteLabel)}</span></div>
        <div class="title">${esc(it.title || '(untitled)')}</div>
      </div>
    </a>`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thrift Finder Results</title>
<style>
:root{--bg:#faf8f5;--card:#fff;--text:#1f1d1a;--muted:#6f6a63;--line:#e7e2da;--accent:#2f6b4f;--err:#b3412e}
@media (prefers-color-scheme:dark){:root{--bg:#171614;--card:#211f1c;--text:#ede9e3;--muted:#a19b92;--line:#35312c;--accent:#7cc4a0;--err:#e57d69}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:24px 16px 8px;max-width:1200px;margin:0 auto;display:flex;gap:16px;align-items:center}
header img{width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);font-size:14px}
.chips{max-width:1200px;margin:0 auto;padding:8px 16px 16px;display:flex;flex-wrap:wrap;gap:8px}
.chip{font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:var(--text);text-decoration:none;background:var(--card)}
.chip.err{color:var(--err);border-color:var(--err)}
.grid{max-width:1200px;margin:0 auto;padding:0 16px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;display:flex;flex-direction:column}
.card:hover{border-color:var(--accent)}
.img{position:relative;aspect-ratio:1;overflow:hidden;background:var(--line)}.img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.score{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.65);color:#fff;font-size:12px;padding:2px 7px;border-radius:999px}
.body{padding:10px 12px 12px}.row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.price{font-weight:700;font-size:17px;color:var(--accent)}.site{font-size:12px;color:var(--muted)}
.title{font-size:13px;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
</style></head><body>
<header>${imageDataUrl ? `<img src="${imageDataUrl}" alt="Your photo">` : ''}<div>
<h1>“${esc(query)}” under $${maxPrice}</h1>
<div class="sub">${items.length} listings, best matches first${via ? ` · query from ${esc(via)}` : ''} · ${new Date().toLocaleString()}</div></div></header>
<div class="chips">${siteRows}</div>
<div class="grid">${cards || '<p>No listings found under that price.</p>'}</div>
</body></html>`;
}
