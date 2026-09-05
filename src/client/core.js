// wiki-plugin-table core — pure, side-effect-free rendering shared by the
// classic face (table.js) and the modern ES module (table.mjs).
// wiki-plugin-table — client. Cloned from wiki-plugin-json (Ward Cunningham,
// 2018): the item holds its own data (text or a pushed `resource`), stats
// line and double-click editing survive; the rendering is new — a real table
// for narrow data, stacked row cards for wide data, an enlarged overlay
// with sortable columns, and a data interface other plugins can read.

import parselib from '../parse/parse.cjs'

const { parse, serialize, moveRow, fromResource, toObjects, sortRows, keyColumn } = parselib

// ---------- helpers carried over from json ---------------------------------

const ago = msecs => {
  let secs, mins, hrs, days, weeks, months
  if ((secs = msecs / 1000) < 2) return `${Math.round(msecs)} milliseconds`
  if ((mins = secs / 60) < 2) return `${Math.round(secs)} seconds`
  if ((hrs = mins / 60) < 2) return `${Math.round(mins)} minutes`
  if ((days = hrs / 24) < 2) return `${Math.round(hrs)} hours`
  if ((weeks = days / 7) < 2) return `${Math.round(days)} days`
  if ((months = days / 31) < 2) return `${Math.round(weeks)} weeks`
  if (months / 12 < 2) return `${Math.round(months)} months`
  return `${Math.round(months / 12)} years`
}

const stats = (item, table) => {
  const out = [`${table.rows.length} row${table.rows.length === 1 ? '' : 's'} × ${table.columns.length} col${table.columns.length === 1 ? '' : 's'}`]
  if (table.source === 'resource') out.push('pushed data')
  if (item.written) out.push(`updated ${ago(Date.now() - item.written)} ago`)
  if (item.interval) out.push(`after ${ago(item.interval)}`)
  return out.join(' · ')
}

// ---------- cell markup ----------------------------------------------------

const escape = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// bold / italic on already-escaped text; nothing else — no raw HTML in cells
const emphasis = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<i>$2</i>')

const markup = (cell, resolve) => {
  const text = cell === null || cell === undefined ? '' : String(cell)
  const r = resolve || (typeof wiki !== 'undefined' && wiki.resolveLinks ? wiki.resolveLinks : null)
  if (r) return r(text, s => emphasis(escape(s)))
  return emphasis(escape(text))
}

// ---------- reading the item -----------------------------------------------

/** One shape for the renderer, whichever way the data arrived. canWrite says
 *  whether this reader may save: grips only show to someone who can drop. */
const tableOf = (item, { canWrite = false } = {}) => {
  const parsed = parse(item.text || '')
  const pushed = fromResource(item.resource)
  if (pushed && pushed.columns.length) {
    return { ...parsed, columns: pushed.columns, rows: pushed.rows, source: 'resource', reorder: false }
  }
  // a dragged order only means something in the order the rows are typed
  if (parsed.directives.reorder && parsed.directives.sort) {
    parsed.warnings.push('REORDER shows rows as typed — SORT ignored')
    parsed.directives = { ...parsed.directives, sort: undefined }
  }
  return { ...parsed, source: 'text', reorder: !!parsed.directives.reorder && canWrite }
}

// the lead cell: grip (REORDER, writers only) and/or number (INDEX), tight together
const gripHtml = table => (table.reorder ? '<span class="row-grip" draggable="true" title="drag to reorder">⠿</span>' : '')
const indexHtml = (table, n) => (table.directives.index ? `<span class="row-index">${n}</span>` : '')
const hasLead = table => table.reorder || !!table.directives.index

const layoutFor = table => {
  const l = table.directives.layout || 'auto'
  if (l !== 'auto') return l
  return table.columns.length <= 3 ? 'table' : 'stack'
}

// ---------- rendering ------------------------------------------------------

