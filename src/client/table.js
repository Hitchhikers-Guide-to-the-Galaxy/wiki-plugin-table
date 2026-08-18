// wiki-plugin-table — client. Cloned from wiki-plugin-json (Ward Cunningham,
// 2018): the item holds its own data (text or a pushed `resource`), stats
// line and double-click editing survive; the rendering is new — a real table
// for narrow data, stacked row cards for wide data, an enlarged overlay
// with sortable columns, and a data interface other plugins can read.

import parselib from '../parse/parse.cjs'

const { parse, fromResource, toObjects, sortRows, keyColumn } = parselib

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

const markup = cell => {
  const text = cell === null || cell === undefined ? '' : String(cell)
  if (typeof wiki !== 'undefined' && wiki.resolveLinks) {
    return wiki.resolveLinks(text, s => emphasis(escape(s)))
  }
  return emphasis(escape(text))
}

// ---------- reading the item -----------------------------------------------

/** One shape for the renderer, whichever way the data arrived. */
const tableOf = item => {
  const parsed = parse(item.text || '')
  const pushed = fromResource(item.resource)
  if (pushed && pushed.columns.length) {
    return { ...parsed, columns: pushed.columns, rows: pushed.rows, source: 'resource' }
  }
  return { ...parsed, source: 'text' }
}

const layoutFor = table => {
  const l = table.directives.layout || 'auto'
  if (l !== 'auto') return l
  return table.columns.length <= 3 ? 'grid' : 'stack'
}

// ---------- rendering ------------------------------------------------------

