#!/usr/bin/env node
/**
 * Content pipeline: .work/de/pages (crawled Lingolia DE pages)
 *   -> src/content-pages/<slug>.html   (cleaned article HTML)
 *   -> src/content/meta.json           (per-page title/desc/section/toc)
 *   -> public/search-index.json        (client-side search index)
 *   -> public/assets|audio…            (downloaded media)
 *
 * Root-absolute URLs are emitted ("/grammatik/verben/", "/assets/…").
 * scripts/apply-base.mjs rewrites them for a non-root GitHub Pages base.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = path.join(ROOT, 'src', 'content-pages');
const META_OUT = path.join(ROOT, 'src', 'content', 'meta.json');
const INDEX_OUT = path.join(ROOT, 'public', 'search-index.json');
const PUBLIC = path.join(ROOT, 'public');
const PAGES_DIR = path.join(ROOT, '.work', 'de', 'pages');

const SITE = 'https://francais.lingolia.com';

// Pages that are interactive exercise apps ("… – Freie Übung"), not theory content.
const EXCLUDE = new Set([
  'grammatik/zeitformen/passe-anterieur/le-passe-anterieur-uebungen',
  'grammatik/verben/partizip-gerundium/participe-present/participe-present-uebungen',
  // added after H1 inspection — also pure exercise apps:
  'grammatik/satzbau/ausrufesaetze/ausrufesaetze',
  'grammatik/satzbau/satzbau',
  'grammatik/verben/les-verbes',
  'grammatik/zeitformen/uebersicht/zeitformen-indicatif',
  'wortschatz/leicht-zu-verwechselnde-woerter/andere/an-annee/ebungen',
]);

// ---------------------------------------------------------------- inventory
function listPages() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(p);
    }
  };
  walk(PAGES_DIR);
  return out;
}

const rawFiles = listPages();
const slugOf = (file) =>
  path.relative(PAGES_DIR, file).split(path.sep).join('/').replace(/\.html$/, '');

const slugs = [];
for (const f of rawFiles) {
  const s = slugOf(f);
  if (s === 'index' || EXCLUDE.has(s)) continue;
  slugs.push({ slug: s, file: f });
}
const slugSet = new Set(slugs.map((x) => x.slug));
slugs.sort((a, b) => a.slug.localeCompare(b.slug, 'de'));
console.log(`pages: ${slugs.length} (excluded: index + ${EXCLUDE.size} exercise pages)`);

// ------------------------------------------------------------------- media
const MEDIA_HOST_RE = /^https?:\/\/[^/]+/;
async function fetchBuf(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (content-mirror)' },
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

const KEEP_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'id', 'class', 'lang', 'width', 'height',
  'controls', 'type', 'abbr', 'colspan', 'rowspan', 'scope', 'checked',
]);

function stripAttrs(doc) {
  doc('*').each((_, el) => {
    for (const name of Object.keys(el.attribs)) {
      if (!KEEP_ATTRS.has(name)) delete el.attribs[name];
    }
  });
}

function sectionOf(slug) {
  const first = slug.split('/')[0];
  const known = { grammatik: 'Grammatik', wortschatz: 'Wortschatz', schreibschule: 'Schreibschule', rechtschreibung: 'Rechtschreibung' };
  return known[first] || 'Allgemein';
}

async function transformPage({ slug, file }) {
  const html = fs.readFileSync(file, 'utf8');
  const doc = load(html);
  const content = doc('#content');
  if (!content.length) throw new Error(`no #content in ${file}`);

  const title = doc('#content h1').first().text().trim() || 'Französisch lernen';

  // ---- remove interactive / promotional / ad blocks (before attribute strip)
  const kill = [
    '#page-toc', 'template', '.m-popup', '[x-popup]', '.m-popup-overlay',
    '#lingolia-plus-adv', '.m-panel-promotion', '.m-panel-info.m-panel-promotion',
    '#traffective-ad-Billboard', '#traffective-ad-Skyscraper',
    '[id^="traffective-ad-"]', '.adv-header', 'h2.notoc', 'ol.exercise-list',
    '.m-control, .m-window, .m-badge', '.ce_image_masonry', '#exercises',
    // exercise app / promo blocks that sit INSIDE the article text
    'form.exercise_form', '#exercise-settings',
    'nav#exercise-list', 'nav.exercises-article-list', '.ce_plusExerciseList',
  ].join(', ');
  content.find(kill).remove();

  // Safety net: any element still carrying alpine STATE (x-data) is interactive
  // UI we cannot render statically — drop the element itself, keep its siblings.
  // (x-show / x-model / x-if only survive inside blocks already removed above,
  // and harmless residual attributes are stripped by stripAttrs.)
  const alpineLeftover = [];
  content.find('[x-data]').each((_, el) => {
    alpineLeftover.push(doc(el).attr('class') || el.tagName);
    doc(el).remove();
  });
  if (alpineLeftover.length) console.warn(`  alpine x-data leftovers removed: ${alpineLeftover.join(', ')}`);

  // ---- tooltips: inline the German translation, drop the icon
  // word tooltips: <span class="tooltip tooltip-word">mot<i/><span class="tooltip-content">Übers.</span></span>
  content.find('span.tooltip-word').each((_, el) => {
    const $el = doc(el);
    const trans = ($el.find('.tooltip-content').first().text() || '').replace(/\s+/g, ' ').trim();
    $el.find('.tooltip-content').remove();
    $el.find('i').remove();
    const word = $el.text().trim();
    const text = trans ? `${word} (${trans})` : word;
    const t = doc.text(text);
    $el.replaceWith(t);
  });
  // sentence tooltips: <span class="tooltip tooltip-fa"><i/><span class="tooltip-content">…</span></span>
  // NOTE: parent() must be captured BEFORE remove() — after detachment it returns empty.
  content.find('span.tooltip-fa').each((_, el) => {
    const $el = doc(el);
    const trans = ($el.find('.tooltip-content').first().text() || '').replace(/\s+/g, ' ').trim();
    const host = $el.parent();
    $el.remove();
    if (!trans || !host || !host.length) return;
    host.append(` <span class="tr-translation">Übersetzung: ${trans}</span>`);
  });
  // Safety net: some Lingolia source pages have malformed tag nesting where a
  // gloss span is NOT inside a .tooltip-word/.tooltip-fa wrapper (e.g. inside a
  // plain <i>). Inline any gloss still remaining in .tooltip-content.
  content.find('.tooltip-content').each((_, el) => {
    const $el = doc(el);
    const gloss = ($el.text() || '').replace(/\s+/g, ' ').trim();
    const parent = $el.parent();
    $el.remove();
    if (!gloss || !parent || !parent.length) return;
    parent.append(` (${gloss})`);
  });
  // any leftover icon font glyphs
  content.find('i.fal, i.far, i.fas, i[aria-hidden="true"]').remove();

  // ---- media
  const media = [];
  content.find('img').each((_, el) => {
    const src = doc(el).attr('src') || '';
    if (src.includes('share/preview') || src.includes('/files/ads') || src.includes('lingolia_logo') || src.startsWith('/files/')) {
      doc(el).remove();
      return;
    }
    const am = src.match(/^(?:assets\/images\/|\/assets\/images\/)(.+)$/);
    const fm = src.match(/^(?:files\/images\/|\/files\/images\/)(.+)$/);
    if (am || fm) {
      const rest = (am || fm)[1];
      const local = `/assets/images/${rest}`;
      const url = fm ? `${SITE}/files/images/${rest}` : `${SITE}/assets/images/${rest}`;
      media.push({ url, local });
      doc(el).attr('src', local);
      doc(el).removeAttr('srcset');
    }
  });
  content.find('audio source, audio[src]').each((_, el) => {
    const src = doc(el).attr('src');
    if (!src) return;
    let local = null;
    let url = null;
    if (src.startsWith('/files/audio/')) { local = `/audio/${src.slice(12)}`; url = `${SITE}${src}`; }
    else if (src.startsWith('files/audio/')) { local = `/audio/${src.slice(11)}`; url = `${SITE}/${src}`; }
    else if (src.startsWith('/audio/')) { local = src; url = `${SITE}${src}`; } // TTS audio, live site
    if (local) {
      media.push({ url, local });
      doc(el).attr('src', local);
    } else if (el.tagName === 'source') {
      doc(el).remove(); // unmatched <source> (e.g. redundant .ogg) — leave no broken fallback
    }
  });

  // ---- links
  content.find('a[href]').each((_, el) => {
    const $el = doc(el);
    let href = ($el.attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(?:javascript|mailto|tel):/i.test(href)) return;

    // Normalize to a root-absolute path
    if (href.startsWith(SITE + '/')) href = href.slice(SITE.length);
    else if (href.startsWith(SITE)) return; // site root itself, not an article
    if (href.startsWith('http://') || href.startsWith('https://')) return; // other external

    // Image/media asset link → download and point locally
    const am = href.match(/^(?:assets\/images\/|\/assets\/images\/)(.+)$/) || href.match(/^(?:files\/images\/|\/files\/images\/)(.+)$/);
    if (am) {
      const local = `/assets/images/${am[1]}`;
      const url = href.startsWith('files/images/') || href.startsWith('/files/images/')
        ? `${SITE}/files/images/${am[1]}`
        : `${SITE}/assets/images/${am[1]}`;
      media.push({ url, local });
      $el.attr('href', local + (href.includes('#') ? '#' + href.split('#')[1] : ''));
      return;
    }

    // Known Lingolia template bug: literal href="undefined" (conditionnel page)
    if (href === 'undefined') {
      $el.attr('href', '/grammatik/satzbau/konditionalsaetze/');
      return;
    }

    // Internal Lingolia DE link?
    let path;
    if (href === '/de' || href === '/de/') path = '';
    else if (href.startsWith('/de/')) path = href.slice(4);
    else if (href === 'de') path = '';
    else if (href.startsWith('de/')) path = href.slice(3);
    else return; // unrelated internal path (assets, etc.) — leave as-is

    const [pathPart, frag] = path.split('#');
    const clean = pathPart.split('/').filter(Boolean).join('/');

    if (clean === '') {
      $el.attr('href', '/'); // Lingolia DE home → our home
      return;
    }
    if (slugSet.has(clean)) {
      $el.attr('href', '/' + clean + '/' + (frag ? '#' + frag : ''));
    } else {
      // Excluded area (Übungen, Konjugator, Hilfe, …) → live site
      $el.attr('href', `${SITE}/de/${clean}` + (frag ? '#' + frag : ''));
      $el.attr('target', '_blank');
      $el.attr('rel', 'noopener');
    }
  });

  // ---- anchors for TOC (h2/h3 with ids) and anchor-link target fixes
  const toc = [];
  content.find('h2[id], h3[id]').each((_, el) => {
    const id = doc(el).attr('id');
    const text = doc(el).text().trim();
    if (!id || !text) return;
    if (toc.length < 12) toc.push({ text, anchor: id });
  });

  stripAttrs(doc);
  // drop attribute-less empty wrapper classes? keep, CSS ignores.
  const body = content.length ? content.first().html() || '' : '';

  // ---- description + search text
  let desc = (doc('meta[name="description"]').attr('content') || '').trim();
  if (desc) {
    try { desc = decodeURIComponent(desc); } catch { /* keep */ }
  }
  let searchText = content.text().replace(/\s+/g, ' ').trim();
  if (!desc) {
    const firstP = body.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (firstP) desc = firstP[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  // write HTML
  const outDir = path.join(SRC, path.dirname(slug));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(SRC, slug + '.html'), body);

  return {
    slug,
    url: '/' + slug + '/',
    title,
    desc,
    section: sectionOf(slug),
    toc,
    text: searchText,
    media,
  };
}

