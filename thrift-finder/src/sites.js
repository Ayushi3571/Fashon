// Each site: how to build a search URL with a max price, and which links are listings.
const enc = encodeURIComponent;

export const SITES = {
  poshmark: {
    label: 'Poshmark',
    url: (q, max) => `https://poshmark.com/search?query=${enc(q)}&price%5B%5D=-${max}&sort_by=relevance`,
    item: /\/listing\//,
  },
  mercari: {
    label: 'Mercari',
    // Mercari takes prices in cents.
    url: (q, max) => `https://www.mercari.com/search/?keyword=${enc(q)}&maxPrice=${Math.round(max * 100)}&itemStatuses=1`,
    item: /\/us\/item\//,
  },
  depop: {
    label: 'Depop',
    url: (q, max) => `https://www.depop.com/search/?q=${enc(q)}&priceMax=${max}`,
    item: /\/products\//,
  },
  thredup: {
    label: 'ThredUp',
    url: (q, max) => `https://www.thredup.com/products?text=${enc(q)}&price_max=${max}`,
    item: /\/product\//,
  },
  ebay: {
    label: 'eBay (used)',
    // LH_ItemCondition=3000 = used; LH_BIN=1 = Buy It Now so prices are real.
    url: (q, max) => `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}&_udhi=${max}&LH_ItemCondition=3000&LH_BIN=1`,
    item: /\/itm\/\d/,
  },
  facebook: {
    label: 'FB Marketplace',
    url: (q, max, opts) => `https://www.facebook.com/marketplace/${opts.fbCity}/search/?query=${enc(q)}&maxPrice=${max}`,
    item: /\/marketplace\/item\//,
  },
};

export const DEFAULT_SITES = Object.keys(SITES);