const gridHtml = (table, { sortable = false, sortState = null } = {}) => {
  const rows = sortState ? sortRows(table.columns, table.rows, sortState) : sortRows(table.columns, table.rows, table.directives.sort)
  const th = table.columns
    .map((c, i) => {
      const dir = sortState && sortState.column === c ? (sortState.desc ? ' ▾' : ' ▴') : ''
      return `<th data-col="${i}"${sortable ? ' class="sortable" title="click to sort"' : ''}>${markup(c)}${dir}</th>`
    })
    .join('')
  const body = rows.map(r => `<tr>${r.map(v => `<td>${markup(v)}</td>`).join('')}</tr>`).join('')
  return `<div class="table-scroll"><table class="table-grid"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

// stack: one card per row. Cards fold to their key cell (FOLD closed, the
// default) so a long table reads as a list of titles; ▸ opens one card,
// shift-click opens or closes them all; FOLD open starts unfolded, FOLD none
// draws no arrows at all. The key cell may be a [[link]] — the link opens the
// row's own page, the arrow opens the row's detail in place.
const stackHtml = table => {
  const key = keyColumn(table)
  const fold = table.directives.fold || 'closed'
  const rows = sortRows(table.columns, table.rows, table.directives.sort)
  const cards = rows
    .map(r => {
      const arrow = fold === 'none' ? '' : `<button class="row-fold" title="show the rest of this row (shift-click: all rows)" aria-expanded="${fold === 'open'}">${fold === 'open' ? '▾' : '▸'}</button>`
      const head = `<div class="row-key">${arrow}${markup(r[key])}</div>`
      const rest = table.columns
        .map((c, i) => (i === key ? '' : `<dt data-col="${i}">${markup(c)}</dt><dd>${markup(r[i])}</dd>`))
        .join('')
      return `<div class="row-card" data-folded="${fold === 'closed'}">${head}<dl class="row-body">${rest}</dl></div>`
    })
    .join('')
  return `<div class="table-stack" data-fold="${fold}">${cards}</div>`
}

// The wiki fetches plugin scripts with a cache-buster but a stylesheet <link>
// is cached by the browser, so stamp the version on it: a new release must
// bring its own CSS or fold arrows render with last release's layout.
const CSS_VERSION = '0.2.1'
const cssOnce = () => {
  const href = `/plugins/table/table.css?v=${CSS_VERSION}`
  if ($(`link[href='${href}']`).length) return
  $(`<link rel="stylesheet" href="${href}" type="text/css">`).appendTo('head')
}

const emit = ($item, item) => {
  cssOnce()
  const table = tableOf(item)
  const layout = layoutFor(table)
  const caption = table.directives.caption ? `<div class="table-caption">${markup(table.directives.caption)}</div>` : ''
  const warnings = table.warnings.length ? `<div class="table-warning">${table.warnings.map(escape).join('<br>')}</div>` : ''
  let body
  if (!table.columns.length) {
    body = `<p class="table-empty">${item.text && item.text.trim() ? 'no table found in this text' : 'empty table — double-click to add CSV, JSON or a markdown table'}</p>`
  } else {
    body = layout === 'stack' ? stackHtml(table) : gridHtml(table)
  }
  $item.append(`
    <div class="table-item" data-layout="${layout}">
      <div class="table-head">${caption}<button class="table-enlarge" title="enlarge">⤢</button></div>
      ${warnings}
      ${body}
      <p class="caption">${escape(stats(item, table))}</p>
    </div>`)

  // ---- data interface -----------------------------------------------------
  // house convention: a *-source class plus a function on the DOM node
  $item.addClass('table-source')
  $item.get(0).tableData = () => ({ columns: table.columns.slice(), rows: table.rows.map(r => r.slice()) })
  // Ward's convention: wiki.getData reads item.data off `.chart,.data,.calculator`
  item.data = toObjects(table.columns, table.rows)
  item.columns = table.columns.slice()
  $item.addClass('data')
}

// ---------- enlarged overlay ------------------------------------------------

const openOverlay = ($item, item, table) => {
  $('.table-overlay').remove()
  let sortState = table.directives.sort ? { ...table.directives.sort } : null
  const title = table.directives.caption || item.title || 'Table'
  const $overlay = $(`
    <div class="table-overlay" role="dialog" aria-label="${escape(title)}">
      <div class="table-overlay-panel">
        <div class="table-overlay-head">
          <span class="table-overlay-title">${markup(title)}</span>
          <span class="table-overlay-stats">${escape(`${table.rows.length} rows × ${table.columns.length} cols`)}</span>
          <button class="table-overlay-close" title="close (Esc)">×</button>
        </div>
        <div class="table-overlay-body"></div>
      </div>
    </div>`)
  const draw = () => $overlay.find('.table-overlay-body').html(gridHtml(table, { sortable: true, sortState }))
  draw()
  const close = () => {
    $overlay.remove()
    $(document).off('keydown.tableOverlay')
  }
  $overlay.on('click', e => {
    if (e.target === $overlay[0]) close()
  })
  $overlay.find('.table-overlay-close').on('click', close)
  $(document).on('keydown.tableOverlay', e => {
    if (e.key === 'Escape') close()
  })
  // The wiki delegates [[link]] clicks on .main; the overlay sits on body, so
  // do the same job here: close, then open the page in the lineup after the
  // table's own page (shift-click keeps the lineup, as everywhere else).
  $overlay.on('click', 'a.internal', function (e) {
    e.preventDefault()
    const $link = $(this)
    const title = `${$link.data('pageName') ? $link.text() || $link.data('pageName') : $link.text()}`
    const $page = e.shiftKey ? null : $item.closest('.page')
    close()
    if (typeof wiki !== 'undefined' && wiki.doInternalLink) wiki.doInternalLink(title, $page, $link.data('site') || null)
    return false
  })
  $overlay.on('click', 'th.sortable', function () {
    const column = table.columns[+this.dataset.col]
    sortState = sortState && sortState.column === column ? { column, desc: !sortState.desc } : { column, desc: false }
    draw()
  })
  $('body').append($overlay)
}

const bind = ($item, item) => {
  $item.on('dblclick', e => {
    if ($(e.target).closest('.table-enlarge, .row-fold, a').length) return
    wiki.textEditor($item, item)
  })
  $item.find('.table-enlarge').on('click', e => {
    e.stopPropagation()
    openOverlay($item, item, tableOf(item))
  })
  // fold / unfold a stacked row card; shift toggles every card the same way
  const setFolded = ($card, folded) => {
    $card.attr('data-folded', folded)
    $card.find('> .row-key > .row-fold').text(folded ? '▸' : '▾').attr('aria-expanded', !folded)
  }
  $item.on('click', '.row-fold, .row-key', function (e) {
    if ($(e.target).closest('a').length) return // a [[link]] in the key cell is a link
    if ($item.find('.table-stack').attr('data-fold') === 'none') return
    e.stopPropagation()
    const $card = $(this).closest('.row-card')
    const folded = $card.attr('data-folded') !== 'true'
    if (e.shiftKey) $item.find('.row-card').each((_, c) => setFolded($(c), folded))
    else setFolded($card, folded)
  })
  // column highlight chatter, as the data plugin does
  $item.on('mouseenter', 'th, dt', function () {
    $item.trigger('thumb', $(this).text())
  })
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins.table = { emit, bind }
}

export { emit, bind, ago, stats, tableOf, layoutFor, markup, gridHtml, stackHtml }
