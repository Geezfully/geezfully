#!/usr/bin/env python3
"""Write translated articles from a batch file into i18n/news/<lang>/<slug>.json.

  python3 tools/news_apply.py batch.json

batch.json: {slug: {"en": {"title", "excerpt", "body"}, "ru": {...}}}
In "body", [[IMG n]] / [[IMGS n-m]] / [[IMGS n-]] insert the n-th image paragraph(s)
of the Romanian original (1-based), so image markup is copied, never retyped.
"""
import json, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_P = re.compile(r'<p>(?:(?!</p>).)*?<img\b(?:(?!</p>).)*?</p>', re.S)
EMOJI_IMG = re.compile(r'<img alt="[^".]{1,8}"[^>]*src="images/news/content/[0-9a-f_]+\.webp"\s*/?>')

src = json.loads(subprocess.check_output(['node', '-e', '''
global.window={}; require("./data-news.js"); require("./data-news-archive.js");
const all=[...(window.ATTP_NEWS||[]),...(window.ATTP_NEWS_ARCHIVE||[])];
console.log(JSON.stringify(Object.fromEntries(all.map(n=>[n.slug,n.body_html||""]))));'''], cwd=ROOT))


PHOTO = re.compile(r'<img\b(?=[^>]*src="images/)(?![^>]*alt="[^".]{1,8}")[^>]*>')


def image_blocks(html):
    """Paragraphs holding real photos. Emoji images (alt is the emoji, e.g. inside
    Word-pasted medal lists) are text, not photos, and are never copied."""
    return [m.group(0) for m in IMG_P.finditer(html) if PHOTO.search(m.group(0)) and '<!--' not in m.group(0)]


def expand(body, blocks):
    def one(m):
        a = int(m.group(2)); b = m.group(3)
        if m.group(1) == 'IMG':
            return blocks[a - 1]
        end = len(blocks) if b == '' else int(b)
        return '\n\n'.join(blocks[a - 1:end])
    return re.sub(r'\[\[(IMGS?) (\d+)(?:-(\d*))?\]\]', one, body)


batch = json.load(open(sys.argv[1], encoding='utf-8'))
for slug, langs in batch.items():
    blocks = image_blocks(src.get(slug, ''))
    for lang, a in langs.items():
        out = {'title': a['title'], 'excerpt': a['excerpt'], 'body_html': expand(a['body'], blocks)}
        with open(os.path.join(ROOT, 'i18n', 'news', lang, f'{slug}.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
print(f'{len(batch)} articles written')
