import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import { SITES } from './sites.js';

const PROFILE_DIR = path.join(os.homedir(), '.thrift-finder', 'chrome-profile');

// A real, visible Chrome window parked off-screen. Headless browsers get
// blocked by eBay and ThredUp (Cloudflare); a normal window with a saved
// profile does not.
export async function openBrowser({ show = false } = {}) {
  const launch = (channel) =>
    chromium.launchPersistentContext(PROFILE_DIR, {
      channel,
      headless: false,
      viewport: { width: 1280, height: 1000 },
      locale: 'en-US',
      args: ['--disable-blink-features=AutomationControlled', ...(show ? [] : ['--window-position=-3000,0'])],
    });
  try {
    return await launch('chrome');
  } catch {
    return await launch(undefined); // Playwright's bundled Chromium if Chrome isn't installed
  }
}

// Runs inside the page. Finds every listing link, climbs to the smallest
// ancestor "card" that holds a price, and reads title / price / image from it.
// Deliberately selector-free so small site redesigns don't break it.
function extractListings(itemPatternSrc) {
  const itemRe = new RegExp(itemPatternSrc);
  const priceRe = /(?:US)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
  const byUrl = new Map();

  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href.split('?')[0].replace('//ebay.com', '//www.ebay.com');
    if (!itemRe.test(href)) continue;

    // Climb to the smallest ancestor holding a price and an image, but never
    // one that spans more than one listing.
    const key = (h) => new URL(h).pathname;
    let card = a;
    for (let el = a, i = 0; i < 8 && el; el = el.parentElement, i++) {
      const keys = new Set([...el.querySelectorAll('a[href]')].map((x) => x.href).filter((h) => itemRe.test(h)).map(key));
      if (keys.size > 1) break;
      card = el;
      if (/\$\s?\d/.test(el.innerText) && el.querySelector('img')) break;
    }
    const text = card.innerText || '';
    const prices = [...text.matchAll(priceRe)].map((m) => parseFloat(m[1].replace(/,/g, '')));
    const img = card.querySelector('img');
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const title =
      a.getAttribute('aria-label') ||
      img?.alt ||
      a.getAttribute('title') ||
      lines.filter((l) => !/\$\s?\d/.test(l) && l.length > 3).sort((x, y) => y.length - x.length)[0] ||
      '';

    if (/\/itm\/123456$/.test(href)) continue; // eBay's placeholder ad card
    const prev = byUrl.get(href);
    const entry = {
      url: href,
      title: title.replace(/\s+/g, ' ').replace(/^View Product:\s*/, '').replace(/ - link opens in a new tab$/, '').replace(/\s*Image \d+ of \d+$/, '').replace(/, (?:US)?\$[\d,.]+.*$/, '').trim().slice(0, 200),
      // Cards often show a sale price next to a struck-through original; take the lowest.
      price: prices.length ? Math.min(...prices) : null,
      image: img?.getAttribute('data-src') || img?.currentSrc || img?.src || null,
      details: lines.slice(0, 6).join(' · ').slice(0, 200),
    };
    // Same listing can be linked twice (image + title); keep the richer one.
    if (!prev || (!prev.price && entry.price) || (!prev.image && entry.image)) byUrl.set(href, { ...prev, ...entry });
  }
  return [...byUrl.values()];
}

export async function searchSite(context, siteKey, query, maxPrice, opts = {}) {
  const site = SITES[siteKey];
  const url = site.url(query, maxPrice, opts);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait for listings to render (and for Cloudflare-style checks to clear).
    await page
      .waitForFunction((src) => [...document.querySelectorAll('a[href]')].some((a) => new RegExp(src).test(a.href)), site.item.source, { timeout: 25000 })
      .catch(() => {});
    // Dismiss Facebook's login popup if present; results are visible without it.
    await page.locator('[aria-label="Close"]').first().click({ timeout: 1500 }).catch(() => {});
    // Scroll a bit to trigger lazy-loaded cards and images.
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(900);
    }
    const items = await page.evaluate(extractListings, site.item.source);
    return {
      site: siteKey,
      searchUrl: url,
      items: items
        .filter((it) => it.price != null && it.price <= maxPrice)
        .map((it) => ({ ...it, site: siteKey, siteLabel: site.label })),
    };
  } catch (e) {
    return { site: siteKey, searchUrl: url, items: [], error: e.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}
