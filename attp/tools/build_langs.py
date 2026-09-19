#!/usr/bin/env python3
"""Generate the English and Russian site from the Romanian pages.

  python3 tools/build_langs.py

Writes en/<page>.html and ru/<page>.html (never edit those by hand) plus
js/i18n-en.js / js/i18n-ru.js, the dictionaries page scripts read through t().
Source of truth: the Romanian pages + i18n/en.json + i18n/ru.json.
Run before every push; untranslated strings are listed at the end.
"""
import glob, hashlib, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from i18n_lib import ROOT, LANGS, PAGES, load_dict, translate_html

PAGE_RE = '|'.join(re.escape(p) for p in PAGES)
NEWS_PAGES = {'index', 'news', 'news-article'}


def localise_links(s, lang, page):
    # Internal page links stay in this language (the lang switcher carries hreflang and is left alone).
    def fix(m):
        tag = m.group(0)
        if 'hreflang=' in tag:
            return tag
        tag = re.sub(r'href="(?:\./)?(' + PAGE_RE + r')\.html([?#][^"]*)?"',
                     lambda h: f'href="{lang}/{h.group(1)}.html{h.group(2) or ""}"', tag)
        return re.sub(r'href="(#[^"]*)"', lambda h: f'href="{lang}/{page}.html{h.group(1)}"', tag)
    return re.sub(r'<a\b[^>]*>', fix, s)


def build():
    report = {}
    for lang in LANGS:
        d = load_dict(lang)
        js = 'window.ATTP_T=' + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + ';\n'
        with open(os.path.join(ROOT, 'js', f'i18n-{lang}.js'), 'w', encoding='utf-8') as f:
            f.write(js)
        ver = hashlib.sha1(js.encode()).hexdigest()[:8]
        # Article titles/excerpts for listings; bodies stay in i18n/news/<lang>/<slug>.json
        # and are fetched one at a time by news-article.html.
        news = {}
        for path in sorted(glob.glob(os.path.join(ROOT, 'i18n', 'news', lang, '*.json'))):
            with open(path, encoding='utf-8') as f:
                a = json.load(f)
            news[os.path.basename(path)[:-5]] = {'title': a['title'], 'excerpt': a.get('excerpt', '')}
        njs = 'window.ATTP_NEWS_T=' + json.dumps(news, ensure_ascii=False, separators=(',', ':')) + ';\n'
        with open(os.path.join(ROOT, 'js', f'news-{lang}.js'), 'w', encoding='utf-8') as f:
            f.write(njs)
        nver = hashlib.sha1(njs.encode()).hexdigest()[:8]
        os.makedirs(os.path.join(ROOT, lang), exist_ok=True)
        missing = set()
        for page in PAGES:
            with open(os.path.join(ROOT, f'{page}.html'), encoding='utf-8') as f:
                s = f.read()
            s = translate_html(s, d, missing)
            s = re.sub(r'<html lang="ro"', f'<html lang="{lang}"', s, count=1)
            # Everything relative (images, css, js, data files) resolves from the site root.
            s = re.sub(r'(<meta charset="utf-8">)', r'\1\n<base href="../">', s, count=1)
            s = s.replace('<script src="js/i18n.js',
                          f'<script>window.__PAGE_LANG__="{lang}";</script>\n'
                          f'<script src="js/i18n-{lang}.js?v={ver}"></script>\n'
                          + (f'<script src="js/news-{lang}.js?v={nver}"></script>\n' if page in NEWS_PAGES else '')
                          + '<script src="js/i18n.js', 1)
            s = localise_links(s, lang, page)
            s = re.sub(r'(<a href="[^"]*" hreflang="ro" lang="ro") class="active"', r'\1', s)
            s = re.sub(rf'(<a href="[^"]*" hreflang="{lang}" lang="{lang}")', r'\1 class="active"', s)
            with open(os.path.join(ROOT, lang, f'{page}.html'), 'w', encoding='utf-8') as f:
                f.write(s)
        report[lang] = sorted(missing)
    for lang, miss in report.items():
        n = len(glob.glob(os.path.join(ROOT, 'i18n', 'news', lang, '*.json')))
        print(f'{lang}: {len(PAGES)} pages built, {len(miss)} untranslated strings, {n} articles translated')
    return report


if __name__ == '__main__':
    rep = build()
    if '-v' in sys.argv:
        for lang, miss in rep.items():
            for k in miss:
                print(f'  [{lang}] {k[:110]}')
