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

// Absolute links to the original site / its shop / parent brand.
// Requirement: the mirrored site must be fully self-contained -> these are
// removed (anchor text is kept; a list item made of nothing but the link is
// dropped together with its <li>).
const BRAND_LINK_RE = /^https?:\/\/[^\s/$]*lingolia\.(?:com|shop)\//i;

// Keep only the anchor's inner content (or delete a full list item).
// Returns true if the anchor was handled.
function stripBrandAnchor(doc, $el, el) {
  const li = $el.closest('li');
  if (li.length) {
    let onlyChild = true;
    li.children().each((_, c) => {
      if (c.type === 'element' && c !== el) onlyChild = false;
    });
    if (onlyChild) {
      li.remove();
      return true;
    }
  }
  $el.replaceWith($el.html() ?? '');
  return true;
}

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

// --------------------------------------------------------------------- tone
// Exact, whole-phrase replacements that (a) remove every "Lingolia" reference
// and (b) soften the "teacher-to-student" phrasing ("Teste!", "Lerne!",
// "Beachte!", "Achte darauf!", …) into friendlier sentences.
// Applied to the serialized HTML AFTER link/media processing.
const SOFTEN = [
  // -- brand / "our site" self-reference -------------------------------
  ['Auf <b>Lingolia</b> findest du', 'Hier findest du'],
  ['Außerdem findest du auf Lingolia eine', 'Außerdem findest du hier eine'],
  ['Lingolia-Vokabelkalender', 'Vokabelkalender'],
  // (specific full sentence first, so it reads on top of the Vokabelkalender fix above)
  ['Erweitere deinen französischen Wortschatz mit den Themen aus dem Vokabelkalender. Ordne die Vokabeln richtig zu, lerne die Artikel und Pluralformen. Wähle aus der Liste unten das Thema deiner Wahl, lerne die Vokabeln und teste dein Wissen in den Übungen.',
   'Erweitere deinen Wortschatz mit neuen Themen! Wähle einfach das Thema, das dich interessiert – und lerne die Vokabeln mit Artikel und Pluralform.'],
  ['Lerne und übe in der Lingolia-Grammatik die', 'Hier lernst und übst du die'],
  ['alle unsere Vokabellisten', 'alle Vokabellisten'],
  ['alle unsere Artikel', 'alle Artikel'],
  ['alle unsere Grammatiklektionen', 'alle Grammatiklektionen'],
  ['alle unsere Rechtschreiblektionen', 'alle Rechtschreiblektionen'],
  ['sowie zahlreiche Übungen:', 'an einem Ort:'],
  ['mit unseren Übungen', 'mit den Übungen'],
  ['mit unseren Aufgaben', 'mit den Aufgaben'],
  ['zu unseren Themen', 'zu diesen Themen'],
  ['unseren Konjugator oder unsere Seiten', 'den Konjugator oder die Seiten'],
  ['mit unserem Einstufungstest', 'mit einem kurzen Test'],
  // -- placement-test invitations (the test doesn't exist here) --------
  ['Wenn du wissen möchtest, wie gut dein Französisch schon ist, kannst du einfach einen Einstufungstest machen. So siehst du, wo du stehst und was du als Nächstes lernen kannst.',
   'Wenn du wissen möchtest, wie gut dein Französisch schon ist, starte einfach bei A1 und arbeite dich Schritt für Schritt weiter.'],
  ['Wenn du wissen möchtest, wie gut dein Französisch schon ist, mach einfach einen Einstufungstest. So findest du heraus, wo du stehst und was du als Nächstes lernen kannst.',
   'Wenn du wissen möchtest, wie gut dein Französisch schon ist, starte einfach bei A1 – Schritt für Schritt steigst du weiter auf.'],
  ['Wenn du wissen möchtest, wie gut dein Französisch schon ist, mach einfach einen Einstufungstest. So findest du heraus, wo du stehst und kannst genau dort weitermachen.',
   'Wenn du wissen möchtest, wie gut dein Französisch schon ist, starte einfach bei A1 und arbeite dich ruhig weiter – so weißt du bald, was du schon gut kannst.'],
  ['Zu jedem Thema gibt es Übungen in verschiedenen Niveaus (A1 bis C1), mit denen du dein Wissen festigen und Schritt für Schritt verbessern kannst.',
   'Zu jedem Thema gibt es Erklärungen und Beispiele für verschiedene Niveaus (A1 bis C1). Schritt für Schritt kannst du dein Wissen so festigen und verbessern.'],
  // -- friendlier phrasing ---------------------------------------------
  ['Teste dein Wissen anschließend in den Übungen.', 'Die Beispielsätze auf dieser Seite zeigen dir, wie die Form in der Praxis steht.'],
  ['Teste dein Wissen anschließend in den Vokabel-Übungen.', 'Am Ende der Seite kannst du das Neue noch einmal durchlesen.'],
  ['und teste dein Wissen mit den Übungen am Ende der Seite.', 'Die Beispiele im Text zeigen dir, wie die Form in der Praxis steht.'],
  ['Lerne hier die Bildung', 'Hier lernst du die Bildung'],
  ['Lerne die Bildung', 'Hier lernst du die Bildung'],
  ['Festige dein Wissen anschließend in den Übungen.', 'Anschließend kannst du das Gelernte an den Beispielen im Text festigen.'],
  ['Besuche unsere Seite', 'Mehr dazu auf der Seite'],
  ['und prüfe dein Wissen mit den zugehörigen Übungen.', ''],
  ['schau dir die folgenden Seiten an:', "hier geht's weiter:"],
  ['Schau dir die folgenden Beispiele an.', 'Hier ein paar Beispiele dazu:'],
  ['>Beachte</h3>', '>Gut zu wissen</h3>'],
  ['>Beachte:</h3>', '>Gut zu wissen:</h3>'],
  ['<p>Beachte: ', '<p>Gut zu wissen: '],
  ['<p><b>Beachte:</b>', '<p><b>Gut zu wissen:</b>'],
  ['<strong>Beachte:</strong>', '<strong>Gut zu wissen:</strong>'],
  ['<strong>Beachte</strong>:', '<strong>Gut zu wissen</strong>:'],
  ['(Beachte: die Verben', '(Übrigens: die Verben'],
  ['Beachte die schwierigen Zahlen:', 'Hier ein paar Zahlen, die einen Haken haben:'],
  ['Beachte, dass Ortsnamen', 'Übrigens: Ortsnamen'],
  ['Achte darauf, den zusammengesetzten Verneinungssatz', 'Gut zu wissen: den zusammengesetzten Verneinungssatz'],
  ['Achte darauf, den Indikativ', 'Gut zu wissen: den Indikativ'],
  ['Achte auf die Angleichung in Numerus und Genus!', 'Und wichtig: die Angleichung in Numerus und Genus!'],
  ['und teste dein Wissen in den Übungen.', '. Die Beispielsätze zeigen dir, wie die Form in der Praxis steht.'],
  ['Erfahre in unserer Erläuterung alles zur Verwendung und Bildung und teste dein Können in den Übungen.',
   'Hier findest du alles zur Verwendung und Bildung der Form \u2013 inklusive Beispiels\u00e4tzen.'],
  ['Lerne mit unserer Erläuterung die Regeln zur Verwendung und Bildung',
   'Hier findest du die Regeln zur Verwendung und Bildung'],
  ['Lerne hier die', 'Hier lernst du die'],
  ['Lerne und übe in unserer Grammatik-Erläuterung mit Übungen, wie französische Adjektive gesteigert werden und welche Besonderheiten wir beachten müssen.',
   'Hier findest du alles Wichtige dazu: wie französische Adjektive gesteigert werden und welche Besonderheiten es gibt.'],
  ['achte darauf, alle Klammern', 'vergiss nur nicht, alle Klammern'],
  ['Achte darauf, das Leerzeichen', 'Und denk dran, das Leerzeichen'],
  // -- drills/conjugator promises: neutralize (static mirror: no exercises, --
  //    no Konjugator, no interactive listening/reading — only text). Added at
  //    the end so it runs after earlier pairs; longest match first in families.
  ['In den Übungen kannst du dein Wissen testen und vertiefen.', 'Hier findest du Erklärungen und Beispiele, die dir helfen, es dir gut einzuprägen.'],
  ['In den Übungen kannst du anschließend dein Wissen testen und vertiefen.', 'Die Erklärungen und Beispiele helfen dir, es dir gut einzuprägen.'],
  ['In den Übungen kannst du dein Wissen anschließend testen.', 'Die Beispiele auf dieser Seite helfen dir, es dir gut einzuprägen.'],
  ['In den Übungen kannst du dein Wissen Testen.', 'Die Beispiele auf dieser Seite helfen dir, es dir gut einzuprägen.'],
  ['In den Übungen kannst du testen, wie gut du die Steigerung der französischen Adverbien beherrschst.', 'Die Beispielsätze im Text zeigen dir, wie die Steigerung in der Praxis aussieht.'],
  ['In den Übungen kannst du testen, wie gut du den Plural beherrschst.', 'Die Beispiellisten weiter unten zeigen dir, wie der Plural aussieht.'],
  ['In den Übungen kannst du dein Wissen zu den Ergänzungssätzen testen.', 'Die Beispiele im Text helfen dir, es dir gut einzuprägen.'],
  ['In den Übungen kannst du dein Wissen prüfen und vertiefen.', 'Die Beispielsätze im Text zeigen dir, wie die Sätze in der Praxis aussehen.'],
  ['In den Übungen kannst du das Gelernte wiederholen und deine Französischkenntnisse verbessern:', 'Die Listen und Beispiele auf dieser Seite helfen dir, das Gelernte gut festzuhalten:'],
  ['In den Übungen lernst du, selbst Passivsätze in verschiedenen Zeiten zu bilden.', 'Die Beispielsätze zeigen dir, wie das Passiv in der Praxis aussieht.'],
  ['In den Übungen kannst du dein Wissen testen.', 'Die Beispielsätze und Listen auf dieser Seite helfen dir, die Regeln gut zu verinnerlichen.'],
  ['in den Grammatik-Übungen', 'in den Beispielsätzen auf dieser Seite'],
  ['sowie zahlreiche Übungen am Ende der Seite, um das Gelernte anzuwenden', 'sowie viele Beispielsätze, an denen du das Gelernte gut festigen kannst'],
  ['Außerdem findest du am Ende der Seite zahlreiche Übungen, um das Gelernte anzuwenden.', 'Außerdem findest du im Text Beispiele, an denen du das Gelernte gut festigen kannst.'],
  ['sowie zahlreiche Übungen, die dir helfen, sie voneinander zu unterscheiden.', 'mit vielen Beispielen, die dir helfen, sie voneinander zu unterscheiden.'],
  ['Details, Beispiele sowie zahlreiche Übungen findest du auf unserer Seite über', 'Details, Beispiele und viele Beispielsätze findest du auf unserer Seite über'],
  ['weitere Einzelheiten sowie zahlreiche Übungen.', 'weitere Einzelheiten und viele Beispiele.'],
  ['Ausführliche Erklärungen sowie zahlreiche Übungen findest du auf den Seiten zu den verschiedenen Arten', 'Ausführliche Erklärungen und viele Beispiele findest du auf den Seiten zu den verschiedenen Arten'],
  ['Erklärungen, Beispiele und Übungen dazu findest du auf unserer Seite', 'Erklärungen und Beispiele dazu findest du auf unserer Seite'],
  ['Erklärungen, Beispiele und Übungen dazu findest du in unserem Kapitel', 'Erklärungen und Beispiele dazu findest du in unserem Kapitel'],
  ['Eine ausführliche Erklärung mit passenden Übungen findest du im Artikel zur', 'Eine ausführliche Erklärung mit vielen Beispielen findest du im Artikel zur'],
  ['Eine ausführliche Erklärung und zahlreiche Übungen findest du auf der Seite zum Thema', 'Eine ausführliche Erklärung und viele Beispiele findest du auf der Seite zum Thema'],
  [', und prüfe deine Kenntnisse mit den Übungen!', ' – mit Erklärungen und vielen Beispielen.'],
  ['sowie Links zu Seiten mit zahlreichen Beispielen und Übungen.', 'sowie Links zu Seiten mit zahlreichen Beispielen.'],
  ["erfahren und mit den Übungen zu trainieren, hier geht's weiter:", "erfahren, hier geht's weiter:"],
  ['sowie Links zu weiteren Seiten zum Thema Adverbien mit vielen Übungen.', 'sowie Links zu weiteren Seiten zum Thema Adverbien.'],
  ['Mit den passenden Übungen kannst du das Gelernte wiederholen und deine Französischkenntnisse verbessern.', 'Die Erklärungen und Beispiele auf diesen Seiten helfen dir, das Gelernte gut festzuhalten.'],
  ['Dieses Kapitel schafft Klarheit durch einfache Erklärungen, anschauliche Beispiele und spannende Übungen!', 'Dieses Kapitel schafft Klarheit durch einfache Erklärungen und anschauliche Beispiele.'],
  ['Folgende Beispiele und Übungen sorgen für mehr Klarheit.', 'Folgende Beispiele sorgen für mehr Klarheit.'],
  ['Die unten stehenden Erläuterungen, Beispiele und Übungen machen die', 'Die unten stehenden Erläuterungen und Beispiele machen die'],
  // -- Hör-/Leseverstehen (explanations only — nothing playable in this mirror) --
  ['Teste dein Hörverstehen auf Französisch. Du hörst von Muttersprachlern gesprochene Texte, zu denen du Fragen beantworten sollst. Im Skript kannst du alle Texte nachlesen.', 'Beim Hörverstehen hörst du gesprochene Texte auf Französisch und beantwortest danach Fragen zum Inhalt.'],
  ['Prüfe und verbessere dein Leseverstehen auf Französisch mit Texten aus unterschiedlichen Wortschatz-Bereichen. Lies die Texte und beantworte die Fragen zum Text oder Vokabular.', 'Beim Leseverstehen liest du Texte auf Französisch und beantwortest anschließend Fragen zum Inhalt oder zum Wortschatz.'],
  // -- Konjugator promises (there is no interactive conjugator in this mirror) --
  ['Wenn du eine französische Zeitform intensiver lernen willst, gelangst du über den Link zu einer ausführlichen Erläuterung mit Übungen.', 'Wenn du eine französische Zeitform intensiver lernen willst, findest du über den Link eine ausführliche Erläuterung dazu.'],
  [' und einen Konjugator, in dem du dir 7000 französische Verben in allen Zeitformen konjugiert anzeigen lassen kannst.', '.'],
  ['Wenn du es etwas bequemer magst, kannst du dir in unserem Konjugator auch französische Verben konjugieren lassen.', ''],
  ['Um die Konjugation eines spezifischen Verbs zu überprüfen, kannst du unseren Verben Konjugator verwenden.', 'Die Tabelle auf dieser Seite zeigt dir alle Formen im Überblick.'],
  ['kannst du den Konjugator oder die', 'kannst du einfach die'],
  // -- brand slip (accented Lingolía) --
  ['Deshalb haben wir auf Lingolía verschiedene Redewendung mit Erklärung, Beispielsatz und Übungen zusammengestellt, die dir helfen, französische Redewendungen richtig zu verstehen und anzuwenden.', 'Deshalb findest du hier zahlreiche Redewendungen – jede mit Erklärung und Beispielsatz – die dir helfen, sie richtig zu verstehen und anzuwenden.'],
  // -- "Weitere Übungen zum Thema" section headings (they list related pages, not drills) --

  ['In diesem Bereich kannst du Hörverstehen und Leseverstehen auf Französisch üben. Hör- und Leseverstehen sind wichtige Bestandteile der Französischprüfungen.', 'Hörverstehen und Leseverstehen sind wichtige Bestandteile der Französischprüfungen.'],
  ['Weitere Übungen zum Thema in anderen Bereichen', 'Mehr zum Thema'],

  ['und kannst das Gelernte durch passende Übungen überprüfen.', 'und lernst an vielen Beispielen, wie sie im Satz stehen.'],
  ['mit zahlreichen Übungen, um dein Wissen zu überprüfen.', 'mit vielen Beispielen.'],
  ['um ihre Anwendung zu verstehen und überprüfe dein Wissen mit den Übungen.', 'um ihre Anwendung zu verstehen – mit Erklärungen und Beispielen.'],
  ['In den Übungen kannst du anschließend prüfen, ob du alles verstanden hast.', 'Danach lernst du an vielen Beispielen, wie alles im Satz steht.'],
  ['mit einem kurzen Test überprüfen.', 'an den Beispielen auf unseren Grammatik- und Wortschatz-Seiten festmachen.'],
  ['Jede Seite enthält <b>zahlreiche Übungen</b>, um dein Wissen gleich zu überprüfen!', 'Jede Seite enthält <b>viele Redewendungen</b>, jeweils mit Erklärung und Beispielsatz.'],
];

