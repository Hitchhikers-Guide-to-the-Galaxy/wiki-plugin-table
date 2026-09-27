import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindReorder } from '../src/client/core.js'

// A bare EventTarget stands in for the item: the rows need only closest/dataset/classList.
const fakeRow = n => {
  const classes = new Set()
  const row = {
    dataset: { row: String(n) },
    classList: { add: c => classes.add(c), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c) },
    getBoundingClientRect: () => ({ top: 0, height: 10 }),
    closest: sel => (sel === '[data-row]' ? row : null),
  }
  row.grip = { closest: sel => (sel === '.row-grip' ? row.grip : row.closest(sel)) }
  return row
}
const fire = (el, type, props) => {
  const e = new Event(type, { cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  el.dispatchEvent(e)
}

test('a second bind replaces the first, so one drop moves once', () => {
  const el = new EventTarget()
  el.querySelectorAll = () => []
  const rows = [0, 1, 2].map(fakeRow)
  const moves = []
  bindReorder(el, (from, to) => moves.push(['first', from, to]))
  bindReorder(el, (from, to) => moves.push(['second', from, to])) // the redraw after an edit
  const dataTransfer = { setData () {}, setDragImage () {} }
  fire(el, 'dragstart', { target: rows[2].grip, dataTransfer })
  fire(el, 'dragover', { target: rows[1], clientY: 1, dataTransfer })
  fire(el, 'drop', { target: rows[1], dataTransfer })
  assert.deepEqual(moves, [['second', 2, 1]])
})
