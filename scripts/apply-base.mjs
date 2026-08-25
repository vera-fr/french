#!/usr/bin/env node
/**
 * Re-roots root-absolute URLs in the built site (dist/) under BASE_PATH.
 *
 * Strategy: the whole pipeline (static pages, content links, JS) emits
 * root-absolute URLs ("/grammatik/verben/"). Astro's `base` covers its own
 * assets, but not plain markup, so after `astro build` we rewrite:
 *   - href/src/content/action attributes starting with "/" (not "//")
 *   - url entries in dist/search-index.json
 *
 * No-op when BASE_PATH is unset or "/".
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE_PATH || '/').replace(/\/+$/, '');
if (!BASE) {
  console.log('[apply-base] BASE_PATH nicht gesetzt – Website läuft unter dem Domain-Wurzelpfad, nichts zu tun.');
  process.exit(0);
}

const DIST = path.resolve(process.cwd(), 'dist');
if (!fs.existsSync(DIST)) {
  console.error('[apply-base] dist/ fehlt – zuerst „node scripts/transform.mjs && astro build“ ausführen.');
  process.exit(1);
}

let files = 0;
let urls = 0;

function isRewriteable(v) {
  if (typeof v !== 'string') return false;
  if (!v.startsWith('/') || v.startsWith('//')) return false;
  if (v === BASE || v.startsWith(BASE + '/')) return false; // already prefixed
  return true;
}

function eachHtml(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) eachHtml(p, fn);
    else if (e.name.endsWith('.html')) fn(p);
  }
}

eachHtml(DIST, (file) => {
  let html = fs.readFileSync(file, 'utf8');
  const rewritten = html.replace(
    /(\b(?:href|src|content|action|poster|data-src|data-href))=["']([^"']*)["']/g,
    (m, attr, value) => {
      if (!isRewriteable(value)) return m;
      urls++;
      return attr + '="' + BASE + value + '"';
    }
  );
  if (rewritten !== html) {
    files++;
    fs.writeFileSync(file, rewritten);
  }
});

const idx = path.join(DIST, 'search-index.json');
let indexUrls = 0;
if (fs.existsSync(idx)) {
  const entries = JSON.parse(fs.readFileSync(idx, 'utf8'));
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e && isRewriteable(e.url)) {
        e.url = BASE + e.url;
        indexUrls++;
      }
    }
    fs.writeFileSync(idx, JSON.stringify(entries));
  }
}

console.log(
  `[apply-base] BASE=${BASE} → ${files} HTML-Datei(en), ${urls} Markup-URL(s) + ${indexUrls} Index-URL(s) neu gerootet.`
);
