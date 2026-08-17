// wiki-plugin-table — server-side component. Ported from wiki-plugin-json's
// server.coffee (Ward Cunningham): restful endpoints on the first table item
// of a page, reads open to all, writes gated by an X-Api-Key held in the
// site's status/plugin/table/tokens.json.
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
  const siteDir = (argv && argv.data) || (argv && argv.status ? path.dirname(argv.status) : '.')
  const tokenFile = path.join(siteDir, 'status', 'plugin', 'table', 'tokens.json')
  let tokens = null
  let tokensMtime = 0
  const loadTokens = () => {
    let stat
    try {
      stat = fs.statSync(tokenFile)
    } catch {
      tokens = null
      return null
    }
    if (stat.mtimeMs !== tokensMtime) {
      try {
        tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
        tokensMtime = stat.mtimeMs
      } catch (e) {
        console.log(`caution: ${tokenFile}: ${e.message}`)
        tokens = null
      }
    }
    return tokens
  }

  const authFor = (slug, key) => {
    const t = loadTokens()
    if (!t || !key) return null
    return (t[slug] && t[slug][key]) || (t['*'] && t['*'][key]) || null
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
  app.put('/plugin/table/:slug', cors, textBody, (req, res, next) => {
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
