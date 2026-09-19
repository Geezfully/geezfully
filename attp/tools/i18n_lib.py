"""Shared helpers for the ATTP translation pipeline.

Translations are keyed by the Romanian source text itself (whitespace-normalised),
so the pages stay plain Romanian HTML with no key attributes to maintain:

  * "rich" keys  — the inner HTML of a leaf element that mixes text with inline
                   tags (<a>, <strong>, <br>, …); translated as a unit so word
                   order can change around the markup;
  * text keys    — every other visible text run;
  * attr keys    — placeholder / aria-label / title / alt, and <meta> content.

i18n/en.json and i18n/ru.json map each key to its translation.
"""
import html as _html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ('en', 'ru')
PAGES = ['index', 'about', 'news', 'news-article', 'players', 'player', 'tournaments',
         'gallery', 'documents', 'fairplay', 'contact', 'privacy', 'terms']

INLINE = r'(?:a|strong|em|b|i|br|span|small|code|abbr|time|sup|sub)'
BLOCK_OR_MEDIA = re.compile(r'<(?:div|p|section|article|ul|ol|li|h[1-6]|table|form|nav|header|footer|main|figure|svg|img|video|picture|button|select|input|textarea|script|style)\b', re.I)
LEAF_TAGS = r'(?:h[1-6]|p|li|a|button|label|option|dt|dd|th|td|legend|small|strong|span|figcaption|summary|address|blockquote|div)'
# Innermost blocks only: an element whose content holds another block (a div of
# paragraphs) never matches, so the paragraphs inside it are still found.
INNER_BLOCK = r'(?:div|p|section|article|aside|ul|ol|li|dl|dt|dd|h[1-6]|table|thead|tbody|tr|td|th|form|fieldset|nav|header|footer|main|figure|blockquote|address|button|select|option|label|textarea)'
LEAF_RE = re.compile(r'<(' + LEAF_TAGS + r')(\s[^<>]*)?>((?:(?!<\1[\s>]|<' + INNER_BLOCK + r'[\s>]).)*?)</\1>', re.S | re.I)
PH_RE = re.compile(r'\x00\d+\x00')
ATTR_RE = re.compile(r'\b(placeholder|aria-label|title|alt)="([^"]*)"')
META_RE = re.compile(r'(<meta\s+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"\s+content=")([^"]*)(")', re.I)
TITLE_RE = re.compile(r'(<title>)(.*?)(</title>)', re.S)
SKIP_BLOCKS = re.compile(r'<(script|style|svg)\b.*?</\1>', re.S | re.I)
LETTERS = re.compile(r'[A-Za-zĂÂÎȘȚăâîșțА-Яа-я]')


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


def has_letters(s):
    return bool(LETTERS.search(_html.unescape(re.sub(r'<[^>]+>', '', s))))


def body_of(page_html):
    m = re.search(r'<body\b.*</body>', page_html, re.S)
    return m.group(0) if m else ''


def protect(s):
    """Replace script/style/svg blocks with placeholders so text passes never touch them."""
    kept = []
    def keep(m):
        kept.append(m.group(0))
        return f'\x00{len(kept)-1}\x00'
    return SKIP_BLOCKS.sub(keep, s), kept


def restore(s, kept):
    return re.sub(r'\x00(\d+)\x00', lambda m: kept[int(m.group(1))], s)


def is_rich_leaf(inner):
    """Mixed prose: own words next to inline tags (a sentence with a link or a <strong>).
    Containers that only hold child elements (switchers, card grids) are not prose."""
    if '\x00' in inner or not re.search(r'<' + INLINE + r'\b', inner, re.I) or BLOCK_OR_MEDIA.search(inner):
        return False
    own = inner
    for _ in range(3):  # peel nested inline children
        own = re.sub(r'<(\w+)\b[^>]*>(?:(?!<\1[\s>]).)*?</\1>', ' ', own, flags=re.S)
    own = re.sub(r'<[^>]+>', ' ', own)
    return has_letters(own)


def extract(page_html):
    """Ordered unique keys found in a page."""
    keys = []
    def add(k):
        k = norm(k)
        if k and has_letters(k) and k not in keys:
            keys.append(k)
    head = page_html.split('<body', 1)[0]
    for m in TITLE_RE.finditer(head):
        add(m.group(2))
    for m in META_RE.finditer(head):
        add(_html.unescape(m.group(2)))
    body, _ = protect(body_of(page_html))
    for m in LEAF_RE.finditer(body):
        if is_rich_leaf(m.group(3)):
            add(m.group(3))
    stripped = LEAF_RE.sub(lambda m: '' if is_rich_leaf(m.group(3)) else m.group(0), body)
    for m in re.finditer(r'>([^<>]+)<', stripped):
        for piece in PH_RE.split(m.group(1)):
            add(_html.unescape(piece))
    for m in ATTR_RE.finditer(body):
        add(_html.unescape(m.group(2)))
    return keys


T_CALL_RE = re.compile(r"\bt\('((?:[^'\\]|\\.)+)'\)")


def extract_runtime(src):
    """Strings page scripts pass through t('…')."""
    return [norm(m.group(1).replace("\\'", "'")) for m in T_CALL_RE.finditer(src)]


def load_dict(lang):
    path = os.path.join(ROOT, 'i18n', f'{lang}.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def translate_html(page_html, d, missing):
    """Translate head title/meta, rich leaves, text runs and attributes of a page."""
    def look(k):
        n = norm(k)
        if n in d:
            return d[n]
        if has_letters(n):
            missing.add(n)
        return None

    head, sep, rest = page_html.partition('<body')
    head = TITLE_RE.sub(lambda m: m.group(1) + (look(m.group(2)) or m.group(2)) + m.group(3), head)
    head = META_RE.sub(lambda m: m.group(1) + _html.escape(look(_html.unescape(m.group(2))) or _html.unescape(m.group(2)), quote=True) + m.group(3), head)

    body, kept = protect(sep + rest)

    def rich(m):
        tag, attrs, inner = m.group(1), m.group(2) or '', m.group(3)
        if not is_rich_leaf(inner):
            return m.group(0)
        t = look(inner)
        if t is None:
            return m.group(0)
        kept.append(t)  # shield the translation from the text pass below
        return f'<{tag}{attrs}>\x00{len(kept)-1}\x00</{tag}>'
    body = LEAF_RE.sub(rich, body)

    def piece(raw):
        if not has_letters(raw):
            return raw
        t = look(_html.unescape(raw))
        if t is None:
            return raw
        lead = re.match(r'\s*', raw).group(0)
        trail = re.search(r'\s*$', raw).group(0)
        return lead + _html.escape(t, quote=False) + trail

    def text(m):
        # icons (placeholders) split a run: "Vezi pe hartă <svg>" translates "Vezi pe hartă"
        parts = re.split(r'(\x00\d+\x00)', m.group(1))
        return '>' + ''.join(p if PH_RE.fullmatch(p) else piece(p) for p in parts) + '<'
    body = re.sub(r'>([^<>]+)<', text, body)

    def attr(m):
        t = look(_html.unescape(m.group(2)))
        return f'{m.group(1)}="{_html.escape(t, quote=True)}"' if t is not None else m.group(0)
    body = ATTR_RE.sub(attr, body)
    return head + restore(body, kept)
