// wiki-plugin-table — CLASSIC face: jQuery emit/bind/overlay + registration.
// Core rendering lives in core.js, shared with the modern module.
import parselib from '../parse/parse.cjs'
const { parse, fromResource, toObjects, sortRows, keyColumn } = parselib
import { ago, stats, escape, emphasis, markup, tableOf, layoutFor, gridHtml, stackHtml } from './core.js'
// The wiki fetches plugin scripts with a cache-buster but a stylesheet <link>
// is cached by the browser, so stamp the version on it: a new release must
// bring its own CSS or fold arrows render with last release's layout.
const CSS_VERSION = typeof __CSS_VERSION__ === 'string' ? __CSS_VERSION__ : 'dev'
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
    $card.find('> .row-body').css('display', folded ? 'none' : '')
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

export { emit, bind }
export { ago, stats, tableOf, layoutFor, markup, gridHtml, stackHtml } from './core.js'
