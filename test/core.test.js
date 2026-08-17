import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as handlers from '../api/handlers.js'

const require = createRequire(import.meta.url)
const core = require('../server/core.js')
const bridge = require('../server/bridge.js')

const farmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'table-farm-'))
const origin = 'demo.localhost'
const pagesDir = path.join(farmRoot, origin, 'pages')
fs.mkdirSync(pagesDir, { recursive: true })
const page = {
  title: 'Boards',
  story: [
    { type: 'paragraph', id: '1', text: 'intro' },
    { type: 'table', id: '2', text: 'CAPTION Boards\nBoard,RAM\nPi 4,4\nPi 5,8\n' },
    { type: 'table', id: '3', text: 'x,y\n1,2\n' },
  ],
  journal: [],
}
fs.writeFileSync(path.join(pagesDir, 'boards'), JSON.stringify(page))
fs.writeFileSync(path.join(pagesDir, 'plain'), JSON.stringify({ title: 'Plain', story: [{ type: 'paragraph', id: '9', text: 'no table' }] }))

test('findTableItem takes the first table item', () => {
  assert.equal(core.findTableItem(page), 1)
  assert.equal(core.findTableItem({ story: [] }), -1)
})

test('readTable prefers resource over text but keeps the caption', () => {
  const t = core.readTable({ text: 'CAPTION C\na,b\n1,2\n', resource: { columns: ['q'], rows: [['z']] } })
  assert.equal(t.caption, 'C')
  assert.deepEqual(t.columns, ['q'])
  assert.equal(t.source, 'resource')
})

test('applyWrite bookkeeping matches the json plugin', () => {
  const p = JSON.parse(JSON.stringify(page))
  const data = { columns: ['a'], rows: [['1']] }
  const first = core.applyWrite(p, 'boards', data, { writer: 'w', now: 1000 })
  assert.equal(first.writes, 1)
  assert.equal(first.slug, 'boards')
  assert.equal(first.interval, undefined)
  const second = core.applyWrite(p, 'boards', data, { writer: 'w', now: 1500 })
  assert.equal(second.writes, 2)
  assert.equal(second.interval, 500)
  assert.equal(second.written, 1500)
  assert.deepEqual(second.resource, data)
})

test('normaliseWrite: object, array, csv wrapper, raw csv, junk', () => {
  assert.deepEqual(core.normaliseWrite({ columns: ['a'], rows: [[1]] }), { columns: ['a'], rows: [['1']] })
  assert.deepEqual(core.normaliseWrite([{ a: 1 }]), { columns: ['a'], rows: [['1']] })
  assert.deepEqual(core.normaliseWrite({ csv: 'a\n1\n' }), { columns: ['a'], rows: [['1']] })
  assert.deepEqual(core.normaliseWrite('a\n1\n'), { columns: ['a'], rows: [['1']] })
  assert.equal(core.normaliseWrite('   '), null)
  assert.equal(core.normaliseWrite(42), null)
})

test('handlers read/list/csv from disk when no bridge', async () => {
  const r = await handlers.read({ slug: 'boards', origin, farmRoot })
  assert.equal(r.title, 'Boards')
  assert.equal(r.caption, 'Boards')
  assert.deepEqual(r.columns, ['Board', 'RAM'])
  assert.deepEqual(r.records[0], { Board: 'Pi 4', RAM: 4 })
  const l = await handlers.list({ origin, farmRoot })
  assert.deepEqual(l.tables.map(t => t.slug), ['boards'])
  const c = await handlers.csv({ slug: 'boards', origin, farmRoot })
  assert.equal(c.csv, 'Board,RAM\nPi 4,4\nPi 5,8\n')
})

test('handlers refuse missing slug, missing page, page without table', async () => {
  await assert.rejects(handlers.read({ origin, farmRoot }), /slug is required/)
  await assert.rejects(handlers.read({ slug: 'nope', origin, farmRoot }), e => e.status === 404)
  await assert.rejects(handlers.read({ slug: 'plain', origin, farmRoot }), e => e.status === 404)
  await assert.rejects(handlers.read({ slug: '../etc', origin, farmRoot }), e => e.status === 400)
})

test('write goes through the bridge pagehandler and refuses without one', async () => {
  await assert.rejects(handlers.write({ slug: 'boards', csv: 'a\n1\n', origin, farmRoot }), e => e.status === 503)
  const saved = []
  bridge.set(origin, {
    get: (slug, cb) => cb(null, JSON.parse(fs.readFileSync(path.join(pagesDir, slug), 'utf8')), 200),
    put: (slug, p, cb) => {
      saved.push([slug, p])
      cb(null)
    },
  })
  const out = await handlers.write({ slug: 'boards', csv: 'a,b\n1,2\n3,4\n', origin, farmRoot })
  assert.equal(out.status, 'ok')
  assert.equal(out.rows, 2)
  assert.equal(saved[0][0], 'boards')
  assert.deepEqual(saved[0][1].story[1].resource.columns, ['a', 'b'])
  await assert.rejects(handlers.write({ slug: 'boards', origin, farmRoot }), e => e.status === 400)
})
