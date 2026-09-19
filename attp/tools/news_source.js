// Print Romanian articles (newest first) for translation: node tools/news_source.js <from> <to>
global.window = {};
require('../data-news.js'); require('../data-news-archive.js');
const all = [...(window.ATTP_NEWS || []), ...(window.ATTP_NEWS_ARCHIVE || [])]
  .sort((a, b) => String(b.published_at || b.date).localeCompare(String(a.published_at || a.date)));
const [from, to] = process.argv.slice(2).map(Number);
all.slice(from, to).forEach((n, i) => {
  console.log(`\n##### ${from + i} ${n.slug}\nTITLE: ${n.title}\nEXCERPT: ${n.excerpt || ''}\nBODY:\n${n.body_html || (Array.isArray(n.body) ? n.body.join('\n') : n.body) || ''}`);
});
