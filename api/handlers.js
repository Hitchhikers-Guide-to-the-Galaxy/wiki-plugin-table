/**
 * table — the handlers named by the api declaration in package.json.
 *
 * Plain functions taking and returning plain values; nothing here sees a
 * request. The logic lives in ../server/core.js as CommonJS — imported here
 * so the farm's ESM loader and the plugin's own CJS server reach the SAME
 * module instances (the bridge holding each site's pagehandler) through
 * Node's require cache. Same trick as wiki-plugin-shortlink.
 *
 * `origin` and `farmRoot` arrive as declared context: the farm supplies them
 * from the site the question was put to, never from the caller.
 */

import core from '../server/core.js'

const need = (name, value) => {
  if (value === undefined || value === null || value === '') {
    const e = new Error(`${name} is required`)
    e.status = 400
    throw e
  }
}

const tableOn = async ({ slug, origin, farmRoot }) => {
  need('slug', slug)
  const page = await core.loadPage({ origin, farmRoot, slug })
  const idx = core.findTableItem(page)
  if (idx < 0) {
    const e = new Error(`no table item on ${origin}/${slug}`)
    e.status = 404
    throw e
  }
  return { page, item: page.story[idx], table: core.readTable(page.story[idx]) }
}

/** GET /read.json?slug= — the first table item on the page, as {columns, rows, …} */
export async function read({ slug, origin, farmRoot } = {}) {
  const { page, table } = await tableOn({ slug, origin, farmRoot })
  return { site: origin, slug, title: page.title || slug, ...table, records: core.toObjects(table.columns, table.rows) }
}

/** GET /list.json — pages on this site that carry a table item */
export async function list({ origin, farmRoot } = {}) {
  return { site: origin, tables: core.listTables({ origin, farmRoot }) }
}

/** GET /csv.json?slug= — the same table serialised as CSV text */
export async function csv({ slug, origin, farmRoot } = {}) {
  const { table } = await tableOn({ slug, origin, farmRoot })
  return { site: origin, slug, csv: core.toCsv(table.columns, table.rows) }
}

/** POST /write.json?slug=&csv= | &json= — replace the table's pushed data (farm-gated) */
export async function write({ slug, csv: csvText, json: jsonText, origin, farmRoot } = {}) {
  need('slug', slug)
  const data = core.normaliseWrite(csvText !== undefined && csvText !== '' ? { csv: csvText } : { json: jsonText })
  if (!data) {
    const e = new Error('supply csv (a CSV/TSV/markdown table) or json ({columns, rows} or an array of rows) with at least a header')
    e.status = 400
    throw e
  }
  const { page } = await tableOn({ slug, origin, farmRoot })
  const item = core.applyWrite(page, slug, data, { writer: 'farm-api' })
  await core.savePage({ origin, slug, page })
  return {
    status: 'ok',
    site: origin,
    slug,
    writes: item.writes,
    interval: item.interval,
    rows: data.rows.length,
    columns: data.columns.length,
  }
}
