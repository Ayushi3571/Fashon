// Free, local image understanding with CLIP (runs on your CPU, ~150 MB
// download on first use, cached afterwards). Used for two things:
//   1. photo -> search query (zero-shot: pick best color / material / item type)
//   2. ranking listings by how visually similar they are to the photo or query
import fs from 'node:fs/promises';
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

const MODEL = 'Xenova/clip-vit-base-patch32';

const CATEGORIES = [
  'denim jacket', 'leather jacket', 'canvas work jacket', 'field jacket', 'varsity jacket', 'windbreaker', 'bomber jacket', 'puffer jacket', 'blazer', 'trench coat', 'wool coat', 'fleece jacket',
  'cardigan', 'sweater', 'hoodie', 'sweatshirt', 't-shirt', 'graphic tee', 'button-up shirt', 'flannel shirt', 'blouse',
  'tank top', 'crop top', 'corset top', 'vest', 'jeans', 'trousers', 'cargo pants', 'leggings', 'sweatpants', 'shorts',
  'mini skirt', 'midi skirt', 'maxi skirt', 'mini dress', 'midi dress', 'maxi dress', 'slip dress', 'jumpsuit', 'overalls',
  'sneakers', 'running shoes', 'boots', 'cowboy boots', 'ankle boots', 'heels', 'loafers', 'sandals', 'clogs',
  'handbag', 'tote bag', 'crossbody bag', 'shoulder bag', 'backpack', 'wallet', 'belt', 'scarf', 'baseball cap', 'beanie',
  'sunglasses', 'necklace', 'earrings', 'watch', 'swimsuit', 'lamp', 'chair', 'vase', 'mirror', 'side table',
];
const STYLES = [
  'plain', 'striped', 'plaid', 'floral', 'leopard print', 'polka dot', 'graphic print', 'knit', 'leather', 'suede',
  'denim', 'canvas', 'corduroy', 'velvet', 'satin', 'linen', 'sherpa', 'distressed', 'vintage', 'sequin',
];

let modelsPromise;
function loadModels() {
  modelsPromise ??= (async () => {
    const opts = { dtype: 'q8' }; // quantized: smaller download, fast on CPU
    const [processor, tokenizer, vision, text] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL),
      AutoTokenizer.from_pretrained(MODEL),
      CLIPVisionModelWithProjection.from_pretrained(MODEL, opts),
      CLIPTextModelWithProjection.from_pretrained(MODEL, opts),
    ]);
    return { processor, tokenizer, vision, text };
  })();
  return modelsPromise;
}

const normalize = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

async function readImage(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return RawImage.fromBlob(await res.blob());
  }
  return RawImage.fromBlob(new Blob([await fs.readFile(source)]));
}

export async function embedImage(source) {
  const { processor, vision } = await loadModels();
  const inputs = await processor(await readImage(source));
  const { image_embeds } = await vision(inputs);
  return normalize(Array.from(image_embeds.data));
}

export async function embedTexts(texts) {
  const { tokenizer, text } = await loadModels();
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await text(inputs);
  const dim = text_embeds.dims[1];
  return texts.map((_, i) => normalize(Array.from(text_embeds.data.slice(i * dim, (i + 1) * dim))));
}

export const similarity = dot;

async function bestLabel(imageVec, labels, template) {
  const vecs = await embedTexts(labels.map((l) => template.replace('{}', l)));
  const scores = vecs.map((v) => dot(imageVec, v));
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  return { label: labels[order[0][1]], margin: order[0][0] - order[1][0] };
}

// CLIP is shaky on color (it called a black jacket "navy"), so read color from
// pixels: treat the border as background, take the median of the rest.
async function dominantColor(imagePath) {
  const img = await (await readImage(imagePath)).rgb().resize(64, 64);
  const { data } = img;
  const px = (x, y) => { const i = (y * 64 + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const border = [];
  for (let i = 0; i < 64; i++) border.push(px(i, 0), px(i, 63), px(0, i), px(63, i));
  const bg = [0, 1, 2].map((c) => border.reduce((s, p) => s + p[c], 0) / border.length);
  const fg = [];
  for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) {
    const p = px(x, y);
    if (Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) > 40) fg.push(p);
  }
  // Item fills the frame (no visible background): use every pixel.
  const pool = fg.length > 200 ? fg : [...Array(64 * 64).keys()].map((i) => px(i % 64, Math.floor(i / 64)));
  const median = [0, 1, 2].map((c) => pool.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(pool.length / 2)]);
  return nameColor(...median);
}

function nameColor(r, g, b) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
  const d = max - min, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (l < 0.16) return 'black';
  if (s < 0.15 || (l < 0.25 && s < 0.25)) return l > 0.85 ? 'white' : l > 0.6 ? 'light gray' : l > 0.3 ? 'gray' : 'charcoal';
  if (l > 0.82 && h < 70) return 'cream';
  if (h < 15 || h >= 340) return l < 0.35 ? 'burgundy' : l > 0.7 ? 'pink' : 'red';
  if (h < 40) return l < 0.45 ? 'brown' : s < 0.5 ? 'tan' : 'orange';
  if (h < 65) return s < 0.45 ? 'beige' : 'yellow';
  if (h < 160) return l < 0.35 || s < 0.35 ? 'olive green' : 'green';
  if (h < 195) return 'teal';
  if (h < 250) return l < 0.3 ? 'navy' : l > 0.6 ? 'light blue' : 'blue';
  if (h < 290) return 'purple';
  return l > 0.65 ? 'pink' : 'magenta';
}

// Photo -> short marketplace-style query, e.g. "light blue denim jacket".
export async function describeImageLocally(imagePath) {
  const vec = await embedImage(imagePath);
  const category = await bestLabel(vec, CATEGORIES, 'a photo of a {}');
  const style = await bestLabel(vec, STYLES, `a photo of a {} ${category.label}`);
  const words = [await dominantColor(imagePath)];
  // Only add the material/pattern if CLIP is reasonably sure and it isn't redundant.
  if (style.label !== 'plain' && style.margin > 0.004 && !category.label.includes(style.label)) words.push(style.label);
  words.push(category.label);
  return words.join(' ');
}

// Optional: Google Gemini's free tier reads brands, logos and details CLIP can't.
// Get a free key at https://aistudio.google.com/apikey and set GEMINI_API_KEY.
export async function describeImageWithGemini(imagePath) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const bytes = await fs.readFile(imagePath);
  const mime = /\.png$/i.test(imagePath) ? 'image/png' : /\.webp$/i.test(imagePath) ? 'image/webp' : 'image/jpeg';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: bytes.toString('base64') } },
          { text: 'You write search queries for resale sites like Poshmark, eBay and Depop. Give the single best 3-6 word search query to find this exact item secondhand: brand (only if clearly visible or highly recognizable), color, item type, and one distinctive detail. Reply with the query only, no quotes.' },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().replace(/^["']|["']$/g, '');
}

export async function imageToQuery(imagePath) {
  if (process.env.GEMINI_API_KEY) {
    try {
      return { query: await describeImageWithGemini(imagePath), via: 'Gemini' };
    } catch (e) {
      console.warn(`  Gemini failed (${e.message}); falling back to local CLIP.`);
    }
  }
  return { query: await describeImageLocally(imagePath), via: 'local CLIP' };
}
