#!/usr/bin/env python3
"""md-table-to-item.py — split a markdown item that holds a GFM pipe table
into (prose/heading markdown item) + (table item) + (trailing markdown item),
so the table renders through wiki-plugin-table instead of bare <table>.

Usage:
  md-table-to-item.py PAGE_FILE [--item ID] [--caption-from-heading] [--dry-run]

PAGE_FILE is the page JSON file on disk (any farm, any host — run it where
the file lives, or on a copy). With no --item, every markdown item holding a
pipe table is split. The heading immediately above the table (if any) becomes
the CAPTION directive when --caption-from-heading is given and is removed from
the prose; otherwise it stays as a markdown heading above the table item.

Journals an `edit` for the shrunk original and `add` actions for the new
items (after the right neighbour), then removes the site's index files so
sitemap/search rebuild. Uses fedwiki-lib for ids, journal shape and indexes.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / '.claude/skills/fedwiki-lib'))
import fedwiki as fw  # noqa: E402

SEP = re.compile(r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$')
ROW = re.compile(r'^\s*\|.*\|\s*$')


def find_table(lines):
    """Return (start, end) line indexes of the first pipe table, or None."""
    for i in range(len(lines) - 1):
        if ROW.match(lines[i]) and SEP.match(lines[i + 1]):
            j = i + 2
            while j < len(lines) and ROW.match(lines[j]):
                j += 1
            return i, j
    return None


def split_item(item, caption_from_heading):
    lines = item['text'].split('\n')
    span = find_table(lines)
    if not span:
        return None
    a, b = span
    before = lines[:a]
    table = lines[a:b]
    after = lines[b:]
    caption = None
    if caption_from_heading:
        # a heading as the last non-blank line before the table
        k = len(before) - 1
        while k >= 0 and not before[k].strip():
            k -= 1
        if k >= 0 and before[k].lstrip().startswith('#'):
            caption = before[k].lstrip('#').strip()
            before = before[:k]
    directives = [f'CAPTION {caption}'] if caption else []
    return {
        'before': '\n'.join(before).strip(),
        'table': '\n'.join(directives + table).strip(),
        'after': '\n'.join(after).strip(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('page')
    ap.add_argument('--item', help='only this item id')
    ap.add_argument('--caption-from-heading', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    path = Path(args.page)
    page = fw.load_page(path)
    story = page['story']
    changed = 0
    i = 0
    while i < len(story):
        it = story[i]
        if it.get('type') == 'markdown' and (not args.item or it.get('id') == args.item):
            parts = split_item(it, args.caption_from_heading)
            if parts:
                new_items = []
                if parts['before']:
                    it['text'] = parts['before']
                    fw.add_journal(page, 'edit', it)
                    prev_id = it['id']
                    insert_at = i + 1
                else:
                    # nothing left before the table: the table item takes this slot
                    story.pop(i)
                    fw.add_journal(page, 'remove', it)
                    prev_id = story[i - 1]['id'] if i > 0 else None
                    insert_at = i
                table_item = fw.make_item(parts['table'], 'table')
                new_items.append(table_item)
                if parts['after']:
                    new_items.append(fw.make_item(parts['after'], 'markdown'))
                for n in new_items:
                    story.insert(insert_at, n)
                    fw.add_journal(page, 'add', n, after=prev_id)
                    prev_id = n['id']
                    insert_at += 1
                changed += 1
                print(f"split item {it.get('id')} → table {table_item['id']} ({parts['table'].count(chr(10))} lines)")
                i = insert_at
                continue
        i += 1

    if not changed:
        print('no markdown item with a pipe table found')
        return 1
    if args.dry_run:
        print(json.dumps([{k: v for k, v in s.items() if k != 'text'} | {'text': s.get('text', '')[:80]} for s in story], indent=1))
        return 0
    fw.save_page(path, page)
    site = path.parent.parent
    print('saved', path, 'indexes removed:', fw.delete_indexes(site))
    return 0


if __name__ == '__main__':
    sys.exit(main())