const SOFT_STATS = new Map(); // phrase -> total matches across the run
function softenHtml(html) {
  let out = html;
  for (const [from, to] of SOFTEN) {
    const n = out.split(from).length - 1;
    if (n > 0) {
      out = out.split(from).join(to);
      SOFT_STATS.set(from, (SOFT_STATS.get(from) || 0) + n);
    }
  }
  return out;
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
    // commercial "plus membership" ad boxes
    '.adv-shop',
  ].join(', ');
  content.find(kill).remove();

  // Teaser blocks that link ONLY to the original site (e.g. Hör-/Leseverstehen
  // cards) — the whole teaser is a dangling invitation, drop it entirely.
  content.find('.ce_teaser_link').each((_, el) => {
    const links = doc(el).find('a[href]');
    if (!links.length) return;
    const allBrand = links.get().every(
      (a) => BRAND_LINK_RE.test(doc(a).attr('href') || '')
    );
    if (allBrand) doc(el).remove();
  });

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

  // Wortschatz pages: "Text zum Leseverstehen/Hörverstehen" heads a list of
  // links to the (non-existent) listening/reading-comprehension pages →
  // drop heading, list and the matching TOC <li>.
  content.find('h3[id^="a-text-zum-leseverstehen"], h3[id^="a-text-zum-hoerverstehen"]').each((_, el) => {
    const h3 = doc(el);
    const id = h3.attr('id');
    const ul = h3.nextUntil('h2, h3').filter('ul').first();
    h3.remove();
    if (ul.length) doc(ul).remove();
    content.find(`a[href="#${id}"]`).closest('li').remove();
  });
  // "Weitere Übungen zum Thema …" heading (wortschatz pages): once the dead
  // list above is gone, drop the heading too — with its whole block if it is
  // now link-free — plus the TOC <li>.
  content.find('h2[id^="a-weitere-uebungen-zum-thema-in"]').each((_, el) => {
    const h2 = doc(el);
    const id = h2.attr('id');
    const b = h2.closest('section.ce_text, .ce_text');
    if (b.length && b.find('a').length === 0) {
      b.remove();
      content.find(`a[href="#${id}"]`).closest('li').remove();
    }
  });

  // ---- tooltips: inline the German translation, drop the icon
  // word tooltips: <span class="tooltip tooltip-word">mot<i/><span class="tooltip-content">Übers.</span></span>
  content.find('span.tooltip-word').each((_, el) => {
    const $el = doc(el);
    const trans = ($el.find('.tooltip-content').first().text() || '').replace(/\s+/g, ' ').trim();
    $el.find('.tooltip-content').remove();
    const word = ($el.text() || '').replace(/\s+/g, ' ').trim();
    $el.replaceWith(word ? (trans ? `${word} (${trans})` : word) : trans);
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

  // ---- audio players: drop the player block, the <audio>, its buttons,
  // and the figure images that belong to the audio block (figures in
  // text-only example blocks elsewhere are kept)
  const audioScopes = [];
  content.find('audio').each((_, el) => {
    const $a = doc(el);
    const scope = $a.closest('.ce_example').first();
    if (scope.length) {
      audioScopes.push(scope);
    } else {
      let cur = $a;
      for (let k = 0; k < 3; k++) cur = cur.parent().length ? cur.parent() : cur;
      audioScopes.push(cur);
    }
  });
  for (const scope of audioScopes) scope.find('.example-image').remove();
  content.find('.example-audio, audio').each((_, el) => {
    const $x = doc(el);
    for (const dir of ['prevAll', 'nextAll']) {
      const figs = $x[dir]('.example-image');
      if (figs.length) figs.first().remove();
    }
  });
  content.find('.example-audio').remove();
  content.find('audio').remove();
  content.find('button[id*="_play"], button[id*="_pause"], button[id*="_playbackRate"], button[id*="_rewind"]').remove();
  content.find('.example-body').each((_, el) => {
    if (!((doc(el).text() || '').trim())) doc(el).remove();
  });

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
    if (href.startsWith('http://') || href.startsWith('https://')) {
      if (BRAND_LINK_RE.test(href)) { stripBrandAnchor(doc, $el, el); return; }
      return; // keep every other external link (museum, wikipedia, …)
    }

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
      // Page not part of the mirror (exercises, Konjugator, Einstufungstest, …)
      // → keep only the linked text; a list item made of nothing but this link
      // is dropped together with its <li>.
      stripBrandAnchor(doc, $el, el);
    }
  });

  stripAttrs(doc);
  // drop attribute-less empty wrapper classes? keep, CSS ignores.
  let body = content.length ? content.first().html() || '' : '';
  body = softenHtml(body); // tone + brand cleanup (exact phrases)

  // ---- TOC headings — extracted AFTER softening so the texts shown in the
  // page's meta/search match the headings the visitor actually sees.
  const toc = [];
  for (const m of body.matchAll(/<h([23]) id="([^"]+)"[^>]*>(.*?)<\/h\1>/gs)) {
    const text = m[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (toc.length < 12) toc.push({ text, anchor: m[2] });
  }

  // ---- description + search text
  let desc = (doc('meta[name="description"]').attr('content') || '').trim();
  if (desc) {
    try { desc = decodeURIComponent(desc); } catch { /* keep */ }
  }
  if (desc) desc = softenHtml(desc).replace(/<[^>]+>/g, '');
  // NOTE: pull search text from the SOFTENED body (not the raw DOM), so the
  // client-side search index carries the same cleaned text as the rendered pages.
  let searchText = load(body).root().text().replace(/\s+/g, ' ').trim();
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

// ----- report tone/brand replacements (flag anything that never matched)
const softApplied = [...SOFT_STATS.entries()].sort((a, b) => b[1] - a[1]);
const softAppliedTotal = softApplied.reduce((s, [, n]) => s + n, 0);
console.log(`tone/brand replacements: ${softAppliedTotal}`);
for (const [phrase, n] of softApplied) console.log(`  ${n}×  ${phrase.slice(0, 70)}`);
const missed = SOFTEN.filter(([from]) => !SOFT_STATS.has(from)).map(([f]) => f);
if (missed.length) {
  console.warn(`WARN  ${missed.length} phrase(s) never matched:`);
  for (const f of missed) console.warn(`  - ${f.slice(0, 80)}`);
}

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