// --------------------------------------------------------------------- run
// Wipe any previously generated pages so this run is the single source of
// truth (prevents stale files from older EXCLUDE lists lingering on disk).
if (fs.existsSync(SRC)) {
  for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
    fs.rmSync(path.join(SRC, e.name), { recursive: true, force: true });
  }
} else {
  fs.mkdirSync(SRC, { recursive: true });
}

const results = [];
let failed = 0;
for (const pg of slugs) {
  try {
    results.push(await transformPage(pg));
  } catch (e) {
    failed++;
    console.error(`FAIL ${pg.slug}: ${e.message}`);
  }
}
console.log(`transformed: ${results.length}, failed: ${failed}`);

// ----- media download
const uniq = [...new Map(results.flatMap((r) => r.media).map((m) => [m.local, m])).values()];
console.log(`media files: ${uniq.length}`);
let dlOk = 0, dlFail = 0;
const dlResults = await Promise.allSettled(
  uniq.map(async (m) => {
    const out = path.join(PUBLIC, m.local.replace(/^\//, ''));
    if (fs.existsSync(out)) { dlOk++; return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const buf = await fetchBuf(m.url);
    fs.writeFileSync(out, buf);
    dlOk++;
  })
);
for (const r of dlResults) if (r.status === 'rejected') dlFail++;
console.log(`media downloaded: ${dlOk}, failed: ${dlFail}`);

// ----- meta + search index
const meta = {};
for (const r of results) {
  meta[r.url] = { url: r.url, title: r.title, desc: r.desc, section: r.section, toc: r.toc };
}
fs.mkdirSync(path.dirname(META_OUT), { recursive: true });
fs.writeFileSync(META_OUT, JSON.stringify(meta));

const index = results.map(({ url, title, desc, section, text }) => ({
  url, title, section, text: (text || '').slice(0, 60000),
}));
fs.mkdirSync(path.dirname(INDEX_OUT), { recursive: true });
fs.writeFileSync(INDEX_OUT, JSON.stringify(index));
console.log(`meta: ${Object.keys(meta).length} pages, index: ${index.length} entries`);
console.log(`index size: ${(fs.statSync(INDEX_OUT).size / 1024 / 1024).toFixed(2)} MB`);
