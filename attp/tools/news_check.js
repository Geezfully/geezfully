// Compare translated articles against the Romanian source: same images, same paragraph count.
global.window = {};
require('../data-news.js'); require('../data-news-archive.js');
const fs = require('fs'), path = require('path');
const src = Object.fromEntries([...(window.ATTP_NEWS || []), ...(window.ATTP_NEWS_ARCHIVE || [])].map(n => [n.slug, n]));
const count = (s, re) => ((s || '').match(re) || []).length;
let bad = 0, n = 0;
for (const lang of ['en', 'ru']) {
  const dir = path.join(__dirname, '..', 'i18n', 'news', lang);
  for (const f of fs.readdirSync(dir)) {
    const slug = f.slice(0, -5), a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), ro = src[slug];
    n++;
    if (!ro) continue; // database-only article
    // photos only: inline emoji images (alt is the emoji itself) may be written as real emoji
    const photos = h => (h.match(/<img\b[^>]*>/g) || []).filter(t => !/alt="[^".]{1,8}"/.test(t)).map(t => t.match(/src="([^"]+)"/)[1]).join();
    const imgRo = photos(ro.body_html), imgTr = photos(a.body_html);
    const pRo = count(ro.body_html, /<p[\s>]/g), pTr = count(a.body_html, /<p[\s>]/g);
    if (imgRo !== imgTr || (pRo > 0 && pRo !== pTr) || !a.title || !a.excerpt) { bad++; console.log(`[${lang}] ${slug}: img ${imgRo === imgTr ? 'ok' : 'DIFF'}, <p> ${pRo}→${pTr}`); }
  }
}
console.log(`${n} translated files checked, ${bad} mismatches`);
