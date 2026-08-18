import { createRequire } from 'node:module'
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'
import { execSync } from 'node:child_process'
const WIKI = process.env.WIKI || (execSync('npm root -g').toString().trim() + '/wiki')
const req = createRequire(WIKI + '/index.js')
const express = req('express')
const { startServer } = createRequire(import.meta.url)(new URL('../server/server.js', import.meta.url).pathname)

const site = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'))
fs.mkdirSync(path.join(site, 'status'), { recursive: true }); fs.mkdirSync(path.join(site, 'pages'))
fs.writeFileSync(path.join(site, 'pages', 't'), JSON.stringify({ title: 'T', story: [{ type: 'table', id: 'x', text: '| a |\n|---|\n| 1 |' }], journal: [] }))

const app = express(); app.use(express.json())
// a fake pagehandler so writes have somewhere to go
let saved = null
app.pagehandler = { get: (slug, cb) => cb(null, JSON.parse(fs.readFileSync(path.join(site, 'pages', slug), 'utf8'))), put: (slug, page, cb) => { saved = page; cb(null) } }
startServer({ argv: { status: path.join(site, 'status'), data: site }, app })
app.use((rq, rs) => rs.status(404).send('WIKI-404'))   // stand-in for the wiki's own 404
const srv = app.listen(0); const port = srv.address().port
const call = (m, p, h = {}, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: h, body }).then(async r => ({ s: r.status, b: (await r.text()).slice(0, 60), cors: r.headers.get('access-control-allow-origin') }))
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? '  ok   ' : '  FAIL ') + n) }

let r = await call('GET', '/plugin/table/t'); t('read works with no key file', r.s === 200 && r.b.includes('columns'))
r = await call('PUT', '/plugin/table/t', { 'content-type': 'text/csv', 'x-api-key': 'anything' }, 'a\n9')
t('PUT with no key file falls to the wiki 404 — dark', r.s === 404 && r.b === 'WIKI-404')
t('… and no CORS header leaks', r.cors === null)

fs.writeFileSync(path.join(site, 'status', 'api-keys.json'), JSON.stringify({ 'table.write': { 'k1': { id: 'ci' } } }))
r = await call('PUT', '/plugin/table/t', { 'content-type': 'text/csv', 'x-api-key': 'k1' }, 'a\n9')
t('key file added, no restart: PUT now lights up and succeeds', r.s === 200 && r.b.includes('"status":"ok"'))
t('… and the write reached the pagehandler', saved && JSON.stringify(saved).includes('"9"'))
r = await call('PUT', '/plugin/table/t', { 'content-type': 'text/csv', 'x-api-key': 'wrong' }, 'a\n9')
t('wrong key -> 401 (route is live, key refused)', r.s === 401)
r = await call('PUT', '/plugin/table/t', { 'content-type': 'text/csv' }, 'a\n9')
t('no key header -> 401', r.s === 401)

fs.rmSync(path.join(site, 'status', 'api-keys.json'))
r = await call('PUT', '/plugin/table/t', { 'content-type': 'text/csv', 'x-api-key': 'k1' }, 'a\n9')
t('key file removed: route goes dark again, no restart', r.s === 404 && r.b === 'WIKI-404')

// legacy file still honoured
fs.mkdirSync(path.join(site, 'status', 'plugin', 'table'), { recursive: true })
fs.writeFileSync(path.join(site, 'status', 'plugin', 'table', 'tokens.json'), JSON.stringify({ '*': { 'oldkey': { id: 'legacy' } } }))
r = await call('PUT', '/plugin/table/t', { 'content-type': 'text/csv', 'x-api-key': 'oldkey' }, 'a\n9')
t('legacy tokens.json still works', r.s === 200)
srv.close(); console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0)
