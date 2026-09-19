#!/usr/bin/env python3
"""Player portraits for the ATTP site.

For every active player who has no transparent portrait yet:
  1. take the Setka Cup original (1000px), or the ligas.io photo if Setka has none;
  2. remove the background with rembg (u2net), same model as the July pass;
  3. crop head-and-shoulders to the framing of the existing photos
     (head top ~1% from the top, head ~33% of the width, centred);
  4. save images/players/<slug>.webp (400px, transparent) and print the
     SQL that records it in players.photo_url.

Usage:  python3 tools/player_photos.py [--limit N] [--dry-run]
Needs:  pip install rembg pillow numpy   (model cached in ~/.u2net)
Run from the attp/ directory. Reads only public endpoints.
"""
import argparse, io, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

SUPA_URL = 'https://bghrgacqcqwdiqegkowd.supabase.co'
SUPA_KEY = 'sb_publishable_-Sj5r66svI88A0Hm9nTvIA_hiEHqay7'
OUT_DIR = 'images/players'
SIZE = 400
# Measured on the 271 existing transparent portraits (median values).
TOP_GAP, HEAD_WIDTH, BAND = 0.009, 0.329, (0.08, 0.18)


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'attp-site-photos', **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get_bytes(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'attp-site-photos'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def slug(p):
    s = unicodedata.normalize('NFD', f"{p['first_name']}-{p['last_name']}")
    s = re.sub(r'[̀-ͯ]', '', s).replace('ș', 's').replace('ț', 't').lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def has_portrait(p):
    """Mirrors avatarHtml(): a recorded players/ photo, or the name-slug file for imported players."""
    url = p.get('photo_url') or ''
    if url.startswith('images/players/') and os.path.exists(url):
        return True
    return p['ligas_match_status'] != 'created' and os.path.exists(f'{OUT_DIR}/{slug(p)}.webp')


def sources(p):
    token = (p.get('setka_cup_cache') or {}).get('photo_token')
    if token:
        yield 'setka', f'https://tabletennis.setkacup.com/api/Image/setka/original/{token}.jpeg'
    if p.get('ligas_user_id'):
        try:
            prof = get_json(f"https://ligas.io/api/organizations/mttf/users/{p['ligas_user_id']}")
            img = next((f['value'] for f in prof.get('fields', []) if f['key'] == 'image' and f['value']), None)
            if img:
                yield 'ligas', img
        except Exception:
            pass


def crop_portrait(rgba):
    import numpy as np
    from PIL import Image
    a = np.array(rgba.getchannel('A')) > 128
    rows = np.where(a.any(1))[0]
    if len(rows) == 0:
        raise ValueError('empty mask')
    y0 = rows[0]
    side = rgba.height * 0.6
    cx = rgba.width / 2
    for _ in range(6):  # side and head width depend on each other; settle by iteration
        band = a[int(y0 + BAND[0] * side):int(y0 + BAND[1] * side)]
        widths = [r.nonzero()[0][-1] - r.nonzero()[0][0] for r in band if r.any()]
        if not widths:
            break
        side = float(np.median(widths)) / HEAD_WIDTH
        xs = np.where(band.any(0))[0]
        cx = (xs[0] + xs[-1]) / 2
    # Photos cut off at the chest would leave the figure floating above an empty band:
    # zoom in just enough that the crop ends where the picture does.
    y_last = rows[-1]
    if y0 + side * (1 - TOP_GAP) > y_last:
        side = (y_last - y0) / (1 - TOP_GAP)
    top = y0 - TOP_GAP * side
    left = cx - side / 2
    canvas = Image.new('RGBA', (int(round(side)), int(round(side))), (0, 0, 0, 0))
    canvas.paste(rgba, (int(round(-left)), int(round(-top))))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    q = ('select=id,first_name,last_name,photo_url,ligas_user_id,ligas_match_status,roles,setka_cup_cache(photo_token)'
         '&active=eq.true&roles=cs.%7Bplayer%7D&order=last_name')
    players = get_json(f'{SUPA_URL}/rest/v1/players?{q}', {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'})
    todo = [p for p in players if not has_portrait(p)]
    print(f'{len(players)} players, {len(todo)} without a portrait', file=sys.stderr)
    if args.limit:
        todo = todo[:args.limit]

    session = None
    sql, stats = [], {'setka': 0, 'ligas': 0, 'none': 0, 'failed': 0}
    for p in todo:
        src = None
        for kind, url in sources(p):
            try:
                raw = get_bytes(url)
                src = (kind, raw)
                break
            except Exception:
                continue
        if not src:
            stats['none'] += 1
            continue
        if args.dry_run:
            stats[src[0]] += 1
            continue
        try:
            from PIL import Image
            from rembg import remove, new_session
            session = session or new_session('u2net')
            cut = remove(Image.open(io.BytesIO(src[1])).convert('RGB'), session=session).convert('RGBA')
            out = crop_portrait(cut)
            name = slug(p)
            path = f'{OUT_DIR}/{name}.webp'
            if os.path.exists(path):  # a namesake already owns this file
                path = f"{OUT_DIR}/{name}-{p['id'][:8]}.webp"
            out.save(path, 'WEBP', quality=84, method=6)
            sql.append(f"('{p['id']}'::uuid, '{path}')")
            stats[src[0]] += 1
            print(f"{src[0]:5} {path}", file=sys.stderr)
        except Exception as e:
            stats['failed'] += 1
            print(f"FAIL {p['first_name']} {p['last_name']}: {e}", file=sys.stderr)
        time.sleep(0.15)

    print(json.dumps(stats), file=sys.stderr)
    if sql:
        print('update players set photo_url = v.path from (values\n  ' + ',\n  '.join(sql) +
              '\n) v(id, path) where players.id = v.id;')


if __name__ == '__main__':
    main()
