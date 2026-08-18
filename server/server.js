// wiki-plugin-table — server-side component. Ported from wiki-plugin-json's
// server.coffee (Ward Cunningham): restful endpoints on the first table item
// of a page, reads open to all, writes gated by an X-Api-Key held in the
// site's status/plugin/table/tokens.json.
//
// The write route is dark unless the site has opted in with a key file, so a
// site that only ever reads carries no write surface at all — see below.
//
// This is deliberately the ONLY thing this file does. Everything else the
// plugin offers over HTTP — read.json, list.json, csv.json, write.json and
// the MCP tools — is declared in api/openapi.json and mounted by
// wiki-plugin-farm under /system/api/table/. The api-key door stays here
// because headless writers (scripts, agents on another machine) have no
// owner cookie, which is what the farm's write gate asks for.
//
// CommonJS on purpose (see sibling package.json): wiki-server loads a
// plugin's server with require() on older releases and import() on newer;
// CJS works under both on every Node version.

const fs = require('node:fs')
const path = require('node:path')
const bridge = require('./bridge.js')
const core = require('./core.js')

const cors = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Api-Key')
  next()
}

// wiki-server parses JSON and form bodies only; CSV arrives as text/csv or
// text/plain with the stream untouched, so read it here (bounded).
const textBody = (req, res, next) => {
  const type = String(req.headers['content-type'] || '')
  if (!/^text\//i.test(type) || typeof req.body === 'string') return next()
  let data = ''
  let size = 0
  req.setEncoding('utf8')
  req.on('data', chunk => {
    size += chunk.length
    if (size > 5 * 1024 * 1024) {
      res.status(413).json({ status: 'error', error: 'body over 5 MB' })
      req.destroy()
      return
    }
    data += chunk
  })
  req.on('end', () => {
    req.body = data
    next()
  })
  req.on('error', next)
}

const startServer = ({ argv, app }) => {
  const origin = argv && argv.status ? path.basename(path.dirname(argv.status)) : null
  const farmRoot = argv && argv.status ? path.dirname(path.dirname(argv.status)) : null
  if (origin && app && app.pagehandler) bridge.set(origin, app.pagehandler)

  // tokens: {slug|'*': {key: {id, nb}}} — json read this once, asynchronously,
  // at start-up; a farm starts a site's server on its first request, so the
  // very next request could beat the read. Read on demand instead, cached by
  // mtime, which also means editing the file needs no restart.
  // Keys live in the site's status directory, which is not served over HTTP.
  // The file is the same one the farm's own API-key door reads —
  // status/api-keys.json, scopes "*" or "table.write" — so a site configures
  // headless writes once and both doors honour it. The older
  // status/plugin/table/tokens.json is still read, so nothing already set up
  // stops working. Read on demand, cached by mtime: no restart to rotate a key.
  const statusDir = argv && argv.status ? argv.status : path.join((argv && argv.data) || '.', 'status')
  const keyFiles = [path.join(statusDir, 'api-keys.json'), path.join(statusDir, 'plugin', 'table', 'tokens.json')]
  const cache = new Map() // file -> { mtimeMs, keys }
  const loadKeys = () => {
    let merged = null
    for (const file of keyFiles) {
      let stat
      try {
        stat = fs.statSync(file)
      } catch {
        cache.delete(file)
        continue
      }
      const hit = cache.get(file)
      if (!hit || hit.mtimeMs !== stat.mtimeMs) {
        try {
          cache.set(file, { mtimeMs: stat.mtimeMs, keys: JSON.parse(fs.readFileSync(file, 'utf8')) })
        } catch (e) {
          console.log(`caution: ${file}: ${e.message}`)
          cache.set(file, { mtimeMs: stat.mtimeMs, keys: null })
        }
      }
      const k = cache.get(file).keys
      if (k) merged = Object.assign(merged || {}, k)
    }
    return merged
  }

  // Whether this site has opted in to headless writes at all.
  const writesOffered = () => !!loadKeys()

  const authFor = (slug, key) => {
    const t = loadKeys()
    if (!t || !key) return null
    return (t[slug] && t[slug][key]) || (t['table.write'] && t['table.write'][key]) || (t['*'] && t['*'][key]) || null
  }

  const readFrom = (slug, res, send) =>
    core
      .loadPage({ origin, farmRoot, slug })
      .then(page => {
        const idx = core.findTableItem(page)
        if (idx < 0) return res.status(404).json({ error: 'No wiki-plugin-table on this page.', slug })
        send(core.readTable(page.story[idx]))
      })
      .catch(e => res.status(e.status || 500).json({ error: e.message, slug }))

  // GET /plugin/table/:slug        → {columns, rows, caption, …}
  // GET /plugin/table/:slug.csv    → text/csv
  app.get('/plugin/table/:slug', cors, (req, res, next) => {
    const raw = req.params.slug
    const csv = raw.endsWith('.csv')
    const slug = csv ? raw.slice(0, -4) : raw
    if (!/^[a-z0-9-]+$/.test(slug)) return next()
    readFrom(slug, res, table => {
      if (csv) return res.type('text/csv').send(core.toCsv(table.columns, table.rows))
      res.json(table)
    })
  })

  // PUT /plugin/table/:slug  body: {columns, rows} | array | {csv} | text/csv
  //
  // Mounted, but dark until the site opts in by writing a key file. Without one
  // the route falls through to the wiki's own 404 before reading a body or
  // sending a CORS header — a site that never authors carries no write surface,
  // and a site that adds a key file later needs no restart. Mounting only when
  // the file exists at start-up would look tidier and would silently ignore a
  // key added afterwards, which is the worse of the two failures.
  const whenOffered = (req, res, next) => (writesOffered() ? next() : next('route'))
  app.put('/plugin/table/:slug', whenOffered, cors, textBody, (req, res, next) => {
    const slug = req.params.slug
    if (!/^[a-z0-9-]+$/.test(slug)) return next()
    const auth = authFor(slug, req.headers['x-api-key'])
    if (!auth) return res.status(401).json({ status: 'error', error: 'Missing or invalid x-api-key in header' })
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : req.body
    const data = core.normaliseWrite(body)
    if (!data) return res.status(400).json({ status: 'error', error: 'Body must be {columns, rows}, an array of rows, or {csv}' })
    core
      .loadPage({ origin, farmRoot, slug })
      .then(page => {
        const item = core.applyWrite(page, slug, data, { writer: auth.id })
        if (!item) return res.status(404).json({ status: 'error', error: 'No wiki-plugin-table on this page.', slug })
        return core.savePage({ origin, slug, page }).then(() =>
          res.json({
            status: 'ok',
            writes: item.writes,
            interval: item.interval,
            length: JSON.stringify(item.resource).length,
            rows: data.rows.length,
            columns: data.columns.length,
          }),
        )
      })
      .catch(e => res.status(e.status || 500).json({ status: 'error', error: e.message, slug }))
  })
}

module.exports = { startServer }
