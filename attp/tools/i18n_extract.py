#!/usr/bin/env python3
"""List every translatable string on the Romanian pages and which ones still lack
an English / Russian translation.

  python3 tools/i18n_extract.py            # summary per page
  python3 tools/i18n_extract.py --missing  # JSON of untranslated keys (for filling i18n/*.json)
  python3 tools/i18n_extract.py --page index --missing
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from i18n_lib import ROOT, LANGS, PAGES, extract, extract_runtime, load_dict

ap = argparse.ArgumentParser()
ap.add_argument('--missing', action='store_true')
ap.add_argument('--page', action='append')
args = ap.parse_args()

dicts = {l: load_dict(l) for l in LANGS}
out = {}
for page in args.page or PAGES:
    with open(os.path.join(ROOT, f'{page}.html'), encoding='utf-8') as f:
        src = f.read()
    keys = extract(src) + [k for k in extract_runtime(src) if k not in extract(src)]
    miss = [k for k in dict.fromkeys(keys) if any(k not in dicts[l] for l in LANGS)]
    out[page] = miss
    if not args.missing:
        print(f'{page:14} {len(keys):4} strings, {len(miss):4} untranslated')
shared = []
for js in ('js/supabase-init.js',):
    with open(os.path.join(ROOT, js), encoding='utf-8') as f:
        shared += extract_runtime(f.read())
miss = [k for k in dict.fromkeys(shared) if any(k not in dicts[l] for l in LANGS)]
out['_shared_js'] = miss
if not args.missing:
    print(f'{"_shared_js":14} {len(shared):4} strings, {len(miss):4} untranslated')
if args.missing:
    print(json.dumps(out, ensure_ascii=False, indent=1))
