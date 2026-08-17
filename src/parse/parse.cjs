// parse.cjs — the one parser for table items, shared by the client bundle
// (esbuild inlines it) and the CommonJS server (require). Pure functions,
// no DOM, no wiki globals.
//
// A table item's text is:
//
//   [directive lines]      CAPTION …  LAYOUT grid|stack|auto  SORT col [desc]  KEY col
//   table source           GFM pipe table | CSV/TSV | JSON
//
// and parse() answers { directives, columns, rows, format, warnings } where
// rows are arrays of cell strings in column order. Everything downstream —
// rendering, CSV export, wiki.getData objects — is derived from that one shape.

const DIRECTIVES = ['CAPTION', 'LAYOUT', 'SORT', 'KEY']
const LAYOUTS = ['grid', 'stack', 'auto']

const splitLines = text => String(text || '').replace(/\r\n?/g, '\n').split('\n')

/** Peel known uppercase directives off the top; everything after is data. */
const takeDirectives = lines => {
  const directives = {}
  const warnings = []
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      if (Object.keys(directives).length) continue // blank after directives
      break
    }
    const m = /^([A-Z]+)\s+(.*)$/.exec(line.trim())
    if (!m || !DIRECTIVES.includes(m[1])) break
    const [, key, value] = m
    switch (key) {
      case 'CAPTION':
        directives.caption = value.trim()
        break
      case 'LAYOUT': {
        const v = value.trim().toLowerCase()
        if (LAYOUTS.includes(v)) directives.layout = v
        else warnings.push(`LAYOUT ${value.trim()} — expected grid, stack or auto`)
        break
      }
      case 'SORT': {
        const m2 = /^(.*?)\s+(asc|desc)$/i.exec(value.trim())
        directives.sort = m2
          ? { column: m2[1].trim(), desc: m2[2].toLowerCase() === 'desc' }
          : { column: value.trim(), desc: false }
        break
      }
      case 'KEY':
        directives.key = value.trim()
        break
    }
  }
  return { directives, warnings, rest: lines.slice(i) }
}

// ---------- CSV / TSV (RFC 4180-ish, quoted fields, either delimiter) -------

const sniffDelimiter = line => {
  const tabs = (line.match(/\t/g) || []).length
  const commas = (line.match(/,/g) || []).length
  return tabs > commas ? '\t' : ','
}

const parseDelimited = (text, delim) => {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') {
      quoted = true
    } else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map(r => r.map(v => v.trim())).filter(r => r.some(v => v !== ''))
}

// ---------- GFM pipe table ----------------------------------------------------

const isSeparator = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

const splitPipes = line => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cell = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cell += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += s[i]
  }
  cells.push(cell.trim())
  return cells
}

const parseGfm = lines => {
  const kept = lines.filter(l => l.trim() && !isSeparator(l))
  return kept.map(splitPipes)
}

// ---------- JSON --------------------------------------------------------------

const fromJson = value => {
  if (Array.isArray(value)) {
    if (!value.length) return { columns: [], rows: [] }
    if (Array.isArray(value[0])) {
      const [head, ...body] = value
      return { columns: head.map(String), rows: body.map(r => r.map(cellString)) }
    }
    const columns = []
    for (const obj of value) for (const k of Object.keys(obj || {})) if (!columns.includes(k)) columns.push(k)
    return { columns, rows: value.map(obj => columns.map(c => cellString(obj ? obj[c] : ''))) }
  }
  if (value && typeof value === 'object') {
    const columns = Array.isArray(value.columns) ? value.columns.map(String) : null
    const rows = Array.isArray(value.rows) ? value.rows : null
    if (columns && rows) {
      return {
        columns,
        rows: rows.map(r => (Array.isArray(r) ? r.map(cellString) : columns.map(c => cellString(r ? r[c] : '')))),
      }
    }
    if (rows) return fromJson(rows)
    // plain object → two-column key/value table
    return { columns: ['key', 'value'], rows: Object.entries(value).map(([k, v]) => [k, cellString(v)]) }
  }
  return { columns: [], rows: [] }
}

