// Crawl the German theory pages of francais.lingolia.com in rounds.
const fs = await import('node:fs/promises');
const path = await import('node:path');

const { fileURLToPath } = await import('node:url');
const ROOT = fileURLToPath(new URL('./', import.meta.url));
const OUT = path.join(ROOT, 'de/pages');
await fs.mkdir(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BASE = 'https://francais.lingolia.com';

const EXCLUDE = [
  /\/uebungen/,       // interactive exercise pages
  /\/de\/test$/,
  /\/hoerverstehen/,
  /\/leseverstehen/,
  /\/hilfe/,
  /\/konjugator/,
  /\/sitemap/,
  /\/search/,
  /\/plus/,
  /\/imprint/,
  /\/datenschutz/,
  /\/news/,
  /\/top/,
  /\/random/,
];

const excluded = (u) => EXCLUDE.some((re) => re.test(decodeURIComponent(new URL(u, BASE).pathname)));

const slugFor = (u) => {
  const p = new URL(u, BASE).pathname;
  if (p === '/de/' || p === '/de') return 'index.html';
  return p.replace(/^\/de\//, '').replace(/\/+$/, '') + '.html';
};

function normalize(raw) {
  try {
    const u = new URL(raw, BASE).href.split('#')[0];
    if (!u.startsWith(BASE + '/de/') || excluded(u)) return null;
    return u;
  } catch { return null; }
}

// seeds: sitemap page links + home
const rawSeeds = await fs.readFile(path.join(ROOT, 'all_de_urls.txt'), 'utf8');
const seeds = rawSeeds.split('\n').map((l) => l.trim().replace(/^href="/, '').replace(/"$/, '')).filter(Boolean);

const pages = new Map();               // url -> item (saved results)
const pending = new Set(['https://francais.lingolia.com/de/', ...seeds.map((s) => normalize(s)).filter(Boolean)]);
const seen = new Set();
let round = 0;
const t0 = Date.now();

while (pending.size > 0) {
  round++;
  const batch = [...pending];
  pending.clear();
  const CHUNK = 12;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    await Promise.all(slice.map(async (url) => {
      if (seen.has(url)) return;
      seen.add(url);
      const item = { url, slug: slugFor(url), status: 'queued' };
      pages.set(url, item);
      try {
        const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
        if (!res.ok) { item.status = res.status; return; }
        const html = await res.text();
        if (html.length < 500) { item.status = 'empty'; return; }
        const file = path.join(OUT, item.slug);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, html);
        item.status = 'ok';
        const re = /(?:href|data-url)="([^"]*\/de\/[^"]*)"/g;
        let m;
        while ((m = re.exec(html))) {
          const u = normalize(m[1]);
          if (u && !seen.has(u)) pending.add(u);
        }
      } catch (e) { item.status = 'error: ' + e.message; }
    }));
  }
  console.log(`round ${round}: batch ${batch.length}, pending now ${pending.size}`);
  if (round > 6) throw new Error('too many rounds');
}

const items = [...pages.values()].sort((a, b) => a.url.localeCompare(b.url));
await fs.writeFile(path.join(ROOT, 'manifest.json'),
  JSON.stringify({ crawledAt: new Date().toISOString(), rounds: round, pages: items }, null, 1));
const ok = items.filter((m) => m.status === 'ok').length;
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${items.length} unique URLs, ${ok} saved OK`);
for (const m of items.filter((x) => x.status !== 'ok')) console.log('  !', m.status, m.url);
