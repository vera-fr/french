import { load } from 'cheerio';
const raw = '<p>z B.: <span lang="fr" class="tooltip tooltip-word"><i class="site-language" lang="fr">choisir<span lang="de" class="tooltip-content">wählen</span></span></i>, <span lang="fr" class="tooltip tooltip-word"><i class="site-language" lang="fr">réagir<span lang="de" class="tooltip-content">reagieren</span></span></i></p>';
const $ = load(raw);
const content = $('body');
content.find('span.tooltip-word').each((_, el) => {
  const $el = $(el);
  const trans = ($el.find('.tooltip-content').first().text() || '').replace(/\s+/g, ' ').trim();
  console.log('trans=', JSON.stringify(trans));
  $el.find('.tooltip-content').remove();
  $el.find('i').remove();
  const word = $el.text().trim();
  console.log('word=', JSON.stringify(word));
  const text = trans ? `${word} (${trans})` : word;
  $el.replaceWith($(text));
});
console.log('RESULT:', $('body').html());