const cellString = v => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

// ---------- the one entry point ---------------------------------------------

/**
 * Parse an item's text (or a raw source string).
 * @returns {{directives:object, columns:string[], rows:string[][], format:string, warnings:string[]}}
 */
const parse = text => {
  const { directives, warnings, rest } = takeDirectives(splitLines(text))
  const body = rest.join('\n').trim()
  let columns = []
  let rows = []
  let format = 'empty'
  if (!body) return { directives, columns, rows, format, warnings }

  if (/^[[{]/.test(body)) {
    try {
      ;({ columns, rows } = fromJson(JSON.parse(body)))
      format = 'json'
    } catch (e) {
      warnings.push(`JSON did not parse: ${e.message}`)
      return { directives, columns: [], rows: [], format: 'json', warnings }
    }
  } else if (rest.some(isSeparator) && body.includes('|')) {
    const table = parseGfm(rest)
    columns = table[0] || []
    rows = table.slice(1)
    format = 'gfm'
  } else {
    const delim = sniffDelimiter(rest.find(l => l.trim()) || '')
    const table = parseDelimited(body, delim)
    columns = table[0] || []
    rows = table.slice(1)
    format = delim === '\t' ? 'tsv' : 'csv'
  }
  // ragged rows: pad or truncate to the header, and say so once
  const width = columns.length
  let ragged = false
  rows = rows.map(r => {
    if (r.length === width) return r
    ragged = true
    return r.length < width ? r.concat(Array(width - r.length).fill('')) : r.slice(0, width)
  })
  if (ragged) warnings.push('some rows did not match the header width and were padded or trimmed')
  return { directives, columns, rows, format, warnings }
}

/** Data pushed through the write door: {columns, rows} | array | csv string. */
const fromResource = resource => {
  if (resource === null || resource === undefined) return null
  if (typeof resource === 'string') {
    const { columns, rows } = parse(resource)
    return { columns, rows }
  }
  return fromJson(resource)
}

// ---------- helpers for consumers -------------------------------------------

const isNumeric = v => v !== '' && v !== null && v !== undefined && !isNaN(Number(String(v).replace(/,/g, '')))
const asNumber = v => Number(String(v).replace(/,/g, ''))

/** Which column heads a stacked card: KEY directive, else first non-numeric column. */
const keyColumn = ({ columns, rows, directives }) => {
  if (directives && directives.key) {
    const i = columns.findIndex(c => c.toLowerCase() === directives.key.toLowerCase())
    if (i >= 0) return i
  }
  for (let i = 0; i < columns.length; i++) {
    if (!rows.length || !rows.every(r => isNumeric(r[i]))) return i
  }
  return 0
}

/** Rows as objects keyed by column, numbers coerced — the wiki.getData shape. */
const toObjects = (columns, rows) =>
  rows.map(r => Object.fromEntries(columns.map((c, i) => [c, isNumeric(r[i]) ? asNumber(r[i]) : r[i]])))

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (columns, rows) => [columns, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'

const sortRows = (columns, rows, sort) => {
  if (!sort || !sort.column) return rows
  const i = columns.findIndex(c => c.toLowerCase() === String(sort.column).toLowerCase())
  if (i < 0) return rows
  const numeric = rows.every(r => isNumeric(r[i]) || r[i] === '')
  const sorted = rows.slice().sort((a, b) => {
    const x = a[i]
    const y = b[i]
    if (numeric) return (isNumeric(x) ? asNumber(x) : -Infinity) - (isNumeric(y) ? asNumber(y) : -Infinity)
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })
  })
  return sort.desc ? sorted.reverse() : sorted
}

module.exports = { parse, fromResource, toObjects, toCsv, sortRows, keyColumn, isNumeric, asNumber, DIRECTIVES }
