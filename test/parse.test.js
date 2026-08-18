import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse, toObjects, toCsv, sortRows, keyColumn, fromResource } = require('../src/parse/parse.cjs')

test('csv with quotes and directives', () => {
  const t = parse('CAPTION Boards\nLAYOUT grid\nBoard,RAM,Note\nPi 4,"4 GB","cheap, cheerful"\nPi 5,8 GB,"says ""hi"""\n')
  assert.equal(t.format, 'csv')
  assert.deepEqual(t.directives, { caption: 'Boards', layout: 'grid' })
  assert.deepEqual(t.columns, ['Board', 'RAM', 'Note'])
  assert.deepEqual(t.rows, [
    ['Pi 4', '4 GB', 'cheap, cheerful'],
    ['Pi 5', '8 GB', 'says "hi"'],
  ])
})

test('tsv is sniffed', () => {
  const t = parse('a\tb\n1\t2\n')
  assert.equal(t.format, 'tsv')
  assert.deepEqual(t.rows, [['1', '2']])
})

test('gfm pipe table, escaped pipe, wikilinks kept verbatim', () => {
  const src = [
    '| # | Strand | Judgement |',
    '|---|---|---|',
    '| 1 | [[Agent Score]] — a score | do first; a \\| b |',
    '| 2 | [[Musical Intention]] | second |',
  ].join('\n')
  const t = parse(src)
  assert.equal(t.format, 'gfm')
  assert.deepEqual(t.columns, ['#', 'Strand', 'Judgement'])
  assert.equal(t.rows[0][1], '[[Agent Score]] — a score')
  assert.equal(t.rows[0][2], 'do first; a | b')
  assert.equal(t.rows.length, 2)
})

test('json array of objects, columns in first-seen order', () => {
  const t = parse(JSON.stringify([{ a: 1, b: 'x' }, { b: 'y', c: true }]))
  assert.equal(t.format, 'json')
  assert.deepEqual(t.columns, ['a', 'b', 'c'])
  assert.deepEqual(t.rows, [
    ['1', 'x', ''],
    ['', 'y', 'true'],
  ])
})

test('json {columns, rows} with array rows and object rows', () => {
  const t = parse(JSON.stringify({ columns: ['k', 'v'], rows: [['a', 1], { k: 'b', v: 2 }] }))
  assert.deepEqual(t.rows, [
    ['a', '1'],
    ['b', '2'],
  ])
})

test('bad json warns, no throw', () => {
  const t = parse('{not json')
  assert.equal(t.columns.length, 0)
  assert.match(t.warnings[0], /JSON did not parse/)
})

test('unknown LAYOUT warns; ragged rows padded and flagged', () => {
  const t = parse('LAYOUT sideways\na,b,c\n1,2\n1,2,3,4\n')
  assert.match(t.warnings[0], /LAYOUT sideways/)
  assert.deepEqual(t.rows, [
    ['1', '2', ''],
    ['1', '2', '3'],
  ])
  assert.match(t.warnings[1], /padded or trimmed/)
})

test('empty text', () => {
  assert.equal(parse('').format, 'empty')
  assert.equal(parse(undefined).format, 'empty')
})

test('helpers: objects, csv round trip, sort, key column', () => {
  const t = parse('name,score\nzed,10\namy,2\n')
  assert.deepEqual(toObjects(t.columns, t.rows), [
    { name: 'zed', score: 10 },
    { name: 'amy', score: 2 },
  ])
  const back = parse(toCsv(t.columns, t.rows))
  assert.deepEqual(back.rows, t.rows)
  assert.deepEqual(sortRows(t.columns, t.rows, { column: 'score' })[0][0], 'amy')
  assert.deepEqual(sortRows(t.columns, t.rows, { column: 'name', desc: true })[0][0], 'zed')
  assert.equal(keyColumn(t), 0)
  const numFirst = parse('#,Strand\n1,x\n2,y\n')
  assert.equal(keyColumn(numFirst), 1)
  assert.equal(keyColumn({ ...numFirst, directives: { key: '#' } }), 0)
})

test('fromResource accepts strings and objects', () => {
  assert.deepEqual(fromResource('a,b\n1,2\n'), { columns: ['a', 'b'], rows: [['1', '2']] })
  assert.deepEqual(fromResource([{ a: 1 }]), { columns: ['a'], rows: [['1']] })
  assert.equal(fromResource(null), null)
})

test('FOLD directive: closed|open|none, else warning', () => {
  assert.equal(parse('FOLD open\n| a | b |\n|---|---|\n| 1 | 2 |').directives.fold, 'open')
  assert.equal(parse('FOLD none\n| a | b |\n|---|---|\n| 1 | 2 |').directives.fold, 'none')
  const bad = parse('FOLD sideways\n| a | b |\n|---|---|\n| 1 | 2 |')
  assert.equal(bad.directives.fold, undefined)
  assert.match(bad.warnings[0], /FOLD sideways/)
})
