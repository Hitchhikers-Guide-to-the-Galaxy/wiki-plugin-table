// core.js — the one read/write path for table items, used by both the
// plugin's own routes (server.js) and the farm-mounted handlers (api/).
// CommonJS (see sibling package.json). Pure page-JSON functions plus two
// small IO helpers that go through the wiki's pagehandler when the bridge
// has one, and read the page file from disk when it does not.

const fs = require('node:fs')
const path = require('node:path')
const bridge = require('./bridge.js')
const { parse, fromResource, toObjects, toCsv } = require('../src/parse/parse.cjs')

/** Index of the first table item on a page, or -1 — json-plugin semantics. */
const findTableItem = page => (page && Array.isArray(page.story) ? page.story.findIndex(i => i && i.type === 'table') : -1)

/** The table as the client sees it. */
const readTable = item => {
  const parsed = parse(item.text || '')
  const pushed = fromResource(item.resource)
  const useResource = pushed && pushed.columns.length
  return {
    columns: useResource ? pushed.columns : parsed.columns,
    rows: useResource ? pushed.rows : parsed.rows,
    caption: parsed.directives.caption || null,
    layout: parsed.directives.layout || 'auto',
    format: useResource ? 'resource' : parsed.format,
    source: useResource ? 'resource' : 'text',
    warnings: parsed.warnings,
    writes: item.writes || 0,
    written: item.written || null,
    interval: item.interval || null,
    writer: item.writer || null,
    id: item.id,
  }
}

/** Accept what a writer sent — {columns, rows}, an array, or a CSV/JSON string. */
const normaliseWrite = body => {
  if (body === null || body === undefined) return null
  if (typeof body === 'string') {
    const t = fromResource(body)
    return t && t.columns.length ? t : null
  }
  if (typeof body === 'object') {
    if ('csv' in body || 'json' in body) {
      if (typeof body.csv === 'string' && body.csv.trim()) return normaliseWrite(body.csv)
      if (typeof body.json === 'string' && body.json.trim()) return normaliseWrite(body.json)
      return null
    }
    // a table shape only — a bare object is not silently turned into key/value rows here
    if (!Array.isArray(body) && !Array.isArray(body.rows)) return null
    const t = fromResource(body)
    return t && t.columns.length ? t : null
  }
  return null
}

/** Mutate the item in place with the json plugin's bookkeeping. */
const applyWrite = (page, slug, data, { writer = 'api', now = Date.now() } = {}) => {
  const idx = findTableItem(page)
  if (idx < 0) return null
  const item = page.story[idx]
  item.resource = { columns: data.columns, rows: data.rows }
  if (item.slug && item.slug === slug && item.writes) {
    item.writes += 1
    if (item.written) item.interval = now - item.written
  } else {
    item.slug = slug
    item.writes = 1
    item.interval = undefined
  }
  item.writer = writer
  item.written = now
  return item
}

// ---------- IO -----------------------------------------------------------------

const pageFile = (farmRoot, origin, slug) => path.join(farmRoot, origin, 'pages', slug)

/** Load a page: through the bridge's pagehandler if that site registered one, else from disk. */
const loadPage = ({ origin, farmRoot, slug }) =>
  new Promise((resolve, reject) => {
    if (!/^[a-z0-9-]+$/.test(String(slug || ''))) {
      const e = new Error('slug must be lowercase letters, digits and hyphens')
      e.status = 400
      return reject(e)
    }
    const ph = bridge.get(origin)
    if (ph) {
      return ph.get(slug, (err, page, status) => {
        if (err) return reject(Object.assign(new Error(String(err)), { status: 500 }))
        if (status === 404 || typeof page !== 'object') {
          return reject(Object.assign(new Error(`no page ${slug} on ${origin}`), { status: 404 }))
        }
        resolve(page)
      })
    }
    if (!farmRoot || !origin) {
      return reject(Object.assign(new Error('no page handler and no farm root to read from'), { status: 500 }))
    }
    fs.readFile(pageFile(farmRoot, origin, slug), 'utf8', (err, text) => {
      if (err) return reject(Object.assign(new Error(`no page ${slug} on ${origin}`), { status: 404 }))
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(Object.assign(new Error(`page ${slug} is not valid JSON`), { status: 500 }))
      }
    })
  })

/** Persist a page through the wiki's own pagehandler only — never raw disk. */
const savePage = ({ origin, slug, page }) =>
  new Promise((resolve, reject) => {
    const ph = bridge.get(origin)
    if (!ph) {
      return reject(
        Object.assign(new Error(`no page handler for ${origin} — the table plugin server has not started here`), {
          status: 503,
        }),
      )
    }
    ph.put(slug, page, err => (err ? reject(Object.assign(new Error(String(err)), { status: 500 })) : resolve(page)))
  })

/** Every page on a site whose story holds a table item, cheapest first pass: disk scan. */
const listTables = ({ origin, farmRoot }) => {
  const dir = path.join(farmRoot, origin, 'pages')
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => /^[a-z0-9-]+$/.test(n))
  } catch {
    return []
  }
  const out = []
  for (const slug of names) {
    let page
    try {
      const text = fs.readFileSync(path.join(dir, slug), 'utf8')
      if (!text.includes('"table"')) continue
      page = JSON.parse(text)
    } catch {
      continue
    }
    const idx = findTableItem(page)
    if (idx < 0) continue
    const t = readTable(page.story[idx])
    out.push({ slug, title: page.title || slug, caption: t.caption, columns: t.columns.length, rows: t.rows.length, source: t.source })
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

module.exports = { findTableItem, readTable, normaliseWrite, applyWrite, loadPage, savePage, listTables, toObjects, toCsv }
