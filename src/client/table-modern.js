// wiki-plugin-table — MODERN face: plain element + context contract, no
// jQuery, no globals, no registration. Same core as the classic bundle, with
// cell links drawn through context.resolveLinks and navigation through
// context.internalLink.
import parselib from '../parse/parse.cjs'
const { toObjects } = parselib
import { ago, stats, escape, markup, tableOf, layoutFor, gridHtml, stackHtml, bindReorder, reorderedText } from './core.js'

const cssOnce = () => {
  const href = '/plugins/table/table.css?v=modern'
  if (!document.querySelector(`link[href='${href}']`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }
}

export function emit(el, item, context) {
  cssOnce()
  const resolve = context.resolveLinks
  // the contract carries no owner flag yet: a column that can save gets grips
  const table = tableOf(item, { canWrite: !!context.save })
  const layout = layoutFor(table)
  const caption = table.directives.caption ? `<div class="table-caption">${markup(table.directives.caption, resolve)}</div>` : ''
  const warnings = table.warnings.length ? `<div class="table-warning">${table.warnings.map(escape).join('<br>')}</div>` : ''
  let body
  if (!table.columns.length) {
    body = `<p class="table-empty">${item.text && item.text.trim() ? 'no table found in this text' : 'empty table — double-click to add CSV, JSON or a markdown table'}</p>`
  } else {
    body = layout === 'stack' ? stackHtml(table, resolve) : gridHtml(table, { resolve })
  }
  el.innerHTML = `
    <div class="table-item" data-layout="${layout}">
      <div class="table-head">${caption}<button class="table-enlarge" title="enlarge">⤢</button></div>
      ${warnings}
      ${body}
      <p class="caption">${escape(stats(item, table))}</p>
    </div>`
  el.classList.add('table-source', 'data')
  el.tableData = () => ({ columns: table.columns.slice(), rows: table.rows.map(r => r.slice()) })
  item.data = toObjects(table.columns, table.rows)
  item.columns = table.columns.slice()
}

const openOverlay = (el, item, table, context) => {
  document.querySelectorAll('.table-overlay').forEach(o => o.remove())
  let sortState = table.directives.sort ? { ...table.directives.sort } : null
  const resolve = context.resolveLinks
  const title = table.directives.caption || item.title || 'Table'
  const overlay = document.createElement('div')
  overlay.className = 'table-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.innerHTML = `
    <div class="table-overlay-panel">
      <div class="table-overlay-head">
        <span class="table-overlay-title">${markup(title, resolve)}</span>
        <span class="table-overlay-stats">${escape(`${table.rows.length} rows × ${table.columns.length} cols`)}</span>
        <button class="table-overlay-close" title="close (Esc)">×</button>
      </div>
      <div class="table-overlay-body"></div>
    </div>`
  const draw = () => {
    overlay.querySelector('.table-overlay-body').innerHTML = gridHtml(table, { sortable: true, sortState, resolve })
  }
  draw()
  const onKey = (e) => { if (e.key === 'Escape') close() }
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey) }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close()
    const link = e.target.closest('a.internal')
    if (link) {
      e.preventDefault()
      e.stopPropagation()
      const title = link.innerText || link.dataset.pageName
      close()
      context.internalLink(title)
      return
    }
    const th = e.target.closest('th.sortable')
    if (th) {
      const column = table.columns[+th.dataset.col]
      sortState = sortState && sortState.column === column ? { column, desc: !sortState.desc } : { column, desc: false }
      draw()
    }
    if (e.target.closest('.table-overlay-close')) close()
  })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
}

export function bind(el, item, context) {
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.table-enlarge, .row-fold, a')) return
    e.stopPropagation()
    context.textEditor(item)
  })
  el.querySelector('.table-enlarge')?.addEventListener('click', (e) => {
    e.stopPropagation()
    openOverlay(el, item, tableOf(item), context)
  })
  const setFolded = (card, folded) => {
    card.dataset.folded = folded
    const body = card.querySelector(':scope > .row-body')
    if (body) body.style.display = folded ? 'none' : ''
    const arrow = card.querySelector(':scope > .row-key > .row-fold')
    if (arrow) { arrow.textContent = folded ? '▸' : '▾'; arrow.setAttribute('aria-expanded', String(!folded)) }
  }
  el.addEventListener('click', (e) => {
    const hit = e.target.closest('.row-fold, .row-key')
    if (!hit || e.target.closest('a')) return
    if (el.querySelector('.table-stack')?.dataset.fold === 'none') return
    e.stopPropagation()
    const card = hit.closest('.row-card')
    const folded = card.dataset.folded !== 'true'
    if (e.shiftKey) el.querySelectorAll('.row-card').forEach((c) => setFolded(c, folded))
    else setFolded(card, folded)
  })
  // REORDER: a drop saves an edit through the column (context.save) and redraws
  bindReorder(el, (from, to) => {
    const next = { ...item, text: reorderedText(item.text, from, to) }
    if (context.save) context.save({ type: 'edit', id: item.id, item: next })
    emit(el, next, context)
    bind(el, next, context)
  })
}
