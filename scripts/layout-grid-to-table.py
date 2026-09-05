#!/usr/bin/env python3
"""layout-grid-to-table.py — rewrite an old LAYOUT word to its new one in table items.

Default grid → table (0.7.0); `--from stack --to list` for 0.8.0.

wiki-plugin-table 0.7.0 renamed the plain-table layout word; `grid` still works
as a warned alias. This walks a farm root (or one site), edits the directive
line in every table item that carries it, journals an edit per item, keeps a
backup beside each page, and clears the site's index files so the sitemap
rebuilds. Prose in markdown items is left alone — reword doc pages by hand.

    python3 layout-grid-to-table.py --root ~/Music/Guides/Private --dry-run
    python3 layout-grid-to-table.py --root ~/.wiki
    python3 layout-grid-to-table.py --site ~/Nextcloud/fedwiki/plugin.fedwiki.club

Needs fedwiki.py (~/.claude/skills/fedwiki-lib) on the path or beside it; on a
remote farm pipe both to `ssh host python3 -` with FEDWIKI_LIB inlined first.
"""
import argparse, os, re, sys, time, shutil

for cand in (os.path.expanduser('~/.claude/skills/fedwiki-lib'), os.path.dirname(os.path.abspath(__file__))):
    if os.path.exists(os.path.join(cand, 'fedwiki.py')):
        sys.path.insert(0, cand)
try:
    import fedwiki as fw
except ImportError:
    fw = None  # inlined mode: the caller has already exec'd fedwiki.py into globals
    fw = sys.modules.get('fedwiki')

GRID = None      # set in main from --from
TO = 'table'
PROVENANCE = 'layout-grid-to-table'


def rewrite(text):
    return GRID.sub(lambda m: f'{m.group(1)}LAYOUT {TO}', text)


def fix_page(path, dry, stamp):
    try:
        page = fw.load_page(path)
    except Exception as e:  # not a page (stray file, broken json)
        print(f'skip {path}: {e}', file=sys.stderr)
        return []
    hits = []
    for it in page.get('story') or []:
        if not isinstance(it, dict) or it.get('type') != 'table':
            continue
        t = it.get('text', '')
        if not GRID.search(t):
            continue
        hits.append(it['id'])
        if dry:
            continue
        it['text'] = rewrite(t)
        it.pop('data', None)      # stale caches; the client rebuilds them
        it.pop('columns', None)
        fw.add_journal(page, 'edit', it, provenance=PROVENANCE)
    if hits and not dry:
        shutil.copy2(path, f'{path}.bak-layout-{stamp}')
        fw.save_page(path, page)
    return hits


def sites(root=None, site=None):
    if site:
        yield os.path.basename(site.rstrip('/')), site
    else:
        yield from fw.iter_sites(root)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root')
    ap.add_argument('--site')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--from', dest='old', default='grid')
    ap.add_argument('--to', dest='new', default='table')
    a = ap.parse_args()
    global GRID, TO, PROVENANCE
    GRID = re.compile(r'^(\s*)LAYOUT\s+' + re.escape(a.old) + r'\s*$', re.I | re.M)
    TO = a.new
    PROVENANCE = f'layout-grid-to-table: LAYOUT {a.old} -> {a.new}'
    if not (a.root or a.site):
        ap.error('give --root or --site')
    stamp = time.strftime('%Y%m%d%H%M')
    total = 0
    for name, site in sites(os.path.expanduser(a.root) if a.root else None, os.path.expanduser(a.site) if a.site else None):
        touched = False
        for slug, path in fw.iter_pages(site):
            if '.bak' in slug:
                continue
            hits = fix_page(path, a.dry_run, stamp)
            if hits:
                touched = True
                total += len(hits)
                print(f'{"would fix" if a.dry_run else "fixed"} {name}/{slug} {" ".join(hits)}')
        if touched and not a.dry_run:
            fw.delete_indexes(site)
    print(f'{total} item(s) {"found" if a.dry_run else "rewritten"}')


if __name__ == '__main__':
    main()