const gridHtml = (table, { sortable = false, sortState = null, resolve = null } = {}) => {
  const rows = sortState ? sortRows(table.columns, table.rows, sortState) : sortRows(table.columns, table.rows, table.directives.sort)
  const t = sortable ? { ...table, reorder: false } : table // the overlay sorts, it does not drag
  const lead = hasLead(t) ? `<th class="row-lead">${t.directives.index ? escape(t.directives.index) : ''}</th>` : ''
  const th = table.columns
    .map((c, i) => {
      const dir = sortState && sortState.column === c ? (sortState.desc ? ' ▾' : ' ▴') : ''
      return `<th data-col="${i}"${sortable ? ' class="sortable" title="click to sort"' : ''}>${markup(c, resolve)}${dir}</th>`
    })
    .join('')
  const body = rows
    .map((r, n) => {
      const cells = hasLead(t) ? `<td class="row-lead">${gripHtml(t)}${indexHtml(t, n + 1)}</td>` : ''
      return `<tr data-row="${table.rows.indexOf(r)}">${cells}${r.map(v => `<td>${markup(v, resolve)}</td>`).join('')}</tr>`
    })
    .join('')
  const fit = table.directives.fit ? ` fit-${table.directives.fit}` : ''
  return `<div class="table-scroll"><table class="table-grid${fit}"><thead><tr>${lead}${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

// stack: one card per row. Cards fold to their key cell (FOLD closed, the
// default) so a long table reads as a list of titles; ▸ opens one card,
// shift-click opens or closes them all; FOLD open starts unfolded, FOLD none
// draws no arrows at all. The key cell may be a [[link]] — the link opens the
// row's own page, the arrow opens the row's detail in place.
const stackHtml = (table, resolve = null) => {
  const key = keyColumn(table)
  const fold = table.directives.fold || 'closed'
  const rows = sortRows(table.columns, table.rows, table.directives.sort)
  const cards = rows
    .map((r, n) => {
      const arrow = fold === 'none' ? '' : `<button class="row-fold" title="show the rest of this row (shift-click: all rows)" aria-expanded="${fold === 'open'}">${fold === 'open' ? '▾' : '▸'}</button>`
      const head = `<div class="row-key">${gripHtml(table)}${arrow}${indexHtml(table, n + 1)}${markup(r[key], resolve)}</div>`
      const rest = table.columns
        .map((c, i) => (i === key ? '' : `<dt data-col="${i}">${markup(c, resolve)}</dt><dd>${markup(r[i], resolve)}</dd>`))
        .join('')
      // inline display so folding works even when a stale table.css is cached
      return `<div class="row-card" data-row="${table.rows.indexOf(r)}" data-folded="${fold === 'closed'}">${head}<dl class="row-body"${fold === 'closed' ? ' style="display:none"' : ''}>${rest}</dl></div>`
    })
    .join('')
  return `<div class="table-stack" data-fold="${fold}">${cards}</div>`
}

// ---------- reorder by drag ------------------------------------------------
// Plain DOM, HTML5 drag and drop, no jQuery: the grip is the drag source, the
// rows (tr or row-card, each stamped data-row = its index in the text) are the
// targets. mousedown on the grip stops at the item so the wiki's own story
// sortable never sees it. onMove(from, to) receives text-order indexes.

const bindReorder = (el, onMove) => {
  const rowOf = target => target && target.closest('[data-row]')
  let from = null
  const clear = () => el.querySelectorAll('.drop-before, .drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'))
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.row-grip')) e.stopPropagation()
  })
  el.addEventListener('dragstart', e => {
    const row = e.target.closest && e.target.closest('.row-grip') ? rowOf(e.target) : null
    if (!row) return e.preventDefault()
    from = +row.dataset.row
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(from))
    e.dataTransfer.setDragImage(row, 10, 10)
  })
  el.addEventListener('dragover', e => {
    const row = rowOf(e.target)
    if (from === null || !row) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = row.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    clear()
    row.classList.add(after ? 'drop-after' : 'drop-before')
  })
  el.addEventListener('drop', e => {
    const row = rowOf(e.target)
    if (from === null || !row) return
    e.preventDefault()
    const after = row.classList.contains('drop-after')
    let to = +row.dataset.row + (after ? 1 : 0)
    if (to > from) to-- // the row leaves before it lands
    clear()
    if (to !== from) onMove(from, to)
    from = null
  })
  el.addEventListener('dragend', () => {
    clear()
    from = null
  })
}

/** The item text with one row moved — what a drop writes back. */
const reorderedText = (text, from, to) => {
  const t = parse(text)
  return serialize({ ...t, rows: moveRow(t.rows, from, to) })
}

export { ago, stats, escape, emphasis, markup, tableOf, layoutFor, gridHtml, stackHtml, bindReorder, reorderedText }
